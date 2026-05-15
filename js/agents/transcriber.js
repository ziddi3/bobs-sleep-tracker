/* ============================================================
   AGENT 4: TRANSCRIPTION AGENT
   Silently records all interactions, builds full session log
   ============================================================ */

class TranscriberAgent {
  constructor(orchestrator) {
    this.name = "Transcriber";
    this.id = "transcriber";
    this.orchestrator = orchestrator;
    this.sessionLog = [];
    this.sessionId = this._genSessionId();
    this.startTime = new Date().toISOString();
  }

  _genSessionId() {
    return "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  _ts() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  /* ── Log Entry ─────────────────────────────────────────── */
  log(speaker, text, meta = {}) {
    const entry = {
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      displayTime: this._ts(),
      speaker,   // "BOB" | "USER" | "SYSTEM" | "ANALYST" | "GUARDIAN" | "AUDITOR"
      text,
      meta
    };
    this.sessionLog.push(entry);
    this.orchestrator.emit("transcriber:entry", entry);
    return entry;
  }

  logSystem(text, meta = {})   { return this.log("SYSTEM",   text, meta); }
  logBob(text, meta = {})      { return this.log("BOB",      text, meta); }
  logUser(text, meta = {})     { return this.log("USER",     text, meta); }
  logAnalyst(text, meta = {})  { return this.log("ANALYST",  text, meta); }
  logGuardian(text, meta = {}) { return this.log("GUARDIAN", text, meta); }
  logAuditor(text, meta = {})  { return this.log("AUDITOR",  text, meta); }

  /* ── Session Summary ───────────────────────────────────── */
  getSession() {
    return {
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime: new Date().toISOString(),
      entryCount: this.sessionLog.length,
      log: this.sessionLog
    };
  }

  /* ── Full Transcript Text ──────────────────────────────── */
  getTranscriptText() {
    const lines = [
      `BOB'S SLEEP TRACKER — Session Transcript`,
      `Session ID: ${this.sessionId}`,
      `Started: ${this.startTime}`,
      `Ended: ${new Date().toISOString()}`,
      `Entries: ${this.sessionLog.length}`,
      `${"─".repeat(60)}`
    ];
    for (const e of this.sessionLog) {
      lines.push(`[${e.displayTime}] ${e.speaker}: ${e.text}`);
    }
    return lines.join("\n");
  }

  /* ── Extract Actionable Items ──────────────────────────── */
  extractActionables() {
    const actionables = {
      symptoms: [],
      confirmedFacts: [],
      triggers: [],
      recommendations: [],
      dataUpdates: [],
      raw: []
    };

    for (const entry of this.sessionLog) {
      const t = entry.text.toLowerCase();

      // Symptom keywords
      if (/pain|ache|anxiety|stress|insomnia|fatigue|tired|restless|nightmare|apnea|snor/.test(t)) {
        actionables.symptoms.push({ text: entry.text, time: entry.timestamp, speaker: entry.speaker });
      }

      // Confirmed facts (user confirms something)
      if (entry.speaker === "USER" && /yes|correct|confirmed|that.s right|exactly|true/.test(t)) {
        actionables.confirmedFacts.push({ text: entry.text, time: entry.timestamp });
      }

      // Triggers
      if (/caffeine|coffee|alcohol|medication|exercise|screen|nap|work|stress/.test(t)) {
        actionables.triggers.push({ text: entry.text, time: entry.timestamp, speaker: entry.speaker });
      }

      // Recommendations
      if (entry.speaker === "BOB" && /recommend|suggest|consider|try|should|important/.test(t)) {
        actionables.recommendations.push({ text: entry.text, time: entry.timestamp });
      }

      // Data updates (sleep hours mentioned)
      if (/\d+\.?\d*\s*(hour|hr|h\b)/.test(t)) {
        actionables.dataUpdates.push({ text: entry.text, time: entry.timestamp, speaker: entry.speaker });
      }
    }

    return actionables;
  }

  /* ── Reset for New Session ─────────────────────────────── */
  newSession() {
    this.sessionLog = [];
    this.sessionId = this._genSessionId();
    this.startTime = new Date().toISOString();
    this.logSystem("New session started.");
  }
}

window.TranscriberAgent = TranscriberAgent;