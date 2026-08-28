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


def write_session(root: Path, session: dict, name: str) -> Path:
    (root / "sessions" / name).mkdir(parents=True, exist_ok=True)
    sp = root / "sessions" / name / f"{name}.json"
    sp.write_text(json.dumps(session, indent=2))
    os.utime(sp, (now, now))
    return sp


def write_log(root: Path, name: str, lines: list[dict]) -> Path:
    (root / "diagnostics").mkdir(parents=True, exist_ok=True)
    p = root / "diagnostics" / f"{name}.jsonl"
    p.write_text("\n".join(json.dumps(line) for line in lines) + "\n")
    os.utime(p, (now, now))
    return p


# -----------------------------------------------------------------------------
# Happy fixture (tightened): session uses ONLY `session_id` (no `sessionId`
# or `taskId`), and events carry `session_id`. This forces the join to
# actually exercise the snake_case projection path; it cannot accidentally
# match through an `sessionId` alias the fixture never sets.
# -----------------------------------------------------------------------------
happy_session = {
    "session_id": "snake-only-A",  # ONLY snake_case identity; no aliases
    "status": "running",
    "source": "vscode",
    "interactive": True,
    "mode": "act",
    "provider": "openrouter",
    "model": "anthropic/claude-sonnet-5",
    "started_at": "2026-08-28T00:00:00.000Z",
    "updated_at": "2026-08-28T00:01:00.000Z",
}

happy_log_a = [
    {"ts": "2026-08-28T00:00:00.000Z", "marker": "approval.entry.v2",
     "toolName": "execute_command", "correlationId": "corr-A",
     "session_id": "snake-only-A", "autoApproveAll": True,
     "shouldAutoApproveTool": False},
    {"ts": "2026-08-28T00:00:00.500Z", "marker": "approval.terminal.v2",
     "toolName": "execute_command", "correlationId": "corr-A",
     "session_id": "snake-only-A", "verdict": "approve"},
]
happy_log_b = list(happy_log_a) + [
    {"ts": "2026-08-28T00:01:00.000Z", "marker": "approval.entry.v2",
     "toolName": "execute_command", "correlationId": "corr-B",
     "session_id": "snake-only-A", "autoApproveAll": True,
     "shouldAutoApproveTool": False},
    {"ts": "2026-08-28T00:01:00.500Z", "marker": "approval.terminal.v2",
     "toolName": "execute_command", "correlationId": "corr-B",
     "session_id": "snake-only-A", "verdict": "approve"},
]

for sub in ("before", "after"):
    write_session(FIXTURE / sub, happy_session, "snake-only-A")
write_log(FIXTURE / "before", "before", happy_log_a)
write_log(FIXTURE / "after",  "after",  happy_log_b)

# -----------------------------------------------------------------------------
# Mismatch negative fixture (P0 closure): captured session is session-A,
# but the new event's `sessionId` is session-B. Counts alone would let the
# old predicate say PASS — the identity join must refuse.
# -----------------------------------------------------------------------------
mismatch_session = {
    "session_id": "session-A",
    "status": "running",
    "source": "vscode",
    "mode": "act",
}
mismatch_log_a = [
    {"ts": "2026-08-28T00:00:00.000Z", "marker": "approval.entry.v2",
     "toolName": "execute_command", "correlationId": "corr-A",
     "session_id": "session-A"},
]
mismatch_log_b = list(mismatch_log_a) + [
    # The new pair intentionally references session-B, not session-A.
    {"ts": "2026-08-28T00:01:00.000Z", "marker": "approval.entry.v2",
     "toolName": "execute_command", "correlationId": "corr-B",
     "session_id": "session-B"},
    {"ts": "2026-08-28T00:01:00.500Z", "marker": "approval.terminal.v2",
     "toolName": "execute_command", "correlationId": "corr-B",
     "session_id": "session-B", "verdict": "approve"},
]

for sub in ("before-mismatch", "after-mismatch"):
    write_session(FIXTURE / sub, mismatch_session, "session-A")
write_log(FIXTURE / "before-mismatch", "before", mismatch_log_a)
write_log(FIXTURE / "after-mismatch",  "after",  mismatch_log_b)

# -----------------------------------------------------------------------------
# Ambiguity negative fixture (P0 transaction-uniqueness closure):
# captured session=A. After the begin phase we add TWO complete
# approval transactions (corr-B and corr-C), each with entry+terminal,
# both session_id=session-A. Both join the captured session identity
# set, so runtimeIdentityBound is True — but two concurrent qualifying
# transactions means the human action cannot be uniquely attributed
# to a single transaction, so approvalTransactionBound stays False.
# -----------------------------------------------------------------------------
ambig_session = {
    "session_id": "session-A",
    "status": "running",
    "source": "vscode",
    "mode": "act",
}
ambig_log_a: list[dict] = []
ambig_log_b = ambig_log_a + [
    # Transaction 1 (corr-B): complete entry→terminal, session=A.
    {"ts": "2026-08-28T00:01:00.000Z", "marker": "approval.entry.v2",
     "toolName": "execute_command", "correlationId": "corr-B",
     "session_id": "session-A", "autoApproveAll": True,
     "shouldAutoApproveTool": False},
    {"ts": "2026-08-28T00:01:00.500Z", "marker": "approval.terminal.v2",
     "toolName": "execute_command", "correlationId": "corr-B",
     "session_id": "session-A", "verdict": "approve"},
    # Transaction 2 (corr-C): complete entry→terminal, session=A.
    {"ts": "2026-08-28T00:02:00.000Z", "marker": "approval.entry.v2",
     "toolName": "execute_command", "correlationId": "corr-C",
     "session_id": "session-A", "autoApproveAll": True,
     "shouldAutoApproveTool": False},
    {"ts": "2026-08-28T00:02:00.500Z", "marker": "approval.terminal.v2",
     "toolName": "execute_command", "correlationId": "corr-C",
     "session_id": "session-A", "verdict": "approve"},
]

for sub in ("before-ambiguity", "after-ambiguity"):
    write_session(FIXTURE / sub, ambig_session, "session-A")
write_log(FIXTURE / "before-ambiguity", "before", ambig_log_a)
write_log(FIXTURE / "after-ambiguity",  "after",  ambig_log_b)

# -----------------------------------------------------------------------------
# Cross-session split negative fixture (P0 cross-session transaction
# incoherence closure — fifth cycle).
# TWO captured sessions (A and B). After the begin phase a single
# transaction corr-X is observed with entry on session=A and terminal
# on session=B. Both sessions are captured (axis 1 holds) but the
# transaction itself is incoherent: a single approval cannot truthfully
# span two runtimes. The classifier must reject this as
# qualifyingTransactionCount=0, demoting axis 2 only.
# -----------------------------------------------------------------------------
split_session_a = {
    "session_id": "session-A",
    "status": "running",
    "source": "vscode",
    "mode": "act",
}
split_session_b = {
    "session_id": "session-B",
    "status": "running",
    "source": "vscode",
    "mode": "act",
}
split_log_a: list[dict] = []
split_log_b = split_log_a + [
    {"ts": "2026-08-28T00:01:00.000Z", "marker": "approval.entry.v2",
     "toolName": "execute_command", "correlationId": "corr-X",
     "session_id": "session-A", "autoApproveAll": True,
     "shouldAutoApproveTool": False},
    {"ts": "2026-08-28T00:01:00.500Z", "marker": "approval.terminal.v2",
     "toolName": "execute_command", "correlationId": "corr-X",
     "session_id": "session-B", "verdict": "approve"},
]

for sub in ("before-split", "after-split"):
    (FIXTURE / sub).mkdir(parents=True, exist_ok=True)
write_session(FIXTURE / "before-split", split_session_a, "session-A")
write_session(FIXTURE / "before-split", split_session_b, "session-B")
write_session(FIXTURE / "after-split",  split_session_a, "session-A")
write_session(FIXTURE / "after-split",  split_session_b, "session-B")
write_log(FIXTURE / "before-split", "before", split_log_a)
write_log(FIXTURE / "after-split",  "after",  split_log_b)

# -----------------------------------------------------------------------------
# Conservation negative: begin scans FIXTURE/before/, finish also scans
# FIXTURE/before/ — byte-identical → no new event. This proves the
# artifact-vs-binding separation is still honoured.
# -----------------------------------------------------------------------------
# Already covered by reusing FIXTURE/before/ in verify-negative.py.

print(f"FIXTURE={FIXTURE}")
print(f"HAPPY     BEFORE_ROOT={FIXTURE / 'before'}")
print(f"HAPPY     AFTER_ROOT ={FIXTURE / 'after'}")
print(f"MISMATCH  BEFORE_ROOT={FIXTURE / 'before-mismatch'}")
print(f"MISMATCH  AFTER_ROOT ={FIXTURE / 'after-mismatch'}")
print(f"AMBIGUITY BEFORE_ROOT={FIXTURE / 'before-ambiguity'}")
print(f"AMBIGUITY AFTER_ROOT ={FIXTURE / 'after-ambiguity'}")
print(f"SPLIT     BEFORE_ROOT={FIXTURE / 'before-split'}")
print(f"SPLIT     AFTER_ROOT ={FIXTURE / 'after-split'}")
