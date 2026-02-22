import { useState, useEffect, useRef, useCallback } from "react";
import { jsPDF } from "jspdf";
import "./App.css";



/* ─── Constants ─── */
const API_BASE = import.meta.env.VITE_API_URL || ""; // e.g. https://metri-api.onrender.com
const API = `${API_BASE}/api`;
const WS_BASE = API_BASE ? API_BASE.replace(/^http/, 'ws') : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
const WS_URL = `${WS_BASE}/ws`;
const CHUNK_INTERVAL_MS = 5000; // Send audio to Whisper every 5 seconds

/* ─── Helpers ─── */
const fmtTime = (d) => new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDur = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const fmtDate = (d) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const isKhmer = (t) => /[\u1780-\u17FF]/.test(t);

/* ─── Wave bars component ─── */
function Wave({ active, color = "#3b82f6", n = 6 }) {
  const D = [0, .12, .24, .12, 0, .16];
  const H = [.35, .7, 1, .65, .45, .55];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 20 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 3,
          height: active ? `${20 * H[i]}px` : "3px",
          background: color, opacity: active ? .88 : .25,
          transition: "height .3s ease",
          animation: active ? `wv ${.48 + i * .07}s ease-in-out ${D[i]}s infinite` : "none",
        }} />
      ))}
    </div>
  );
}

/* ─── Status dot ─── */
function Dot({ color, pulse }) {
  return (
    <div style={{
      width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0,
      animation: pulse ? "dotPulse 1.1s ease-in-out infinite" : "none",
    }} />
  );
}

/* ══════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════ */
export default function App() {
  /* ─── UI state ─── */
  const [tab, setTab] = useState("meeting");
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | connecting | listening | processing | error
  const [transcripts, setTx] = useState([]);
  const [library, setLib] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [sessionStart, setSStart] = useState(null);
  const [micLevel, setMicLevel] = useState(0);
  const [filterLang, setFilter] = useState("all");
  const [toast, setToast] = useState(null);
  const [saveModal, setSave] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [serverOnline, setServerOnline] = useState(null); // null=checking
  const [apiKeyOk, setApiKeyOk] = useState(null);
  const [setupModal, setSetup] = useState(false);
  const [setupOS, setOS] = useState("windows");

  /* --- Auth State --- */
  const [user, setUser] = useState(JSON.parse(localStorage.getItem("metri_user")));
  const [token, setToken] = useState(localStorage.getItem("metri_token"));
  const [authMode, setAuthMode] = useState("login"); // login | signup
  const [authForm, setAuthForm] = useState({ username: "", password: "" });

  /* --- New Features State --- */
  const [summarizing, setSummarizing] = useState(null); // sid
  const [summary, setSummary] = useState({}); // sid -> text
  const [searchQuery, setSearch] = useState("");
  const [searchResults, setSearchRes] = useState([]);
  const [isSearching, setIsSearching] = useState(false);


  /* ─── Refs ─── */
  const wsRef = useRef(null);
  const mediaRecRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const levelRafRef = useRef(null);
  const timerRef = useRef(null);
  const sessionRef = useRef([]);
  const feedRef = useRef(null);

  /* ─── Auto-scroll ─── */
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [transcripts]);

  /* ─── Auth Helper ─── */
  const authFetch = useCallback(async (url, options = {}) => {
    const headers = { ...options.headers, "Authorization": `Bearer ${token}` };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      logout();
      throw new Error("Unauthorized");
    }
    return res;
  }, [token]);

  /* ─── Toast ─── */

  const toast$ = useCallback((msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("metri_token");
    localStorage.removeItem("metri_user");
    setToken(null);
    setUser(null);
    setToast({ msg: "Logged out", type: "ok" });
    setTimeout(() => setToast(null), 3500);
  }, []);

  /* ─── Check server health on mount ─── */
  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(d => { setServerOnline(true); setApiKeyOk(d.whisper); })
      .catch(() => setServerOnline(false));
  }, []);

  /* ─── Load library from server on mount ─── */
  useEffect(() => {
    if (!token) return;
    authFetch(`${API}/sessions`)
      .then(r => r.json())
      .then(d => setLib(Array.isArray(d) ? d : []))
      .catch(() => { });
  }, [token, authFetch]);

  /* ─── Auth Actions ─── */
  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API}/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm),
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("metri_token", data.token);
        localStorage.setItem("metri_user", JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
        toast$(`Welcome back, ${data.user.username}!`);
      } else {
        toast$(data.error || "Authentication failed", "warn");
      }
    } catch {
      toast$("Could not connect to server", "warn");
    }
  };


  /* ══ WEBSOCKET CONNECTION ══ */
  const connectWS = useCallback(() => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => { wsRef.current = ws; resolve(ws); };
      ws.onerror = () => reject(new Error("WebSocket connection failed"));

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch (_) { }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
      };
    });
  }, []);

  const handleServerMessage = useCallback((msg) => {
    switch (msg.type) {
      case "transcript":
        if (msg.text?.trim()) {
          const entry = { id: Date.now() + Math.random(), text: msg.text.trim(), lang: msg.lang || "en", time: msg.time || Date.now() };
          setTx(p => [...p, entry]);
          sessionRef.current = [...sessionRef.current, entry];
        }
        setStatus("listening");
        break;

      case "processing":
        setStatus("processing");
        break;

      case "silence":
        setStatus("listening");
        break;

      case "error":
        console.error("Server error:", msg.message);
        setStatus("listening"); // keep going
        toast$(msg.message || "Transcription error", "warn");
        break;

      default:
        break;
    }
  }, [toast$]);

  /* ══ MIC SETUP ══ */
  const setupMic = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });

    /* Audio level meter */
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.75;
    src.connect(an);
    analyserRef.current = an;
    const data = new Uint8Array(an.frequencyBinCount);
    const tick = () => {
      levelRafRef.current = requestAnimationFrame(tick);
      an.getByteFrequencyData(data);
      setMicLevel(data.reduce((s, v) => s + v, 0) / data.length / 128);
    };
    tick();

    return stream;
  }, []);

  /* ══ START SESSION ══ */
  const startSession = useCallback(async () => {
    try {
      setStatus("connecting");
      setTx([]); sessionRef.current = [];

      /* Connect WebSocket */
      const ws = await connectWS();

      /* Setup microphone */
      const stream = await setupMic();

      /* Timer */
      const startTime = Date.now();
      setSStart(new Date()); setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);

      /* Determine best supported MIME type */
      const mimeType = getSupportedMimeType();

      /* Tell server we're starting */
      ws.send(JSON.stringify({ type: "audio_start", mimeType }));

      /* MediaRecorder — sends a chunk every CHUNK_INTERVAL_MS */
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (e.data.size < 1000) return; // skip tiny/empty chunks
        if (ws.readyState === WebSocket.OPEN) {
          const buf = await e.data.arrayBuffer();
          ws.send(buf); // send binary audio to backend
        }
      };

      recorder.start(CHUNK_INTERVAL_MS);
      setIsActive(true);
      setStatus("listening");
    } catch (err) {
      console.error("Start error:", err);
      setStatus("error");
      if (err.name === "NotAllowedError") {
        toast$("Microphone access denied. Please allow mic access and try again.", "warn");
      } else if (err.message?.includes("WebSocket")) {
        toast$("Cannot connect to METRI server. Is the backend running?", "warn");
      } else {
        toast$(err.message || "Could not start session.", "warn");
      }
    }
  }, [connectWS, setupMic, toast$]);

  /* ══ STOP SESSION ══ */
  const stopSession = useCallback(() => {
    /* Stop recorder */
    if (mediaRecRef.current?.state !== "inactive") {
      mediaRecRef.current?.stop();
    }
    mediaRecRef.current?.stream?.getTracks().forEach(t => t.stop());
    mediaRecRef.current = null;

    /* Close WebSocket */
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "audio_end" }));
      wsRef.current.close();
      wsRef.current = null;
    }

    /* Stop audio context */
    cancelAnimationFrame(levelRafRef.current);
    audioCtxRef.current?.close().catch(() => { });
    audioCtxRef.current = null;
    analyserRef.current = null;

    /* Stop timer */
    clearInterval(timerRef.current);

    setIsActive(false);
    setStatus("idle");
    setMicLevel(0);
  }, []);

  /* ══ SAVE SESSION ══ */
  const saveSession = useCallback(async () => {
    if (!sessionRef.current.length) { toast$("Nothing recorded yet.", "warn"); return; }
    const title = saveTitle.trim() || `Meeting — ${fmtDate(sessionStart)}`;
    try {
      const res = await authFetch(`${API}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date: sessionStart, duration: elapsed, entries: sessionRef.current }),
      });
      const saved = await res.json();
      setLib(p => [saved, ...p]);
      setSave(false); setSaveTitle(""); toast$(`"${title}" saved ✓`);
    } catch {
      toast$("Failed to save. Is the backend running?", "warn");
    }
  }, [saveTitle, sessionStart, elapsed, toast$, authFetch]);

  /* ══ DELETE SESSION ══ */
  const deleteSession = useCallback(async (id) => {
    if (!confirm("Delete this transcript?")) return;
    try {
      await authFetch(`${API}/sessions/${id}`, { method: "DELETE" });
      setLib(p => p.filter(s => s.id !== id));
      toast$("Transcript deleted.");
    } catch {
      toast$("Delete failed.", "warn");
    }
  }, [toast$, authFetch]);

  /* ══ DOWNLOAD SESSION ══ */
  const downloadSession = useCallback((id) => {
    authFetch(`${API}/sessions/${id}/download`)
      .then(r => r.blob())
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transcript_${id}.txt`;
        a.click();
      });
  }, [authFetch]);

  /* ══ PDF EXPORT ══ */
  const exportPDF = useCallback((session) => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text("METRI Transcript", 20, 20);
    doc.setFontSize(12);
    doc.text(`Title: ${session.title}`, 20, 30);
    doc.text(`Date: ${fmtDate(session.date)}`, 20, 38);
    doc.text(`Duration: ${fmtDur(session.duration)}`, 20, 46);
    doc.line(20, 52, 190, 52);

    let y = 60;
    session.entries.forEach(e => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.text(`[${fmtTime(e.time)}] ${e.lang === 'km' ? 'Khmer' : 'English'}:`, 20, y);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(e.text, 160);
      doc.text(lines, 30, y + 7);
      y += 10 + (lines.length * 7);
    });

    doc.save(`${session.title.replace(/\s+/g, '_')}.pdf`);
    toast$("PDF generated!");
  }, [toast$]);

  /* ══ SUMMARIZE SESSION ══ */
  const summarizeSession = useCallback(async (id) => {
    setSummarizing(id);
    try {
      const res = await authFetch(`${API}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      const data = await res.json();
      if (data.summary) {
        setSummary(p => ({ ...p, [id]: data.summary }));
        toast$("Summary generated!");
      } else {
        toast$(data.error || "Could not summarize.", "warn");
      }
    } catch {
      toast$("Summarization failed. Check backend connection.", "warn");
    } finally {
      setSummarizing(null);
    }
  }, [toast$, authFetch]);

  /* ══ SEARCH TRANSCRIPTS ══ */
  useEffect(() => {
    if (!searchQuery.trim() || !token) {
      setSearchRes([]);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await authFetch(`${API}/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchRes(data);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, token, authFetch]);



  /* ── Displayed transcripts ── */
  const displayed = filterLang === "all" ? transcripts : transcripts.filter(t => t.lang === filterLang);
  const enCnt = transcripts.filter(t => t.lang === "en").length;
  const kmCnt = transcripts.filter(t => t.lang === "km").length;
  const ringGlow = Math.min(micLevel * 1.5, 1);

  const SETUP_STEPS = {
    windows: [
      { icon: "🔊", t: "Open Sound Settings", d: "Right-click the speaker in taskbar → Sounds → Recording tab." },
      { icon: "✅", t: 'Enable "Stereo Mix"', d: 'Right-click blank area → "Show Disabled Devices". Right-click Stereo Mix → Enable → Set as Default.' },
      { icon: "🎧", t: "Wear headphones", d: "Prevents meeting audio from echoing into your mic." },
      { icon: "▶️", t: "Click Start Listening", d: "METRI now captures your voice + all meeting participants." },
    ],
    mac: [
      { icon: "⬇️", t: "Install BlackHole (free)", d: "Download from existential.audio/blackhole — free virtual audio driver." },
      { icon: "🎛️", t: "Create Multi-Output Device", d: "Audio MIDI Setup → + → Multi-Output. Add BlackHole + your headphones." },
      { icon: "🔄", t: "Set system output", d: "System output → Multi-Output Device so audio plays AND routes to BlackHole." },
      { icon: "▶️", t: "Click Start Listening", d: "METRI hears all meeting audio via BlackHole virtual mic." },
    ],
    chromebook: [
      { icon: "🎧", t: "Use headphones", d: "Required to prevent echo." },
      { icon: "⚙️", t: "Allow mic in browser", d: "Click the lock icon in address bar → Microphone → Allow." },
      { icon: "▶️", t: "Click Start Listening", d: "METRI transcribes your voice. Use Google Meet's captions for remote speakers." },
      { icon: "💡", t: "Tip", d: "Place device near speakers if you want METRI to pick up meeting audio." },
    ],
  };

  /* ════════════════════════════════ RENDER ════════════════════════════════ */
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)", fontFamily: "'Plus Jakarta Sans','Noto Sans Khmer',system-ui,sans-serif", color: "#1a2233", fontSize: 14 }}>


      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: toast.type === "warn" ? "#92400e" : "#1e3a5f", color: "#fff", padding: "11px 22px", borderRadius: 12, fontWeight: 600, fontSize: 13, zIndex: 9999, boxShadow: "0 8px 28px rgba(0,0,0,.22)", animation: "up .3s ease-out", whiteSpace: "nowrap" }}>
          {toast.msg}
        </div>
      )}

      {/* ── Save Modal ── */}
      {saveModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", backdropFilter: "blur(6px)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn .2s" }}>
          <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid #e2e8f0", boxShadow: "0 16px 48px rgba(0,0,0,.15)", width: 380, padding: 30, animation: "up .3s ease-out" }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Save Transcript</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>{sessionRef.current.length} entries · {fmtDur(elapsed)}</div>
            <input autoFocus value={saveTitle} onChange={e => setSaveTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && saveSession()} placeholder="Session title (optional)…" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", background: "#f8fafc", marginBottom: 14, color: "#1a2233" }} />
            <div style={{ display: "flex", gap: 9 }}>
              <button onClick={() => setSave(false)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1.5px solid #e2e8f0", background: "#fff", fontWeight: 600, fontSize: 13, color: "#64748b" }}>Cancel</button>
              <button onClick={saveSession} style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", color: "#fff", fontWeight: 700, fontSize: 13, boxShadow: "0 4px 14px rgba(59,130,246,.4)" }}>💾 Save to Library</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Setup Modal ── */}
      {setupModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", backdropFilter: "blur(8px)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn .2s", padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 20, border: "1.5px solid #e2e8f0", boxShadow: "0 20px 60px rgba(0,0,0,.2)", width: "100%", maxWidth: 500, maxHeight: "88vh", overflowY: "auto", padding: 28, animation: "up .3s ease-out" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>📡 Online Meeting Setup</div>
              <button onClick={() => setSetup(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 20, lineHeight: 1, padding: 4 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 18, lineHeight: 1.65 }}>Route meeting audio through your mic so METRI captures all speakers:</div>
            <div style={{ display: "flex", gap: 5, marginBottom: 18, background: "#f1f5f9", padding: 4, borderRadius: 10 }}>
              {[["windows", "🪟 Windows"], ["mac", "🍎 Mac"], ["chromebook", "🔵 Chromebook"]].map(([os, label]) => (
                <button key={os} onClick={() => setOS(os)} style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 12, background: setupOS === os ? "#1d4ed8" : "transparent", color: setupOS === os ? "#fff" : "#64748b", transition: "all .15s" }}>{label}</button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
              {SETUP_STEPS[setupOS].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "13px 15px", background: "#f8fafc", borderRadius: 11, border: "1.5px solid #e2e8f0" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{s.icon}</div>
                  <div><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Step {i + 1}: {s.t}</div><div style={{ fontSize: 12, color: "#475569", lineHeight: 1.55 }}>{s.d}</div></div>
                </div>
              ))}
            </div>
            <button onClick={() => setSetup(false)} style={{ width: "100%", padding: "12px", borderRadius: 11, border: "none", background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", color: "#fff", fontWeight: 700, fontSize: 14 }}>Got it — Start Transcribing</button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ background: "#fff", borderBottom: "1.5px solid #e2e8f0", boxShadow: "0 1px 10px rgba(0,0,0,.05)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 18px", display: "flex", alignItems: "center", gap: 12, height: 58 }}>
          {/* Logo */}
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(59,130,246,.35)", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="11" rx="2" stroke="white" strokeWidth="1.8" /><path d="M8 9h8M8 11.5h5" stroke="white" strokeWidth="1.8" strokeLinecap="round" /><path d="M12 15v4M9 19h6" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-.02em" }}>METRI</span>
            <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 7, fontWeight: 600, letterSpacing: ".07em" }}>MEETING ASSISTANT</span>
          </div>

          {!user ? (
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setAuthMode("login")} style={{ background: "none", border: "none", fontWeight: 700, fontSize: 13, color: "#64748b" }}>Login</button>
              <button onClick={() => setAuthMode("signup")} style={{ background: "var(--primary)", color: "#fff", padding: "6px 14px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13 }}>Sign Up</button>
            </div>
          ) : (
            <>
              {/* User Identity */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 15 }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, color: "#64748b" }}>
                  {user.username[0].toUpperCase()}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{user.username}</div>
                <button onClick={logout} style={{ background: "none", border: "none", color: "#ef4444", fontSize: 11, fontWeight: 700, padding: 0 }}>Logout</button>
              </div>

              {/* Live badge */}
              {isActive && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, background: "#fef2f2", border: "1px solid #fecaca", padding: "5px 12px", borderRadius: 24, marginRight: 15 }}>
                  <Dot color="#ef4444" pulse />
                  <span style={{ fontWeight: 700, fontSize: 12, color: "#ef4444" }}>LIVE</span>
                  <Wave active color="#ef4444" n={5} />
                </div>
              )}

              {/* Tabs */}
              <div style={{ display: "flex", gap: 3, background: "#f1f5f9", padding: 3, borderRadius: 10 }}>
                {["meeting", "library"].map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, transition: "all .15s", background: tab === t ? "#1d4ed8" : "transparent", color: tab === t ? "#fff" : "#64748b", boxShadow: tab === t ? "0 3px 10px rgba(29,78,216,.3)" : "none" }}>
                    {t === "library" ? `Library${library.length ? ` (${library.length})` : ""}` : "Meeting"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "18px" }}>

        {/* ── AUTH SCREEN ── */}
        {!user && (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <div style={{ background: "#fff", borderRadius: 20, border: "1.5px solid #e2e8f0", boxShadow: "0 20px 48px rgba(0,0,0,.1)", width: 380, padding: 35 }}>
              <div style={{ textAlign: "center", marginBottom: 30 }}>
                <div style={{ fontSize: 26, fontWeight: 900, marginBottom: 8, letterSpacing: "-.02em" }}>METRI</div>
                <div style={{ fontSize: 14, color: "#64748b" }}>{authMode === "login" ? "Sign in to your assistant" : "Create your free account"}</div>
              </div>

              <form onSubmit={handleAuth} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>USERNAME</label>
                  <input required value={authForm.username} onChange={e => setAuthForm(p => ({ ...p, username: e.target.value }))} placeholder="Enter username" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>PASSWORD</label>
                  <input required type="password" value={authForm.password} onChange={e => setAuthForm(p => ({ ...p, password: e.target.value }))} placeholder="••••••••" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none" }} />
                </div>

                <button type="submit" style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", color: "#fff", fontWeight: 700, fontSize: 14, marginTop: 10, boxShadow: "0 4px 14px rgba(59,130,246,.4)" }}>
                  {authMode === "login" ? "Sign In" : "Create Account"}
                </button>
              </form>

              <div style={{ textAlign: "center", marginTop: 25, fontSize: 13, color: "#64748b" }}>
                {authMode === "login" ? "New to METRI?" : "Already have an account?"}
                <button onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")} style={{ background: "none", border: "none", color: "#3b82f6", fontWeight: 700, marginLeft: 6 }}>
                  {authMode === "login" ? "Sign up now" : "Log in"}
                </button>
              </div>
            </div>
          </div>
        )}

        {user && tab === "meeting" && (

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Server offline warning */}
            {serverOnline === false && (
              <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 14, padding: "14px 18px", animation: "up .3s" }}>
                <div style={{ fontWeight: 700, color: "#ef4444", marginBottom: 4 }}>⚠️ Backend Server Not Running</div>
                <div style={{ fontSize: 13, color: "#7f1d1d", lineHeight: 1.6 }}>
                  Start the backend first:<br />
                  <code style={{ background: "#fee2e2", padding: "2px 6px", borderRadius: 5, fontSize: 12 }}>cd backend && npm start</code>
                </div>
              </div>
            )}

            {/* No API key warning */}
            {serverOnline && apiKeyOk === false && (
              <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 14, padding: "14px 18px", animation: "up .3s" }}>
                <div style={{ fontWeight: 700, color: "#d97706", marginBottom: 4 }}>🔑 OpenAI API Key Missing</div>
                <div style={{ fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>
                  Add your key to <code style={{ background: "#fef3c7", padding: "2px 6px", borderRadius: 5, fontSize: 12 }}>backend/.env</code>:<br />
                  <code style={{ background: "#fef3c7", padding: "2px 6px", borderRadius: 5, fontSize: 12 }}>OPENAI_API_KEY=sk-...</code><br />
                  <span style={{ marginTop: 4, display: "block" }}>Running in <strong>demo mode</strong> — sample transcripts will appear.</span>
                </div>
              </div>
            )}

            {/* ── MIC CARD ── */}
            <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid #e2e8f0", boxShadow: "0 2px 14px rgba(0,0,0,.05)", padding: "30px 22px" }}>
              <div style={{ textAlign: "center", marginBottom: 26 }}>
                {!isActive ? (
                  <>
                    <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Ready to Listen</div>
                    <div style={{ fontSize: 14, color: "#64748b", lineHeight: 1.7 }}>
                      Tap the mic to transcribe in <strong style={{ color: "#3b82f6" }}>English</strong> or <strong style={{ color: "#d97706" }}>ភាសាខ្មែរ</strong> — automatically.<br />
                      <button onClick={() => setSetup(true)} style={{ background: "none", border: "none", color: "#8b5cf6", fontWeight: 700, fontSize: 13, textDecoration: "underline", padding: 0, marginTop: 4 }}>📡 Using an online meeting? See setup guide</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 5 }}>
                      {status === "processing" ? "🔄 Transcribing…" : micLevel > 0.1 ? "🗣️ Speech detected" : "👂 Listening…"}
                    </div>
                    <div style={{ fontSize: 13, color: "#64748b" }}>Powered by OpenAI Whisper · Auto language detection</div>
                  </>
                )}
              </div>

              {/* Mic ring button */}
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
                <button
                  onClick={isActive ? stopSession : startSession}
                  disabled={serverOnline === false}
                  style={{
                    position: "relative", width: 92, height: 92, borderRadius: "50%", border: "none",
                    background: isActive ? "linear-gradient(145deg,#ef4444,#dc2626)" : "linear-gradient(145deg,#3b82f6,#1d4ed8)",
                    boxShadow: isActive
                      ? `0 0 0 ${4 + ringGlow * 14}px rgba(239,68,68,${.1 + ringGlow * .07}), 0 8px 28px rgba(239,68,68,.45)`
                      : "0 8px 28px rgba(59,130,246,.42)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background .3s, box-shadow .1s",
                    opacity: serverOnline === false ? .5 : 1,
                  }}
                >
                  {isActive && (
                    <>
                      <div style={{ position: "absolute", inset: -8, borderRadius: "50%", border: "2.5px solid rgba(239,68,68,.4)", animation: "ripOut 1.8s ease-out infinite" }} />
                      <div style={{ position: "absolute", inset: -8, borderRadius: "50%", border: "2.5px solid rgba(239,68,68,.2)", animation: "ripOut 1.8s ease-out infinite .65s" }} />
                    </>
                  )}
                  {status === "connecting"
                    ? <div style={{ width: 24, height: 24, borderRadius: "50%", border: "3px solid rgba(255,255,255,.3)", borderTopColor: "white", animation: "spin .8s linear infinite" }} />
                    : isActive
                      ? <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
                      : <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" fill="white" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" strokeWidth="2.2" strokeLinecap="round" /><path d="M12 19v3M9 22h6" stroke="white" strokeWidth="2.2" strokeLinecap="round" /></svg>
                  }
                </button>
              </div>

              {/* Language pills + mic meter */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {[
                  { lang: "en", label: "English", flag: "🇺🇸", color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe", count: enCnt, cbg: "#dbeafe", cc: "#1d4ed8" },
                  { lang: "km", label: "ភាសាខ្មែរ", flag: "🇰🇭", color: "#d97706", bg: "#fffbeb", border: "#fcd34d", count: kmCnt, cbg: "#fef3c7", cc: "#92400e" },
                ].map(({ lang, label, flag, color, bg, border, count, cbg, cc }) => (
                  <div key={lang} style={{ display: "flex", alignItems: "center", gap: 8, background: bg, border: `1px solid ${border}`, padding: "9px 14px", borderRadius: 11 }}>
                    <span style={{ fontSize: 17 }}>{flag}</span>
                    <div><div style={{ fontWeight: 700, color, fontSize: 13 }}>{label}</div><div style={{ fontSize: 10, color: "#94a3b8" }}>Auto-detected</div></div>
                    <Wave active={isActive && count > 0} color={color} />
                    {count > 0 && <span style={{ background: cbg, color: cc, borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{count}</span>}
                  </div>
                ))}

                {isActive && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "9px 14px", borderRadius: 11 }}>
                    <span style={{ fontSize: 17 }}>🎙️</span>
                    <div><div style={{ fontWeight: 700, color: "#16a34a", fontSize: 13 }}>Mic Input</div><div style={{ fontSize: 10, color: "#94a3b8" }}>Live level</div></div>
                    <div style={{ width: 52, height: 6, background: "#dcfce7", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: micLevel > .6 ? "#ef4444" : "#22c55e", width: `${Math.min(micLevel * 100, 100)}%`, borderRadius: 3, transition: "width .08s, background .2s" }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {isActive && (
                <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "center" }}>
                  {transcripts.length > 0 && (
                    <button onClick={() => setSave(true)} style={{ padding: "9px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "#fff", fontWeight: 700, fontSize: 13, boxShadow: "0 3px 12px rgba(217,119,6,.3)" }}>
                      📝 Save Notes
                    </button>
                  )}
                  <button onClick={stopSession} style={{ padding: "9px 18px", borderRadius: 10, border: "1.5px solid #fecaca", background: "#fef2f2", color: "#ef4444", fontWeight: 700, fontSize: 13 }}>
                    ⏹ Stop
                  </button>
                </div>
              )}
            </div>

            {/* ── TRANSCRIPT FEED ── */}
            <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid #e2e8f0", boxShadow: "0 2px 14px rgba(0,0,0,.05)", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid #f1f5f9", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: ".08em" }}>SHOW</span>
                {[{ v: "all", l: "All" }, { v: "en", l: "🇺🇸 English" }, { v: "km", l: "🇰🇭 ខ្មែរ" }].map(({ v, l }) => (
                  <button key={v} onClick={() => setFilter(v)} style={{ padding: "5px 13px", borderRadius: 20, border: `1.5px solid ${filterLang === v ? (v === "km" ? "#fcd34d" : v === "en" ? "#bfdbfe" : "#e2e8f0") : "transparent"}`, background: filterLang === v ? (v === "km" ? "#fffbeb" : v === "en" ? "#eff6ff" : "#f1f5f9") : "transparent", color: filterLang === v ? (v === "km" ? "#d97706" : v === "en" ? "#3b82f6" : "#1a2233") : "#94a3b8", fontWeight: 700, fontSize: 12, transition: "all .14s", border: `1.5px solid ${filterLang === v ? (v === "km" ? "#fcd34d" : v === "en" ? "#bfdbfe" : "#e2e8f0") : "transparent"}` }}>{l}</button>
                ))}
                <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>{displayed.length} {displayed.length === 1 ? "entry" : "entries"}</span>
              </div>

              <div ref={feedRef} style={{ height: 380, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 16 }}>
                {displayed.length === 0 && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                    <div style={{ fontSize: 48, animation: "float 3s ease-in-out infinite" }}>{isActive ? "👂" : "🎙️"}</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#475569" }}>{isActive ? "Listening… speak now" : "No transcript yet"}</div>
                    <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", maxWidth: 280, lineHeight: 1.7 }}>
                      {isActive
                        ? "Whisper processes audio every 5 seconds. Words appear here in real time."
                        : "Press the mic button to begin transcribing your meeting."}
                    </div>
                  </div>
                )}

                {displayed.map(e => (
                  <div key={e.id} className="entry" style={{ display: "flex", gap: 12 }}>
                    <div style={{ width: 4, borderRadius: 4, flexShrink: 0, alignSelf: "stretch", minHeight: 44, background: e.lang === "km" ? "linear-gradient(180deg,#f59e0b,#d97706)" : "linear-gradient(180deg,#60a5fa,#3b82f6)" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, ...(e.lang === "km" ? { background: "#fffbeb", color: "#d97706", border: "1px solid #fcd34d" } : { background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe" }) }}>
                          {e.lang === "km" ? "🇰🇭 ខ្មែរ" : "🇺🇸 English"}
                        </span>
                        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{fmtTime(e.time)}</span>
                      </div>
                      <div style={{ display: "inline-block", maxWidth: "100%", padding: "12px 15px", borderRadius: "16px 16px 16px 4px", ...(e.lang === "km" ? { background: "linear-gradient(135deg,#fef3e2,#fef9f0)", border: "1.5px solid #f6d89a", boxShadow: "0 2px 10px rgba(240,165,0,.07)" } : { background: "#fff", border: "1.5px solid #e2e8f0", boxShadow: "0 2px 8px rgba(0,0,0,.04)" }) }}>
                        <p style={{ margin: 0, fontSize: e.lang === "km" ? 16 : 14, lineHeight: e.lang === "km" ? 2.05 : 1.75, color: "#1a2233" }}>{e.text}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Online meeting card */}
            {!isActive && (
              <div style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)", borderRadius: 16, border: "1.5px solid #ddd6fe", padding: "18px 20px", display: "flex", gap: 14, alignItems: "center" }}>
                <span style={{ fontSize: 26, flexShrink: 0 }}>📡</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Using METRI in Zoom / Google Meet / Teams?</div>
                  <div style={{ fontSize: 13, color: "#4c1d95", lineHeight: 1.6 }}>Route meeting audio through your mic to capture all speakers.</div>
                </div>
                <button onClick={() => setSetup(true)} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#8b5cf6,#6d28d9)", color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0, boxShadow: "0 3px 12px rgba(139,92,246,.4)" }}>
                  Setup Guide
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══ LIBRARY TAB ══ */}
        {user && tab === "library" && (
          <div>
            <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Transcript Library</div>
                <div style={{ fontSize: 14, color: "#64748b" }}>{library.length} Meetings Saved</div>
              </div>

              {/* Search Box */}
              <div style={{ position: "relative", minWidth: 260 }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search in transcripts..."
                  style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: 12, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", transition: "border-color .2s" }}
                  onFocus={e => e.target.style.borderColor = "#3b82f6"}
                  onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                />
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, opacity: 0.4 }}>🔍</span>
                {isSearching && (
                  <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, border: "2px solid #e2e8f0", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin .6s linear infinite" }} />
                )}
              </div>
            </div>

            {searchQuery && (
              <div style={{ marginBottom: 20, padding: "12px 18px", background: "#f1f5f9", borderRadius: 12, fontSize: 13, color: "#475569" }}>
                Found <strong>{searchResults.length}</strong> matches for "{searchQuery}"
              </div>
            )}

            {library.length === 0 ? (

              <div style={{ background: "#fff", borderRadius: 18, border: "1.5px solid #e2e8f0", padding: "56px 40px", textAlign: "center" }}>
                <div style={{ fontSize: 52, marginBottom: 14, animation: "float 3s ease-in-out infinite" }}>📂</div>
                <div style={{ fontWeight: 700, fontSize: 17, color: "#475569", marginBottom: 8 }}>No saved transcripts yet</div>
                <div style={{ color: "#94a3b8", fontSize: 13, maxWidth: 260, margin: "0 auto", lineHeight: 1.7 }}>Record a meeting and press <strong>"Save Notes"</strong> to store it here.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
                {library.map(rec => {
                  const enC = rec.entries.filter(e => e.lang === "en").length;
                  const kmC = rec.entries.filter(e => e.lang === "km").length;
                  return (
                    <div key={rec.id} className="hc" style={{ background: "#fff", borderRadius: 16, border: "1.5px solid #e2e8f0", boxShadow: "0 2px 12px rgba(0,0,0,.05)", padding: 20 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6, lineHeight: 1.4 }}>{rec.title}</div>
                      <div style={{ display: "flex", gap: 10, fontSize: 12, color: "#64748b", marginBottom: 10, flexWrap: "wrap" }}>
                        <span>📅 {fmtDate(rec.date)}</span>
                        <span>⏱ {fmtDur(rec.duration)}</span>
                        <span>💬 {rec.entries.length}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                        {enC > 0 && <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe" }}>🇺🇸 {enC}</span>}
                        {kmC > 0 && <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: "#fffbeb", color: "#d97706", border: "1px solid #fcd34d" }}>🇰🇭 {kmC}</span>}
                      </div>
                      {rec.entries[0] && (
                        <div style={{ background: "#f8fafc", borderRadius: 9, padding: "9px 12px", marginBottom: 12, fontSize: 12, color: "#64748b", lineHeight: 1.6, borderLeft: "3px solid #e2e8f0", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          "{rec.entries[0].text}"
                        </div>
                      )}

                      {/* Summary Section */}
                      {summary[rec.id] && (
                        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 12, marginBottom: 15, fontSize: 12, color: "#166534" }}>
                          <div style={{ fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                            ✨ AI Summary
                          </div>
                          <div style={{ lineHeight: 1.6, whiteSpace: "pre-line" }}>{summary[rec.id]}</div>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => summarizeSession(rec.id)}
                          disabled={summarizing === rec.id}
                          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px", borderRadius: 9, border: "1.5px solid #dcfce7", background: "#f0fdf4", color: "#166534", fontWeight: 700, fontSize: 12 }}
                        >
                          {summarizing === rec.id ? "..." : "✨ Summarize"}
                        </button>
                        <button onClick={() => exportPDF(rec)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px", borderRadius: 9, border: "none", background: "#d97706", color: "#fff", fontWeight: 700, fontSize: 12 }}>
                          📄 PDF
                        </button>
                        <button onClick={() => downloadSession(rec.id)} style={{ padding: "9px 12px", borderRadius: 9, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", fontWeight: 600, fontSize: 12 }}>
                          TXT
                        </button>
                        <button onClick={() => deleteSession(rec.id)} style={{ padding: "9px 12px", borderRadius: 9, border: "1.5px solid #fecaca", background: "#fef2f2", color: "#ef4444", fontWeight: 600, fontSize: 12 }}>
                          🗑
                        </button>
                      </div>


                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", padding: "20px 20px 14px", color: "#cbd5e1", fontSize: 11 }}>
        METRI · Powered by OpenAI Whisper · English &amp; ភាសាខ្មែរ
      </div>
    </div>
  );
}

/* ─── Helper: find supported MediaRecorder MIME type ─── */
function getSupportedMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || "";
}
