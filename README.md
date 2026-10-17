# 🦊 QuizzyFox Web — AI Trivia Battle & Live Multiplayer

> **Created & Developed by InvestaPlay Studios**  
> AI-powered interactive quiz platform with real-time 1v1 multiplayer duels, PDF question generation, and global leaderboards.

---

## 📋 Table of Contents
1. [Project Overview](#-project-overview)
2. [Tech Stack](#-tech-stack)
3. [Folder Structure](#-folder-structure)
4. [How to Run (Step-by-Step)](#-how-to-run-step-by-step)
5. [Available Scripts](#-available-scripts)
6. [Production Deployment](#-production-deployment-vercel--netlify--vps)
7. [Troubleshooting & FAQs](#-troubleshooting--faqs)
8. [Credits & Brand Info](#-credits--brand-info)

---

## 🌟 Project Overview

**QuizzyFox Web** is the official web version of the QuizzyFox mobile app. It shares the same real-time backend, authentication, Groq AI engine, and database.

### Key Features:
* ⚡ **Quick Quiz AI Practice**: Generate instant custom quizzes on any topic (Coding, Science, History, Bollywood, etc.) powered by Groq AI (`llama-3.3-70b-versatile`).
* 📄 **PDF Study Quiz Generator**: Drag-and-drop or upload PDF study notes to extract and generate AI multiple-choice questions automatically.
* ⚔️ **1v1 Live Online Challenge**: Real-time multiplayer battles matching "Play with Friend" rules. Send challenges to any online player, receive live incoming audio/visual modal notifications, and duel with synced 15-second per-question timers.
* 🎁 **Lifelines & Rewards**: 50:50 Lifeline, Skip question, Streak combo multiplier, and Daily coin rewards.
* 🏆 **Global Leaderboard & Hall of Fame**: Podium rankings for top weekly masters and all-time champions.
* 🎨 **Rich Gaming Design System**: Glassmorphism dark UI, official mascot (`quizzyfox.png`), official logo, audio sound effects (Web Audio API), and 16 character avatars directly from the mobile app.

---

## 🛠️ Tech Stack

* **Framework**: React 18 + Vite 6
* **Language**: TypeScript
* **Routing**: React Router DOM v6
* **Real-Time Multiplayer**: Socket.IO Client
* **HTTP Client**: Native Fetch with JWT Auth Interceptor
* **Icons**: Lucide React
* **Effects**: Canvas Confetti + Custom Web Audio API Synthesizer
* **Styling**: Modern Vanilla CSS Design Tokens (Glassmorphism, Neon Glow, Mobile Responsive)

---

## 📁 Folder Structure

```text
QuizWeb/
├── backend/                        # Complete Quiz Backend API & Socket Server (Node.js/Express)
│   ├── src/                        # Controllers, Routes, Sockets, Services, DB Pool
│   │   ├── modules/quickQuiz/      # Groq AI Question Generator & PDF parser
│   │   ├── sockets/                # Real-time 1v1 multiplayer matchmaking & chat
│   │   ├── services/               # User, Room, Challenge, Tournament, Wallet
│   │   └── server.js               # Server entry point (Port 4000)
│   ├── migrations/                 # Full MySQL database migration files (001 to 021)
│   ├── Question_banck/             # Curated quiz question banks (.xlsx)
│   ├── scripts/                    # Database seeding and utility scripts
│   ├── templates/                  # Question & category import templates
│   ├── uploads/                    # PDF uploads and shop asset storage
│   ├── .env                        # Backend environment configuration
│   └── package.json                # Backend dependencies & npm scripts
├── public/
│   ├── assets/
│   │   ├── quizzyfox.png           # Official QuizzyFox mascot
│   │   ├── logo.png                # Official app logo
│   │   ├── app-icon.png            # App launcher icon
│   │   ├── trophy.png              # Victory trophy
│   │   ├── live-trophy.png         # Leaderboard trophy
│   │   ├── coins.png               # Gold coin badge
│   │   ├── avatar-boy.png          # Default avatar 1
│   │   ├── avatar-girl.png         # Default avatar 2
│   │   ├── robot-login.png         # Mascot illustration
│   │   └── avatars/                # 16 Character avatars (01 to 16 webp)
│   └── favicon.png                 # Browser tab icon
├── src/
│   ├── components/
│   │   ├── Navbar.tsx              # Top navigation bar & user stats
│   │   └── IncomingChallengeModal.tsx # Real-time 1v1 battle popup
│   ├── context/
│   │   └── AuthContext.tsx         # User authentication & guest session
│   ├── pages/
│   │   ├── HomePage.tsx            # Game mode lobby & online players
│   │   ├── QuickQuizPage.tsx       # AI topic/PDF generator & 1v1 challenge
│   │   ├── GamePage.tsx            # Match engine with 15s timer & lifelines
│   │   ├── QuizRoomPage.tsx        # 1v1 Room lobby with ready status
│   │   ├── FriendsPage.tsx         # Challenge inbox & private room creator
│   │   ├── LeaderboardPage.tsx     # Global podium & rankings
│   │   └── LoginPage.tsx           # Sign in, register & instant guest play
│   ├── services/
│   │   ├── api.ts                  # REST API client
│   │   └── socket.ts               # Socket.IO connection manager
│   ├── types/
│   │   └── index.ts                # TypeScript interfaces
│   ├── App.tsx                     # Main layout & router
│   ├── index.css                   # Global game design system
│   └── main.tsx                    # React DOM entry point
├── .env.example                    # Frontend environment template
├── start.bat                       # One-click launcher for Backend & Frontend
├── start_quizweb.bat               # One-click launcher
├── index.html                      # HTML root template with Google Fonts
├── package.json                    # Project dependencies & fullstack scripts
├── tsconfig.json                   # TypeScript configuration
└── vite.config.ts                  # Vite build & proxy configuration
```

---

## 🚀 How to Run (Step-by-Step)

Follow these simple steps whenever you copy this `QuizWeb` folder to another computer or new folder:

### Step 1: Requirements Check
Make sure the target PC has **Node.js** (v18 or v20+ LTS recommended) and **MySQL** (XAMPP / MySQL Service) installed and running:
* Node.js: [https://nodejs.org/](https://nodejs.org/)
* Verify in Terminal:
  ```bash
  node -v
  npm -v
  ```

---

### Step 2: One-Click Startup (Easiest Method)
Simply double-click:
```text
start.bat
```
*(This automatically launches Backend on Port 4000, Frontend on Port 5173, and opens your browser!)*

---

### Step 3: Or Run via Command Line

**Option A — Run Both Together:**
```bash
npm start
# OR
npm run dev:all
```

**Option B — Run Separately:**
```bash
# Terminal 1 (Backend Server - Port 4000)
npm run backend

# Terminal 2 (Frontend Website - Port 5173)
npm run dev
```

Open **`http://localhost:5173/`** in your browser. The website and backend are now fully live! 🎉

---

## 📜 Available Scripts

Inside the `QuizWeb` directory, you can run:

| Command | Description |
|---|---|
| `start.bat` | Windows 1-click launcher for both Backend (Port 4000) & Frontend (Port 5173). |
| `npm start` or `npm run dev:all` | Runs both Backend and Frontend concurrently with color logs. |
| `npm run dev` | Starts only the Vite Frontend development server on `http://localhost:5173/`. |
| `npm run backend` | Starts only the Backend Node.js server on `http://localhost:4000/`. |
| `npm run build` | Compiles TypeScript and creates an optimized production bundle inside `dist/`. |
| `npm run preview` | Runs a local server to test the production `dist/` build locally. |
---

## 🌐 Production Deployment (Vercel / Netlify / VPS)

### Option A: Deploy to Vercel (Easiest & Free)
1. Push `QuizWeb` to GitHub or use Vercel CLI (`npm i -g vercel && vercel`).
2. Framework Preset: **Vite**
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. In Vercel Environment Variables:
   * Set `VITE_BACKEND_URL` to your production backend URL (e.g. `https://quiz-api.yourdomain.com`).

### Option B: Deploy to Netlify
1. Drag & drop the `dist/` folder into Netlify Drop, or connect your Git repository.
2. Build command: `npm run build`
3. Publish directory: `dist`

### Option C: Self-Hosted (Nginx / Apache / Windows Server)
1. Run `npm run build` to generate the `dist/` directory.
2. Point your web server root to the `dist/` folder.
3. Configure SPA fallback so all routes redirect to `index.html`.

---

## ❓ Troubleshooting & FAQs

### 1. `npm install` throws an error?
* Ensure you are running Node.js 18 or 20+.
* Clear npm cache if needed: `npm cache clean --force` then run `npm install`.

### 2. "Cannot connect to server" or "Network Error"?
* Verify that the backend server is running on port 4000 (run `npm run backend` or `start.bat`).
* Ensure MySQL (XAMPP / MySQL Service) is running.
* Check browser console (`F12`) to verify the endpoint being called.

### 3. Port 5173 is already in use?
* Vite will automatically ask to run on port 5174.
* Alternatively, run on a custom port: `npx vite --port 3000`.

### 4. How to play 1v1 battle on the same computer?
* Open `http://localhost:5173/` in your normal browser tab (log in as Player 1).
* Open `http://localhost:5173/` in an **Incognito / Private tab** (log in as Player 2 or Guest).
* Go to Quick Quiz AI -> Select 1v1 Challenge -> Select the online player and click **Challenge ⚡**!

---

## 👥 Credits & Brand Info

* **Application Name**: QuizzyFox
* **Developer & Publisher**: InvestaPlay Studios
* **AI Engine**: Groq Cloud AI (`llama-3.3-70b-versatile`)
* **Copyright**: © 2026 QuizzyFox by InvestaPlay Studios. All Rights Reserved.
