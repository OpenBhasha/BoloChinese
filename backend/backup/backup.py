#!/usr/bin/env python3
"""
Downloads BoloChinese's submission data one request at a time, bypassing the
bulk zip-backup endpoint entirely. Uses the same admin API the dashboard
uses - just one small request per file instead of one big zip, so a slow
connection or a large dataset shows real, granular progress instead of a
long silent wait.

Requires: pip install requests

Edit BASE_URL / ADMIN_EMAIL / ADMIN_PASSWORD below, then just run:
    python3 download_backup.py

Writes, under OUTPUT_DIR:
    submissions.csv                          one row per submission
    <project>/<username>/<dialogueId>.wav    one file per recording

Safe to re-run: existing audio files are skipped, not re-downloaded.
"""
import csv
import os
import re
import sys
import requests

# ── Edit these three, then run ──────────────────────────────────────────────
BASE_URL = "https://your-app.example.com/api"  # no trailing slash; use
                                                # "http://localhost:5001/api" for local
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "CHANGE_ME"
# ─────────────────────────────────────────────────────────────────────────────

OUTPUT_DIR = "bolochinese_backup"
PAGE_SIZE = 100  # max the API allows
REQUEST_TIMEOUT = 60

CSV_COLUMNS = [
    "project", "username", "email", "dialogueId", "taskId", "status",
    "chineseTranscript", "pinyin", "correctedChineseTranscript", "correctedPinyin",
    "editCharCount", "pinyinVerified", "isCorrected", "discarded", "discardedAt",
    "audioDurationSeconds", "audioFileSizeBytes", "timeSpentMs",
    "createdAt", "updatedAt", "audioFile",
]


def sanitize(name):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", str(name or "").strip())
    return name or "unnamed"


def login(session):
    r = session.post(
        f"{BASE_URL}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    session.headers["Authorization"] = f"Bearer {r.json()['data']['token']}"


def get_projects(session):
    r = session.get(f"{BASE_URL}/admin/projects", timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    return r.json()["data"]


def get_submissions_page(session, project_id, page):
    r = session.get(
        f"{BASE_URL}/admin/projects/{project_id}/submissions",
        params={"page": page, "limit": PAGE_SIZE},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()["data"]


def download_audio(session, submission_id, dest_path):
    r = session.get(
        f"{BASE_URL}/admin/submissions/{submission_id}/audio",
        stream=True,
        timeout=REQUEST_TIMEOUT,
    )
    if r.status_code == 404:
        return False
    r.raise_for_status()
    with open(dest_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)
    return True


def main():
    if ADMIN_PASSWORD == "CHANGE_ME" or "your-app.example.com" in BASE_URL:
        sys.exit("Edit BASE_URL / ADMIN_EMAIL / ADMIN_PASSWORD at the top of this script first.")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    session = requests.Session()
    login(session)

    projects = get_projects(session)
    print(f"Found {len(projects)} project(s).")

    rows = []
    audio_jobs = []  # (submission_id, dest_path)

    for project in projects:
        page = 1
        while True:
            data = get_submissions_page(session, project["_id"], page)
            items = data["items"]
            for item in items:
                task = item.get("taskId") or {}
                user = item.get("userId") or {}
                audio = item.get("audio") or {}
                discarded = item.get("discarded") or {}
                dialogue_id = task.get("dialogueId") or item["_id"]
                username = sanitize(user.get("username") or user.get("email") or "unknown")

                audio_rel_path = ""
                if audio.get("url"):
                    audio_rel_path = os.path.join(
                        sanitize(project["name"]), username, f"{sanitize(dialogue_id)}.wav"
                    )
                    audio_jobs.append((item["_id"], os.path.join(OUTPUT_DIR, audio_rel_path)))

                rows.append({
                    "project": project["name"],
                    "username": user.get("username") or "",
                    "email": user.get("email") or "",
                    "dialogueId": dialogue_id,
                    "taskId": task.get("taskId") or "",
                    "status": item.get("status") or "",
                    "chineseTranscript": task.get("chineseTranscript") or "",
                    "pinyin": task.get("pinyin") or "",
                    "correctedChineseTranscript": item.get("correctedChineseTranscript") or "",
                    "correctedPinyin": item.get("correctedPinyin") or "",
                    "editCharCount": item.get("editCharCount") or 0,
                    "pinyinVerified": item.get("pinyinVerified"),
                    "isCorrected": item.get("isCorrected"),
                    "discarded": discarded.get("flagged", False),
                    "discardedAt": discarded.get("discardedAt") or "",
                    "audioDurationSeconds": audio.get("durationSeconds") or "",
                    "audioFileSizeBytes": audio.get("fileSizeBytes") or "",
                    "timeSpentMs": item.get("timeSpentMs") or 0,
                    "createdAt": item.get("createdAt") or "",
                    "updatedAt": item.get("updatedAt") or "",
                    "audioFile": audio_rel_path,
                })

            total_pages = data["pagination"]["totalPages"]
            print(f"  {project['name']}: page {page}/{total_pages} ({len(items)} rows)")
            if page >= total_pages:
                break
            page += 1

    csv_path = os.path.join(OUTPUT_DIR, "submissions.csv")
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nWrote {len(rows)} row(s) to {csv_path}")

    total = len(audio_jobs)
    print(f"\nDownloading {total} audio file(s), one at a time...")
    ok, skipped, failed = 0, 0, []
    for i, (submission_id, dest_path) in enumerate(audio_jobs, start=1):
        pct = round(i / total * 100) if total else 100
        label = f"  [{i}/{total}] ({pct}%) {os.path.basename(dest_path)} ... "
        if os.path.exists(dest_path):
            print(label + "skip (already downloaded)")
            skipped += 1
            continue
        print(label, end="", flush=True)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        try:
            if download_audio(session, submission_id, dest_path):
                print("OK")
                ok += 1
            else:
                print("no audio")
        except Exception as e:
            print(f"FAILED: {e}")
            failed.append((submission_id, dest_path, str(e)))

    print(f"\nDone. {ok} downloaded, {skipped} already had a copy, {len(failed)} failed (of {total}).")
    if failed:
        print("Failed:")
        for submission_id, dest_path, err in failed:
            print(f"  {submission_id} -> {dest_path}: {err}")


if __name__ == "__main__":
    main()