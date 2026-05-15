/* ============================================================
   AGENT 3: QUESTION STRATEGIST + 3a AUDITOR/ASSISTANT
   Generates contextual Q&A responses, audits before output
   ============================================================ */

class QuestionStrategistAgent {
  constructor(orchestrator) {
    this.name = "Strategist";
    this.id = "strategist";
    this.orchestrator = orchestrator;
    this.auditor = new AuditorAssistant(orchestrator);
    this.conversationHistory = [];
    this.confirmedFacts = [];
    this.sessionContext = {};
  }

  setContext(analysisData, guardianMemory) {
    this.sessionContext = {
      analysis: analysisData,
      memory: guardianMemory || {},
      setAt: new Date().toISOString()
    };
  }

  updateConfirmedFacts(facts) {
    this.confirmedFacts = facts;
  }

  _buildSystemPrompt() {
    const stats = this.sessionContext.analysis?.stats || {};
    const mem   = this.sessionContext.memory || {};
    const facts = this.confirmedFacts.map(f => `- ${f}`).join("\n") || "None yet.";
    const symptoms = mem.symptoms?.join(", ") || "None recorded.";
    const pattern  = mem.overallPattern || "Not yet established.";

    return `You are BOB, the AI sleep health assistant in Bob's Sleep Tracker. You are warm, professional, and evidence-informed.

YOUR ROLE:
- Help the user understand their sleep patterns using ONLY the data provided
- Ask clarifying questions to improve data quality and understanding
- Provide evidence-based sleep health guidance
- NEVER fabricate statistics or make up data not present in the context

CURRENT SLEEP DATA CONTEXT:
- Total recorded days: ${stats.D || 0}
- Average sleep per known day: ${stats.avgPerKnownDay || 0}h
- No-sleep days: ${stats.noSleepCount || 0} (${stats.noSleepRate || 0}%)
- Full sleep days (8h+): ${stats.fullCount || 0}
- Unknown days: ${stats.unknownCount || 0} (${stats.unknownRate || 0}%)
- 7-day trend: ${this.sessionContext.analysis?.trend?.direction || "unknown"}

CONFIRMED FACTS FROM PRIOR SESSIONS:
${facts}

KNOWN SYMPTOMS:
${symptoms}

OVERALL PATTERN:
${pattern}

STRICT RULES:
1. ONLY reference data that exists in the context above
2. If asked something outside the sleep data scope, gently redirect
3. Never diagnose medical conditions — recommend consulting a professional
4. Keep responses conversational, 2-4 sentences unless more detail is needed
5. Always maintain continuity with confirmed facts
6. Do not repeat the same question twice in a session
7. If the user seems distressed, prioritize empathy before data`;
  }

  async generateResponse(userMessage, apiKey) {
    this.orchestrator.emit("strategist:thinking", { message: userMessage });
    this.conversationHistory.push({ role: "user", content: userMessage });

    if (this.conversationHistory.length > 24) {
      this.conversationHistory = this.conversationHistory.slice(-24);
    }

    const messages = [
      { role: "system", content: this._buildSystemPrompt() },
      ...this.conversationHistory
    ];

    let rawResponse;
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages,
          temperature: 0.65,
          max_tokens: 300
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `API error ${res.status}`);
      }

      const data = await res.json();
      rawResponse = data.choices[0].message.content.trim();
    } catch (err) {
      this.orchestrator.emit("strategist:error", { error: err.message });
      rawResponse = this._fallbackResponse(userMessage);
    }

    const auditResult = await this.auditor.audit(rawResponse, userMessage, this.sessionContext);

    if (auditResult.approved) {
      this.conversationHistory.push({ role: "assistant", content: rawResponse });
      this.orchestrator.emit("strategist:approved", { response: rawResponse, audit: auditResult });
      return { text: rawResponse, audited: true, auditNote: auditResult.note };
    } else {
      this.orchestrator.emit("strategist:rejected", { response: rawResponse, audit: auditResult });
      const corrected = await this._correctResponse(rawResponse, auditResult, apiKey);
      this.conversationHistory.push({ role: "assistant", content: corrected });
      this.orchestrator.emit("strategist:corrected", { response: corrected });
      return { text: corrected, audited: true, corrected: true, auditNote: auditResult.reason };
    }
  }

  async _correctResponse(originalResponse, auditResult, apiKey) {
    const correctionPrompt = `Your previous response was flagged by the auditor.

ORIGINAL RESPONSE: "${originalResponse}"

AUDIT REJECTION REASON: ${auditResult.reason}

CORRECTION DIRECTIVE: ${auditResult.directive}

Please rewrite your response following the directive exactly. Be concise and stay grounded in the actual data context provided.`;

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: this._buildSystemPrompt() },
            { role: "user", content: correctionPrompt }
          ],
          temperature: 0.3,
          max_tokens: 250
        })
      });

      if (!res.ok) throw new Error("Correction API error");
      const data = await res.json();
      return data.choices[0].message.content.trim();
    } catch {
      return this._fallbackResponse("");
    }
  }

  _fallbackResponse(userMessage) {
    const stats = this.sessionContext.analysis?.stats || {};
    if (/how.*sleep|sleep.*how/i.test(userMessage)) {
      return stats.D > 0
        ? `Based on your ${stats.D} recorded days, you're averaging ${stats.avgPerKnownDay} hours per night. ${stats.avgPerKnownDay < 6 ? "That's below the recommended 7-9 hours." : "That's within a reasonable range."}`
        : "I don't have enough data yet to give you a full picture. Let's start building your sleep log.";
    }
    if (/pattern|trend/i.test(userMessage)) {
      return `Your current 7-day trend is ${this.sessionContext.analysis?.trend?.direction || "unclear"}. Keep logging consistently for more accurate pattern detection.`;
    }
    return "I'm here to help you understand your sleep patterns. What would you like to know about your data?";
  }

  async generateOpeningQuestion(apiKey) {
    const stats = this.sessionContext.analysis?.stats || {};
    const userMsg = stats.D > 0
      ? `I've just synced my sleep data. I have ${stats.D} days recorded, averaging ${stats.avgPerKnownDay}h per night. Please give me a brief welcome and your most important observation about my sleep data.`
      : "I just opened Bob's Sleep Tracker for the first time. Please welcome me and ask me to tell you about my sleep.";
    return this.generateResponse(userMsg, apiKey);
  }

  clearHistory() {
    this.conversationHistory = [];
  }
}

/* ============================================================
   AGENT 3a: AUDITOR / ASSISTANT
   Reviews strategist output before it reaches the voice agent
   ============================================================ */
class AuditorAssistant {
  constructor(orchestrator) {
    this.name = "Auditor";
    this.id = "auditor";
    this.orchestrator = orchestrator;
  }

  async audit(responseText, userMessage, sessionContext) {
    this.orchestrator.emit("auditor:checking", { response: responseText });

    const stats = sessionContext?.analysis?.stats || {};
    const issues = [];

    const mentionedNumbers = responseText.match(/\d+\.?\d*\s*(hour|h\b|%|day|night)/gi) || [];
    for (const num of mentionedNumbers) {
      const val = parseFloat(num);
      if (!isNaN(val) && val > 12) {
        issues.push({
          type: "hallucinated_statistic",
          detail: `Number "${num}" may not match known data points.`
        });
      }
    }

    if (/you have|you suffer from|diagnosed with|you are experiencing/i.test(responseText)) {
      issues.push({
        type: "medical_diagnosis",
        detail: "Response makes a definitive medical claim. BOB should not diagnose."
      });
    }

    if (/studies show|research proves|clinically proven|scientifically established/i.test(responseText) && stats.D < 3) {
      issues.push({
        type: "unsupported_claim",
        detail: "Citing external studies to fill insufficient data."
      });
    }

    if (/stock|invest|politic|religion|relationship advice|diet plan/i.test(responseText)) {
      issues.push({
        type: "scope_drift",
        detail: "Response has drifted outside sleep health domain."
      });
    }

    if (issues.length === 0) {
      this.orchestrator.emit("auditor:approved", { response: responseText });
      return { approved: true, note: "All checks passed.", issues: [] };
    }

    const reason = issues.map(i => `[${i.type.toUpperCase()}] ${i.detail}`).join("; ");
    const directive = this._buildDirective(issues, stats, userMessage);

    this.orchestrator.emit("auditor:rejected", { issues, reason, directive });
    return { approved: false, reason, directive, issues };
  }

  _buildDirective(issues, stats, userMessage) {
    const parts = ["CORRECTION REQUIRED — Rewrite your response following these rules:"];

    for (const issue of issues) {
      switch (issue.type) {
        case "hallucinated_statistic":
          parts.push(`WHO: You (BOB). WHAT: You stated a number not in the user's actual data. WHY: This is hallucination. HOW: Only use these verified values: avg=${stats.avgPerKnownDay}h, total days=${stats.D}, no-sleep days=${stats.noSleepCount}. DIRECTIVE: Only reference data explicitly provided in context.`);
          break;
        case "medical_diagnosis":
          parts.push(`WHO: You (BOB). WHAT: You stated a definitive medical condition. WHY: BOB cannot diagnose. HOW: Use observational language and recommend professional consultation. DIRECTIVE: Never diagnose.`);
          break;
        case "unsupported_claim":
          parts.push(`WHO: You (BOB). WHAT: You cited research to fill thin data. WHY: This creates false authority. HOW: Acknowledge limited data and encourage continued logging. DIRECTIVE: Stay grounded in actual data.`);
          break;
        case "scope_drift":
          parts.push(`WHO: You (BOB). WHAT: Response drifted outside sleep health. WHY: BOB's purpose is sleep tracking only. HOW: Redirect back to sleep health and the tracker data. DIRECTIVE: Stay focused on sleep patterns.`);
          break;
      }
    }

    return parts.join("\n\n");
  }
}

window.QuestionStrategistAgent = QuestionStrategistAgent;
window.AuditorAssistant = AuditorAssistant;