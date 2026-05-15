import base64, os, re

# Read logo
with open("logo_b64_small.txt") as f:
    logo_b64 = f.read().strip()

logo_data_uri = f"data:image/png;base64,{logo_b64}"

# Read all JS agent files
def read(path):
    with open(path) as f:
        return f.read()

analyst_js    = read("js/agents/analyst.js")
voice_js      = read("js/agents/voice.js")
strategist_js = read("js/agents/strategist.js")
transcriber_js= read("js/agents/transcriber.js")
datainput_js  = read("js/agents/datainput.js")
guardian_js   = read("js/agents/guardian.js")
orchestrator_js = read("js/orchestrator.js")
app_js        = read("js/app.js")
css           = read("css/style.css")

offline_html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bob\'s Sleep Tracker</title>
  <!-- QR Code libraries via CDN -->
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"></script>
  <style>
{css}
    @keyframes fadeInUp {{
      from {{ opacity:0; transform:translateY(12px); }}
      to   {{ opacity:1; transform:translateY(0); }}
    }}
    #toastContainer {{
      position: fixed; bottom: 24px; right: 24px;
      display: flex; flex-direction: column; gap: 8px;
      z-index: 9999; pointer-events: none;
    }}
  </style>
</head>
<body>

<div id="toastContainer"></div>

<div class="app-wrapper">

  <!-- BRAND HEADER -->
  <header class="brand-header">
    <div class="brand-left">
      <div class="brand-logo-wrap">
        <img src="{logo_data_uri}" alt="Bob\'s Sleep Tracker" />
      </div>
      <div class="brand-title-wrap">
        <div class="brand-name">BOB\'S</div>
        <div class="brand-sub">Sleep Tracker</div>
        <div class="brand-tagline">AI-Powered · 6-Agent System · Offline + Online</div>
      </div>
    </div>
    <div class="brand-right">
      <div class="mode-toggle-wrap">
        <span class="mode-label active" id="labelOffline">OFFLINE</span>
        <label class="toggle-switch">
          <input type="checkbox" id="modeToggle" />
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
        <span class="mode-label" id="labelOnline">ONLINE</span>
        <div class="online-dot" id="onlineDot"></div>
      </div>
    </div>
  </header>

  <!-- OFFLINE VIEW -->
  <div id="offlineView">
    <div class="metrics-grid" id="offMetrics"></div>
    <div class="card" style="margin-top:4px;" id="offEntryPanel"></div>

    <div class="card" style="margin-top:12px;">
      <div class="panel-title"><span class="icon">🧮</span> Tracking Formula</div>
      <div class="formula-box">
        D = total recorded calendar days &nbsp;|&nbsp; h&#x1D62; = sleep hours for day i<br>
        u = unknown days &nbsp;|&nbsp; n = confirmed no-sleep days<br>
        s = sleep days where h&#x1D62; > 0 &nbsp;|&nbsp; x = full sleep days where h&#x1D62; &ge; 8<br><br>
        Known Total Sleep: &nbsp;<strong>T&#8342; = &Sigma;h&#x1D62;</strong> (known days only)<br>
        Known Sample Days: <strong>D&#8342; = D &minus; u</strong><br>
        Average / Known Day: <strong>A&#8342; = T&#8342; &divide; D&#8342;</strong><br>
        Unknown Rate: <strong>U&#7523; = u &divide; D</strong><br>
        Full Sleep Freq: <strong>F&#8328; = x &divide; D&#8342;</strong><br><br>
        <span style="color:var(--muted2);">Pattern is not assumed. Pattern is inferred from logged sequences over time.</span>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <div class="panel-title"><span class="icon">📋</span> Recorded Days</div>
      <div id="offLogTable"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">
        <button class="btn btn-ghost" onclick="exportData()">📤 Export JSON</button>
        <button class="btn btn-ghost" onclick="copySummary()">📋 Copy Summary</button>
        <button class="btn btn-danger" onclick="resetAll()">🗑 Reset Tracker</button>
      </div>
    </div>
  </div><!-- /offlineView -->

  <!-- ONLINE VIEW -->
  <div id="onlineView">

    <div id="apiSetupBox" class="card" style="margin-bottom:12px;">
      <div class="api-setup-box">
        <h3>🔑 Groq API Key Required</h3>
        <p>Enter your Groq API key to activate the 6-agent AI system.<br>
        Your key is stored locally only — never sent to any third party.</p>
        <div class="api-key-row">
          <input type="password" id="apiKeyInput" placeholder="gsk_… your Groq API key…" />
          <button class="btn btn-primary" onclick="saveApiKey()">Connect</button>
        </div>
        <p style="margin-top:10px;font-size:0.78rem;color:var(--muted);">
          Get your free key at <a href="https://console.groq.com" target="_blank" style="color:var(--blue);">console.groq.com</a>
        </p>
      </div>
    </div>

    <div id="agentSystemBox" class="hidden">

      <!-- Agent Status Bar -->
      <div class="card card-glow" style="margin-bottom:12px;">
        <div class="panel-title"><span class="icon">🤖</span> Agent System Status</div>
        <div class="agent-status-bar">
          <div class="agent-pill" id="agent-analyst"><div class="agent-dot"></div><div><div class="agent-name">Analyst</div><div class="agent-status-text">Standby</div></div></div>
          <div class="agent-pill" id="agent-voice"><div class="agent-dot"></div><div><div class="agent-name">Voice</div><div class="agent-status-text">Standby</div></div></div>
          <div class="agent-pill" id="agent-strategist"><div class="agent-dot"></div><div><div class="agent-name">Strategist</div><div class="agent-status-text">Standby</div></div></div>
          <div class="agent-pill" id="agent-auditor"><div class="agent-dot"></div><div><div class="agent-name">Auditor</div><div class="agent-status-text">Standby</div></div></div>
          <div class="agent-pill" id="agent-transcriber"><div class="agent-dot"></div><div><div class="agent-name">Transcriber</div><div class="agent-status-text">Standby</div></div></div>
          <div class="agent-pill" id="agent-datainput"><div class="agent-dot"></div><div><div class="agent-name">Data Input</div><div class="agent-status-text">Standby</div></div></div>
          <div class="agent-pill" id="agent-guardian"><div class="agent-dot"></div><div><div class="agent-name">Guardian</div><div class="agent-status-text">Standby</div></div></div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="card" style="margin-bottom:12px;">
        <div class="tab-bar">
          <button class="tab-btn active" data-tab="chat"       onclick="switchTab(\'chat\')">💬 Chat</button>
          <button class="tab-btn"        data-tab="analysis"   onclick="switchTab(\'analysis\')">📊 Analysis</button>
          <button class="tab-btn"        data-tab="guardian"   onclick="switchTab(\'guardian\')">🛡 Memory</button>
          <button class="tab-btn"        data-tab="transcript" onclick="switchTab(\'transcript\')">📝 Transcript</button>
          <button class="tab-btn"        data-tab="code"       onclick="switchTab(\'code\')">🔐 Session Code</button>
          <button class="tab-btn"        data-tab="restore"    onclick="switchTab(\'restore\')">♻️ Restore</button>
        </div>

        <!-- Chat Tab -->
        <div class="tab-content active" id="tab-chat">
          <div class="panel-title"><span class="icon">🎙</span> Voice Conversation with BOB</div>
          <div class="voice-visualizer" id="voiceVisualizer">
            <div class="voice-bar" style="height:8px;"></div>
            <div class="voice-bar" style="height:14px;"></div>
            <div class="voice-bar" style="height:20px;"></div>
            <div class="voice-bar" style="height:28px;"></div>
            <div class="voice-bar" style="height:36px;"></div>
            <div class="voice-bar" style="height:42px;"></div>
            <div class="voice-bar" style="height:48px;"></div>
            <div class="voice-bar" style="height:42px;"></div>
            <div class="voice-bar" style="height:36px;"></div>
            <div class="voice-bar" style="height:28px;"></div>
            <div class="voice-bar" style="height:20px;"></div>
            <div class="voice-bar" style="height:14px;"></div>
          </div>
          <div id="interimDisplay" style="min-height:22px;padding:4px 8px;color:var(--blue);font-size:0.85rem;font-style:italic;"></div>
          <div class="chat-container" id="chatContainer" style="margin-top:6px;"></div>
          <div class="voice-controls" style="margin-top:14px;">
            <button class="mic-btn" id="micBtn" onclick="toggleMic()" title="Click to speak">🎙</button>
            <div style="flex:1;">
              <div style="display:flex;gap:8px;">
                <input type="text" id="textInput" placeholder="Or type your message here…" style="flex:1;" />
                <button class="btn btn-primary" id="textSendBtn">Send</button>
              </div>
              <div style="display:flex;gap:6px;margin-top:6px;">
                <button class="btn btn-ghost" style="font-size:0.78rem;padding:6px 10px;" onclick="stopSpeaking()">⏹ Stop</button>
                <button class="btn btn-ghost" style="font-size:0.78rem;padding:6px 10px;" onclick="generateSessionCode()">🔐 End & Save Session</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Analysis Tab -->
        <div class="tab-content" id="tab-analysis">
          <div class="panel-title"><span class="icon">📊</span> AI Sleep Analysis</div>
          <div id="onlineAnalysisContent">
            <div class="notice notice-blue">Analysis will appear once the session starts.</div>
          </div>
        </div>

        <!-- Guardian Tab -->
        <div class="tab-content" id="tab-guardian">
          <div class="panel-title"><span class="icon">🛡</span> Guardian Memory</div>
          <div class="notice notice-blue" style="margin-bottom:12px;">
            The Guardian Agent preserves your symptoms, confirmed facts, and sleep patterns across every session.
          </div>
          <div id="guardianContent"><div class="text-muted">Memory loads when session begins.</div></div>
        </div>

        <!-- Transcript Tab -->
        <div class="tab-content" id="tab-transcript">
          <div class="panel-title"><span class="icon">📝</span> Session Transcript</div>
          <div class="notice notice-blue" style="margin-bottom:10px;">The Transcriber Agent silently records every interaction.</div>
          <div class="transcript-log" id="transcriptLog">
            <div class="transcript-entry"><span class="ts">[--:--:--]</span><span class="speaker-sys">SYS: </span>Waiting for session to start…</div>
          </div>
          <div style="margin-top:10px;">
            <button class="btn btn-ghost btn-full" onclick="downloadTranscript()">⬇️ Download Full Transcript</button>
          </div>
        </div>

        <!-- Session Code Tab -->
        <div class="tab-content" id="tab-code">
          <div class="panel-title"><span class="icon">🔐</span> Session Code & QR</div>
          <div id="sessionCodeContent">
            <div class="notice notice-blue">
              <strong>How Session Codes Work:</strong><br>
              Your complete dataset is compressed into a single QR code. Scan it anytime to restore all data — no accounts or passwords needed.
            </div>
            <div class="notice" style="margin-top:10px;">
              Click <strong>"End & Save Session"</strong> in the Chat tab to generate your code.
            </div>
          </div>
        </div>

        <!-- Restore Tab -->
        <div class="tab-content" id="tab-restore">
          <div class="panel-title"><span class="icon">♻️</span> Restore from Session Code</div>
          <div class="notice notice-blue" style="margin-bottom:14px;">
            Upload your saved QR code image or paste your text code to restore all data after a reset.
          </div>
          <div class="qr-upload-zone" onclick="document.getElementById(\'qrFileInput\').click()">
            <div style="font-size:2rem;margin-bottom:8px;">📷</div>
            <strong>Upload QR Code Image</strong><br>
            <span style="font-size:0.8rem;">Click to select your saved QR code PNG</span>
            <input type="file" id="qrFileInput" accept="image/*" style="display:none;" onchange="handleQRUpload(this)" />
          </div>
          <div style="text-align:center;margin:14px 0;color:var(--muted2);font-size:0.85rem;">— OR —</div>
          <div>
            <label style="font-size:0.8rem;color:var(--muted2);font-weight:600;letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:6px;">Paste Text Session Code</label>
            <textarea id="manualCodeInput" placeholder="Paste your session code here…" style="min-height:80px;font-family:monospace;font-size:0.78rem;"></textarea>
            <button class="btn btn-primary btn-full btn-lg" style="margin-top:10px;" onclick="restoreFromTextCode()">♻️ Restore Data from Code</button>
          </div>
          <div class="notice" style="margin-top:14px;">
            <strong>When to use:</strong> After resetting offline data, go online, come here, and inject your last session code. The Guardian Agent loads your full history and continues seamlessly.
          </div>
        </div>

      </div><!-- /card tabs -->
    </div><!-- /agentSystemBox -->
  </div><!-- /onlineView -->

</div><!-- /app-wrapper -->

<script>
// ── Embedded Agent Scripts ──────────────────────────────
{analyst_js}
{voice_js}
{strategist_js}
{transcriber_js}
{datainput_js}
{guardian_js}
{orchestrator_js}
{app_js}

// ── Groq API Shim (maps Groq endpoints → OpenAI-compatible) ──
// Groq uses same API format as OpenAI — just swap base URL in fetch calls
(function() {{
  const origFetch = window.fetch.bind(window);
  window.fetch = function(url, opts) {{
    if (typeof url === 'string' && url.includes('api.openai.com')) {{
      // Check if we have a Groq key
      const groqKey = localStorage.getItem('bobs_groq_api_key') || '';
      if (groqKey && groqKey.startsWith('gsk_')) {{
        url = url.replace('https://api.openai.com/v1', 'https://api.groq.com/openai/v1');
        // Swap model names for Groq-compatible models
        if (opts && opts.body) {{
          try {{
            const body = JSON.parse(opts.body);
            if (body.model === 'gpt-4o') body.model = 'llama-3.3-70b-versatile';
            if (body.model === 'tts-1')  body.model = 'playai-tts';
            if (body.model === 'whisper-1') body.model = 'whisper-large-v3';
            opts = {{ ...opts, body: JSON.stringify(body) }};
          }} catch(e) {{}}
        }}
      }}
    }}
    return origFetch(url, opts);
  }};
}})();
</script>

</body>
</html>'''

with open("bobs-sleep-tracker-offline.html", "w") as f:
    f.write(offline_html)

size = os.path.getsize("bobs-sleep-tracker-offline.html")
print(f"Offline HTML built: {size:,} bytes ({size/1024:.1f} KB)")