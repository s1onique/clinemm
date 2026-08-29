#!/usr/bin/env python3
"""ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01

Synthetic-live qualification.

This script mirrors the exact record shape that
`emitCaptureAttach()` produces in apps/vscode/src/sdk/v2-capture.ts,
but it does so from Python so we can prove the capture tool can
observe the marker without requiring a live VS Code extension
host.

The synthetic capture path points at the REAL ClineMM
~/.cline2 data root, so the session candidates and `clineVersion`
projection come from a real runtime. The `repoHead` projection
also comes from the live repo. The only synthetic piece is the
capture.attach.v1 record itself, which is content-identical to
what v2-capture.ts emits.

Expected results:

  - instrumentationAttachmentBound = True
  - attachmentProjection.runtimeInstanceId is a real-looking ULID
  - attachmentProjection.clineVersion matches the live
    ClineMM globalState.json (real)
  - attachmentProjection.repoHead matches the live repo HEAD (real)
  - runtimeIdentityProjection.clineVersion matches (real)
  - runtimeIdentityProjection.repoHead matches (real)
  - runtimeIdentityBound = True (session join OR attach path)
  - runtimeSourceDrift = False (begin and finish HEAD match)
"""
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = str(REPO / "tools" / "factory" / "capture-approval-specimen.py")
DATA_ROOT = Path.home() / ".cline2"
SYNTH_DIR = REPO / ".factory" / "evidence" / ".synthetic-live-capture"


def run(args):
    return subprocess.run(args, capture_output=True, text=True, cwd=str(REPO))


def parse_kv(stdout):
    out = {}
    for line in stdout.splitlines():
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip()
    return out


def assert_eq(actual, expected, msg):
    assert actual == expected, f"{msg}: expected {expected!r}, got {actual!r}"


# Read real identity
real_head = subprocess.run(
    ["git", "rev-parse", "HEAD"], cwd=str(REPO),
    capture_output=True, text=True,
).stdout.strip()
real_tree = subprocess.run(
    ["git", "rev-parse", "HEAD^{tree}"], cwd=str(REPO),
    capture_output=True, text=True,
).stdout.strip()
gs_path = DATA_ROOT / "data" / "globalState.json"
real_cline_version = "UNAVAILABLE"
if gs_path.is_file():
    try:
        obj = json.loads(gs_path.read_text(encoding="utf-8", errors="replace"))
        v = obj.get("clineVersion")
        if isinstance(v, str) and v.strip():
            real_cline_version = v.strip()
    except Exception:
        pass

print(f"  real repoHead       = {real_head}")
print(f"  real repoTree       = {real_tree}")
print(f"  real clineVersion   = {real_cline_version}")

# Build synthetic v2-capture output — two dirs so the
# begin/finish delta is non-empty (the attach event appears
# in the after-only dir).
SYNTH_BEFORE = SYNTH_DIR / "before"
SYNTH_AFTER = SYNTH_DIR / "after"
for d in (SYNTH_BEFORE, SYNTH_AFTER):
    if d.exists():
        shutil.rmtree(d)
    (d / "diagnostics").mkdir(parents=True)
    (d / "sessions" / "synthetic").mkdir(parents=True)
now = time.time()

synthetic_session = {
    "session_id": "synthetic-live-A",
    "status": "running",
    "source": "vscode",
    "interactive": True,
    "mode": "act",
    "provider": "openrouter",
    "model": "anthropic/claude-sonnet-5",
    "started_at": "2026-08-29T22:00:00.000Z",
    "updated_at": "2026-08-29T22:01:00.000Z",
}
# Session is shared (both dirs see the same session candidate).
for d in (SYNTH_BEFORE, SYNTH_AFTER):
    sp = d / "sessions" / "synthetic" / "synthetic.json"
    sp.write_text(json.dumps(synthetic_session, indent=2))
    os.utime(sp, (now, now))

# Mirror the real globalState.json so the runtime-identity
# projector can read clineVersion. The collector reads
# `<root>/data/globalState.json` — we copy the real one in.
for d in (SYNTH_BEFORE, SYNTH_AFTER):
    (d / "data").mkdir(parents=True, exist_ok=True)
    if gs_path.is_file():
        shutil.copy2(gs_path, d / "data" / "globalState.json")
        os.utime(d / "data" / "globalState.json", (now, now))

# Synthetic capture.attach.v1 record — content-identical to
# what apps/vscode/src/sdk/v2-capture.ts produces. Only present
# in the after-phase so it appears in the delta.
attach_record = {
    "ts": "2026-08-29T22:01:00.000Z",
    "codePoint": "capture.attach.v1",
    "scope": "process",
    "correlationId": "no-request",
    "commandDigest": "no-input",
    "data": {
        "runtimeInstanceId": secrets.token_hex(8),
        "clineVersion": real_cline_version,
        "repoHead": real_head,
        "emittedAt": "2026-08-29T22:01:00.000Z",
    },
}
# Empty log at begin, populated log at finish.
(SYNTH_BEFORE / "diagnostics" / "before.jsonl").write_text("")
log_path = SYNTH_AFTER / "diagnostics" / "after.jsonl"
log_path.write_text(json.dumps(attach_record) + "\n")
os.utime(log_path, (now, now))

# Run capture tool against the synthetic dirs
print("\n=== STEP 1: begin (synthetic-live) ===")
r = run([
    "python3", TOOL, "begin",
    "--act", "ACT-CLINEMM-SYNTHETIC-LIVE",
    "--data-dir", str(SYNTH_BEFORE),
    "--recent-minutes", "60",
])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)
kv = parse_kv(r.stdout)
cid = kv["CAPTURE_ID"]
resolved_dir = REPO / ".factory" / "evidence" / "ACT-CLINEMM-SYNTHETIC-LIVE" / "captures" / cid / "resolved"

print("=== STEP 2: finish (synthetic-live) ===")
r = run([
    "python3", TOOL, "finish",
    "--act", "ACT-CLINEMM-SYNTHETIC-LIVE",
    "--capture-id", cid,
    "--data-dir", str(SYNTH_AFTER),
    "--recent-minutes", "60",
])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)
kv = parse_kv(r.stdout)

print(f"  INSTRUMENTATION_ATTACHMENT_BOUND={kv.get('INSTRUMENTATION_ATTACHMENT_BOUND')}")
print(f"  ZERO_EVENT_CLASSIFICATION={kv.get('ZERO_EVENT_CLASSIFICATION')}")
print(f"  RUNTIME_IDENTITY_BOUND={kv.get('RUNTIME_IDENTITY_BOUND')}")
print(f"  RUNTIME_SOURCE_DRIFT={kv.get('RUNTIME_SOURCE_DRIFT')}")

binding = json.loads((resolved_dir / "binding.json").read_text())
ap = binding["attachmentProjection"]
ri = binding["runtimeIdentityProjection"]
print(f"  attachment.clineVersion      = {ap['clineVersion']}")
print(f"  attachment.repoHead          = {ap['repoHead']}")
print(f"  attachment.runtimeInstanceId = {ap['runtimeInstanceId'][:12]}...")
print(f"  runtimeIdentity.clineVersion = {ri['clineVersion']}")
print(f"  runtimeIdentity.repoHead     = {ri['repoHead']}")

# Synthetic-live contract
assert_eq(kv["INSTRUMENTATION_ATTACHMENT_BOUND"], "YES",
          "synthetic-live: attachment must be bound")
assert_eq(kv["ZERO_EVENT_CLASSIFICATION"], "Z1_CONFIRMED_NO_APPROVAL_PATH_EXECUTED",
          "synthetic-live: Z1 (attachment + no approval events)")
assert_eq(kv["RUNTIME_IDENTITY_BOUND"], "YES",
          "synthetic-live: runtime identity bound via attach path")
assert_eq(kv["RUNTIME_SOURCE_DRIFT"], "NO",
          "synthetic-live: no source drift")
assert ap["clineVersion"] == real_cline_version, \
    f"synthetic-live: attach.clineVersion must equal real ({real_cline_version!r}); got {ap['clineVersion']!r}"
assert ap["repoHead"] == real_head, \
    f"synthetic-live: attach.repoHead must equal real ({real_head!r}); got {ap['repoHead']!r}"
assert ri["clineVersion"] == real_cline_version, \
    "synthetic-live: runtimeIdentity.clineVersion must equal real"
assert ri["repoHead"] == real_head, \
    "synthetic-live: runtimeIdentity.repoHead must equal real"

print("\nsynthetic-live-qualify.py: PASS")

# Move the synthetic-live evidence into the ACT folder
dest_dir = REPO / ".factory" / "evidence" / "ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01" / "synthetic-live"
if dest_dir.exists():
    shutil.rmtree(dest_dir)
shutil.copytree(REPO / ".factory" / "evidence" / "ACT-CLINEMM-SYNTHETIC-LIVE", dest_dir)
print(f"\nMoved synthetic-live evidence to {dest_dir}")
