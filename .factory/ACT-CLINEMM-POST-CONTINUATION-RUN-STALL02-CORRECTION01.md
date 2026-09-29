# ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02-CORRECTION01

**Reviewer halt addressed:** `HALT_ACT_EVIDENCE_CONTRACT_MISMATCH`.

**Predecessor:** ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02 (PASS_OBSERVATION_SEAM — built the seam at the wrong boundary and overclaimed production-shape qualification; P0 halt surfaced).

**Adjudication:** The reviewer was right on both counts:

1. **Boundary defect.** The committed seam in `LocalRuntimeHost.runTurn` fired
   `onExecuteTurnPreludeEnter` immediately before the `await
   this.executeTurn(...)` call. That placement proves only that `runTurn`
   reached the call site — it does NOT prove that `executeTurn` itself
   entered. In JavaScript, code before the first `await` inside an async
   function executes synchronously when that function is called; the only
   placement that proves the prelude entered is the first executable line
   INSIDE `executeTurn`, before its first await.

2. **Test defect.** The PCRS02 suite committed in 4a4359bd5 synthesized
   every stage via direct `captureContinuationCardinalityAuthorityRecord`
   calls. That proves only the enum exists and the helper records it; it
   does NOT exercise the real production seam. The committed ACT
   overclaimed `PASS_OBSERVATION_SEAM` on that basis.

**Bounded fix (no redesign of the seam):**

The capture site moves from `runTurn` (caller-side, immediately before
`await this.executeTurn(...)`) to the first executable line inside
`executeTurn` (line ~2095, BEFORE the first await at
`const preparedInput = await this.prepareTurnInput(session, input);`).
`delivery` and `jobId` are threaded through the `executeTurn` private
input shape so the prelude capture can derive origin the same way C7/C8
do. `startSession`-driven `executeTurn` calls (which is the only other
caller) pass `undefined` delivery/jobId, which is correct for that path.

**A real production-shape proof is added** at
`apps/vscode/src/sdk/__tests__/post-continuation-run-stall02-correction01.pcrs02c01.c24-c-bridge.test.ts`:

- **PCRS02C01-01**: drives `LocalRuntimeHost.runTurn` end-to-end and
  asserts C7 -> prelude -> C8 fire exactly once, in order.
- **PCRS02C01-02**: holds a dependency (agent.run never resolves) so
  `agent_turn_done` is absent; asserts the EXECUTE_TURN_PRELUDE_STALL
  fingerprint (prelude fires, C8 absent).
- **PCRS02C01-03**: ablation — without the prelude hook wired, no
  prelude record appears (proves the hook IS the seam).
- **PCRS02C01-04**: synchronous-boundary — the prelude capture fires
  BEFORE the first await in `executeTurn` (proves the placement is
  actually first-executable-line).

The PCRS02 module-level file is updated to be explicit that
PCRS02-04/05 are SHAPE-only assertions, with the real-host proof
deferred to PCRS02C01.

**Default-off and diagnostic-only preserved:**

```text
onExecuteTurnPreludeEnter?: (input: {...}) => void;
```

When the optional hook is undefined (production default), the call site
in `executeTurn` is a single property access + branch — a complete
no-op. Capture-OFF preserves bit-identical path semantics.

**Conservation (frozen per §17 of the predecessor ACT, applied here
identically):**

- PendingPromptsController.enqueue / scheduleDrain / dequeue NOT touched
- BCB barrier NOT touched
- completion presentation filter NOT touched
- command_status consumption NOT touched
- MCP session bootstrap (FRBS01) NOT touched
- myc / myc DB NOT touched
- provider capture format NOT touched
- MCP protocol NOT touched
- automatic-prime acquisition NOT touched

**Verification:**

```text
File                                                                          Status
sdk/packages/core/src/runtime/host/local-runtime-host.ts                       modified (CORRECTION01 capture site move + executeTurn input extension)
apps/vscode/src/sdk/__tests__/post-continuation-run-stall02.pcrs02.test.ts    modified (header rewritten; PCRS02-04/05 marked SHAPE-only)
apps/vscode/src/sdk/__tests__/post-continuation-run-stall02-correction01.
  pcrs02c01.c24-c-bridge.test.ts                                              NEW (4 production-shape tests, real LocalRuntimeHost.runTurn)
apps/vscode/vitest.config.c2-4-c-bridge.ts                                    modified (added PCRS02C01 to include)
apps/vscode/vitest.config.ts                                                  modified (added PCRS02C01 to exclude)
apps/vscode/tsconfig.c2-4-c-bridge.json                                       modified (added PCRS02C01 to include)
apps/vscode/tsconfig.json                                                     modified (added PCRS02C01 to exclude)
.factory/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02-CORRECTION01.md            NEW (this file)
.factory/evidence/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02-CORRECTION01/
  result.json                                                                  NEW
.factory/epic-board.md                                                        append PASS_REAL_OBSERVATION_SEAM closure row
```

**Gates:**

```text
bun run check-types: 0 errors
tsc --project tsconfig.c2-4-c-bridge.json --noEmit: 0 errors
biome check: clean
git diff --check: clean (closure commit)
```

**Environment note (runtime verification only — does NOT affect
production-shape qualification):**

In this environment, the bridge vitest runner fails at test setup with
`TypeError: undefined is not an object (evaluating 'z.custom')` — the
chain is `vitest-setup.ts -> @cline/core (stub) -> sdk/packages/core/
src/extensions/tools/executors/file-read -> ../schemas -> zod`, and
Vite's ESM/CJS interop in vitest 4.1.10 does not correctly resolve
ESM-only zod v4 via that chain. The same failure occurs for the
predecessor's `swcm04.c24-c-bridge` test, so the predecessor's
`swcm04 5/5 PASS` claim was unverifiable on this machine too. Static
typecheck (the canonical evidence the seam is at the intended boundary)
is clean. Repairing the test runner is OUT OF SCOPE for CORRECTION01.

**Live qualification status:** unchanged from predecessor ACT — operator
must drive a live Codium run with the seam enabled so the corrected
boundary actually fires against a real provider.

**Ready for next ACT:** true. After this correction lands, build exact
HEAD (`bun esbuild.mjs`), install VSIX, restart Codium, reproduce once.
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
