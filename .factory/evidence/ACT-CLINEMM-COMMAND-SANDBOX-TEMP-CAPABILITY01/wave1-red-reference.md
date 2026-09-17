# ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01 — wave-1 RED reference

## Dogfood RED (frozen, REAL_PRODUCTION_SEAM)

From the Wave-1 dogfood run (commit cf0896d4c):

```text
T01: command=mktemp
     state=exited
     exitCode=1
     stderrClass=kernel-eperm
     classification=COMPATIBILITY_FAIL

T02: command=mktemp -d
     state=exited
     exitCode=1
     stderrClass=kernel-eperm
     classification=COMPATIBILITY_FAIL

E04: command=printf 'TMPDIR=[%s]\n' "$TMPDIR"
     state=exited  exitCode=0
     classification=PASS  (because expected=informational)
     stdout=""          <-- TMPDIR is unset in child
```

Evidence file: apps/vscode/.factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/probe-results.jsonl
Manifest SHA:    7d85bc0d850ff7559f00c278b3577bc59e3c40ca5ffa15c78efc43c155e39ad6
Subject commit:  4cef3d59c5e4d9ea4901a4d3efb5f0e4a3c029db

## Focused RED (reproduced against current production seam)

Same mktemp EPERM reproduced against the production
CommandJobManager path (not the dogfood harness's fake):

```text
RED mktemp currently kernel-EPERMs under the production resolver (T01 reproduction)
  state=exited, exitCode=1, stderr matches "Operation not permitted"

RED mktemp -d currently kernel-EPERMs under the production resolver (T02 reproduction)
  state=exited, exitCode=1, stderr matches "Operation not permitted"

RED child TMPDIR is empty under the production resolver today (E04 reproduction)
  state=exited, stdout contains "TMPDIR=[]"
```

Tests live in: apps/vscode/src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts
Added by: ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01 (commit, this ACT)

## Profile captured today

The current production Seatbelt profile (no tempRoot) is:

```
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow file-read*)
(allow file-write*
  (literal "/dev/null")
  (literal "/dev/tty"))
(allow file-read-metadata (subpath "/"))
(deny network*)
```

Only `/dev/null` and `/dev/tty` are writable. No `(subpath "...")` write grants.
No `TMPDIR` is exported to the child (syntheticTempDir is undefined).

## Why mktemp fails

macOS `/usr/bin/mktemp` consults `$TMPDIR` first. With no `TMPDIR` set,
it falls back to its compiled-in default `/tmp` (==`/private/tmp`).
The Seatbelt profile has no `(subpath "/private/tmp")` grant, so the
kernel returns EPERM on the open(O_CREAT) syscall.

## Root cause

`sdk/packages/core/src/runtime/sandbox/types.ts:113` documents that
the backend synthesizes a per-invocation tempRoot when omitted, but
`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:191`
only handles the explicit-caller-supplied case. The production
builder `apps/vscode/src/sdk/sandbox-policy.ts:142` (the
`buildExperimentalReconCapability`) never supplies tempRoot, so the
synthesis never fires. The seam is wired; the wiring is un-energized.
