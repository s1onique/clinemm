# ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02-CORRECTION02

**Status:** PASS_REAL_OBSERVATION_SEAM.

**Reviewer halt:** `HALT_EXECUTABLE_EVIDENCE_MISMATCH` (raised against
the CORRECTION01 closure row). P0 finding: the predecessor ACT
claimed `PASS_REAL_OBSERVATION_SEAM` on the strength of structural
test definition + clean static typecheck, but the four PCRS02C01
tests had never actually executed on this machine. The 5/5 PCRS02
claims and the predecessor's 5/5 SWCM04 claims were similarly
unverifiable: every test that transitively imports real SDK source
fails at module-load time with `TypeError: undefined is not an
object (evaluating 'z.custom' / 'z.object')` from Vite/Vitest
4.1.10's ESM/CJS interop bug for zod v4.

**Artifact-identity inconsistency:** the closure_head of the
predecessor ACT pointed at the board commit `d5e963648`, not the
true HEAD at closure-time (`35c301def`). Resolved here by freezing
the true HEAD at every stage and validating the closure HEAD
against `git rev-parse HEAD`.

## Bounded correction (no change to production seam)

Only two files changed:
1. `apps/vscode/vitest.config.c2-4-c-bridge.ts` — added
   `optimizeDeps.include = ["zod"], force = true` and
   `ssr.noExternal = ["zod"]` at the TOP level of the config
   (sibling of `test:`, `resolve:`, etc.).
2. `apps/vscode/vitest.config.ts` — same two blocks at the top
   level. Required to keep the base config's `setupFiles`
   (`cline-core-vitest-stub.ts` → `createFileReadExecutor` →
   `schemas.ts` → `import { z } from "zod"`) loading correctly.

**Subtle bug encountered:** placing these blocks inside
`test: { ... }` (my first attempt on the base config) silently
ignored them. They must be at the top level. The bridge config
already had this correct.

## Verification (executed evidence)

**Production-shape PCRS02C01 bridge suite:** 4/4 PASS in 110ms

| Test | Driver | Assertion | Result |
|---|---|---|---|
| PCRS02C01-01 | `host.runTurn({prompt, delivery: undefined})` | C7 → prelude → C8 in order with matching jobId | PASS |
| PCRS02C01-02 | `host.runTurn` with `agent.run` returning a never-resolving promise | prelude fires, C8 absent → STALL fingerprint | PASS |
| PCRS02C01-03 | `host` constructed without `onExecuteTurnPreludeEnter` | C7 + C8 fire, NO prelude record → ablation | PASS |
| PCRS02C01-04 | `host.executeTurn` with stub `prepareTurnInput` recording call stack | prelude captured BEFORE `prepareTurnInput` invoked → synchronous boundary proof | PASS |

**PCRS02 module-level suite:** 5/5 PASS in 4ms

**Adjacent bridge tests (regression check, same zod fix unblocks them):**

| Suite | Tests | Time | Result |
|---|---|---|---|
| SWCM04 | 5/5 | 324ms | PASS |
| CCCL01 | 2/2 | 5ms | PASS |
| ACL02 | 2/2 | 5ms | PASS |
| PPRD01 | 2/2 | 211ms | PASS |
| PPLW01 | 2/2 | 270ms | PASS |
| real-local-to-shadow | 5/5 | 47ms | PASS |
| CCARD01 (base) | 12/12 | 6ms | PASS |

**Total:** 41/41 PASS across 9 test files.

**Gates (all clean):**

```text
tsc_apps_vscode                                  = 0 errors
tsc_apps_vscode_bridge                           = 0 errors
biome_check                                      = clean
git_diff_check                                   = clean (closure commit)
PCRS02C01 runtime                                = 4/4 PASS
PCRS02 module runtime                            = 5/5 PASS
SWCM04 runtime                                   = 5/5 PASS
PCRS02_RUNTIME                                   = 5/5 PASS
```

## Production-shape conservation (frozen per §17 of CORRECTION01)

```text
ACT_CARDINALITY_AUTHORITY_CAPTURE_ENABLED_seam  = true
execute_turn_prelude_enter_stage                = true   (frozen per CORRECTION01 §3)
LocalRuntimeHost_executeTurn_capture_call       = true   (preserved at first executable line)
PRODUCTION_BEHAVIOR_CHANGED                     = false
PUBLIC_API_CHANGED                              = false
WIRE_FIELDS_ADDED                               = 0
REACT_STATE_ADDED                               = 0
QUEUE_REDESIGNED                                = false
BCB_REDESIGNED                                  = false
PROMPT_REWRITES                                 = false
PROVIDER_FORMAT_CHANGED                         = false
MCP_PROTOCOL_CHANGED                            = false
MYC_CODE_CHANGED                                = false
```

## Environment note (informational only — does not affect the load-bearing runtime evidence)

The full vitest run emits `EPERM: operation not permitted, kill`
errors after the per-file summaries are printed. These are
Bun-on-macOS child-process cleanup noise (Vite's forks pool cannot
always terminate its workers cleanly under the IDE sandbox used
by the author). The per-file `✓ / ✗` lines and the
`Test Files X passed | Y failed` summary lines are the source of
truth and are not affected.

## Ready for live discrimination: TRUE

After this ACT's commits:

```bash
git checkout 8d3b120d7     # (or the closure HEAD if you want the artifact-identity-bound one)
bun esbuild.mjs             # production bundle
mkdir -p "$ROOT/dist"
@vscode/vsce package --out "$ROOT/dist/clinemm-correction02.vsix"
# Install the VSIX, restart Codium, reproduce once.
```

The new live trace will finally distinguish:

```text
run_turn_started
(no execute_turn_prelude_enter)
-> stall before executeTurn entry (EXECUTE_TURN_PRELUDE_HUNG)

vs

run_turn_started
execute_turn_prelude_enter
(no agent_turn_done)
-> stall inside executeTurn or deeper (EXECUTE_TURN_PRELUDE_STALL)
```

Only the second branch (`EXECUTE_TURN_PRELUDE_STALL`) would justify
a follow-up ACT to add a deeper seam inside the prelude awaits.
