/* ============================================================
   AGENT ORCHESTRATOR
   Central event bus + agent lifecycle manager
   Wires: Analyst → Strategist+Auditor → Voice → Transcriber
          → DataInput → Guardian
   ============================================================ */

class AgentOrchestrator {
  constructor() {
    this.listeners = {};
    this.apiKey = null;
    this.groqBaseURL = "/api/openai/v1";
    this.isOnline = false;
    this.agents = {};
    this.uiCallbacks = {};
  }

  /* ── Event Bus ─────────────────────────────────────────── */
  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  off(event, cb) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== cb);
  }

  emit(event, data) {
    (this.listeners[event] || []).forEach(cb => {
      try { cb(data); } catch (e) { console.warn(`[Orchestrator] Error in handler for ${event}:`, e); }
    });
    // Also emit to wildcard listeners
    (this.listeners["*"] || []).forEach(cb => {
      try { cb(event, data); } catch {}
    });
  }

  /* ── Init All Agents ───────────────────────────────────── */
  init(apiKey) {
    this.apiKey = apiKey;

    this.agents.analyst    = new AnalystAgent(this);
    this.agents.voice      = new VoiceAgent(this);
    this.agents.strategist = new QuestionStrategistAgent(this);
    this.agents.transcriber= new TranscriberAgent(this);
    this.agents.datainput  = new DataInputAgent(this);
    this.agents.guardian   = new GuardianAgent(this);

    // Wire API key to voice
    this.agents.voice.setApiKey(apiKey);
    this.agents.voice.setOpenAITTS(true); // Use Groq-compatible TTS if available

    // Wire speech recognition results to conversation pipeline
    this.on("voice:final", async (data) => {
      await this.handleUserSpeech(data.text);
    });

    // Log all events to transcriber
    this.on("*", (event, data) => {
      if (event.startsWith("voice:speech_start")) {
        this.agents.transcriber.logBob(data.text || "", { event });
      }
    });

    this.emit("orchestrator:ready", { agents: Object.keys(this.agents) });
    return this.agents;
  }

  /* ── Go Online ─────────────────────────────────────────── */
  async goOnline(entries) {
    this.isOnline = true;
    this.agents.transcriber.newSession();
    this.agents.transcriber.logSystem("Session started — online mode activated.");

    // Step 1: Analyze data
    this.emit("ui:agent_status", { id: "analyst", status: "active", text: "Analyzing data…" });
    const analysis = this.agents.analyst.analyze(entries);
    this.agents.transcriber.logAnalyst(this.agents.analyst.getContextSummary());
    this.emit("ui:agent_status", { id: "analyst", status: "idle", text: "Ready" });

    // Step 2: Load guardian memory
    this.emit("ui:agent_status", { id: "guardian", status: "active", text: "Loading memory…" });
    const guardianCtx = this.agents.guardian.getContextForStrategist();
    this.agents.transcriber.logGuardian("Memory context loaded for session.");
    this.emit("ui:agent_status", { id: "guardian", status: "idle", text: "Guarding" });

    // Step 3: Set context for strategist
    this.agents.strategist.setContext(analysis, guardianCtx);
    this.agents.strategist.clearHistory();

    // Step 4: Render analysis in UI
    this.emit("ui:analysis_ready", analysis);
    this.emit("ui:guardian_status", this.agents.guardian.getStatus());

    // Step 5: Opening question
    this.emit("ui:agent_status", { id: "strategist", status: "thinking", text: "Preparing…" });
    this.emit("ui:agent_status", { id: "auditor",    status: "thinking", text: "Auditing…" });
    const opening = await this.agents.strategist.generateOpeningQuestion(this.apiKey);
    this.emit("ui:agent_status", { id: "strategist", status: "idle", text: "Ready" });
    this.emit("ui:agent_status", { id: "auditor",    status: "idle", text: "Approved" });

    // Step 6: Speak opening
    this.emit("ui:agent_status", { id: "voice", status: "speaking", text: "Speaking…" });
    this.emit("ui:chat_message", { speaker: "bob", text: opening.text, audited: opening.audited });
    await this.agents.voice.speak(opening.text);
    this.emit("ui:agent_status", { id: "voice", status: "idle", text: "Listening" });

    this.emit("orchestrator:online_ready", { analysis, opening });
    return { analysis, opening };
  }

  /* ── Handle User Speech Input ──────────────────────────── */
  async handleUserSpeech(userText) {
    if (!userText?.trim()) return;

    // Transcribe user input
    this.agents.transcriber.logUser(userText);
    this.emit("ui:chat_message", { speaker: "user", text: userText });
    this.emit("ui:interim_text", { text: "" });

    // Strategist generates response
    this.emit("ui:agent_status", { id: "strategist", status: "thinking", text: "Thinking…" });
    this.emit("ui:agent_status", { id: "auditor",    status: "thinking", text: "Reviewing…" });

    const result = await this.agents.strategist.generateResponse(userText, this.apiKey);

    this.emit("ui:agent_status", { id: "strategist", status: "idle", text: "Ready" });
    this.emit("ui:agent_status", { id: "auditor",    status: result.corrected ? "active" : "idle",
                                   text: result.corrected ? "Corrected" : "Approved" });

    // Check for confirmed facts
    if (/yes|correct|right|exactly|confirmed|true/i.test(userText)) {
      const lastBob = [...this.agents.transcriber.sessionLog]
        .reverse()
        .find(e => e.speaker === "BOB");
      if (lastBob) {
        this.agents.guardian.addConfirmedFact(lastBob.text, "user_confirmation");
        this.agents.strategist.updateConfirmedFacts(
          this.agents.guardian.memory.confirmedFacts.map(f => f.text)
        );
      }
    }

    // Speak response
    this.emit("ui:agent_status", { id: "voice", status: "speaking", text: "Speaking…" });
    this.emit("ui:chat_message", {
      speaker: "bob",
      text: result.text,
      audited: result.audited,
      corrected: result.corrected,
      auditNote: result.auditNote
    });

    await this.agents.voice.speak(result.text);
    this.emit("ui:agent_status", { id: "voice", status: "idle", text: "Listening" });
  }

  /* ── Handle Text Input (typed) ─────────────────────────── */
  async handleTextInput(text) {
    return this.handleUserSpeech(text);
  }

  /* ── End Session + Generate Code ──────────────────────────*/
  async endSession(entries) {
    this.agents.transcriber.logSystem("Session ending — generating session code.");

    // Process actionables
    const rawActionables  = this.agents.transcriber.extractActionables();
    const processed       = this.agents.datainput.processActionables(rawActionables);

    // Update guardian
    const guardianMemory  = this.agents.guardian.updateFromSession(
      this.agents.analyst.lastAnalysis,
      processed,
      this.agents.guardian.memory.confirmedFacts.map(f => f.text)
    );

    // Generate session code
    const code = this.agents.datainput.encodeDataset(
      entries,
      guardianMemory,
      processed
    );

    // Save code to guardian
    this.agents.guardian.saveSessionCode(code);

    this.emit("ui:session_code_ready", {
      code,
      transcript: this.agents.transcriber.getTranscriptText(),
      actionables: processed,
      guardianStatus: this.agents.guardian.getStatus()
    });

    this.isOnline = false;
    return { code, processed, guardianMemory };
  }

  /* ── Restore from Code ─────────────────────────────────── */
  restoreFromCode(code) {
    const result = this.agents.guardian.injectRestorationCode(code, this.agents.datainput);
    if (result) {
      this.emit("ui:data_restored", result);
    }
    return result;
  }

  /* ── Getters ───────────────────────────────────────────── */
  getAnalysis()    { return this.agents.analyst?.lastAnalysis; }
  getTranscript()  { return this.agents.transcriber?.getTranscriptText(); }
  getGuardianStatus() { return this.agents.guardian?.getStatus(); }
}

window.AgentOrchestrator = AgentOrchestrator;