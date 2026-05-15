/* ============================================================
   AGENT 2: VOICE AGENT
   Text-to-Speech + Speech Recognition conversation interface
   Uses Web Speech API (free, built-in) + OpenAI TTS fallback
   ============================================================ */

class VoiceAgent {
  constructor(orchestrator) {
    this.name = "Voice";
    this.id = "voice";
    this.orchestrator = orchestrator;
    this.isSpeaking = false;
    this.isListening = false;
    this.recognition = null;
    this.synthesis = window.speechSynthesis;
    this.useOpenAITTS = false;  // fallback flag
    this.apiKey = null;
    this.preferredVoice = null;
    this.onUserSpeech = null;   // callback set by orchestrator
    this._initRecognition();
    this._initVoice();
  }

  setApiKey(key) { this.apiKey = key; }
  setOpenAITTS(flag) { this.useOpenAITTS = flag; }

  /* ── Speech Recognition Init ───────────────────────────── */
  _initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.orchestrator.emit("voice:no_recognition", {});
      return;
    }
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.orchestrator.emit("voice:listening_start", {});
    };

    this.recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      if (interim) this.orchestrator.emit("voice:interim", { text: interim });
      if (final)   this.orchestrator.emit("voice:final",   { text: final.trim() });
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      this.orchestrator.emit("voice:error", { error: event.error });
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.orchestrator.emit("voice:listening_end", {});
    };
  }

  /* ── Voice Selection ───────────────────────────────────── */
  _initVoice() {
    const selectVoice = () => {
      const voices = this.synthesis.getVoices();
      // Prefer a deep, clear English male voice
      const preferred = [
        "Google UK English Male",
        "Microsoft David Desktop",
        "Alex",
        "Daniel",
        "Microsoft Mark"
      ];
      for (const name of preferred) {
        const v = voices.find(v => v.name === name);
        if (v) { this.preferredVoice = v; return; }
      }
      // Fallback: first en-US or en-GB
      this.preferredVoice = voices.find(v => v.lang.startsWith("en")) || voices[0] || null;
    };

    if (this.synthesis.getVoices().length > 0) selectVoice();
    else this.synthesis.onvoiceschanged = selectVoice;
  }

  /* ── Start Listening ───────────────────────────────────── */
  startListening() {
    if (!this.recognition) {
      this.orchestrator.emit("voice:no_recognition", {});
      return false;
    }
    if (this.isSpeaking) {
      this.synthesis.cancel();
      this.isSpeaking = false;
    }
    if (this.isListening) return false;
    try {
      this.recognition.start();
      return true;
    } catch (e) {
      this.orchestrator.emit("voice:error", { error: e.message });
      return false;
    }
  }

  /* ── Stop Listening ────────────────────────────────────── */
  stopListening() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  /* ── Speak Text (Web Speech API) ───────────────────────── */
  speakWebSpeech(text) {
    return new Promise((resolve) => {
      this.synthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = this.preferredVoice;
      utterance.rate  = 0.92;
      utterance.pitch = 0.9;
      utterance.volume = 1.0;

      utterance.onstart = () => {
        this.isSpeaking = true;
        this.orchestrator.emit("voice:speech_start", { text });
      };
      utterance.onend = () => {
        this.isSpeaking = false;
        this.orchestrator.emit("voice:speech_end", { text });
        resolve();
      };
      utterance.onerror = (e) => {
        this.isSpeaking = false;
        this.orchestrator.emit("voice:error", { error: e.error });
        resolve();
      };

      this.synthesis.speak(utterance);
    });
  }

  /* ── Speak Text (OpenAI TTS) ───────────────────────────── */
  async speakOpenAI(text) {
    if (!this.apiKey) return this.speakWebSpeech(text);
    // Groq TTS has limited availability — use Web Speech API for reliable voice output
    return this.speakWebSpeech(text);
  }
  async speakOpenAI_disabled(text) {
    try {
      this.isSpeaking = true;
      this.orchestrator.emit("voice:speech_start", { text });

      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: "tts-1",
          input: text,
          voice: "onyx",
          speed: 0.95
        })
      });

      if (!res.ok) throw new Error("TTS API error");

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);

      return new Promise((resolve) => {
        audio.onended = () => {
          this.isSpeaking = false;
          URL.revokeObjectURL(url);
          this.orchestrator.emit("voice:speech_end", { text });
          resolve();
        };
        audio.onerror = () => {
          this.isSpeaking = false;
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.play().catch(() => {
          this.isSpeaking = false;
          resolve();
        });
      });
    } catch (err) {
      this.orchestrator.emit("voice:tts_fallback", {});
      return this.speakWebSpeech(text);
    }
  }

  /* ── Main Speak Entry Point ────────────────────────────── */
  async speak(text) {
    if (!text || !text.trim()) return;
    const clean = this._cleanForSpeech(text);
    if (this.useOpenAITTS && this.apiKey) {
      return this.speakOpenAI(clean);
    }
    return this.speakWebSpeech(clean);
  }

  /* ── Text Cleaning ─────────────────────────────────────── */
  _cleanForSpeech(text) {
    return text
      .replace(/[#*_`~]/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "a link")
      .replace(/\d+h\b/g, (m) => m.replace("h", " hours"))
      .replace(/Tₖ|Dₖ|Aₖ|Uᵣ|F₈/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /* ── Stop Speaking ─────────────────────────────────────── */
  stopSpeaking() {
    this.synthesis.cancel();
    this.isSpeaking = false;
    this.orchestrator.emit("voice:speech_stopped", {});
  }

  /* ── Transcribe via Whisper ────────────────────────────── */
  async transcribeAudio(audioBlob) {
    if (!this.apiKey) return null;
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.webm");
      formData.append("model", "whisper-1");
      formData.append("language", "en");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${this.apiKey}` },
        body: formData
      });

      if (!res.ok) throw new Error("Whisper error");
      const data = await res.json();
      return data.text?.trim() || null;
    } catch {
      return null;
    }
  }

  /* ── Check Capabilities ────────────────────────────────── */
  getCapabilities() {
    return {
      speechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      speechSynthesis: !!window.speechSynthesis,
      openAITTS: !!this.apiKey,
      whisper: !!this.apiKey
    };
  }
}

window.VoiceAgent = VoiceAgent;