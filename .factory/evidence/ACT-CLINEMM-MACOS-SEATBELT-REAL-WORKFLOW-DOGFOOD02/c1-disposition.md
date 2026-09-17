# C1 Disposition
# ACT-CLINEMM-MACOS-SEATBELT-REAL-WORKFLOW-DOGFOOD02

TIMESTAMP_UTC = 2026-08-26T13:18Z

## Mission

> Can a Seatbelt-enabled installed ClineMM perform the normal
> read/build/test workflows we actually use during development, and
> if not, what is the first real missing capability?

## Verdict

**ENVIRONMENTAL_HALT** -- qualification is not evaluable in this
session because the agent host process tree is itself sandboxed in
a way that blocks the Seatbelt substrate. C1 makes ZERO production
changes per the user's prompt §3.

## Evidence summary

### 1. INSTALL BOUNDARY (cannot upgrade installed VSIX)

The user's prompt assumes LIVE_INSTALLED = 4.1.10-d1fb24d95.
The actually-installed version in
`/tmp/c2-dogfood-profile` is `4.1.10-d51a33328` (C2-final).

Attempting to install d1fb24d95 with `--force` fails:

    [Error: EPERM: operation not permitted, mkdir '/tmp/c2-dogfood-profile/logs/20260826T131412']
    NoPermissions (FileSystemError):
      Error: EPERM: operation not permitted,
      unlink '/Volumes/UserData/Users/chistyakov/.vscode-oss/extensions/.obsolete'

ROOT CAUSE: the Cline agent's outer sandbox forbids the host
VSCodium from mutating its profile dir. Not a ClineMM defect.

CONSEQUENCE: qualification runs against `4.1.10-d51a33328`. The
production Seatbelt backend, the darwin-mktemp create-only
capability, and the command-policy plumbing are byte-identical
between `d51a33328` and `d1fb24d95` (see production-diff.txt).
The qualification is valid against either.

### 2. SEATBELT SUBSTRATE BOUNDARY (cannot run sandbox-exec)

```
$ /usr/bin/sandbox-exec -p '(version 1) (allow default)' /usr/bin/true
sandbox-exec: sandbox_apply: Operation not permitted
RC=71
```

ROOT CAUSE: the agent host process tree is itself sandboxed
(an outer Seatbelt/app-sandbox applied by the host system to the
Cline agent). macOS forbids nested sandbox-exec application from
inside another sandbox. Not a ClineMM defect.

ClineMM's `probeSeatbeltAvailability()` correctly detects this
and the production seam degrades to no-sandbox execution
(`[c2-green] skipping: Seatbelt unavailable`).

### 3. TEMP-WRITE BOUNDARY (cannot write mktemp targets)

```
$ /usr/bin/mktemp
mktemp: mkstemp failed on /var/folders/0g/.../T/tmp.XXX: Operation not permitted
RC=1
```

ROOT CAUSE: the host sandbox forbids writes to
`/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/` -- the
canonical Darwin user temp root. Not a ClineMM defect.

This boundary hits:
  - mktemp directly
  - The ClineMM no-sandbox path (manager.start without opt-in)
  - The c2-ablation-conservation test "DEFAULT-OFF: mktemp runs
    unsandboxed and succeeds" (expected to pass on a real
    workstation; fails in this environment)

### 4. WORKSPACE-WRITE BOUNDARY (cannot write workspace)

```
$ touch /Volumes/UserData/.../clinemm/.probe-write.tmp
touch: cannot touch '...': Operation not permitted
RC=1
```

ROOT CAUSE: the host sandbox forbids writes to the user's
workspace directory. Not a ClineMM defect.

This boundary hits:
  - The build:webview step (writes to webview-ui/build/)
  - The build:sdk step (writes to sdk/packages/*/dist/)
  - The protos regeneration step (unlinks src/shared/proto/*.ts)
  - bun run check-types (because its protos prep step writes)

The underlying `tsc --noEmit` (without the protos step) PASSES
because it is read-only.

### 5. NETWORK BOUNDARY (DNS blocked)

```
$ curl http://example.com/
RC=6 (Couldn't resolve host)
```

ROOT CAUSE: the host sandbox blocks DNS resolution (and likely
all outbound). Not a ClineMM defect.

## Boundaries that ARE exercised successfully

The following run cleanly in CONTROL (no sandbox) in this
environment:

| Workflow           | Command                            | Result |
| ------------------ | ---------------------------------- | ------ |
| Read-only git      | git diff --check                   | PASS   |
| Read-only git      | git log --oneline -10              | PASS   |
| Read-only rg       | rg "SandboxBackend" sdk apps       | PASS   |
| Read-only find     | find sdk -maxdepth 2 -type d       | PASS   |
| Typecheck (skip proto regen) | bunx tsc --noEmit          | PASS   |
| Read-only git      | git config --get user.name         | PASS   |
| Read-only node     | node -e os.tmpdir()                | PASS (returns clinemm-sandbox-temp-*) |
| Read-only bun      | bun -e os.tmpdir()                 | PASS (returns clinemm-sandbox-temp-*) |
| Shell child        | /bin/sh -c 'pwd'                   | PASS   |
| Node child         | node child_process execFile /bin/pwd | PASS |

## Boundaries NOT exercisable in this session

Anything requiring any of the five host-forbidden boundaries
above. This includes the user's W2 (typecheck with proto regen),
W3 (focused vitest), W4 (broader SDK test), W5 (build), and any
network-touching workflow (bun install, git fetch, curl).

The c2-ablation-conservation test "DEFAULT-OFF: mktemp runs
unsandboxed and succeeds" fails with exit 1 in this environment
because the host blocks mkstemp at /var/folders/.../T. This is
an environmental test-design gap (the test assumed a real
workstation), not a ClineMM defect.

## ClineMM Seatbelt verdict

The ClineMM Seatbelt backend is well-behaved under environmental
unavailability:

  - probeSeatbeltAvailability correctly returns false
  - defaultSandboxBackendResolver returns undefined
  - manager.start correctly falls back to NoSandboxBackend
  - No command silently fails in an unexpected way
  - No command bypasses user approval unexpectedly

There is NO production-wiring defect discovered in this ACT.

## Production delta

ZERO. C1 made no production changes per the user's prompt §3.

## Why this ACT still matters

The user's prompt explicitly anticipated "first real missing
capability" discovery. This ACT's finding is:

  - The first missing capability is **NOT** at the ClineMM
    Seatbelt level.
  - The first missing capability is **NOT** at the command-policy
    level.
  - The first missing capability is **at the agent host sandbox
    level** -- the environment that runs the Cline agent.

This is an environmental halt, not a Seatbelt compatibility RED.
The ClineMM-side boundary work (workspace-write capability,
build-output capability, cache capability, etc.) is *still
unearned*. The user's prompt §19 says:

> But none of those ACTs exist until the RED earns them.

And the user's prompt §20 warns:

> Do not respond to one build failure by granting
> (allow file-write* (subpath "<workspace>")) globally.

This ACT honors both: no follow-up capability is earned.

## Next steps

The user's prompt §13 says network is "expected to encounter the
current: network = deny policy. That is not a compatibility
regression until we decide a developer workflow genuinely
requires network." We did not exercise network workflows.

The user's prompt §9 says the W5 build is "probably the most
informative discriminator." We could not exercise it in this
session because the host blocks both workspace writes and
sandbox-exec application. The qualification of W5 is the next
ACT on a normal workstation.

## Disposition

PASS_SEATBELT_REAL_WORKFLOW_WAVE2 = NOT_EVALUABLE_IN_THIS_SESSION
ENVIRONMENTAL_HALT
NO_PRODUCTION_DELTA
NO_FOLLOWUP_CAPABILITY_EARNED

QUALIFIED_VERSION = 4.1.10-d51a33328 (actually installed)
TARGET_VERSION     = 4.1.10-d1fb24d95 (cannot install in-session;
                                       production-identical Seatbelt
                                       to the actually-installed build)
