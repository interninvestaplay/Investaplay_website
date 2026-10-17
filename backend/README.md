# 🦊 QuizGame Backend Server

> **Engineered by InvestaPlay Studios**  
> High-performance Node.js, Express, MySQL 8, and Socket.IO real-time gaming backend powering QuizzyFox Web & Mobile apps.

---

## 📋 Table of Contents
1. [Overview & Tech Stack](#-overview--tech-stack)
2. [Folder Structure](#-folder-structure)
3. [Prerequisites & Requirements](#-prerequisites--requirements)
4. [Environment Configuration (.env)](#-environment-configuration-env)
5. [Database Setup & Auto-Migration](#-database-setup--auto-migration)
6. [How to Run](#-how-to-run)
7. [API Endpoints Reference](#-api-endpoints-reference)
8. [Real-Time Socket.IO Events](#-real-time-socketio-events)
9. [AI Engine & Groq LLM Integration](#-ai-engine--groq-llm-integration)
10. [Question Import & Management](#-question-import--management)
11. [Testing & Syntax Checking](#-testing--syntax-checking)

---

## ⚡ Overview & Tech Stack

The backend is built with a modular, scalable layered architecture designed for ultra-low latency multiplayer matchmaking, AI question generation, and secure player progression.

* **Runtime**: Node.js (v18 or v20+ LTS)
* **Framework**: Express.js
* **Real-Time Engine**: Socket.IO (WebSockets with polling fallback)
* **Database**: MySQL 8+ with Connection Pooling (`mysql2/promise`)
* **AI Provider**: Groq Cloud SDK (`llama-3.3-70b-versatile` / `qwen/qwen3.8-27b`)
* **Document Processing**: `pdf-parse` (for PDF question generation) & `xlsx` (Excel sheets)
* **Security & Auth**: JWT (Access + Rotating Refresh Tokens), `bcryptjs`, `helmet`, `cors`, `express-rate-limit`

---

## 📁 Folder Structure

```text
backend/
├── src/
│   ├── config/                     # Environment validation & constants
│   ├── controllers/                # HTTP route controllers
│   ├── db/                         # MySQL connection pool & autoMigrate logic
│   ├── middleware/                 # Auth verification, rate limits, upload handlers
│   ├── modules/
│   │   └── quickQuiz/              # Groq AI quiz generator, PDF extractor & validators
│   ├── routes/                     # REST API route definitions
│   │   ├── auth.routes.js          # Register, Login, Guest, Me, Refresh, Logout
│   │   ├── challenges.routes.js    # 1v1 PvP challenge invitations & inbox
│   │   ├── games.routes.js         # Match sessions, scoring, answers
│   │   ├── questions.routes.js     # Question bank & Excel imports
│   │   ├── rooms.routes.js         # Multiplayer room lobbies & invite codes
│   │   ├── shop.routes.js          # Avatar store & inventory purchase
│   │   ├── statistics.routes.js    # Global analytics & user stats
│   │   ├── tournaments.routes.js   # Scheduled tournaments
│   │   └── users.routes.js         # Profiles, Leaderboards, Daily Streak
│   ├── scripts/                    # Database seeding, syntax checks, user utils
│   ├── services/                   # Business logic (matchmaking, wallet, scoring)
│   ├── sockets/                    # Real-time Socket.IO event handlers
│   ├── utils/                      # Helper utilities (token signer, room codes)
│   └── server.js                   # Main application entry point (Port 4000)
├── migrations/                     # Sequential SQL database migrations (001 to 021)
├── Question_banck/                 # Pre-compiled question spreadsheets (.xlsx)
├── templates/                      # Question and category import templates
├── uploads/                        # User uploads, PDFs, and shop avatars
├── .env                            # Active environment variables
├── .env.example                    # Template environment variables
└── package.json                    # Dependencies & npm scripts
```

---

## ⚙️ Prerequisites & Requirements

1. **Node.js**: v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
2. **MySQL**: v8.0 or higher (via XAMPP, Docker, or standalone MySQL service)
   - Ensure MySQL service is running on `127.0.0.1:3306`.
   - Default user is usually `root` with empty password (`""`).

---

## 🔐 Environment Configuration (.env)

The `.env` file in the `backend/` directory controls database and service connections:

```env
NODE_ENV=development
PORT=4000

# MySQL Database Configuration
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=quizgame

# JWT Secrets (replace with long secure random strings in production)
JWT_ACCESS_SECRET=replace-with-random-secret
JWT_REFRESH_SECRET=replace-with-another-random-secret

# Allowed CORS Origins
CLIENT_ORIGIN=http://localhost:5173,http://localhost:8081,http://localhost:8082,http://localhost:19006

# Groq Cloud AI Configuration
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=qwen/qwen3.8-27b
```

---

## 🗄️ Database Setup & Auto-Migration

QuizGame Backend features **Built-in Auto-Migration**:
* When the server boots (`node src/server.js`), it automatically connects to MySQL, checks if `quizgame` database exists, and executes any missing schema tables and columns automatically.

### Manual Database Commands (Optional):
```bash
# Run all migrations from scratch
npm run db:migrate:all

# Seed initial categories and sample data
npm run db:seed

# Seed curated sports and general questions
npm run db:seed:questions

# Import custom questions from Question_banck
npm run questions:import
```

---

## 🚀 How to Run

### From Inside `QuizWeb/backend` Folder:

```bash
# 1. Install dependencies (if not already installed)
npm install

# 2. Start in Development Mode (with hot-reload via nodemon)
npm run dev

# 3. OR Start in Production Mode
npm start
```

### From the Root `QuizWeb` Directory:
```bash
# Run backend directly from root
npm run backend
```

Once running, verify health at: **`http://localhost:4000/health`**  
Expected output:
```json
{
  "ok": true,
  "service": "quizgame-backend",
  "databaseTime": "2026-10-16T07:18:32.000Z"
}
```

---

## 📡 API Endpoints Reference

### 1. Authentication (`/api/auth`)
* `POST /api/auth/register` — Create a new account with email, username & password.
* `POST /api/auth/login` — Sign in with email or username.
* `POST /api/auth/guest` — Instant anonymous play (generates temporary guest session).
* `GET  /api/auth/me` — Retrieve current authenticated user profile.
* `POST /api/auth/refresh` — Refresh expired JWT access token.
* `POST /api/auth/logout` — Revoke active session refresh token.

### 2. Quick Quiz AI Engine (`/api/quick-quiz`)
* `GET  /api/quick-quiz/online-players` — List active online players ready for 1v1 battle.
* `POST /api/quick-quiz/generate` — Generate custom AI quiz questions on any topic.
* `POST /api/quick-quiz/upload-pdf` — Extract text from uploaded PDF and generate AI quiz questions.
* `POST /api/quick-quiz/challenge` — Issue a 1v1 battle challenge with custom AI questions.
* `GET  /api/quick-quiz/session/:id` — Retrieve generated quiz session details.

### 3. Challenges & PvP Invitations (`/api/challenges`)
* `GET  /api/challenges` — List received and sent active challenge invitations.
* `POST /api/challenges/:id/accept` — Accept invitation and initialize synchronized room.
* `POST /api/challenges/:id/decline` — Decline duel invitation.
* `POST /api/challenges/:id/cancel` — Cancel sent invitation.

### 4. Multiplayer Rooms (`/api/rooms`)
* `POST /api/rooms` — Create a multiplayer lobby room with custom rules (category, difficulty, limit).
* `POST /api/rooms/join/:code` — Join an existing lobby room using a 6-character room code.
* `GET  /api/rooms/:roomId` — Fetch current room state, player list, and ready status.

### 5. Gameplay & Scoring (`/api/games`)
* `GET  /api/games/:gameId/current-question` — Retrieve current active question (without leaking answers).
* `POST /api/games/:gameId/answers` — Submit an answer with timestamp for speed bonus calculation.
* `GET  /api/games/:gameId/leaderboard` — Get final game scores and XP/coin payouts.

### 6. Users, Streaks & Leaderboards (`/api/users`)
* `GET  /api/users/leaderboard?period=weekly` — Global leaderboard rankings (weekly / all-time).
* `POST /api/users/daily-streak/claim` — Claim daily login reward coins and increment streak count.

---

## 🔄 Real-Time Socket.IO Events

All clients authenticate on socket handshake with `auth: { token: accessToken }`.

| Direction | Event Name | Payload / Description |
|---|---|---|
| **Client ➔ Server** | `room:join` | `{ roomId }` — Enters room channel. |
| **Client ➔ Server** | `room:ready` | `{ roomId, ready: true/false }` — Toggles ready state. |
| **Client ➔ Server** | `game:start` | `{ roomId }` — Host initiates the match. |
| **Client ➔ Server** | `game:answer` | `{ gameId, roomId, questionId, selectedOption, answeredInMs }` |
| **Client ➔ Server** | `challenge:send` | `{ targetUserId, challengeData }` — Real-time duel invite. |
| **Server ➔ Client** | `challenge:incoming` | Pops up 1v1 battle invite modal for recipient. |
| **Server ➔ Client** | `room:updated` | Emits updated player roster and status. |
| **Server ➔ Client** | `game:started` | Synced start countdown & first question broadcast. |
| **Server ➔ Client** | `game:scoreboard` | Live real-time score updates after each answer. |
| **Server ➔ Client** | `game:finished` | Final winner podium, XP, and coin rewards. |

---

## 🤖 AI Engine & Groq LLM Integration

The backend leverages Groq Cloud's ultra-fast inference:
- **Model**: `llama-3.3-70b-versatile` or `qwen/qwen3.8-27b`
- **Output Format**: Strictly validated JSON schema with options A, B, C, D, correct option index, and brief educational explanations.
- **Deduplication Engine**: Built-in similarity checking prevents identical questions from repeating in consecutive sessions.

---

## 🧪 Testing & Syntax Checking

To run full codebase syntax validation across all 60+ backend files:
```bash
npm run check
```

To run unit and integration test suites:
```bash
npm test
```

---

## 👥 Credits & Licensing

* **Project**: QuizzyFox Backend
* **Publisher**: InvestaPlay Studios
* **Copyright**: © 2026 InvestaPlay Studios. All Rights Reserved.
