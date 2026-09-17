# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01 — Final Assessment

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN
```

The cross-platform authority leak the reviewer identified
(HALT_MKTEMP_DEFAULT_OFF_AUTHORITY_UNPROVEN) is closed at the
production policy seam. The end-to-end UX closure is preserved.

## What was done (three commits)

1. **C1** (`docs(factory)`) -- reopen + RED repro
   - entry freeze at ENTRY_HEAD=6562651dc (C3 of prior ACT)
   - reviewer's disposition captured verbatim
   - LIVE RED reproduced on this darwin-arm64 host:
     BSD /usr/bin/mktemp ignores TMPDIR (Outcome A confirmed)
     GNU coreutils mktemp honors inherited TMPDIR (LEAK reproduced)
   - contract freeze for the bounded correction

2. **C2** (`feat(safety)`) -- host-evidence-bound rule
   - command-policy-types.ts: +TempAuthorityEvidence interface,
     +optional tempAuthorityEvidence field on CommandHostAuthorization,
     +new CommandDecisionSource value host_mktemp_temp_authority_unbound
   - command-policy.ts: +TEMP_AUTHORITY_HOST_EVIDENCE_BOUND_SOURCES
     set with one entry; +isTempAuthorityHostEvidenceBoundRuleSource
     predicate; +isTempAuthorityHostEvidenceBound exported predicate;
     +new branch in evaluateOne that gates the matched rule through
     a host-evidence check (returns ASK with new source if evidence
     is missing, platform != darwin, or any field is malformed)
   - command-safe-rules.ts: REVIEW STANDARD block rewritten for
     host_safe_mktemp_default_temp -- no longer claims cross-platform
     AUTO; explicit Darwin-only, host-evidence-bound contract
   - command-policy.mktemp-host-evidence-bound.test.ts: NEW, 29 tests
   - _live-qualification-c4.test.ts: NEW, 6 tests (replaces c3)
   - command-policy.mktemp-live-green.test.ts: DELETED (replaced)
   - _live-qualification-c3.test.ts: DELETED (replaced by c4)
   - sdk/packages/core/src/index.ts: +TempAuthorityEvidence re-export

3. **C3** (`feat(safety)`) -- apps/vscode adapter + GREEN
   - apps/vscode/src/sdk/sdk-tool-policies.ts: +buildTempAuthorityEvidence
     helper (darwin-only via os.tmpdir() + fs.realpathSync); wired
     into getCommandHostAuthorization at executeSafeCommands=true
   - 85/85 PASS across apps/vscode policy/approval/sandbox suites
   - Seatbelt mktemp composition unchanged (15/15 GREEN)

## Production change scope

Total production touch across all three commits:

```
sdk/packages/core/src/runtime/command-policy/command-policy-types.ts
  +TempAuthorityEvidence interface
  +optional tempAuthorityEvidence field on CommandHostAuthorization
  +new source value host_mktemp_temp_authority_unbound
  +extended commandHostAuthorization() factory (backward-compatible)

sdk/packages/core/src/runtime/command-policy/command-policy.ts
  +TEMP_AUTHORITY_HOST_EVIDENCE_BOUND_SOURCES set (1 entry)
  +isTempAuthorityHostEvidenceBoundRuleSource predicate
  +isTempAuthorityHostEvidenceBound exported predicate
  +new branch in evaluateOne() gating the rule through host evidence

sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  REVIEW STANDARD block rewritten for host_safe_mktemp_default_temp

sdk/packages/core/src/runtime/command-policy/index.ts
  +export type TempAuthorityEvidence

sdk/packages/core/src/index.ts
  +re-export type TempAuthorityEvidence

apps/vscode/src/sdk/sdk-tool-policies.ts
  +import * as fs from "node:fs"
  +import * as os from "node:os"
  +import type { TempAuthorityEvidence } from "@cline/core"
  +buildTempAuthorityEvidence() helper (darwin-only)
  +wire tempAuthorityEvidence into getCommandHostAuthorization
    at executeSafeCommands=true

NEW test files:
  sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-host-evidence-bound.test.ts
    29 tests at REAL_PRODUCTION_POLICY_SEAM
  sdk/packages/core/src/runtime/command-policy/_live-qualification-c4.test.ts
    6 tests (RED REPROOF + GREEN + CONSERVATION)

DELETED test files:
  sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-live-green.test.ts
  sdk/packages/core/src/runtime/command-policy/_live-qualification-c3.test.ts
```

No apps/vscode code was touched beyond the explicit
host-adapter change in C3.
NO parser-helper change. SHA256SUMS unchanged.
NO proto/schema change. NO public knob added.

## Test gates

| Suite | Pre-ACT | Post-CORRECTION01 | Status |
|-------|---------|-------------------|--------|
| sdk/packages/core full vitest | 3109 PASS | **3121 PASS / 16 SKIP / 0 FAIL** | +12 new tests, 0 regression |
| command-safe-rules.test.ts | 278 PASS | 278 PASS | unchanged (lexical-layer tests) |
| command-policy.mktemp-host-evidence-bound.test.ts | -- | 29 PASS | NEW |
| _live-qualification-c4.test.ts | -- | 6 PASS | NEW |
| apps/vscode policy/approval/sandbox suites | 85 PASS | 85 PASS | unchanged (no regression) |
| apps/vscode sandbox c3-real-kernel | 15/15 | 15/15 | **GREEN regression** |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## Architectural invariants preserved

- **No DEFAULT_OFF behavior change for non-mktemp commands.**
- **No new paths to broad filesystem write.** Bare mktemp under the
  host-evidence gate is bounded to the host-proven per-user temp
  directory on darwin.
- **Linux mktemp is now ASK, not AUTO.** Closes the cross-platform
  authority leak.
- **No public knob added.** The new field is optional; the factory
  is backward-compatible.
- **Parser-helper SHA256SUMS unchanged.**
- **OPAQUE_SHELL_TOKENS guard intact.**
- **R5 catastrophic floor intact.**
- **Seatbelt composition unchanged.**
- **1044+ cmd-policy tests PASS.**
- **P1 wording fixed**: the live-green tests now explicitly state
  `REAL_PRODUCTION_POLICY_SEAM (NOT a substitute for LIVE installed UX)`;
  the live UX evidence is the seatbelt c3-real-kernel suite from
  the predecessor ACT.

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

## Evidence (gitignored, local)

```
.factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01/
  entry-freeze.txt
  review-disposition.txt
  red-inherited-tmpdir.txt
  c1-closure.md
  c2-closure.md
  c3-closure.md
  test-gates.txt
  c3-live-output.txt
  live-qualification.txt
  final-assessment.md
```

## Next ACT candidates (NOT in this ACT)

The reviewer explicitly bounded this CORRECTION01 to:
- darwin AUTO
- linux ASK

Per the reviewer's preferred lean correction, the following are NOT
in scope and would require separate ACT candidates:

1. **Linux mktemp support.** Proving bounded Linux authority would
   require canonicalizing inherited TMPDIR per-process and binding
   it to a per-user temp authority -- a real authority-evidence
   change.

2. **mktemp template forms (`mktemp foo.XXXX`).** These have caller-
   selected pathname authority and would need canonical-path
   evidence binding similar to cd/find. Separate authority family.

3. **ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01**
   (general authorization -> executor capability composition).

The bounded bare mktemp form does NOT require any of these. The
reviewer's lean correction closes the leak while keeping the
darwin UX closure intact.

**This CORRECTION01 ACT is closed.**
