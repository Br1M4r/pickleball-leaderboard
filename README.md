# PickleRank — Pickleball Leaderboard Management System

Manage players, record singles and doubles matches, and get automatically calculated rankings, statistics and a public leaderboard.

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + React Router, deployed to **Vercel** |
| Backend | ASP.NET Core 10 Web API + Entity Framework Core 10, deployed with **Docker** (Render, Railway, Azure, Fly.io…) |
| Database | **Neon** serverless PostgreSQL |
| Auth | JWT bearer tokens, PBKDF2 password hashing, role-based access (Admin / Player) |

```
pickleball-leaderboard/
├── backend/
│   ├── PickleballLeaderboard.sln
│   ├── Dockerfile
│   ├── PickleballLeaderboard.Api/      # ASP.NET Core Web API
│   │   ├── Controllers/                # Auth, Players, Matches, Leaderboard, RankingRules, Dashboard, Users
│   │   ├── Data/                       # AppDbContext (schema, constraints, indexes) + DbInitializer
│   │   ├── Dtos/                       # Request/response contracts with validation
│   │   ├── Entities/                   # EF Core entities and enums
│   │   ├── Infrastructure/             # Error handling, .env loader, Neon URL parser, helpers
│   │   ├── Services/                   # RankingCalculator, LeaderboardService, JWT, password hashing
│   │   └── .env.example
│   └── PickleballLeaderboard.Tests/    # xUnit tests for the ranking engine
├── frontend/
│   ├── src/
│   │   ├── api/                        # fetch client + endpoint wrappers
│   │   ├── components/                 # Layout, leaderboard table, podium, match cards, modals…
│   │   ├── context/                    # Auth + toast providers
│   │   ├── pages/                      # Public pages
│   │   ├── pages/admin/                # Dashboard, matches, players, accounts, ranking rules
│   │   └── styles/index.css
│   ├── vercel.json
│   └── .env.example
├── docs/DATABASE.md
└── render.yaml                         # optional one-click Render blueprint for the API
```

---

## 1. Prerequisites

- **.NET 10 SDK** — https://dotnet.microsoft.com/download
- **Node.js 20.19+ or 22.12+** (needed by Vite 8)
- A free **Neon** account — https://neon.tech

---

## 2. Create the Neon database

1. In Neon, create a project (pick the region closest to your users, e.g. *AWS Asia Pacific (Singapore)*).
2. Use the default `neondb` database or create a new **empty** one for this app.
3. Open **Connect** and copy the connection string. It looks like:
   `postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

Tip: create a separate Neon **branch** (e.g. `dev`) for local development so you never touch production data.

You don't need to run any SQL. On first start the API creates all tables, constraints and indexes, the default ranking rules and your first admin account.

---

## 3. Run the backend locally

```bash
cd backend/PickleballLeaderboard.Api
cp .env.example .env          # Windows: copy .env.example .env
```

Edit `.env`:

```ini
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.aws.neon.tech/neondb?sslmode=require
Jwt__Secret=<at least 32 random characters>
Cors__AllowedOrigins=http://localhost:5173
Admin__Email=you@example.com
Admin__Password=<a strong password>
```

Generate a secret with `openssl rand -base64 48`. In PowerShell you can use
`[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }))`.

Then run:

```bash
dotnet restore
dotnet run
```

The API listens on **http://localhost:5080**. Check it with:

- `GET http://localhost:5080/health` → `Healthy`
- `GET http://localhost:5080/openapi/v1.json` → OpenAPI document (Development only)

Run the ranking engine tests:

```bash
cd backend
dotnet test
```

---

## 4. Run the frontend locally

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The frontend reads the API address from `VITE_API_URL`. `.env.development` already points to `http://localhost:5080`.

Sign in with the `Admin__Email` / `Admin__Password` you configured, then:

1. **Admin → Players** – register players. You can also give each one a login.
2. **Admin → Matches → New match** – pick singles or doubles and the category, choose the players, and optionally enter the final score.
3. The **Leaderboard** updates right away.

Players can also self-register at `/register`.

---

## 5. Deploy to production

### 5.1 Backend (Docker → Render, as an example)

Any host that runs a Docker container or ASP.NET Core works. Render's free tier is a simple option.

1. Push this project to GitHub.
2. In Render: **New → Web Service**, connect the repo, and set:
   - **Root Directory:** `backend`
   - **Runtime:** Docker (it uses `backend/Dockerfile`)
   - **Health Check Path:** `/health`
3. Add these **environment variables**:

| Key | Value |
|---|---|
| `DATABASE_URL` | Neon production connection string |
| `Jwt__Secret` | long random secret (32+ chars) |
| `Cors__AllowedOrigins` | your Vercel URL, e.g. `https://picklerank.vercel.app` (comma-separate multiple) |
| `Admin__Email` | first admin email |
| `Admin__Password` | first admin password |

4. Deploy, then open `https://<your-service>.onrender.com/health`.

Instead of steps 2–3 you can use the included `render.yaml`: **New → Blueprint**.

Render provides HTTPS automatically. The app honours `$PORT`, trusts forwarded headers and sends HSTS in production.

> **Other hosts:** Azure App Service (publish with `dotnet publish -c Release`, or deploy the container), Railway and Fly.io all work the same way. Set the same environment variables.

> **Free-tier note:** free Render instances sleep when idle, so the first request after a pause takes about 30–50 seconds.

### 5.2 Frontend (Vercel)

1. In Vercel: **Add New → Project**, import the repo.
2. Set **Root Directory** to `frontend`. Vercel detects Vite automatically (build `npm run build`, output `dist`).
3. Add the environment variable `VITE_API_URL = https://<your-service>.onrender.com` (no trailing slash).
4. Deploy. `vercel.json` rewrites every route to `index.html`, so deep links such as `/players/12` work.

5. Go back to the backend and make sure `Cors__AllowedOrigins` contains the exact Vercel URL. If you change it, redeploy the API.

### 5.3 Production checklist

- [ ] Strong unique `Jwt__Secret` and admin password
- [ ] `Cors__AllowedOrigins` contains only your real frontend URL(s)
- [ ] Neon connection uses `sslmode=require`
- [ ] Optionally remove `Admin__Password` from the host after the first successful start. It is only used when no admin exists yet.
- [ ] Change the admin password from **My account** after the first login

---

## 6. How rankings work

- Rankings are **rebuilt from the full match history** every time a result is recorded, corrected, cancelled or restored, and whenever ranking rules or player status change. Because of this, corrections always produce consistent standings.
- Six independent leaderboards are kept: **Overall, Singles, Doubles, Men's, Women's and Mixed Doubles**. The **skill level** filter and search narrow any of them.
- Points (configurable under **Admin → Ranking rules**):
  - win points, plus loss points (negative values deduct points)
  - a **margin bonus** for winning by N+ points
  - a **streak bonus** every N consecutive wins
  - a minimum number of matches to be ranked, and an option to allow negative totals
- Tie-breakers: points → win % → wins → point differential. Fully tied players share a rank (1, 2, 2, 4).
- **Rank movement** (▲/▼) shows the change since the last time standings changed. **NEW** marks players who just entered a ranking.
- Deactivated players are removed from rankings, but their matches still count for their opponents.

## 7. Security

- Passwords are hashed with ASP.NET Core Identity's PBKDF2 hasher (HMAC-SHA512, 100k iterations, per-user salt).
- JWT tokens are validated on every request against the database. A deactivated account, or one whose role changed, is rejected immediately.
- Role-based authorization protects all write endpoints. Only admins can create or modify matches and results.
- Every match change is written to `MatchResultHistory` as before/after JSON snapshots, with the admin and the reason. Correcting a result requires a reason.
- Inputs are validated with data annotations and domain rules: team sizes, duplicate players, category/gender rules, no tied scores, and no results for future-dated matches.
- Rate limiting is applied to login and registration (10 per minute per IP).
- Errors are returned as RFC 7807 problem details, and internals are hidden in production.
- Image uploads are checked by file signature (JPEG/PNG/GIF/WEBP), limited to 2 MB and stored in the database.
- All secrets come from environment variables.

## 8. API overview

| Method | Endpoint | Access |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` | Public |
| GET | `/api/auth/me` · POST `/api/auth/change-password` | Signed in |
| GET | `/api/leaderboard?scope=&skillLevel=&gender=&search=&sortBy=&sortDir=` | Public |
| POST | `/api/leaderboard/recalculate` | Admin |
| GET | `/api/players` · `/api/players/{id}` · `/api/players/{id}/matches` · `/api/players/{id}/photo` | Public |
| POST/PUT | `/api/players` · `/api/players/{id}` | Admin |
| PATCH | `/api/players/{id}/status` | Admin |
| PUT | `/api/players/me` | Player (own profile) |
| POST/DELETE | `/api/players/{id}/photo` | Admin or owner |
| GET | `/api/matches` · `/api/matches/{id}` | Public |
| GET | `/api/matches/{id}/history` | Admin |
| POST/PUT | `/api/matches` · `/api/matches/{id}` | Admin |
| PUT | `/api/matches/{id}/result` | Admin |
| POST | `/api/matches/{id}/cancel` · `/api/matches/{id}/restore` | Admin |
| GET/PUT | `/api/ranking-rules` | GET public · PUT admin |
| GET | `/api/dashboard` | Admin |
| GET/POST/PUT | `/api/users` · `/api/users/{id}` · POST `/api/users/{id}/reset-password` | Admin |

## 9. Database schema changes (EF Core migrations)

On first run, when the project has no migrations, the API creates the schema directly from the model. If you plan to change the schema later, switch to migrations **before going to production**:

```bash
dotnet tool install --global dotnet-ef
cd backend/PickleballLeaderboard.Api
dotnet ef migrations add InitialCreate
```

Once a migration exists, the API applies pending migrations automatically on startup. If your database was already created without migrations, start with a fresh Neon branch or database when you switch.

See `docs/DATABASE.md` for the full table design.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `Jwt__Secret must be set…` on startup | Add a secret of 32+ characters to `.env` or the host's environment |
| `Database connection is not configured` | Set `DATABASE_URL` or `ConnectionStrings__DefaultConnection` |
| Browser shows a CORS error | Add the exact frontend origin (scheme + host, no trailing slash) to `Cors__AllowedOrigins` |
| You can't sign in as admin | Check the API logs for "Created administrator account". `Admin__Email`/`Admin__Password` are only used when no admin exists yet |
| Tables were not created | Use an **empty** database. EF's schema creation skips any database that already contains tables |
| Frontend calls `localhost` in production | Set `VITE_API_URL` in Vercel and **redeploy**, because Vite bakes env vars in at build time |
