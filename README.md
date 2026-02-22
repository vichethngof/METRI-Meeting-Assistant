# 🎙️ METRI Meeting Assistant — Full Stack

Bilingual meeting transcription app powered by **OpenAI Whisper**.
Supports **English** and **ភាសាខ្មែរ (Khmer)** automatically.

---

## 📁 Project Structure

```
metri/
├── backend/          ← Node.js + Express + WebSocket server
│   ├── server.js     ← Main server (REST API + WebSocket)
│   ├── package.json
│   ├── .env          ← Your secrets (create from .env.example)
│   ├── data/         ← Transcript storage (auto-created)
│   └── uploads/      ← Temp audio files (auto-created)
│
├── frontend/         ← React + Vite app
│   ├── src/
│   │   ├── App.jsx   ← Main UI
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
└── README.md
```

---

## ⚡ Quick Setup (5 minutes)

### Prerequisites
- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Google Chrome** — best speech + mic support
- **OpenAI API key** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

### Step 1 — Configure the backend

```bash
cd backend

# Copy the example env file
cp .env.example .env

# Edit .env and add your OpenAI API key:
# OPENAI_API_KEY=sk-your-key-here

# Install dependencies
npm install
```

### Step 2 — Start the backend

```bash
# In the backend/ folder:
npm start

# You should see:
# 🎙️  METRI Backend running on http://localhost:3001
# 📡  WebSocket on ws://localhost:3001/ws
# 🔑  Whisper API: ✅ Configured
```

### Step 3 — Start the frontend

```bash
# Open a NEW terminal tab, then:
cd frontend
npm install
npm run dev

# You should see:
# ➜  Local:   http://localhost:5173/
```

### Step 4 — Open the app

Open **http://localhost:5173** in **Google Chrome** and click the mic button!

---

## 🔑 Getting an OpenAI API Key

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up / log in
3. Click **API Keys** in the sidebar
4. Click **Create new secret key**
5. Copy the key and paste it in `backend/.env`

**Cost:** Whisper charges ~$0.006 per minute of audio — very affordable.
A 1-hour meeting costs about **$0.36**.

---

## 📡 Using METRI in Online Meetings

METRI transcribes your microphone. To also capture remote speakers
(Zoom, Google Meet, Teams), route their audio through your mic:

### Windows (easiest)
1. Right-click speaker in taskbar → **Sounds** → **Recording** tab
2. Right-click blank area → **Show Disabled Devices**
3. Right-click **Stereo Mix** → **Enable** → **Set as Default**
4. Wear headphones (prevents echo)
5. Start METRI — it now hears everything ✅

### Mac (recommended: BlackHole)
1. Download **BlackHole** (free): [existential.audio/blackhole](https://existential.audio/blackhole)
2. Open **Audio MIDI Setup** → **+** → **Create Multi-Output Device**
3. Add BlackHole + your headphones
4. Set system output to the Multi-Output Device
5. Set METRI mic input to BlackHole ✅

---

## 🚀 Host for Testing (Free & Fast)

### Backend → Render.com
1. Push this code to **GitHub**.
2. Go to [Render.com](https://render.com) → **New +** → **Blueprint**.
3. Connect your repo. It will auto-detect `render.yaml` and create the `metri-backend` service.
4. **Crucial:** In the Render dashboard, go to `metri-backend` → **Environment** and set:
   - `OPENAI_API_KEY` = your OpenAI key
   - `FRONTEND_URL` = your Netlify URL (e.g. `https://metri.netlify.app`)
5. Wait for the first deploy to finish. Note the backend URL (e.g. `https://metri-backend.onrender.com`).

### Frontend → Netlify
1. Go to [Netlify](https://netlify.com) → **Add new site** → **Import from Git**.
2. Connect the **same GitHub repo**.
3. Set the **Base Directory** to `frontend`.
4. Build command: `npm install && npm run build`
5. Publish directory: `frontend/dist`
6. **Crucial:** Go to **Site settings** → **Environment Variables** and add:
   - `VITE_API_URL` = your Render backend URL (e.g. `https://metri-backend.onrender.com`)
7. **Trigger a redeploy** after setting the variable so the frontend picks it up.

---

## 🛠 Features (Testing Ready)
- ✅ **Multi-user Login**: Secure accounts for different testers.
- ✅ **PDF Export**: Generate professional reports of meetings.
- ✅ **AI Summaries**: Khmer & English summaries in one click.
- ✅ **Global Search**: Find anything across all saved transcripts.

---

## 🛠 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server status + API key check |
| POST | `/api/transcribe` | Transcribe an audio file (multipart) |
| GET | `/api/sessions` | List all saved sessions |
| POST | `/api/sessions` | Save a new session |
| DELETE | `/api/sessions/:id` | Delete a session |
| GET | `/api/sessions/:id/download` | Download transcript as .txt |

WebSocket endpoint: `ws://localhost:3001/ws`

---

## 🌐 Browser Support

| Browser | English | Khmer | Recommended |
|---------|---------|-------|-------------|
| Chrome (desktop) | ✅ | ✅ | ⭐ Best |
| Chrome (Android) | ✅ | ✅ | ⭐ Good |
| Edge | ✅ | ✅ | OK |
| Safari | ✅ | ❌ | — |
| Firefox | ✅ | ❌ | — |

---

## 📝 Tech Stack

| Layer | Technology |
|-------|-----------|
| Transcription | OpenAI Whisper (via API) |
| Backend | Node.js + Express |
| Real-time | WebSocket (ws library) |
| Audio recording | Browser MediaRecorder API |
| Frontend | React + Vite |
| Storage | JSON file (upgradeable to PostgreSQL) |
| Deployment | Render (backend) + Netlify (frontend) |
