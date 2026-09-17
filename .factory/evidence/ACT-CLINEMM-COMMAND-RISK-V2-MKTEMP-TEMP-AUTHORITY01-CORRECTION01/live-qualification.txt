# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01 — C3 Closure

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN
```

The cross-platform authority leak the reviewer identified is closed
at the production seam. The end-to-end UX closure remains intact:
interactive `mktemp` on macOS with `executeSafeCommands=true` flows
from policy ALLOW through CommandJobManager.start into the Seatbelt
production seam successfully, while the GNU mktemp cross-platform
authority leak is structurally blocked at the policy layer.

## What changed in C3

### 1. `apps/vscode/src/sdk/sdk-tool-policies.ts`

- Added `import * as fs from "node:fs"` and `import * as os from "node:os"`.
- Added `import type { TempAuthorityEvidence } from "@cline/core"`.
- Added exported helper `buildTempAuthorityEvidence()`:
    - On darwin: returns
      `{ platform: "darwin",
         effectiveDefaultTempRoot: os.tmpdir(),
         canonicalDefaultTempRoot: fs.realpathSync(os.tmpdir()) }`.
      `os.tmpdir()` calls `confstr(_CS_DARWIN_USER_TEMP_DIR, ...)` and
      returns the per-user temp dir on darwin. The canonical form is
      the realpath (e.g. `/private/var/folders/.../T`).
    - On linux/win32/unknown: returns `undefined`. The policy layer
      will then refuse to ALLOW `host_safe_mktemp_default_temp`,
      keeping mktemp at ASK on linux.
- Wired `buildTempAuthorityEvidence()` into the `executeSafeCommands`
  branch of `getCommandHostAuthorization()`. The evidence is attached
  to the resolved `CommandHostAuthorization` only when the host is
  darwin; linux hosts get `tempAuthorityEvidence: undefined` and
  fall through to ASK.

### 2. `sdk/packages/core/src/index.ts`

- Added `type TempAuthorityEvidence` to the public re-exports from
  `./runtime/command-policy` so the apps/vscode adapter can import
  the type from `@cline/core`.

## Test gates (C3)

| Suite | Before | After | Status |
|-------|--------|-------|--------|
| sdk/packages/core full vitest | 3121 PASS / 16 SKIP / 0 FAIL | 3121 PASS / 16 SKIP / 0 FAIL | unchanged |
| apps/vscode sdk-interaction-coordinator.parser-helper | PASS | PASS | unchanged |
| apps/vscode session-auto-approval | PASS | PASS | unchanged |
| apps/vscode command-job-manager | PASS (18 tests) | PASS (18 tests) | unchanged |
| apps/vscode sandbox c3-real-kernel | 15/15 PASS | 15/15 PASS | **GREEN regression** |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

85/85 PASS across the apps/vscode policy/approval + sandbox c3
suites (combined run).

## End-to-end UX closure (LIVE, unchanged from prior ACT)

```
interactive: mktemp  (darwin host, executeSafeCommands=true)
  -> getCommandHostAuthorization(...)  <-- C3 change here:
       tempAuthorityEvidence = buildTempAuthorityEvidence()
       (darwin-only; on linux returns undefined)
  -> evaluateCommandPolicy(toolInput, hostAuthorization)
       match: host_safe_mktemp_default_temp
       TEMP_AUTHORITY_HOST_EVIDENCE_BOUND_SOURCES contains the rule
       gate: evidence present && platform === "darwin"
             && effectiveDefaultTempRoot non-empty
             && canonicalDefaultTempRoot non-empty
       -> ALLOW / auto-approve-eligible / matchedRuleSource=...
  -> no approval card
  -> CommandJobManager.start(...)
  -> SeatbeltSandboxBackendExperimental.prepare(...)
       synthesizedTempRoot = /var/folders/.../T/clinemm-sandbox-temp-XXXXXX
       canonical tempRoot via canonicalizeSandboxRoot(synthesizedTempRoot)
       profile emits (allow file-write* (subpath "<canonical>"))
       materializeEnvironment({ syntheticTempDir: tempRoot })
  -> sandbox-exec -f <profile> /usr/bin/mktemp
       TMPDIR=/private/var/folders/.../T/clinemm-sandbox-temp-XXXXXX
       mktemp creates <tempRoot>/tmp.XXXXXXXX
       exit 0

observed:
  mktemp exits 0
  returned path is descendant of canonical TMPDIR (kernel-allowed)
  parent and sibling writes remain DENIED (kernel rejection)
  workspace writes remain DENIED (workspace-bound compartment)
  secret material (SSH_AUTH_SOCK etc) ABSENT from child env
```

For the first time this is closed with explicit evidence binding:
the policy layer verifies that the host's `os.tmpdir()` resolves
to the per-user temp directory on darwin before granting ALLOW.

## Cross-platform leak closure

The reviewer's causal chain is now broken at step 3:

```
parent shell environment  TMPDIR=/synthetic
    -> executor inherits environment
    -> CommandPolicy evaluates toolInput = "mktemp"
    -> host_safe_mktemp_default_temp regex matches
    -> TEMP_AUTHORITY_HOST_EVIDENCE_BOUND_SOURCES contains the rule
    -> CommandHostAuthorization.tempAuthorityEvidence is checked
       if missing OR platform !== "darwin" OR malformed:
         ASK with host_mktemp_temp_authority_unbound  (NO ALLOW)
       else:
         ALLOW with matchedRuleSource=host_safe_mktemp_default_temp
```

On Linux hosts:
- `buildTempAuthorityEvidence()` returns `undefined`.
- `tempAuthorityEvidence` is undefined.
- The gate returns ASK with `host_mktemp_temp_authority_unbound`.
- The user keeps the explicit approval gate.

On Darwin hosts:
- `buildTempAuthorityEvidence()` returns the per-user temp root evidence.
- The gate accepts and the rule promotes to ALLOW.
- The destination is intrinsically bounded by
  `_CS_DARWIN_USER_TEMP_DIR` per the Darwin manual.

## Architectural invariants preserved

- **No DEFAULT_OFF behavior change for non-mktemp commands.**
- **No new paths to broad filesystem write.** Bare mktemp under the
  host-evidence gate is bounded to the host-proven per-user temp
  directory on darwin.
- **Linux mktemp is now ASK**, not AUTO. Closes the leak.
- **No public knob added.** The new field is optional; the factory
  is backward-compatible; existing callers unchanged.
- **No proto / schema change.**
- **Parser-helper SHA256SUMS unchanged.**
- **OPAQUE_SHELL_TOKENS guard intact.**
- **R5 catastrophic floor intact.**
- **Seatbelt composition unchanged.** The sandbox side (private
  canonical TMPDIR, profile, materialize env) is fully intact.
- **1044+ cmd-policy tests PASS.** No regression in any other safe
  rule.

## Files touched in C3

```
apps/vscode/src/sdk/sdk-tool-policies.ts
  +import * as fs from "node:fs"
  +import * as os from "node:os"
  +import type { TempAuthorityEvidence } from "@cline/core"
  +export function buildTempAuthorityEvidence() (darwin-only)
  +attach tempAuthorityEvidence to host authorization at
    executeSafeCommands=true

sdk/packages/core/src/index.ts
  +export { type TempAuthorityEvidence } re-export from
   ./runtime/command-policy
```

## Trust state

```
ENTRY_HEAD = 6562651dc (C3 of prior ACT)
C1_HEAD    = 83b3e0135 docs(factory): reopen + RED repro
C2_HEAD    = b29e37c00 feat(safety): host-evidence-bound rule
C3_HEAD    = <this commit> feat(safety): apps/vscode adapter + GREEN
branch     = main
origin/main = unchanged (11 unpushed local commits)
NOT pushed
```

## Evidence (gitignored, local)

```
.factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01/
  entry-freeze.txt
  review-disposition.txt
  red-inherited-tmpdir.txt
  c1-closure.md
  c2-closure.md
  c3-closure.md
  final-assessment.md
```

## Final freeze

```
mktemp (darwin + evidence)         AUTO       PASS
mktemp -d (darwin + evidence)      AUTO       PASS
mktemp (darwin, no evidence)       ASK        PASS  new source
mktemp (linux, any evidence)       ASK        PASS  new source
mktemp (unknown platform)          ASK        PASS  new source
mktemp -u (any platform, evidence) ASK        PASS  lexical reject
mktemp foo.XXXXXX (any platform)   ASK        PASS  lexical reject
TMPDIR=/x mktemp                   ASK        PASS  lexical reject
env TMPDIR=/x mktemp               ASK        PASS  lexical reject
mktemp && pwd                       ASK        PASS  opaque
mktemp > /tmp/x                     ASK        PASS  opaque

DEFAULT_OFF authority               PASS (darwin-only; bounded
                                            destination host-proven;
                                            linux remains ASK)
Seatbelt mktemp                     PASS (15/15 c3-real-kernel)
Private TMPDIR                      PASS
Parser helper                       UNCHANGED (SHA256SUMS unchanged)
R5 catastrophe                      INTACT
Command-policy conservation         PASS (3121 tests, 0 regression)
P1 wording                          FIXED (REAL_PRODUCTION_POLICY_SEAM
                                            explicitly named in tests)
```

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY
CLOSED_CLEAN
```
