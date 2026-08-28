#!/usr/bin/env python3
"""Build the hermetic fixture in a stable in-repo location.

Layout (deliberate so that --data-dir selections isolate the phase):

  FIXTURE/
    sessions/synthetic01/synthetic01.json   (in BOTH before/ and after/)
    before/
      diagnostics/before.jsonl              (event pair A only)
      sessions/synthetic01/synthetic01.json
    after/
      diagnostics/after.jsonl               (event pair A + new pair B)
      sessions/synthetic01/synthetic01.json

The session file is duplicated across before/ and after/ so each
phase's data-root rglob finds exactly the events for that phase —
nothing more. (Putting both logs in the same directory would mean
both phases see both logs, and the delta would always be 0.)

Negative fixture:
    before/ and after/ are byte-identical (so finish sees no new
    events) → CAPTURE_INSUFFICIENT.
"""
import json, os, time, shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent  # tools/factory/hermetic-fixture -> tools/factory -> tools -> REPO
# ↑ but the tool lives in REPO/tools/factory, so we go up three levels
REPO = Path(__file__).resolve().parents[3]
FIXTURE = REPO / ".factory" / "evidence" / ".hermetic-fixture"

if FIXTURE.exists():
    shutil.rmtree(FIXTURE)

now = time.time()

session = {
    "session_id": "synthetic01",
    "sessionId": "synthetic01",
    "taskId": "synthetic01",
    "status": "running",
    "source": "vscode",
    "interactive": True,
    "mode": "act",
    "provider": "openrouter",
    "model": "anthropic/claude-sonnet-5",
    "started_at": "2026-08-28T00:00:00.000Z",
    "updated_at": "2026-08-28T00:01:00.000Z",
}
session_text = json.dumps(session, indent=2)

# Build before/ and after/ trees, each with the session file.
for sub in ("before", "after"):
    (FIXTURE / sub / "diagnostics").mkdir(parents=True)
    (FIXTURE / sub / "sessions" / "synthetic01").mkdir(parents=True)
    sp = FIXTURE / sub / "sessions" / "synthetic01" / "synthetic01.json"
    sp.write_text(session_text)
    os.utime(sp, (now, now))

# Log A (only event pair A) — used by begin phase AND by negative phase
log_a_lines = [
    {"ts": "2026-08-28T00:00:00.000Z", "marker": "approval.entry.v2",
     "toolName": "execute_command", "correlationId": "corr-A",
     "sessionId": "synthetic01", "autoApproveAll": True,
     "shouldAutoApproveTool": False},
    {"ts": "2026-08-28T00:00:00.500Z", "marker": "approval.terminal.v2",
     "toolName": "execute_command", "correlationId": "corr-A",
     "sessionId": "synthetic01", "verdict": "approve"},
]

# Log B (A + new pair B) — used by finish phase
log_b_lines = list(log_a_lines) + [
    {"ts": "2026-08-28T00:01:00.000Z", "marker": "approval.entry.v2",
     "toolName": "execute_command", "correlationId": "corr-B",
     "sessionId": "synthetic01", "autoApproveAll": True,
     "shouldAutoApproveTool": False},
    {"ts": "2026-08-28T00:01:00.500Z", "marker": "approval.terminal.v2",
     "toolName": "execute_command", "correlationId": "corr-B",
     "sessionId": "synthetic01", "verdict": "approve"},
]

before_log = FIXTURE / "before" / "diagnostics" / "before.jsonl"
before_log.write_text("\n".join(json.dumps(line) for line in log_a_lines) + "\n")
os.utime(before_log, (now, now))

after_log = FIXTURE / "after" / "diagnostics" / "after.jsonl"
after_log.write_text("\n".join(json.dumps(line) for line in log_b_lines) + "\n")
os.utime(after_log, (now, now))

# Negative fixture: begin scans FIXTURE/before/, finish also scans
# FIXTURE/before/ — byte-identical → no new event.
# We achieve this by reusing the before/ tree.

print(f"FIXTURE={FIXTURE}")
print(f"BEFORE_ROOT={FIXTURE / 'before'}")
print(f"AFTER_ROOT={FIXTURE / 'after'}")
print(f"BEFORE_LOG={before_log}")
print(f"AFTER_LOG={after_log}")
