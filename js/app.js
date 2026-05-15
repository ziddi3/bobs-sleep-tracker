/* ============================================================
   BOB'S SLEEP TRACKER — Main App Controller
   Handles offline/online toggle, UI rendering, agent wiring
   ============================================================ */

const STORAGE_KEY = "sleep_pattern_tracker_v1";
const GROQ_KEY_STORAGE = "bobs_groq_api_key";

let entries = [];
let orchestrator = null;
let isOnlineMode = false;
let currentTab = "chat";
let interimText = "";

/* ══════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════ */
function boot() {
  entries = loadEntries();
  renderOffline();

  // Try to restore API key
  const savedKey = localStorage.getItem(GROQ_KEY_STORAGE);
  if (savedKey) {
    document.getElementById("apiKeyInput").value = savedKey;
  }

  // Wire toggle
  document.getElementById("modeToggle").addEventListener("change", handleToggle);

  // Wire text input send button
  document.getElementById("textSendBtn").addEventListener("click", handleTextSend);
  document.getElementById("textInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleTextSend();
    }
  });
}

/* ══════════════════════════════════════════════════════════
   STORAGE
   ══════════════════════════════════════════════════════════ */
function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/* ══════════════════════════════════════════════════════════
   OFFLINE TRACKER LOGIC (unchanged from original)
   ══════════════════════════════════════════════════════════ */
function todayISO() {
  const d = new Date(); d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}
function parseISO(s) { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function toISO(d) { const x=new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); }
function addDays(s,n) { const d=parseISO(s); d.setDate(d.getDate()+n); return toISO(d); }
function sortedEntries() { return [...entries].sort((a,b)=>a.date.localeCompare(b.date)); }
function getNextRequiredDate() {
  const sorted = sortedEntries();
  if (!sorted.length) return todayISO();
  const last = sorted[sorted.length-1].date;
  const next = addDays(last,1);
  return next <= todayISO() ? next : null;
}
function getExisting(date) { return entries.find(e=>e.date===date); }
function formatDate(s) {
  return parseISO(s).toLocaleDateString(undefined,{weekday:"short",year:"numeric",month:"short",day:"numeric"});
}
function classifyEntry(e) {
  if (e.status==="unknown") return "unknown";
  if (Number(e.hours)===0)  return "none";
  if (Number(e.hours)>=8)   return "full";
  return "sleep";
}
function round(n) { return Number.isInteger(n)?n:n.toFixed(2); }
function escapeHTML(s) {
  return String(s).replace(/[&<>'"]/g,c=>({'&':'&','<':'<','>':'>',"'":'&#39;','"':'"'}[c]));
}

let selectedHours = null;

function selectHours(h, btn) {
  selectedHours = { status:"known", hours:h };
  document.querySelectorAll(".hour-btn").forEach(b=>b.classList.remove("selected"));
  btn.classList.add("selected");
}

function selectUnknown(btn) {
  selectedHours = { status:"unknown", hours:null };
  document.querySelectorAll(".hour-btn").forEach(b=>b.classList.remove("selected"));
  btn.classList.add("selected");
}

function saveCurrentEntry() {
  const date = getNextRequiredDate();
  if (!date) return;
  if (!selectedHours) { alert("Pick sleep hours or Unknown before saving."); return; }
  const notes = document.getElementById("offNotes")?.value.trim() || "";
  const entry = { date, status:selectedHours.status, hours:selectedHours.hours, notes, recordedAt:new Date().toISOString() };
  const existing = getExisting(date);
  if (existing) Object.assign(existing, entry);
  else entries.push(entry);
  saveEntries();
  selectedHours = null;
  renderOffline();
}

function deleteEntry(date) {
  if (!confirm(`Delete record for ${date}?`)) return;
  entries = entries.filter(e=>e.date!==date);
  saveEntries();
  renderOffline();
}

function resetAll() {
  if (!confirm("Reset all sleep tracking data? Export your session code first if needed!")) return;
  entries = [];
  saveEntries();
  renderOffline();
}

function exportData() {
  const blob = new Blob([JSON.stringify(entries,null,2)],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`sleep-tracker-${todayISO()}.json`; a.click();
  URL.revokeObjectURL(url);
}

function copySummary() {
  const D=entries.length;
  const known=entries.filter(e=>e.status!=="unknown");
  const unknown=entries.filter(e=>e.status==="unknown");
  const noSleep=known.filter(e=>Number(e.hours)===0);
  const sleep=known.filter(e=>Number(e.hours)>0);
  const full=known.filter(e=>Number(e.hours)>=8);
  const total=known.reduce((s,e)=>s+Number(e.hours||0),0);
  const avg=known.length?total/known.length:0;
  const summary=[
    "Bob's Sleep Tracker Summary",
    `Recorded days D: ${D}`, `Known Dₖ: ${known.length}`,
    `Unknown u: ${unknown.length}`, `No-sleep n: ${noSleep.length}`,
    `Sleep s: ${sleep.length}`, `8h+ x: ${full.length}`,
    `Total Tₖ: ${round(total)}h`, `Avg Aₖ: ${round(avg)}h/day`
  ].join("\n");
  navigator.clipboard.writeText(summary).then(()=>alert("Summary copied."));
}

/* ══════════════════════════════════════════════════════════
   OFFLINE RENDER
   ══════════════════════════════════════════════════════════ */
function renderOffline() {
  renderMetrics();
  renderEntryPanel();
  renderLogTable();
}

function renderMetrics() {
  const D=entries.length;
  const known=entries.filter(e=>e.status!=="unknown");
  const unknown=entries.filter(e=>e.status==="unknown");
  const noSleep=known.filter(e=>Number(e.hours)===0);
  const sleep=known.filter(e=>Number(e.hours)>0);
  const full=known.filter(e=>Number(e.hours)>=8);
  const total=known.reduce((s,e)=>s+Number(e.hours||0),0);
  const avg=known.length?total/known.length:0;
  const avgSleep=sleep.length?total/sleep.length:0;
  const uRate=D?unknown.length/D:0;

  const data=[
    ["Recorded Days",D,"Total calendar days entered"],
    ["Known Sleep Hours",round(total),"Unknown days excluded"],
    ["Avg / Known Day",round(avg),"Tₖ ÷ Dₖ"],
    ["Avg / Sleep Night",round(avgSleep),"Tₖ ÷ s"],
    ["No-Sleep Days",noSleep.length,"Confirmed 0h days"],
    ["Unknown Days",unknown.length,`${Math.round(uRate*100)}% integrity gap`],
    ["8h+ Days",full.length,"Full recovery sleep count"],
    ["Sleep Days",sleep.length,"Any sleep above 0h"]
  ];

  document.getElementById("offMetrics").innerHTML = data.map(([l,v,n])=>`
    <div class="metric-card">
      <div class="metric-label">${l}</div>
      <div class="metric-value">${v}</div>
      <div class="metric-note">${n}</div>
    </div>
  `).join("");
}

function renderEntryPanel() {
  const date = getNextRequiredDate();
  const panel = document.getElementById("offEntryPanel");
  selectedHours = null;

  if (!date) {
    panel.innerHTML = `
      <div class="panel-title"><span class="icon">✅</span> Today Is Recorded</div>
      <p class="text-muted">No action needed until the next calendar day.</p>`;
    return;
  }

  const missed = date < todayISO();
  const notice = missed
    ? `<div class="notice"><strong>Missed day detected.</strong> This date must be recorded before today. Choose actual hours, 0h, or Unknown.</div>`
    : `<div class="notice notice-blue"><strong>Current day entry.</strong> Record the best known sleep result for this calendar day.</div>`;

  const hourButtons = [0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,9,10,11,12];

  panel.innerHTML = `
    <div class="panel-title"><span class="icon">🌙</span> Record Sleep</div>
    ${notice}
    <div class="entry-date">📅 ${formatDate(date)}</div>
    <div class="hours-grid">
      ${hourButtons.map(h=>`
        <button class="hour-btn ${h===0?"zero-btn":""}" onclick="selectHours(${h},this)">${h}h</button>
      `).join("")}
      <button class="hour-btn unknown-btn" onclick="selectUnknown(this)">Unknown</button>
    </div>
    <textarea id="offNotes" placeholder="Optional: stress, caffeine, naps, medication, pain, work schedule…" style="margin-top:12px;min-height:60px;"></textarea>
    <button class="btn btn-success btn-full btn-lg" style="margin-top:10px;" onclick="saveCurrentEntry()">💾 Save This Day</button>
  `;
}

function renderLogTable() {
  const sorted = sortedEntries().reverse();
  const el = document.getElementById("offLogTable");
  if (!sorted.length) {
    el.innerHTML = `<p class="text-muted" style="padding:12px 0;">No records yet.</p>`;
    return;
  }
  el.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Date</th><th>Status</th><th>Hours</th><th>Notes</th><th></th>
      </tr></thead>
      <tbody>
        ${sorted.map(e=>{
          const cls=classifyEntry(e);
          const label=cls==="none"?"No Sleep":cls==="full"?"8h+ Sleep":cls==="unknown"?"Unknown":"Sleep";
          return `<tr>
            <td>${formatDate(e.date)}</td>
            <td><span class="tag ${cls}">${label}</span></td>
            <td>${e.status==="unknown"?"—":`${e.hours}h`}</td>
            <td>${escapeHTML(e.notes||"")}</td>
            <td><button class="btn btn-danger" onclick="deleteEntry('${e.date}')">✕</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

/* ══════════════════════════════════════════════════════════
   ONLINE / OFFLINE TOGGLE
   ══════════════════════════════════════════════════════════ */
async function handleToggle(e) {
  const online = e.target.checked;
  const dot = document.getElementById("onlineDot");
  const labelOnline = document.getElementById("labelOnline");
  const labelOffline = document.getElementById("labelOffline");

  if (online) {
    dot.classList.add("active");
    labelOnline.classList.add("active");
    labelOffline.classList.remove("active");
    document.getElementById("offlineView").style.display = "none";
    document.getElementById("onlineView").style.display  = "block";
    await initOnlineMode();
  } else {
    dot.classList.remove("active");
    labelOnline.classList.remove("active");
    labelOffline.classList.add("active");
    document.getElementById("offlineView").style.display = "block";
    document.getElementById("onlineView").style.display  = "none";
    if (orchestrator?.isOnline) {
      await endOnlineSession();
    }
  }
}

/* ══════════════════════════════════════════════════════════
   ONLINE MODE INIT
   ══════════════════════════════════════════════════════════ */
async function initOnlineMode() {
  const apiKey = getApiKey();
  if (!apiKey) {
    showApiKeySetup();
    return;
  }
  hideApiKeySetup();
  startAgentSystem(apiKey);
}

function getApiKey() {
  const input = document.getElementById("apiKeyInput")?.value?.trim();
  if (input) { localStorage.setItem(GROQ_KEY_STORAGE, input); return input; }
  return localStorage.getItem(GROQ_KEY_STORAGE) || null;
}

function showApiKeySetup() {
  document.getElementById("apiSetupBox").classList.remove("hidden");
  document.getElementById("agentSystemBox").classList.add("hidden");
}

function hideApiKeySetup() {
  document.getElementById("apiSetupBox").classList.add("hidden");
  document.getElementById("agentSystemBox").classList.remove("hidden");
}

function saveApiKey() {
  const key = document.getElementById("apiKeyInput")?.value?.trim();
  if (!key) { alert("Please enter your Groq API key."); return; }
  localStorage.setItem(GROQ_KEY_STORAGE, key);
  hideApiKeySetup();
  startAgentSystem(key);
}

async function startAgentSystem(apiKey) {
  // Create orchestrator
  orchestrator = new AgentOrchestrator();

  // Wire UI events
  wireOrchestratorEvents();

  // Init agents
  orchestrator.init(apiKey);

  // Show loading state
  setAgentStatus("analyst",    "active",   "Analyzing…");
  setAgentStatus("strategist", "thinking", "Preparing…");
  setAgentStatus("auditor",    "thinking", "Standby…");
  setAgentStatus("voice",      "active",   "Loading…");
  setAgentStatus("transcriber","active",   "Recording…");
  setAgentStatus("datainput",  "active",   "Ready…");
  setAgentStatus("guardian",   "active",   "Loading memory…");

  // Go online
  await orchestrator.goOnline(entries);
  isOnlineMode = true;
}

/* ══════════════════════════════════════════════════════════
   ORCHESTRATOR EVENT WIRING
   ══════════════════════════════════════════════════════════ */
function wireOrchestratorEvents() {
  orchestrator.on("ui:agent_status", ({ id, status, text }) => {
    setAgentStatus(id, status, text);
  });

  orchestrator.on("ui:analysis_ready", (analysis) => {
    renderOnlineAnalysis(analysis);
  });

  orchestrator.on("ui:chat_message", ({ speaker, text, audited, corrected, auditNote }) => {
    appendChatBubble(speaker, text, audited, corrected);
    appendTranscriptEntry(speaker, text);
  });

  orchestrator.on("ui:interim_text", ({ text }) => {
    interimText = text;
    const el = document.getElementById("interimDisplay");
    if (el) el.textContent = text || "";
  });

  orchestrator.on("voice:interim", ({ text }) => {
    const el = document.getElementById("interimDisplay");
    if (el) el.textContent = "🎙 " + text;
  });

  orchestrator.on("voice:listening_start", () => {
    document.getElementById("micBtn")?.classList.add("recording");
    document.getElementById("voiceVisualizer")?.classList.add("active");
    setAgentStatus("voice", "speaking", "Listening…");
  });

  orchestrator.on("voice:listening_end", () => {
    document.getElementById("micBtn")?.classList.remove("recording");
    document.getElementById("voiceVisualizer")?.classList.remove("active");
    document.getElementById("interimDisplay").textContent = "";
    setAgentStatus("voice", "active", "Processing…");
  });

  orchestrator.on("voice:speech_start", () => {
    document.getElementById("voiceVisualizer")?.classList.add("active");
    setAgentStatus("voice", "speaking", "Speaking…");
  });

  orchestrator.on("voice:speech_end", () => {
    document.getElementById("voiceVisualizer")?.classList.remove("active");
    setAgentStatus("voice", "idle", "Ready");
  });

  orchestrator.on("ui:guardian_status", (status) => {
    renderGuardianStatus(status);
  });

  orchestrator.on("ui:session_code_ready", ({ code, transcript, actionables }) => {
    renderSessionCode(code, transcript, actionables);
  });

  orchestrator.on("ui:data_restored", (result) => {
    entries = result.entries;
    saveEntries();
    renderOffline();
    showToast(`✅ Restored ${result.entries.length} entries from session code.`);
  });

  orchestrator.on("datainput:qr_generated", () => {
    showToast("QR code generated successfully.");
  });

  orchestrator.on("datainput:decode_error", ({ error }) => {
    showToast("❌ Could not decode session code: " + error, "error");
  });

  orchestrator.on("guardian:fact_added", ({ text }) => {
    showToast("✓ Confirmed fact saved to memory.");
  });
}

/* ══════════════════════════════════════════════════════════
   ONLINE UI RENDERS
   ══════════════════════════════════════════════════════════ */
function setAgentStatus(id, status, text) {
  const pill = document.getElementById(`agent-${id}`);
  if (!pill) return;
  pill.className = `agent-pill ${status}`;
  const nameEl   = pill.querySelector(".agent-name");
  const statusEl = pill.querySelector(".agent-status-text");
  if (statusEl) statusEl.textContent = text || status;
}

function appendChatBubble(speaker, text, audited = false, corrected = false) {
  const container = document.getElementById("chatContainer");
  if (!container) return;

  const isBob = speaker === "bob";
  const avatar = isBob ? "🤖" : "🧑";
  const cls    = isBob ? "bob" : "user";
  const auditBadge = (isBob && audited)
    ? `<span class="audit-badge">${corrected ? "⚡ Corrected" : "✅ Audited"}</span>` : "";

  const div = document.createElement("div");
  div.className = `chat-bubble ${cls}`;
  div.innerHTML = `
    <div class="bubble-avatar">${avatar}</div>
    <div>
      <div class="bubble-content">${escapeHTML(text)}</div>
      <div class="bubble-meta">
        <span>${isBob ? "BOB" : "You"}</span>
        <span>${new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
        ${auditBadge}
      </div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendTranscriptEntry(speaker, text) {
  const log = document.getElementById("transcriptLog");
  if (!log) return;
  const ts = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  const speakerCls = speaker === "bob" ? "speaker-bob" : speaker === "system" ? "speaker-sys" : "speaker-user";
  const speakerLabel = speaker === "bob" ? "BOB" : speaker === "system" ? "SYS" : "YOU";
  const div = document.createElement("div");
  div.className = "transcript-entry";
  div.innerHTML = `<span class="ts">[${ts}]</span><span class="${speakerCls}">${speakerLabel}: </span>${escapeHTML(text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function renderOnlineAnalysis(analysis) {
  const el = document.getElementById("onlineAnalysisContent");
  if (!el) return;
  const s = analysis.stats;
  const t = analysis.trend;

  el.innerHTML = `
    <div class="metrics-grid" style="margin:0 0 12px;">
      <div class="metric-card">
        <div class="metric-label">Avg / Known Day</div>
        <div class="metric-value">${s.avgPerKnownDay}h</div>
        <div class="metric-note">Known sample days: ${s.knownCount}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">7-Day Trend</div>
        <div class="metric-value" style="font-size:1.2rem;">${t.direction === "improving" ? "📈" : t.direction === "declining" ? "📉" : "➡️"} ${t.direction}</div>
        <div class="metric-note">Δ ${t.delta > 0 ? "+" : ""}${t.delta}h vs prior 7 days</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">No-Sleep Rate</div>
        <div class="metric-value" style="color:${s.noSleepRate > 30 ? "var(--bad)" : "var(--warn)"};">${s.noSleepRate}%</div>
        <div class="metric-note">${s.noSleepCount} confirmed 0h days</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Full Sleep Rate</div>
        <div class="metric-value" style="color:var(--good);">${s.fullSleepRate}%</div>
        <div class="metric-note">${s.fullCount} days ≥ 8h</div>
      </div>
    </div>

    <div class="analysis-section">
      <div class="analysis-heading">🔍 AI Insights</div>
      ${analysis.insights.map(i=>`
        <div class="insight-item">
          <span class="insight-icon">${i.icon}</span>
          <span class="analysis-text">${escapeHTML(i.text)}</span>
        </div>
      `).join("")}
    </div>

    ${analysis.patterns.length ? `
    <div class="analysis-section" style="margin-top:10px;">
      <div class="analysis-heading">🏷️ Detected Patterns</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
        ${analysis.patterns.map(p=>`<span class="tag ${p.color === "good" ? "full" : p.color === "bad" ? "none" : "unknown"}">${p.label}</span>`).join("")}
      </div>
    </div>` : ""}

    <div class="analysis-section" style="margin-top:10px;">
      <div class="analysis-heading">📊 Streak Data</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;">
        <div><span style="color:var(--muted2);font-size:0.78rem;">Current Sleep Streak</span><br><strong style="color:var(--good);">${analysis.streaks.currentSleepStreak} days</strong></div>
        <div><span style="color:var(--muted2);font-size:0.78rem;">Best Sleep Streak</span><br><strong style="color:var(--blue);">${analysis.streaks.bestSleepStreak} days</strong></div>
        <div><span style="color:var(--muted2);font-size:0.78rem;">No-Sleep Streak</span><br><strong style="color:${analysis.streaks.currentNoSleepStreak > 2 ? "var(--bad)" : "var(--muted2)"};">${analysis.streaks.currentNoSleepStreak} days</strong></div>
        <div><span style="color:var(--muted2);font-size:0.78rem;">Worst No-Sleep Run</span><br><strong style="color:var(--bad);">${analysis.streaks.bestNoSleepStreak} days</strong></div>
      </div>
    </div>
  `;
}

function renderGuardianStatus(status) {
  const el = document.getElementById("guardianContent");
  if (!el) return;
  el.innerHTML = `
    <div class="guardian-panel">
      <div class="guardian-item">
        <div class="guardian-item-title">Sessions Tracked</div>
        <div class="guardian-item-value">${status.sessions}</div>
      </div>
      <div class="guardian-item">
        <div class="guardian-item-title">Symptoms Logged</div>
        <div class="guardian-item-value">${status.symptoms}</div>
      </div>
      <div class="guardian-item">
        <div class="guardian-item-title">Confirmed Facts</div>
        <div class="guardian-item-value">${status.facts}</div>
      </div>
      <div class="guardian-item">
        <div class="guardian-item-title">Session Code</div>
        <div class="guardian-item-value">${status.hasCode ? "✅ Active" : "⏳ Pending"}</div>
      </div>
    </div>
    <div class="guardian-item" style="margin-top:10px;">
      <div class="guardian-item-title">Overall Pattern</div>
      <div class="guardian-item-value" style="font-size:0.82rem;">${escapeHTML(status.pattern)}</div>
    </div>
    ${status.lastUpdated ? `<div class="text-muted" style="margin-top:8px;font-size:0.72rem;">Last updated: ${new Date(status.lastUpdated).toLocaleString()}</div>` : ""}
  `;
}

function renderSessionCode(code, transcript, actionables) {
  const el = document.getElementById("sessionCodeContent");
  if (!el) return;

  el.innerHTML = `
    <div class="notice notice-good">
      <strong>Session complete!</strong> Your data has been encoded into a session code. Save the QR code or copy the text code before resetting data.
    </div>
    <div class="qr-display">
      <div class="qr-frame"><canvas id="qrCanvas"></canvas></div>
      <div class="qr-instructions">Scan this QR code to restore your complete dataset.<br>Or use the text code below.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
        <button class="btn btn-primary" onclick="downloadQRCode()">⬇️ Download QR</button>
        <button class="btn btn-primary" onclick="downloadCodeText()">📄 Download Code</button>
        <button class="btn btn-ghost" onclick="copyCode()">📋 Copy Code</button>
      </div>
    </div>
    <div style="margin-top:12px;">
      <div class="analysis-heading" style="margin-bottom:6px;">📋 Processed Actionables</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
        <div class="guardian-item"><div class="guardian-item-title">Medical</div><div class="guardian-item-value">${(actionables?.medical||[]).length}</div></div>
        <div class="guardian-item"><div class="guardian-item-title">Behavioral</div><div class="guardian-item-value">${(actionables?.behavioral||[]).length}</div></div>
        <div class="guardian-item"><div class="guardian-item-title">Data Updates</div><div class="guardian-item-value">${(actionables?.dataUpdates||[]).length}</div></div>
      </div>
    </div>
  `;

  // Store code globally for download functions
  window._currentSessionCode = code;
  window._currentTranscript  = transcript;

  // Generate QR
  const canvas = document.getElementById("qrCanvas");
  if (canvas && window.QRCode) {
    orchestrator.agents.datainput.generateQRCode(code, canvas).catch(console.warn);
  }

  // Switch to session code tab
  switchTab("code");
}

/* ══════════════════════════════════════════════════════════
   VOICE CONTROLS
   ══════════════════════════════════════════════════════════ */
function toggleMic() {
  if (!orchestrator) return;
  const voice = orchestrator.agents.voice;
  if (voice.isListening) {
    voice.stopListening();
  } else {
    if (!voice.startListening()) {
      showToast("Microphone not available. Use text input below.", "warn");
    }
  }
}

function stopSpeaking() {
  orchestrator?.agents?.voice?.stopSpeaking();
}

function handleTextSend() {
  const input = document.getElementById("textInput");
  const text = input?.value?.trim();
  if (!text || !orchestrator) return;
  input.value = "";
  orchestrator.handleTextInput(text);
}

/* ══════════════════════════════════════════════════════════
   SESSION CODE ACTIONS
   ══════════════════════════════════════════════════════════ */
function downloadQRCode() {
  orchestrator?.agents?.datainput?.downloadQRCode(`bobs-sleep-qr-${todayISO()}.png`);
}

function downloadCodeText() {
  if (!window._currentSessionCode) return;
  orchestrator?.agents?.datainput?.downloadCodeText(window._currentSessionCode);
}

function copyCode() {
  if (!window._currentSessionCode) return;
  navigator.clipboard.writeText(window._currentSessionCode)
    .then(() => showToast("Session code copied to clipboard."));
}

function downloadTranscript() {
  if (!window._currentTranscript) return;
  const blob = new Blob([window._currentTranscript], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `bobs-transcript-${todayISO()}.txt`; a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════════════════
   QR CODE RESTORE
   ══════════════════════════════════════════════════════════ */
function handleQRUpload(input) {
  const file = input.files[0];
  if (!file || !orchestrator) return;
  orchestrator.agents.datainput.readQRFromImage(file).then(code => {
    if (code) {
      const result = orchestrator.restoreFromCode(code);
      if (result) showToast(`✅ Restored ${result.entries.length} entries!`);
    } else {
      showToast("Could not read QR code from image.", "error");
    }
  });
}

function restoreFromTextCode() {
  const code = document.getElementById("manualCodeInput")?.value?.trim();
  if (!code || !orchestrator) return;
  const result = orchestrator.restoreFromCode(code);
  if (result) showToast(`✅ Restored ${result.entries.length} entries!`);
  else showToast("Invalid session code.", "error");
}

/* ══════════════════════════════════════════════════════════
   END SESSION
   ══════════════════════════════════════════════════════════ */
async function endOnlineSession() {
  if (!orchestrator) return;
  await orchestrator.endSession(entries);
}

async function generateSessionCode() {
  if (!orchestrator) return;
  await orchestrator.endSession(entries);
}

/* ══════════════════════════════════════════════════════════
   TABS
   ══════════════════════════════════════════════════════════ */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-content").forEach(c => {
    c.classList.toggle("active", c.id === `tab-${tab}`);
  });
}

/* ══════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ══════════════════════════════════════════════════════════ */
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.style.cssText = `
    background: ${type === "error" ? "rgba(255,68,85,0.15)" : type === "warn" ? "rgba(255,170,0,0.15)" : "rgba(0,170,255,0.15)"};
    border: 1px solid ${type === "error" ? "var(--bad)" : type === "warn" ? "var(--warn)" : "var(--blue-dim)"};
    color: ${type === "error" ? "var(--bad)" : type === "warn" ? "var(--warn)" : "var(--text)"};
    padding: 10px 16px; border-radius: 10px; font-size: 0.88rem; font-weight: 500;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4); max-width: 320px;
    animation: fadeInUp 0.3s ease;
  `;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/* ══════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════ */
window.addEventListener("DOMContentLoaded", boot);