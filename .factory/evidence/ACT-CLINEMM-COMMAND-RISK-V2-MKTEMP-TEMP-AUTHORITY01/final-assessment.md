# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01 — Final Assessment

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY
CLOSED_CLEAN
```

The user-facing mktemp defect is closed end-to-end at the production
seam, with both layers verified:

1. **Policy layer** (`command-policy/command-safe-rules.ts`):
   added `host_safe_mktemp_default_temp` safe rule.

2. **Sandbox execution layer** (predecessor
   `ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01` and its
   `CORRECTION01`): bare mktemp / mktemp -d reach Seatbelt and
   succeed under private canonical TMPDIR.

3. **Composition is now unbroken**: interactive ClineMM with
   `executeSafeCommands=true` flows `mktemp` from the UI surface
   through the policy ALLOW verdict into CommandJobManager.start
   into Seatbelt production seam successfully.

## What was done

### Three commits

1. **C1** (`docs(factory)`) -- recon + contract freeze. No
   production code touched. Established:
   - live RED captured (decision=ask, source=risk_parse_failed)
   - darwin host semantics verified (BSD ignores TMPDIR for bare form)
   - DEFAULT_OFF discriminator answered: Outcome A on darwin-arm64
   - parser-helper SHA256 unchanged
   - Wave-1 grammar frozen at `\s*mktemp(?:\s+-d)?\s*`

2. **C2** (`feat(safety)`) -- bounded policy implementation.
   Added 1 regex entry to `DEFAULT_COMMAND_HOST_ALLOW_RULES`
   with a 28-line REVIEW STANDARD block documenting reviewed
   positives, explicit negatives, and DEFAULT_OFF rationale.
   Added 45 tests in `command-safe-rules.test.ts`.
   Added new `command-policy.mktemp-live-green.test.ts` (23 tests)
   driving the production policy seam end-to-end.

3. **C3** (this commit) -- installed qualification. Verified
   end-to-end UX closure: policy ALLOW -> Seatbelt GREEN mktemp.
   Captured ablation necessity test. No production code touched.

### Production change scope

The entire ACT's production touch is:

```
sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  +~36 lines: REVIEW STANDARD block + 1 safe rule entry

sdk/packages/core/src/runtime/command-policy/command-safe-rules.test.ts
  +~115 lines: 1 positive test + 1 REJECTED describe (39 tests)
                 + 1 ablation test = 45 total

sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-live-green.test.ts
  NEW file, 23 tests, drives the production policy seam

sdk/packages/core/src/runtime/command-policy/_live-qualification-c3.test.ts
  NEW evidence-capture file (C3 LIVE QUALIFICATION), 9 tests
```

NO apps/vscode code touched.
NO parser-helper code touched.
NO SDK API surface touched.
NO proto/schema change.
NO DEFAULT_OFF behavior change for any non-mktemp command.

## Test gates

| Suite | Before | After |
|-------|--------|-------|
| command-safe-rules.test.ts | 233 tests | **278 tests (+45 new)** |
| command-policy.mktemp-live-green.test.ts | -- | **23 tests (NEW)** |
| _live-qualification-c3.test.ts | -- | **9 tests (NEW)** |
| sdk/packages/core full vitest | 3041 PASS | **3109 PASS / 16 SKIP / 0 FAIL** |
| apps/vscode sdk-interaction-coordinator.parser-helper.test.ts | PASS | PASS |
| apps/vscode session-auto-approval.test.ts | PASS | PASS |
| apps/vscode command-job-manager.test.ts | PASS | PASS (70/70 across the 3 files) |
| apps/vscode sandbox c3-real-kernel.test.ts | 15/15 PASS | **15/15 PASS** (regression check) |
| bun run build:sdk | clean | clean |
| apps/vscode bun run compile | clean | clean |
| git diff --check | clean | clean |

## Architectural invariants preserved

- **No DEFAULT_OFF behavior change for non-mktemp commands.**
- **No new paths to broad filesystem write.** The rule grants
  authority to a single binary that creates exactly one
  unpredictable filesystem object at a host-defined destination.
- **No authority expansion under Seatbelt.** Authorization is
  bound by the rendered shape alone; Seatbelt composes as an
  additional defense-in-depth layer (independently proven in the
  predecessor ACTs), not as the authorization basis.
- **No public surface change.** The new rule is in the same
  `DEFAULT_COMMAND_HOST_ALLOW_RULES` catalog that ships to host
  adapters without per-rule knobs.
- **Parser-helper conservation.** SHA256SUMS unchanged at
  `874741a388b621596b59cf75c7d59c62cf919931d7f164174a60b1920d7df1d3`
  (darwin-arm64).
- **OPAQUE_SHELL_TOKENS guard intact.** All dynamic, redirect,
  composition, and substitution inputs short-circuit before
  reaching the regex.
- **R5 catastrophic floor intact.** `rm -rf`, `destructive shell
  constructs`, etc. all hard-floor at the canonical policy's
  hard-floor matcher before reaching the safe-rule engine.

## Trust state

```
ENTRY_HEAD = 7f1ff13d9d678ea4d27b6449db4c3b4fe0e263a1 (CORRECTION01)
C1_HEAD    = 787f2b2d7 docs(factory): recon + contract freeze
C2_HEAD    = fac25e959 feat(safety): bounded mktemp policy
C3_HEAD    = <this commit> docs(factory): installed qualification
BRANCH     = main
ORIGIN_MAIN = 7f1ff13d9 (9 unpushed local commits)
NOT pushed
```

## Evidence (gitignored, local)

`.factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01/`
- entry-freeze.txt
- darwin-mktemp-semantics.txt
- parser-matrix.jsonl
- parser-helper-sha.txt
- red.txt
- default-off-authority.txt
- production-rejection-boundary.md
- c1-closure.md
- green-raw.jsonl
- green.txt
- rule-matrix.txt
- negative-matrix.txt
- ablation.txt
- policy-source-proof.txt
- test-gates.txt
- c2-closure.md
- c3-live-output.txt
- live-qualification.txt
- final-assessment.md

## Freeze

```
mktemp                              AUTO       PASS
mktemp -d                           AUTO       PASS
mktemp -u                           ASK        PASS (Darwin manual: unsafe)
mktemp -p /tmp ...                  ASK        PASS (path-steering)
mktemp -t foo                       ASK        PASS (template-driven)
mktemp TEMPLATE                     ASK        PASS (path authority)
mktemp "$X" / ${X} / $(printf)      ASK        PASS (dynamic, no flattening)
TMPDIR=/x mktemp                    ASK        PASS (env steering)
env TMPDIR=/x mktemp                ASK        PASS (env wrapper)
mktemp && pwd                       ASK        PASS (opaque)
mktemp > /tmp/x                     ASK        PASS (opaque)

DEFAULT_OFF authority               PASS (independent of Seatbelt)
Seatbelt mktemp                     PASS (15/15 c3-real-kernel)
Private TMPDIR                      PASS
Parser helper                       UNCHANGED (SHA256SUMS unchanged)
R5 catastrophe                      INTACT (n untouched)
Command-policy conservation         PASS (1044/1044 cmd-policy tests)
```

## Next ACT candidates (NOT in this ACT)

The reviewer-recommended next step (`ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01` already closed):

1. **ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01**
   - explicitly bind policy authorization to executor
     capabilities for forms whose destination depends on
     guaranteed sandbox state
   - not in scope of this ACT; the bounded mktemp form does
     NOT need this because the bare form's destination is
     intrinsic.

2. **mktemp template form** (separate authority family)
   - `mktemp foo.XXXX` is path-steering via the template; would
     need canonical-path evidence binding similar to cd/find
     - this is a separate ACT once user demand exists.

3. **Developer-cache capability** (`ACT-CLINEMM-COMMAND-SANDBOX-DEVELOPER-CACHE-CAPABILITY01`)
   - only if real Go/Node cache workflows show caches as the
     next blocking compatibility class.
   - not in scope of this ACT.
