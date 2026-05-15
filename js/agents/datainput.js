/* ============================================================
   AGENT 5: DATA INPUT AGENT
   Encodes full dataset → QR code (compressed + base64)
   Decodes QR scan → reinjects data
   Separates actionables into correct categories
   ============================================================ */

class DataInputAgent {
  constructor(orchestrator) {
    this.name = "DataInput";
    this.id = "datainput";
    this.orchestrator = orchestrator;
    this.lastQRDataURL = null;
    this.lastSessionCode = null;
  }

  /* ── Encode Full Dataset → Compressed String ───────────── */
  encodeDataset(entries, guardianMemory, transcriptActionables) {
    const payload = {
      v: 2,                          // schema version
      t: Date.now(),                 // timestamp
      e: this._compressEntries(entries),
      m: this._compressMemory(guardianMemory),
      a: this._compressActionables(transcriptActionables)
    };

    const json = JSON.stringify(payload);
    const compressed = this._lzCompress(json);
    const code = btoa(compressed).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    this.lastSessionCode = code;
    this.orchestrator.emit("datainput:encoded", { codeLength: code.length, entries: entries.length });
    return code;
  }

  /* ── Decode Session Code → Dataset ────────────────────────*/
  decodeDataset(code) {
    try {
      const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
      const compressed = atob(padded);
      const json = this._lzDecompress(compressed);
      const payload = JSON.parse(json);

      if (!payload.v || !payload.e) throw new Error("Invalid payload schema");

      const result = {
        entries: this._decompressEntries(payload.e),
        memory:  this._decompressMemory(payload.m || {}),
        actionables: this._decompressActionables(payload.a || {}),
        encodedAt: new Date(payload.t).toISOString(),
        schemaVersion: payload.v
      };

      this.orchestrator.emit("datainput:decoded", { entries: result.entries.length });
      return result;
    } catch (err) {
      this.orchestrator.emit("datainput:decode_error", { error: err.message });
      return null;
    }
  }

  /* ── Generate QR Code Canvas ───────────────────────────── */
  async generateQRCode(code, canvasEl) {
    if (code.length > 2953) {
      // QR version 40 max for binary: split into multi-part
      return this._generateMultiQR(code, canvasEl);
    }

    return new Promise((resolve, reject) => {
      try {
        QRCode.toCanvas(canvasEl, code, {
          width: 180,
          margin: 1,
          color: { dark: "#000000", light: "#ffffff" },
          errorCorrectionLevel: "M"
        }, (err) => {
          if (err) { reject(err); return; }
          this.lastQRDataURL = canvasEl.toDataURL();
          this.orchestrator.emit("datainput:qr_generated", {});
          resolve(this.lastQRDataURL);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /* ── Multi-part QR for large datasets ─────────────────────*/
  _generateMultiQR(code, canvasEl) {
    // For large datasets, show a summary QR + download option
    const summary = code.slice(0, 2900);
    return new Promise((resolve, reject) => {
      QRCode.toCanvas(canvasEl, summary, {
        width: 180, margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "L"
      }, (err) => {
        if (err) { reject(err); return; }
        this.lastQRDataURL = canvasEl.toDataURL();
        this.orchestrator.emit("datainput:qr_large", { totalLength: code.length });
        resolve(this.lastQRDataURL);
      });
    });
  }

  /* ── Generate Downloadable QR Image ───────────────────────*/
  downloadQRCode(filename) {
    if (!this.lastQRDataURL) return;
    const a = document.createElement("a");
    a.href = this.lastQRDataURL;
    a.download = filename || `bobs-sleep-code-${Date.now()}.png`;
    a.click();
  }

  /* ── Download Full Session Code as Text ───────────────────*/
  downloadCodeText(code) {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bobs-sleep-code-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Process Transcript Actionables ───────────────────────*/
  processActionables(actionables) {
    const result = {
      medical: [],
      behavioral: [],
      environmental: [],
      dataUpdates: [],
      followUps: [],
      confirmed: []
    };

    for (const s of (actionables.symptoms || [])) {
      if (/pain|ache|apnea|insomnia|anxiety|nightmare/.test(s.text.toLowerCase())) {
        result.medical.push({ ...s, category: "symptom", priority: "high" });
      } else {
        result.medical.push({ ...s, category: "symptom", priority: "normal" });
      }
    }

    for (const t of (actionables.triggers || [])) {
      if (/caffeine|alcohol|medication/.test(t.text.toLowerCase())) {
        result.behavioral.push({ ...t, category: "substance_trigger" });
      } else if (/exercise|work|stress/.test(t.text.toLowerCase())) {
        result.behavioral.push({ ...t, category: "lifestyle_trigger" });
      } else {
        result.environmental.push({ ...t, category: "environmental_trigger" });
      }
    }

    for (const d of (actionables.dataUpdates || [])) {
      result.dataUpdates.push({ ...d, category: "sleep_data" });
    }

    for (const r of (actionables.recommendations || [])) {
      result.followUps.push({ ...r, category: "recommendation" });
    }

    for (const f of (actionables.confirmedFacts || [])) {
      result.confirmed.push({ ...f, category: "confirmed_fact" });
    }

    this.orchestrator.emit("datainput:actionables_processed", {
      medical: result.medical.length,
      behavioral: result.behavioral.length,
      dataUpdates: result.dataUpdates.length
    });

    return result;
  }

  /* ── LZ-style String Compression ──────────────────────────*/
  _lzCompress(str) {
    // Simple but effective repetition-based compression
    const dict = {};
    let data = str.split("");
    let out = [];
    let w = "";
    let code = 256;

    for (let i = 0; i < 256; i++) dict[String.fromCharCode(i)] = i;

    for (const c of data) {
      const wc = w + c;
      if (dict[wc] !== undefined) {
        w = wc;
      } else {
        out.push(dict[w]);
        if (code < 65535) dict[wc] = code++;
        w = c;
      }
    }
    if (w !== "") out.push(dict[w]);

    return out.map(c => String.fromCharCode(c)).join("");
  }

  _lzDecompress(str) {
    const dict = {};
    let data = str.split("").map(c => c.charCodeAt(0));
    let out = [];
    let code = 256;

    for (let i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);

    let w = String.fromCharCode(data[0]);
    out.push(w);

    for (let i = 1; i < data.length; i++) {
      const k = data[i];
      let entry;
      if (dict[k] !== undefined) entry = dict[k];
      else if (k === code) entry = w + w[0];
      else throw new Error("LZ decompress error at " + i);
      out.push(entry);
      dict[code++] = w + entry[0];
      w = entry;
    }
    return out.join("");
  }

  /* ── Compact entry serialization ──────────────────────────*/
  _compressEntries(entries) {
    return entries.map(e => ({
      d: e.date,
      s: e.status === "unknown" ? "u" : "k",
      h: e.hours,
      n: e.notes || "",
      r: e.recordedAt
    }));
  }

  _decompressEntries(compressed) {
    return (compressed || []).map(e => ({
      date: e.d,
      status: e.s === "u" ? "unknown" : "known",
      hours: e.h,
      notes: e.n || "",
      recordedAt: e.r
    }));
  }

  _compressMemory(memory) {
    if (!memory) return {};
    return {
      s: memory.symptoms || [],
      p: memory.overallPattern || "",
      f: memory.confirmedFacts || [],
      u: memory.lastUpdated || ""
    };
  }

  _decompressMemory(m) {
    return {
      symptoms:       m.s || [],
      overallPattern: m.p || "",
      confirmedFacts: m.f || [],
      lastUpdated:    m.u || ""
    };
  }

  _compressActionables(a) {
    if (!a) return {};
    return {
      m: a.medical || [],
      b: a.behavioral || [],
      d: a.dataUpdates || [],
      c: a.confirmed || []
    };
  }

  _decompressActionables(a) {
    return {
      medical:     a.m || [],
      behavioral:  a.b || [],
      dataUpdates: a.d || [],
      confirmed:   a.c || []
    };
  }

  /* ── Read QR from uploaded image ──────────────────────────*/
  async readQRFromImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width  = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            this.orchestrator.emit("datainput:qr_scanned", { data: code.data });
            resolve(code.data);
          } else {
            this.orchestrator.emit("datainput:qr_scan_failed", {});
            resolve(null);
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
}

window.DataInputAgent = DataInputAgent;