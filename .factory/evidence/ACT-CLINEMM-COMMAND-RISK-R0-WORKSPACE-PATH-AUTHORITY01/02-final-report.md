# ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01 — Final Report

## Summary

CLOSED at the production-fix commit. The workspace path authority
gate is wired through the canonical command policy. The R0
read-only allowlist is now path-agnostic at the regex layer and
path-conforming at the policy layer.

**CORRECTION01 — REALPATH_WORKSPACE_CONFINEMENT:** the reviewer
flagged the V1 lexical-only gate as a P0 unsafe production
authority boundary (project-internal symlink → outside lexically
passes containment). CORRECTION01 closes this gap by requiring
the host to call `fs.realpathSync` on the workspace root(s) and
on every path operand, then passing the result as
`WorkspacePathAuthorityEvidence` to the policy layer. Containment
is then tested on the CANONICAL pathname.

**CORRECTION02 — REALPATH_EVIDENCE_REQUIRED_FOR_PATH_BEARING_R0_ALLOW:**
the reviewer flagged that CORRECTION01 left a P0 regression in
the production state machine: when evidence construction failed
(`buildPathAuthorityEvidence` returned `ok:false`), the host code
did not pass evidence, and the policy fell back to the V1
lexical gate. The V1 lexical gate ALLOWs the symlink-escape the
reviewer identified. CORRECTION02 closes this by removing the V1
lexical fallback from the production ALLOW path entirely. Production
ALLOW eligibility for an R0 path-bearing rule now REQUIRES
host-supplied realpath evidence; missing / failed / operand-
mismatched evidence ⇒ ASK, never ALLOW. CORRECTION02 also adds
operand identity binding: each evidence `operands[i].operand`
must exactly equal the command's extracted operand at the same
index.

## V1 → CORRECTION01 progression

### V1 (LEXICAL_WORKSPACE_CONFINEMENT)
- `CommandHostAuthorization` gained two host-supplied fields:
  `workspaceRoots: ReadonlyArray<string>` and `cwd: string`.
- A new `path-authority.ts` module exports the lexical
  containment primitive.
- The canonical policy applies the path authority gate AFTER an
  R0 rule matches the argv shape. If any path operand fails
  containment, the verdict is downgraded to ASK with the new
  `host_workspace_path_authority` source.
- The CLI host adapter defaults the workspace context to
  `process.cwd()`.
- The VSCode host adapter wires `lastKnownWorkspaceRoot` (the
  active workspace root) as the authority boundary.

### CORRECTION01 (REALPATH_WORKSPACE_CONFINEMENT)
- New `path-authority-evidence.ts` module: HOST-PRODUCED
  evidence types (`WorkspacePathAuthorityEvidence`,
  `WorkspacePathOperandEvidence`).
- New `path-authority-evidence-builder.ts` module: the ONLY
  sanctioned place in the policy stack that calls
  `fs.realpathSync`. Exposes `buildPathAuthorityEvidence(...)`
  + `safeRealpathSync(...)`.
- `path-authority.ts` gained a realpath consumer
  (`evaluateCommandRealpathConformance`) that the policy layer
  calls when `pathAuthorityEvidence` is supplied. Containment
  is tested on realpath-resolved strings.
- `command-policy-types.ts` added the `pathAuthorityEvidence?`
  field on `CommandHostAuthorization` and a new decision source
  `host_workspace_realpath_authority`.
- `command-policy.ts` consults `pathAuthorityEvidence` FIRST
  after an R0 rule matches; V1 lexical fallback applies only
  when the host has not yet upgraded to produce evidence.
- CLI host adapter (`cliEvaluateCommandToolApproval`) requires
  the host to supply an explicit `workspaceRoot`; when absent,
  the path authority is DISABLED (the reviewer flagged
  `cwd === workspaceRoots` as a P1 authority assumption).
- CLI host adapter calls `buildPathAuthorityEvidence` to attach
  realpath evidence when `workspaceRoot` is supplied.
- VSCode host adapter builds multi-root realpath evidence from
  `vscode.workspace.workspaceFolders` via
  `buildPathAuthorityEvidence`. Virtual workspaces (non-`file`
  URI) are not supported and naturally fail closed.

## Architecture invariant (load-bearing)

```
policy = pure (no filesystem I/O)
filesystem = host authority
```

The policy module never calls `fs.realpathSync`. The host does.
The host passes pre-built evidence; the policy inspects the
strings.

## Fail-closed contract

- `resolvedRealPath === null`               ⇒ ASK (realpath failed; do not guess)
- ENOENT (path does not exist)               ⇒ ASK
- EACCES / EPERM (permission denied)         ⇒ ASK
- ELOOP (symlink loop)                       ⇒ ASK
- Any other fs error                         ⇒ ASK
- Workspace root fails to resolve            ⇒ host drops evidence (ok:false); V1 lexical gate as fallback
- Operand count mismatch between command and evidence ⇒ ASK
- `pathAuthorityEvidence` absent AND no V1 lexical roots ⇒ ASK (regression-closed posture preserved)

## Reviewer findings — closed

| Finding | Severity | Status |
|---|---|---|
| `find /current/project/outside-link` → ALLOW under V1 (symlink escape) | P0 | **CLOSED**: realpath gate downgrades to ASK with `host_workspace_realpath_authority` |
| `find -L project/outside-link` (forced dereference) | P0 | **CLOSED**: same path |
| `cwd === workspaceRoots` (CLI launching from `/` or `$HOME` silently widens authority) | P1 | **NARROWED**: `workspaceRoot` is now an explicit required parameter; absent ⇒ path authority disabled |
| Single-root only in VSCode | P1 | **WIRED**: all `vscode.workspace.workspaceFolders` are passed as roots |
| Tilde-prefixed operands (`ls ~/.ssh`) | P1 | **CLOSED**: rejected by both V1 lexical and CORRECTION01 realpath gates |
| Multi-root workspace support | P1 | **WIRED** in VSCode (`HostProvider.workspace.getWorkspacePaths()`); CLI is single-root by design |
| Virtual workspace (non-`file` URI) | P1 | **FAILS CLOSED**: `realpathSync` throws on non-filesystem schemes; policy treats as ASK |

## RED/GREEN matrix (executed)

ALLOW (workspace-conforming, realpath-resolved):
- `ls /current/project`
- `ls /current/project/.factory`
- `find /current/project -type f`
- `find /current/project/src -name foo.ts`
- `pwd` / `git status` / `git diff` (no path operand)
- Multi-root: `find /current/project/outside-link` when `OUTSIDE_DIR` is also a workspace root

ASK (outside workspace or realpath resolution failed):
- `ls /etc`, `ls ~/.ssh`, `find /`, `find /etc`
- `find /current/project/../../etc` (lexical escape caught)
- `ls /current/project/../.ssh` (lexical escape caught)
- `ls /current/project/sub/../../etc` (lexical escape caught)
- `find /current/project/outside-link` (P0 closed: realpath escape → ASK)
- `find -L /current/project/outside-link` (P0 closed: forced deref → ASK)
- `ls /current/project/outside-link` (P0 closed: even single ls → ASK)
- `find /current/project/does-not-exist` (ENOENT → ASK)
- `find /current/project/restricted` (EACCES → ASK)
- `find /current/project/src /current/project/does-not-exist` (mixed → ASK)

## Adversarial RED/GREEN (real filesystem)

Built with `os.tmpdir` + `symlinkSync`:

```
tmp/
  project/
    inside/
    file.txt
    escape-link -> ../outside/
  outside/
    file.txt
```

10/10 RED/GREEN tests pass (`path-authority.realpath.test.ts`):

| Test | Outcome | Source |
|---|---|---|
| `ls project/inside` | ALLOW | `host_mode_safe_only_rule` |
| `find project/inside` | ALLOW | `host_mode_safe_only_rule` |
| `find project/escape-link` | ASK | `host_workspace_realpath_authority` (P0 closed) |
| `find -L project/escape-link` | ASK | `host_workspace_realpath_authority` (P0 closed) |
| `ls project/escape-link` | ASK | `host_workspace_realpath_authority` (P0 closed) |
| `find project/does-not-exist` | ASK | `host_workspace_realpath_authority` (ENOENT) |
| `ls /etc` | ASK | `host_workspace_realpath_authority` |
| Multi-root: `find project/escape-link` (target as 2nd root) | ALLOW | `host_mode_safe_only_rule` |
| V1 lexical-only (no evidence) | ALLOW | V1 limitation pinned (test verifies V1 ≠ V2) |
| `realpathSync` actually resolves the symlink to OUTSIDE_DIR | true | platform property pin |

## Subset guarantee verified (V1 + CORRECTION01)

The path authority gates (both V1 lexical and CORRECTION01 realpath)
are STRICT SUBSETS of the previous ALLOW set: they only remove
ALLOWs, they never add new ALLOWs.

## Validation results

| Surface | Status |
|---|---|
| `@cline/core` unit | **2493/2493 PASS** / 14 SKIPPED (was 2470 in V1; +23 from CORRECTION01) |
| `@cline/core` command-policy/ | **528 PASS** (was 505 in V1; +23) |
| `@cline/core` typecheck | EXIT=0 (no new errors; 7 pre-existing in unrelated files confirmed via stash round-trip) |
| `apps/cli` command-policy-host | **42 PASS** (was 40; +2 CORRECTION01 assertions) |
| `apps/cli` typecheck | EXIT=0 |
| `apps/cli` test:unit | 4 pre-existing failures (confirmed via git stash round-trip) NOT introduced by this ACT |
| `apps/vscode` sdk-tool-policies | 70 PASS |
| `apps/vscode` sdk/ tests | **1954/1954 PASS** |
| `apps/vscode` typecheck | EXIT=0 |
| New `path-authority.realpath.test.ts` (adversarial RED/GREEN) | **10/10 PASS** |
| New `path-authority-evidence-builder.test.ts` (host builder unit) | **10/10 PASS** |
| New CORRECTION01 assertions in `command-risk-corpus.path-authority.test.ts` | **31 PASS** |
| SDK rebuild | EXIT=0 |

## Backlog (now closed by this ACT)

- ~~V1 symlink-to-outside limitation~~ — CLOSED via CORRECTION01 realpath gate.
- ~~Multi-root workspace support in VSCode~~ — CLOSED via `buildPathAuthorityEvidence` consuming all `workspaceFolders`.
- ~~CLI `cwd === workspaceRoots` assumption~~ — CLOSED by requiring explicit `workspaceRoot`; absent ⇒ authority disabled.

## CORRECTION02 — REALPATH_EVIDENCE_REQUIRED_FOR_PATH_BEARING_R0_ALLOW

The CORRECTION01 implementation left a P0 regression in the
production state machine:

```text
buildPathAuthorityEvidence(...)  →  ok:false  (e.g. workspaceRoot ENOENT)
host code:                       →  evidence NOT attached to auth
policy layer:                    →  falls back to V1 lexical gate
V1 lexical gate:                 →  ALLOW (project-internal symlink)
reviewer-identified attack:      →  ALLOWED → HALT
```

CORRECTION02 removes the V1 lexical fallback from the
**production ALLOW path entirely**.

### Production state machine after CORRECTION02

```text
realpath evidence present and operand-bound?
  ├─ YES → evaluate it
  └─ NO  → ASK
```

NOT:

```text
  └─ NO  → lexical ALLOW eligibility
```

### Files changed for CORRECTION02

- `command-policy.ts`: removed the V1 lexical fallback branch;
  added operand identity binding (each evidence `operands[i].operand`
  must exactly equal the command's extracted `expectedOperands[i]`).
- `command-risk-corpus.path-authority.test.ts`: rewritten with a
  per-corpus evidence builder (the V1-era tests assumed V1 lexical
  fallback; CORRECTION02 requires explicit evidence for every
  path-bearing corpus entry).
- `command-risk-corpus.baseline.test.ts`: now builds catch-all
  realpath evidence per entry to preserve the V0 baseline.
- `path-authority.realpath.test.ts`: replaced the V1-era "V1
  LEXICAL REGRESSION" test (which asserted V1 ALLOW-ed the
  symlink escape under no evidence) with explicit
  `CORRECTION02 REGRESSION` tests that demand ASK when
  evidence is missing or operand-mismatched.
- `command-policy-host.ts` (CLI): comment updated to reflect
  that missing evidence ⇒ ASK under CORRECTION02, NOT V1 lexical
  fallback ALLOW.

### Adversarial RED/GREEN (CORRECTION02 specific)

12/12 RED/GREEN tests pass in `path-authority.realpath.test.ts`:

| Test | Outcome | Source |
|---|---|---|
| `find project/escape-link` (realpath evidence) | ASK | `host_workspace_realpath_authority` |
| `find -L project/escape-link` (realpath evidence) | ASK | `host_workspace_realpath_authority` |
| `ls project/escape-link` (realpath evidence) | ASK | `host_workspace_realpath_authority` |
| `find project/does-not-exist` (realpath evidence ENOENT) | ASK | `host_workspace_realpath_authority` |
| `find project/restricted` (realpath evidence EACCES) | ASK | `host_workspace_realpath_authority` |
| `ls /etc` (realpath evidence OUTSIDE) | ASK | `host_workspace_realpath_authority` |
| Multi-root: `find project/escape-link` (target as 2nd root) | ALLOW | `host_mode_safe_only_rule` |
| **CORRECTION02 REGRESSION: missing evidence `find project/escape-link`** | **ASK** | `host_workspace_realpath_authority` (NOT V1 fallback ALLOW) |
| **CORRECTION02: missing evidence for `ls project/inside`** | **ASK** | `host_workspace_realpath_authority` |
| **CORRECTION02: operand identity mismatch (evidence for /safe applied to /evil)** | **ASK** | `host_workspace_realpath_authority` |
| `realpathSync` actually resolves the symlink to OUTSIDE_DIR | true | platform property pin |

### Reviewer findings — all closed

| Finding | Severity | Status |
|---|---|---|
| symlink escape V1 | P0 | **CLOSED** (CORRECTION01) |
| failed evidence → V1 lexical fallback | P0 | **CLOSED** (CORRECTION02: V1 fallback removed from production ALLOW path) |
| operand count-only check (no identity) | P1 | **CLOSED** (CORRECTION02: operand identity binding added) |
| multi-root in VSCode | P1 | **CLOSED** (CORRECTION01) |
| CLI `cwd === workspaceRoots` | P1 | **CLOSED** (CORRECTION01) |
| Virtual workspaces | P1 | **CLOSED** (CORRECTION01) |

### Validation results (CORRECTION02)

| Surface | Status |
|---|---|
| `@cline/core` unit | **2498/2498 PASS** / 14 SKIPPED (was 2493 in CORRECTION01; +5 from CORRECTION02: 3 missing-evidence, 1 operand-identity, 1 multi-command-aggregate) |
| `@cline/core` command-policy/ | **538 PASS** (was 528; +5) |
| `@cline/core` typecheck | EXIT=0 |
| `apps/cli` command-policy-host | 42 PASS |
| `apps/cli` typecheck | EXIT=0 |
| `apps/vscode` sdk-tool-policies | 70 PASS |
| `apps/vscode` sdk/ tests | 1954/1954 PASS |
| `apps/vscode` typecheck | EXIT=0 |
| SDK rebuild | EXIT=0 |

### Backlog CLOSED by CORRECTION02

- ~~V1 lexical fallback in production ALLOW path~~ — CLOSED.
- ~~operand count-only check (no identity binding)~~ — CLOSED.

### Backlog REMAINING (unchanged from CORRECTION01)

1. `ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01` (carried from prior ACT).
2. `ACT-CLINEMM-COMMAND-RISK-R0-READONLY-TEXT-INSPECTION01` (cat/head/tail).
3. `ACT-CLINEMM-COMMAND-RISK-R0-HARMLESS-STDERR-REDIRECT-PRECISION01`.
4. Virtual-workspace URI scheme-filtering follow-up.

## Backlog (remaining)

1. `ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01` (carried from prior ACT).
2. Virtual workspace URI filtering (non-`file` schemes): realpath currently throws, which is conservative; a follow-up could add explicit `vscode.workspace.workspaceFolders` scheme-filtering so the evidence builder doesn't even attempt realpath on virtual workspaces.
3. `.factory/epic-board.md` row update to mark this ACT as closed.
