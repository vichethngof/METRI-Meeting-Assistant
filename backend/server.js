/**
 * METRI Meeting Assistant — Backend Server
 * ─────────────────────────────────────────
 * Express REST API + WebSocket server
 * Audio transcription via OpenAI Whisper
 * Supports English (en-US) and Khmer (km)
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const multer = require("multer");
const { OpenAI } = require("openai");
const { v4: uuid } = require("uuid");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./database");

/* ─── Config ─── */
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const JWT_SECRET = process.env.JWT_SECRET || "metri-super-secret-key";
const UPLOADS_DIR = path.join(__dirname, "uploads");


/* ─── Ensure directories exist ─── */
[path.join(__dirname, "data"), UPLOADS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/* ─── OpenAI client ─── */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


/* ─── Express app ─── */
const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (server-to-server, mobile apps, curl)
    if (!origin) return callback(null, true);
    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) return callback(null, true);
    // Allow the configured frontend URL
    if (FRONTEND_URL && origin === FRONTEND_URL.replace(/\/$/, '')) return callback(null, true);
    // Allow any netlify.app or onrender.com subdomain for easy testing
    if (origin.endsWith('.netlify.app') || origin.endsWith('.onrender.com')) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json());

/* --- Auth Middleware --- */
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access denied. No token provided." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}


/* ─── Multer for temp audio uploads ─── */
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB (Whisper limit)
});

/* ══════════════════════════════════════════
   WHISPER TRANSCRIPTION SERVICE
══════════════════════════════════════════ */
async function transcribeAudio(filePath, originalName) {
  try {
    const fileStream = fs.createReadStream(filePath);

    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: "whisper-1",
      response_format: "verbose_json", // gives us language + segments
      // No language hint → Whisper auto-detects English vs Khmer
    });

    const text = response.text?.trim() || "";
    const langCode = response.language || "en"; // e.g. "english", "khmer"

    // Normalize Whisper's language name to ISO code
    const lang = normalizeLanguage(langCode, text);

    return { text, lang, duration: response.duration || 0 };
  } catch (err) {
    console.error("Whisper error:", err.message);
    throw err;
  }
}

/**
 * Whisper returns language as full name ("english", "khmer").
 * Also cross-check with Khmer Unicode in the text itself.
 */
function normalizeLanguage(whisperLang, text) {
  const hasKhmerChars = /[\u1780-\u17FF]/.test(text);
  if (hasKhmerChars) return "km";
  const lower = (whisperLang || "").toLowerCase();
  if (lower.includes("khmer") || lower === "km") return "km";
  return "en";
}

/* ══════════════════════════════════════════
   REST API ROUTES
══════════════════════════════════════════ */

/* Health check */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    whisper: !!process.env.OPENAI_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

/* --- Auth Routes --- */

app.post("/api/auth/signup", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  try {
    const existing = db.findUserByUsername(username);
    if (existing) return res.status(400).json({ error: "Username already exists" });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const user = db.createUser(username, hash);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  try {
    const user = db.findUserByUsername(username);
    if (!user) return res.status(401).json({ error: "Invalid username or password" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid username or password" });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});


/* ── POST /api/transcribe ──────────────────
   Upload a single audio chunk for transcription.
   Returns: { text, lang, duration }
*/
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No audio file received" });

  const tempPath = req.file.path;
  // Rename to give it proper extension so Whisper recognises format
  const ext = guessExtension(req.file.mimetype || req.body.mimeType || "");
  const namedPath = tempPath + ext;

  try {
    fs.renameSync(tempPath, namedPath);
    const result = await transcribeAudio(namedPath, req.file.originalname);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Transcription failed" });
  } finally {
    // Clean up temp file
    [tempPath, namedPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { } });
  }
});

function guessExtension(mimeType) {
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("wav")) return ".wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  return ".webm"; // default for browser MediaRecorder
}

/* ── GET /api/sessions ─────────────────────
   Return all saved sessions (library).
*/
app.get("/api/sessions", authenticateToken, (req, res) => {
  try {
    const sessions = db.getSessions(req.user.id);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

/* ── POST /api/sessions ────────────────────
   Save a new session to the library.
   Body: { title, date, duration, entries }
*/
app.post("/api/sessions", authenticateToken, (req, res) => {
  const { title, date, duration, entries } = req.body;
  if (!entries?.length) return res.status(400).json({ error: "No entries to save" });

  const session = {
    id: uuid(),
    user_id: req.user.id,
    title: title || `Meeting — ${new Date(date).toLocaleDateString()}`,
    date: date || new Date().toISOString(),
    duration: duration || 0,
    entries,
  };

  try {
    db.saveSession(session);
    res.status(201).json(session);
  } catch (err) {
    console.error("Save error:", err);
    res.status(500).json({ error: "Failed to save session" });
  }
});


/* ── DELETE /api/sessions/:id ──────────────
   Remove a session from the library.
*/
app.delete("/api/sessions/:id", authenticateToken, (req, res) => {
  try {
    const success = db.deleteSession(req.params.id, req.user.id);
    if (!success) return res.status(404).json({ error: "Session not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete session" });
  }
});

/* ── GET /api/sessions/:id/download ────────
   Download a session transcript as plain text.
*/
app.get("/api/sessions/:id/download", authenticateToken, (req, res) => {
  try {
    const session = db.getSessionById(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: "Session not found" });



    const fmtTime = (d) => new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const fmtDur = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

    const lines = session.entries.map(e =>
      `[${fmtTime(e.time)}] [${e.lang === "km" ? "ខ្មែរ" : "English"}]\n${e.text}\n`
    );

    const content = [
      "METRI Meeting Assistant — Transcript",
      "═".repeat(44),
      `Title    : ${session.title}`,
      `Date     : ${new Date(session.date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
      `Duration : ${fmtDur(session.duration)}`,
      `Entries  : ${session.entries.length}`,
      "═".repeat(44),
      "",
      ...lines,
    ].join("\n");

    const filename = session.title.replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_") + ".txt";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: "Download failed" });
  }
});

/* ── GET /api/search ───────────────────────
   Search through all transcripts.
*/
app.get("/api/search", authenticateToken, (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const results = db.searchTranscripts(query, req.user.id);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
});

/* ── POST /api/summarize ────────────────────
   Summarize a meeting transcript using GPT.
*/
app.post("/api/summarize", authenticateToken, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "Session ID required" });

  try {
    const session = db.getSessionById(sessionId, req.user.id);
    if (!session) return res.status(404).json({ error: "Session not found" });


    const fullText = session.entries.map(e => e.text).join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a professional meeting assistant. Summarize the following meeting transcript into concise bullet points, highlighting key decisions and action items. Provide the output in both English and Khmer if both languages are present."
        },
        {
          role: "user",
          content: `Transcript:\n${fullText}`
        }
      ],
    });

    const summary = response.choices[0].message.content;
    res.json({ summary });
  } catch (err) {
    console.error("Summarize error:", err);
    res.status(500).json({ error: "Summarization failed" });
  }
});


/* ══════════════════════════════════════════
   WEBSOCKET SERVER
   Real-time connection for live transcription status.
   Clients connect → server pushes transcript results.
══════════════════════════════════════════ */
const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Map(); // clientId → ws

wss.on("connection", (ws) => {
  const clientId = uuid();
  clients.set(clientId, ws);
  console.log(`[WS] Client connected: ${clientId} (total: ${clients.size})`);

  // Send welcome
  send(ws, { type: "connected", clientId });

  ws.on("message", async (data, isBinary) => {
    // Binary data = audio chunk from the browser
    if (isBinary) {
      await handleAudioChunk(ws, clientId, data);
      return;
    }

    // Text data = JSON control messages
    try {
      const msg = JSON.parse(data.toString());
      await handleMessage(ws, clientId, msg);
    } catch (e) {
      send(ws, { type: "error", message: "Invalid message format" });
    }
  });

  ws.on("close", () => {
    clients.delete(clientId);
    console.log(`[WS] Client disconnected: ${clientId} (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error(`[WS] Error for ${clientId}:`, err.message);
    clients.delete(clientId);
  });
});

/* ── Audio chunk buffer per client ── */
const audioBuffers = new Map(); // clientId → { chunks, mimeType }

async function handleMessage(ws, clientId, msg) {
  switch (msg.type) {
    /* Client signals start of audio stream */
    case "audio_start":
      audioBuffers.set(clientId, { chunks: [], mimeType: msg.mimeType || "audio/webm" });
      send(ws, { type: "audio_start_ack" });
      break;

    /* Client sends metadata about the chunk about to arrive */
    case "chunk_meta":
      if (audioBuffers.has(clientId)) {
        audioBuffers.get(clientId).pendingMeta = msg;
      }
      break;

    /* Client signals end of stream → clear buffer */
    case "audio_end":
      audioBuffers.delete(clientId);
      break;

    default:
      send(ws, { type: "error", message: `Unknown message type: ${msg.type}` });
  }
}

/* Handle incoming binary audio chunk → transcribe → send result */
async function handleAudioChunk(ws, clientId, binaryData) {
  const bufInfo = audioBuffers.get(clientId);
  const mimeType = bufInfo?.mimeType || "audio/webm";

  if (!process.env.OPENAI_API_KEY) {
    // No API key → send demo transcript so UI still works
    send(ws, {
      type: "transcript",
      ...mockTranscript(),
      time: Date.now(),
    });
    return;
  }

  // Save binary audio to temp file
  const ext = guessExtension(mimeType);
  const tempPath = path.join(UPLOADS_DIR, `${uuid()}${ext}`);

  try {
    fs.writeFileSync(tempPath, binaryData);
    send(ws, { type: "processing" });

    const result = await transcribeAudio(tempPath, `chunk${ext}`);

    if (result.text) {
      send(ws, {
        type: "transcript",
        text: result.text,
        lang: result.lang,
        time: Date.now(),
      });
    } else {
      send(ws, { type: "silence" }); // Whisper returned empty (silence)
    }
  } catch (err) {
    console.error("[Transcribe] Error:", err.message);
    send(ws, { type: "error", message: "Transcription failed. Check your API key." });
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) { }
  }
}

/* ── Round-robin demo phrases when no API key ── */
const DEMO_PHRASES = [
  { text: "Good morning everyone, let's begin today's agenda.", lang: "en" },
  { text: "សួស្តីទាំងអស់គ្នា! ខ្ញុំរីករាយដែលបានចូលរួម។", lang: "km" },
  { text: "Can you share the Q3 report on screen please?", lang: "en" },
  { text: "យើងត្រូវពិភាក្សាអំពីផែនការអភិវឌ្ឍន៍។", lang: "km" },
  { text: "The marketing team exceeded their targets this quarter.", lang: "en" },
  { text: "ខ្ញុំយល់ព្រមជាមួយការស្នើឡើងរបស់អ្នក។", lang: "km" },
];
let demoIdx = 0;
const mockTranscript = () => DEMO_PHRASES[demoIdx++ % DEMO_PHRASES.length];

/* ── Send helper ── */
function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/* ── Start server ── */
server.listen(PORT, () => {
  console.log(`\n🎙️  METRI Backend running on http://localhost:${PORT}`);
  console.log(`📡  WebSocket on ws://localhost:${PORT}/ws`);
  console.log(`🔑  Whisper API: ${process.env.OPENAI_API_KEY ? "✅ Configured" : "❌ Missing OPENAI_API_KEY"}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  GET  /api/health`);
  console.log(`  POST /api/transcribe`);
  console.log(`  GET  /api/sessions`);
  console.log(`  POST /api/sessions`);
  console.log(`  DELETE /api/sessions/:id`);
  console.log(`  GET  /api/sessions/:id/download\n`);
});
