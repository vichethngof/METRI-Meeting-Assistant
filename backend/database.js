/**
 * METRI Meeting Assistant — Database Manager (JSON File)
 * ──────────────────────────────────────────────────────
 * Pure-JS file-based storage — no native addons needed.
 * Works on Render, Railway, Vercel, and local dev.
 *
 * Note: On Render's free tier the filesystem is ephemeral,
 * so data resets on each deploy. For persistence, upgrade
 * to a paid plan with a disk, or migrate to PostgreSQL.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'metri.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Load / Save helpers ──────────────────────

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('DB load error, resetting:', err.message);
  }
  return { users: [], sessions: [], entries: [] };
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

// Initialize on startup
let _db = loadDB();

// ── Session Methods ──────────────────────────

/**
 * Save a complete session and its entries
 */
function saveSession(session) {
  _db.sessions.push({
    id: session.id,
    user_id: session.user_id,
    title: session.title,
    date: session.date,
    duration: session.duration || 0,
    created_at: new Date().toISOString(),
  });

  for (const entry of session.entries) {
    _db.entries.push({
      id: entry.id || Math.random().toString(36).substr(2, 9),
      session_id: session.id,
      text: entry.text,
      lang: entry.lang,
      time: entry.time,
    });
  }

  saveDB(_db);
  return session;
}

/**
 * Get all sessions for a specific user
 */
function getSessions(userId) {
  const sessions = _db.sessions
    .filter(s => s.user_id === userId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return sessions.map(s => {
    const entries = _db.entries
      .filter(e => e.session_id === s.id)
      .sort((a, b) => a.time - b.time);
    return { ...s, entries };
  });
}

/**
 * Get a single session by ID and verify owner
 */
function getSessionById(id, userId) {
  const session = _db.sessions.find(s => s.id === id && s.user_id === userId);
  if (!session) return null;

  const entries = _db.entries
    .filter(e => e.session_id === id)
    .sort((a, b) => a.time - b.time);
  return { ...session, entries };
}

/**
 * Delete a session and its entries
 */
function deleteSession(id, userId) {
  const idx = _db.sessions.findIndex(s => s.id === id && s.user_id === userId);
  if (idx === -1) return false;

  _db.sessions.splice(idx, 1);
  _db.entries = _db.entries.filter(e => e.session_id !== id);
  saveDB(_db);
  return true;
}

/**
 * Search transcripts for a specific user
 */
function searchTranscripts(query, userId) {
  const userSessionIds = new Set(
    _db.sessions.filter(s => s.user_id === userId).map(s => s.id)
  );

  const lowerQuery = query.toLowerCase();

  const results = [];
  for (const entry of _db.entries) {
    if (!userSessionIds.has(entry.session_id)) continue;
    if (!entry.text.toLowerCase().includes(lowerQuery)) continue;

    const session = _db.sessions.find(s => s.id === entry.session_id);
    results.push({
      session_id: entry.session_id,
      title: session?.title || '',
      text: entry.text,
      lang: entry.lang,
      time: entry.time,
    });
  }

  return results.sort((a, b) => b.time - a.time);
}

// ── Auth Methods ─────────────────────────────

function createUser(username, passwordHash) {
  const id = Math.random().toString(36).substr(2, 9);
  const user = {
    id,
    username,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
  };
  _db.users.push(user);
  saveDB(_db);
  return { id, username };
}

function findUserByUsername(username) {
  return _db.users.find(u => u.username === username) || null;
}


module.exports = {
  saveSession,
  getSessions,
  getSessionById,
  deleteSession,
  searchTranscripts,
  createUser,
  findUserByUsername,
};
