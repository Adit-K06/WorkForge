# Dayframe

Dayframe is a personal, responsive work and study planner. It is a TypeScript web app with a Python FastAPI backend, designed to run locally and deploy together on Vercel.

## What is included

- A day-by-day task list with category colors, scheduled times, descriptions, checkboxes, and subtasks.
- A drag-and-drop competition board with upcoming, in-progress, and wrapped-up columns.
- A SWE roadmap checklist that reads Markdown files from `adi-training/swe-roadmap` and preserves completion state across repository syncs.
- A drag-and-drop project board with categories, due dates, progress, project tasks, and nested subtasks.
- A focus timer and stopwatch with daily, weekly, and monthly time and tree counts.
- An optional AI planner. It sends only task titles, categories, durations, start times, completion state, and the selected date to the OpenAI API. The API key stays on the server.
- A private workspace password and shared Postgres storage for syncing your data between devices.
- A responsive layout and installable web-app manifest for a home-screen shortcut on mobile.

## Run locally (Windows)

You need Node.js 20.9 or newer and Python 3.12 or newer.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Local development saves to `workforge.sqlite3` and does not require a password or API key. The AI planner needs an `OPENAI_API_KEY`; add it to `.env.local` to enable it.

## Deploy to Vercel

1. Push this folder to a GitHub repository you own, then import that repository in Vercel with the project root set to this folder.
2. In the Vercel Marketplace, connect a Neon Postgres database to the project. Vercel will add its database connection environment variables; set `DATABASE_URL` to the pooled connection string.
3. Add these Production environment variables in Vercel:
   - `APP_PASSWORD`: a long password used to open your private workspace.
   - `CRON_SECRET`: a random secret used to authorize the scheduled GitHub sync.
   - `DATABASE_URL`: the Neon Postgres pooled connection string.
   - `OPENAI_API_KEY`: optional; only needed for the AI planner.
   - `OPENAI_MODEL`: optional; defaults to `gpt-6-astra`.
4. Deploy. The first API request creates the small Dayframe state table automatically. Vercel serves the TypeScript app and Python API from the same project.
5. Open the deployment URL on your laptop and phone, enter the same workspace password, and bookmark it. On mobile, use the browser's **Add to Home Screen** action for an app-like shortcut.

The roadmap refresh is scheduled for midnight India time (`18:30 UTC`) and uses the `CRON_SECRET` environment variable. Vercel Cron uses UTC schedules.

## Storage and privacy

The workspace is intentionally single-user. The password is checked by the Python API; it is not stored in the database. The browser keeps it in session storage for the current tab session. With Postgres configured, task and timer data syncs through the Vercel deployment. Without Postgres, the local app uses SQLite, and an unconfigured production app falls back to browser-only storage with a visible notice.

The GitHub repository is public. Roadmap completion checks are stored in your workspace and matched by file path, so a repository refresh does not clear them.

## Project layout

```text
app/                  Next.js pages, metadata, and responsive theme
components/            Interactive Dayframe screens
api/index.py           FastAPI state, roadmap, and AI endpoints
lib/                   Shared TypeScript types and API helper
requirements.txt       Python dependencies
vercel.json            India-midnight roadmap cron
```
