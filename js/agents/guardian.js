/* ============================================================
   AGENT 6: GUARDIAN AGENT
   Safeguards memory across sessions — symptoms, patterns,
   confirmed facts. Manages session code injection between
   offline ↔ online. Prevents truncation of critical data.
   ============================================================ */

class GuardianAgent {
  constructor(orchestrator) {
    this.name = "Guardian";
    this.id = "guardian";
    this.orchestrator = orchestrator;
    this.STORAGE_KEY = "bobs_guardian_memory_v2";
    this.CODE_KEY     = "bobs_session_code_v2";
    this.memory = this._loadMemory();
  }

  /* ── Memory Schema ─────────────────────────────────────── */
  _defaultMemory() {
    return {
      symptoms:         [],   // [{text, date, confirmed}]
      confirmedFacts:   [],   // [{text, date, source}]
      overallPattern:   "",   // narrative summary of sleep pattern
      patternHistory:   [],   // [{summary, date, stats}]
      triggers:         [],   // [{text, type, date}]
      sessionCount:     0,
      firstSessionDate: null,
      lastSessionDate:  null,
      lastStats:        null,
      sessionCodes:     [],   // history of session codes (last 5)
      activeCode:       null, // current active session code
      lastUpdated:      null
    };
  }

  /* ── Load / Save ───────────────────────────────────────── */
  _loadMemory() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return this._defaultMemory();
      const parsed = JSON.parse(raw);
      return { ...this._defaultMemory(), ...parsed };
    } catch {
      return this._defaultMemory();
    }
  }

  _saveMemory() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.memory));
      this.orchestrator.emit("guardian:saved", { lastUpdated: this.memory.lastUpdated });
    } catch (e) {
      this.orchestrator.emit("guardian:save_error", { error: e.message });
    }
  }

  /* ── Update from Session ───────────────────────────────── */
  updateFromSession(analysisData, actionables, transcriptFacts) {
    const now = new Date().toISOString();
    this.memory.lastUpdated     = now;
    this.memory.lastSessionDate = now;
    this.memory.sessionCount    = (this.memory.sessionCount || 0) + 1;

    if (!this.memory.firstSessionDate) {
      this.memory.firstSessionDate = now;
    }

    // Update stats snapshot
    if (analysisData?.stats) {
      this.memory.lastStats = { ...analysisData.stats, recordedAt: now };
    }

    // Update overall pattern
    if (analysisData?.insights?.length > 0) {
      this.memory.overallPattern = analysisData.insights.map(i => i.text).join(" ");
    }

    // Store pattern history (keep last 10)
    if (analysisData?.stats) {
      this.memory.patternHistory.push({
        summary: this.memory.overallPattern,
        date: now,
        stats: analysisData.stats
      });
      if (this.memory.patternHistory.length > 10) {
        this.memory.patternHistory = this.memory.patternHistory.slice(-10);
      }
    }

    // Merge symptoms (deduplicate by text)
    for (const s of (actionables?.medical || [])) {
      const exists = this.memory.symptoms.find(x => x.text === s.text);
      if (!exists) {
        this.memory.symptoms.push({
          text: s.text,
          date: s.time || now,
          confirmed: false,
          priority: s.priority || "normal"
        });
      }
    }
    // Keep last 50 symptoms
    if (this.memory.symptoms.length > 50) {
      this.memory.symptoms = this.memory.symptoms.slice(-50);
    }

    // Merge confirmed facts from transcript
    for (const f of (transcriptFacts || [])) {
      const text = typeof f === "string" ? f : f.text;
      if (!text) continue;
      const exists = this.memory.confirmedFacts.find(x => x.text === text);
      if (!exists) {
        this.memory.confirmedFacts.push({ text, date: now, source: "qa_session" });
      }
    }
    // Keep last 100 facts
    if (this.memory.confirmedFacts.length > 100) {
      this.memory.confirmedFacts = this.memory.confirmedFacts.slice(-100);
    }

    // Merge triggers
    for (const t of (actionables?.behavioral || [])) {
      const exists = this.memory.triggers.find(x => x.text === t.text);
      if (!exists) {
        this.memory.triggers.push({ text: t.text, type: t.category || "unknown", date: now });
      }
    }
    if (this.memory.triggers.length > 50) {
      this.memory.triggers = this.memory.triggers.slice(-50);
    }

    this._saveMemory();
    this.orchestrator.emit("guardian:updated", {
      symptoms: this.memory.symptoms.length,
      facts: this.memory.confirmedFacts.length,
      sessions: this.memory.sessionCount
    });
    return this.memory;
  }

  /* ── Add Single Confirmed Fact ─────────────────────────── */
  addConfirmedFact(text, source = "user") {
    const exists = this.memory.confirmedFacts.find(x => x.text === text);
    if (!exists) {
      this.memory.confirmedFacts.push({
        text,
        date: new Date().toISOString(),
        source
      });
      this._saveMemory();
      this.orchestrator.emit("guardian:fact_added", { text });
    }
  }

  /* ── Session Code Management ───────────────────────────── */
  saveSessionCode(code) {
    this.memory.activeCode = code;

    // Keep rolling history of last 5 codes
    if (!this.memory.sessionCodes.includes(code)) {
      this.memory.sessionCodes.push(code);
      if (this.memory.sessionCodes.length > 5) {
        this.memory.sessionCodes = this.memory.sessionCodes.slice(-5);
      }
    }

    // Also save to dedicated key for quick access
    try {
      localStorage.setItem(this.CODE_KEY, code);
    } catch {}

    this._saveMemory();
    this.orchestrator.emit("guardian:code_saved", { codeLength: code.length });
  }

  getActiveCode() {
    if (this.memory.activeCode) return this.memory.activeCode;
    try {
      return localStorage.getItem(this.CODE_KEY) || null;
    } catch {
      return null;
    }
  }

  /* ── Inject code from user (after data reset) ─────────── */
  injectRestorationCode(code, dataInputAgent) {
    const result = dataInputAgent.decodeDataset(code);
    if (!result) {
      this.orchestrator.emit("guardian:restore_failed", {});
      return null;
    }

    // Restore memory from code
    if (result.memory) {
      this.memory = {
        ...this._defaultMemory(),
        ...result.memory,
        activeCode: code,
        lastUpdated: new Date().toISOString()
      };
    }

    this.saveSessionCode(code);
    this._saveMemory();

    this.orchestrator.emit("guardian:restored", {
      entries: result.entries.length,
      memorySections: Object.keys(result.memory || {}).length
    });

    return result;
  }

  /* ── Build Context for Strategist ─────────────────────── */
  getContextForStrategist() {
    return {
      symptoms:       this.memory.symptoms.slice(-10),
      confirmedFacts: this.memory.confirmedFacts.slice(-20).map(f => f.text),
      overallPattern: this.memory.overallPattern,
      triggers:       this.memory.triggers.slice(-10),
      sessionCount:   this.memory.sessionCount,
      lastStats:      this.memory.lastStats
    };
  }

  /* ── Status Summary ────────────────────────────────────── */
  getStatus() {
    return {
      sessions:      this.memory.sessionCount,
      symptoms:      this.memory.symptoms.length,
      facts:         this.memory.confirmedFacts.length,
      triggers:      this.memory.triggers.length,
      hasCode:       !!this.memory.activeCode,
      lastUpdated:   this.memory.lastUpdated,
      pattern:       this.memory.overallPattern
        ? this.memory.overallPattern.slice(0, 120) + (this.memory.overallPattern.length > 120 ? "…" : "")
        : "No pattern established yet"
    };
  }

  /* ── Clear Memory (but keep code history) ─────────────── */
  clearSessionMemory() {
    const codes = this.memory.sessionCodes;
    const active = this.memory.activeCode;
    this.memory = this._defaultMemory();
    this.memory.sessionCodes = codes;
    this.memory.activeCode = active;
    this._saveMemory();
    this.orchestrator.emit("guardian:cleared", {});
  }

  /* ── Full Reset ────────────────────────────────────────── */
  fullReset() {
    this.memory = this._defaultMemory();
    this._saveMemory();
    try { localStorage.removeItem(this.CODE_KEY); } catch {}
    this.orchestrator.emit("guardian:full_reset", {});
  }

  getMemory() { return { ...this.memory }; }
}

window.GuardianAgent = GuardianAgent;