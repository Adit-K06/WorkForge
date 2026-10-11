from __future__ import annotations

import hmac
import json
import os
import re
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="Dayframe API", docs_url=None, redoc_url=None)
STATE_KEYS = ("tasks", "competitions", "projects", "roadmap", "focusSessions", "timetable")


def empty_state() -> dict[str, Any]:
    return {
        "tasks": [],
        "competitions": [],
        "projects": [],
        "roadmap": {"files": [], "completed": {}, "syncedAt": None},
        "focusSessions": [],
        "timetable": [],
    }


def postgres_enabled() -> bool:
    return bool(os.getenv("DATABASE_URL"))


def ensure_database() -> None:
    if postgres_enabled():
        import psycopg

        with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=8) as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS dayframe_state (
                    id SMALLINT PRIMARY KEY,
                    payload JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )"""
            )
        return

    if os.getenv("VERCEL"):
        raise RuntimeError("DATABASE_URL is missing. Connect a Neon Postgres database in Vercel.")

    db_path = Path(os.getenv("WORKFORGE_DB_PATH", "workforge.sqlite3"))
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS dayframe_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)"
        )


def read_state() -> dict[str, Any]:
    ensure_database()
    if postgres_enabled():
        import psycopg

        with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=8) as connection:
            row = connection.execute("SELECT payload FROM dayframe_state WHERE id = 1").fetchone()
        if not row:
            return empty_state()
        payload = row[0]
    else:
        db_path = Path(os.getenv("WORKFORGE_DB_PATH", "workforge.sqlite3"))
        with sqlite3.connect(db_path) as connection:
            row = connection.execute("SELECT payload FROM dayframe_state WHERE id = 1").fetchone()
        if not row:
            return empty_state()
        payload = json.loads(row[0])

    result = empty_state()
    if isinstance(payload, dict):
        for key in STATE_KEYS:
            if key in payload:
                result[key] = payload[key]
    return result


def write_state(payload: dict[str, Any]) -> None:
    ensure_database()
    normalized = empty_state()
    for key in STATE_KEYS:
        if key in payload:
            normalized[key] = payload[key]

    if postgres_enabled():
        import psycopg

        with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=8) as connection:
            connection.execute(
                """INSERT INTO dayframe_state (id, payload, updated_at)
                   VALUES (1, %s::jsonb, NOW())
                   ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()""",
                (json.dumps(normalized),),
            )
        return

    db_path = Path(os.getenv("WORKFORGE_DB_PATH", "workforge.sqlite3"))
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO dayframe_state (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
            (json.dumps(normalized),),
        )


def check_password(request: Request) -> None:
    expected = os.getenv("APP_PASSWORD", "")
    if not expected:
        if os.getenv("VERCEL"):
            raise PermissionError("APP_PASSWORD is missing. Set it in Vercel project environment variables.")
        return
    supplied = request.headers.get("x-app-password", "")
    if not hmac.compare_digest(supplied, expected):
        raise PermissionError("Enter the workspace password to continue.")


def github_roadmap_files() -> list[dict[str, str]]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "dayframe-roadmap-sync"}
    repo_request = urllib.request.Request(
        "https://api.github.com/repos/adi-training/swe-roadmap", headers=headers
    )
    with urllib.request.urlopen(repo_request, timeout=15) as response:
        repository = json.load(response)
    branch = repository.get("default_branch") or "main"
    tree_url = f"https://api.github.com/repos/adi-training/swe-roadmap/git/trees/{branch}?recursive=1"
    tree_request = urllib.request.Request(tree_url, headers=headers)
    with urllib.request.urlopen(tree_request, timeout=20) as response:
        tree = json.load(response)

    files: list[dict[str, str]] = []
    for entry in tree.get("tree", []):
        path = entry.get("path", "")
        if entry.get("type") != "blob" or not path.lower().endswith(".md"):
            continue
        parts = path.split("/")
        phase = next((part for part in parts if re.search(r"phase\s*[-_ ]?\s*\d+", part, re.I)), "Other")
        phase_match = re.search(r"phase\s*[-_ ]?\s*(\d+)", phase, re.I)
        if phase_match:
            phase = f"Phase {phase_match.group(1)}"
        folder = "/".join(parts[:-1]) if len(parts) > 1 else "General"
        files.append({"id": path, "path": path, "phase": phase, "folder": folder, "name": parts[-1]})
    return sorted(files, key=lambda item: (item["phase"].casefold(), item["folder"].casefold(), item["name"].casefold()))


def refresh_roadmap() -> dict[str, Any]:
    state = read_state()
    files = github_roadmap_files()
    roadmap = state.get("roadmap") or {}
    state["roadmap"] = {
        "files": files,
        "completed": roadmap.get("completed", {}),
        "syncedAt": datetime.now(timezone.utc).isoformat(),
    }
    write_state(state)
    return state["roadmap"]


async def handle_request(path: str, request: Request):
    route = path.strip("/")
    if route.startswith("api/"):
        route = route[4:]
    if not route:
        route = "health"

    if route in {"health", "status"} and request.method == "GET":
        return {"ok": True, "storage": "postgres" if postgres_enabled() else "local", "authRequired": bool(os.getenv("APP_PASSWORD")) or bool(os.getenv("VERCEL"))}

    if route == "roadmap/refresh" and request.method == "GET":
        secret = os.getenv("CRON_SECRET", "")
        supplied = request.headers.get("authorization", "")
        if not secret:
            return JSONResponse({"detail": "CRON_SECRET is not configured."}, status_code=503)
        if not hmac.compare_digest(supplied, f"Bearer {secret}"):
            return JSONResponse({"detail": "Scheduled refresh authorization failed."}, status_code=401)
        return {"roadmap": refresh_roadmap()}

    if route not in {"state", "roadmap/refresh", "ai/plan"}:
        return JSONResponse({"detail": "Not found."}, status_code=404)

    try:
        check_password(request)
    except PermissionError as exc:
        status = 503 if "missing" in str(exc).lower() or "set it" in str(exc).lower() else 401
        return JSONResponse({"detail": str(exc)}, status_code=status)

    try:
        if route == "state" and request.method == "GET":
            return {"state": read_state()}

        if route == "state" and request.method == "PUT":
            payload = await request.json()
            if not isinstance(payload, dict):
                return JSONResponse({"detail": "Workspace data must be an object."}, status_code=400)
            write_state(payload)
            return {"state": read_state(), "saved": True}

        if route == "roadmap/refresh" and request.method == "POST":
            return {"roadmap": refresh_roadmap()}

        if route == "ai/plan" and request.method == "POST":
            api_key = os.getenv("OPENAI_API_KEY", "")
            if not api_key:
                return JSONResponse({"detail": "Add OPENAI_API_KEY to enable the AI planner."}, status_code=503)
            from openai import OpenAI

            payload = await request.json()
            compact_tasks = [
                {
                    "title": task.get("title", ""),
                    "category": task.get("category", ""),
                    "durationMinutes": task.get("durationMinutes", 0),
                    "startTime": task.get("startTime", ""),
                    "complete": task.get("complete", False),
                }
                for task in payload.get("tasks", [])
            ]
            response = OpenAI(api_key=api_key).responses.create(
                model=os.getenv("OPENAI_MODEL", "gpt-6-astra"),
                instructions=(
                    "You are a concise personal study and work planner. Use only the supplied task list. "
                    "Suggest a realistic order with short breaks, protect fixed start times, and call out overload. "
                    "Return a small heading and 3-5 practical bullets. Never invent a task or claim a deadline."
                ),
                input=json.dumps({"date": payload.get("date"), "tasks": compact_tasks}),
                store=False,
            )
            return {"plan": response.output_text}

        return JSONResponse({"detail": "Method not allowed."}, status_code=405)
    except RuntimeError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=503)
    except urllib.error.HTTPError as exc:
        return JSONResponse({"detail": f"GitHub roadmap sync failed ({exc.code})."}, status_code=502)
    except urllib.error.URLError:
        return JSONResponse({"detail": "Could not reach GitHub. Try again when the network is available."}, status_code=502)
    except Exception as exc:
        detail = str(exc) or "The request could not be completed."
        return JSONResponse({"detail": detail[:240]}, status_code=502)


@app.api_route("/{path:path}", methods=["GET", "PUT", "POST", "PATCH", "DELETE"])
async def api_router(path: str, request: Request):
    return await handle_request(path, request)
