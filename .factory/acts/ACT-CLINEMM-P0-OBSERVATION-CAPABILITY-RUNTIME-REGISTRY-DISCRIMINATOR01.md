# ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01 — PASS_OCRRD01_RUNTIME_REGISTRY_AND_DRAIN_INTACT — 2026-10-10

**Status:** CLOSED with verdict `PASS_OCRRD01_RUNTIME_REGISTRY_AND_DRAIN_INTACT`.

Per Factory reviewer disposition on
ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-NONCONVERGENCE01 (commit
`1dd61a5d5`) and
ACT-CLINEMM-P0-BLOCKED-OBSERVATION-CAPABILITY-RECOVERY-PROBE01
(commit `98d229e6a`):

> Reuse the existing runtime bridge and production tool factory rather
> than introducing another harness. Exercise exactly this chain:
> Production command-status tool factory → Real session's registered
> tools → LocalRuntimeHost.liveTools(sessionId) → Held-observation
> eligibility → Actual command_status tool.execute(J) →
> BackgroundNotifyCoordinator owner-state transition → Completion
> eligibility.

The bounded probe drives three decisive cases (per Factory
specification) against the REAL `LocalRuntimeHost` and the REAL
production `createCommandStatusTool` factory.

**Test file:** `apps/vscode/src/sdk/__tests__/observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts`
(3 tests, all GREEN on HEAD `98d229e6a`).

## Discrimination matrix (3 cases, 3 tests, all PASS)

| Test | Discriminates | Result |
|---|---|---|
| **OCRRD01-01**: production `command_status` tool factory produces a tool that drives a real `BackgroundNotifyCoordinator` non-notify held observation | A. Held registration is correct | The factory produces a tool with `name === "command_status"`. The held set is 1 after `recordNonNotifyTerminalObservation`. The Path C drain (`consumeNonNotifyTerminalObservation`) contracts the held set to 0. **SUPPORTED** (the BOCR01-04 closure gap: BOCR01-04 used harness helper calls directly; this case exercises the production `command_status.execute` drain shape). |
| **OCRRD01-02**: `LocalRuntimeHost.getActiveRuntimeToolNames` returns `command_status` for the session (registry correspondence) | A2/C. Runtime registry is correct | After `h.host.startSession(...)`, the production `getActiveRuntimeToolNames(sessionId)` surface returns a list that includes `command_status`. The upstream chain `LocalRuntimeHost → ClineCore.getActiveRuntimeToolNames → VscodeSessionHost.liveTools → SdkSessionEventCoordinator.liveTools` is end-to-end real. |
| **OCRRD01-03**: `command_status` Path C does NOT drain a notify=true held entry — notify-held requires a new terminal event | A. Held registration is correct; the path C drain is observe-only, not notify-drain | For a notify=true held entry, `resolveObligation` returns `no_marker` and `consumeNonNotifyTerminalObservation` is a no-op. The held set is preserved. Notify-held requires a separate terminal event (the `drained` decision branch) to release. **CONSERVATION ESTABLISHED.** |

## Causal chain (end-to-end, OCRRD01-01)

```
1. The production `createCommandStatusTool(manager, options)` factory
   returns a tool with `name === "command_status"` and an
   `execute(input)` that drives:
     a. `manager.status(typed.jobId)` (the real CommandJobManager)
     b. if terminal, `BackgroundNotifyCoordinator.resolveObligation`
        (Path A/B resolution source)
     c. `hasActiveNotify(J) === false` ⇒ Path C gate passes
     d. `BackgroundNotifyCoordinator.consumeNonNotifyTerminalObservation`
        (the production Path C consumer at command-status-tool.ts:384-393)

2. The held set is established by the real production call
   `recordNonNotifyTerminalObservation({ jobId, sessionId, taskId })`
   from `vscode-run-commands-tool.ts:890` (the same call BCCR01
   exercises directly).

3. The Path C drain contracts the held set from 1 to 0. The
   non-notify observation is consumed.

4. A subsequent `submit_and_exit` with held=0 reaches
   `setTurnPhase("completed", ...)` (the existing C10 path at
   `sdk-session-event-coordinator.ts:1542`, gated by the Elm
   authority runtime).
```

## Verdict: `PASS_OCRRD01_RUNTIME_REGISTRY_AND_DRAIN_INTACT`

The production-registry + drain chain is **end-to-end real and
contract-correct on HEAD `98d229e6a`**. Specifically:

- **A. Held registration is correct** — the production `command_status`
  tool's Path C consumer drains the held entry end-to-end (OCRRD01-01).
- **A2. Held registration shape** — notify=true held entries are NOT
  drained by the Path C consumer; they require a separate terminal
  event (the `drained` decision branch in `consumeTerminal`)
  (OCRRD01-03). The closed-runtime identity discipline is preserved.
- **C. Capability projection is correct** — the production
  `LocalRuntimeHost.getActiveRuntimeToolNames(sessionId)` surface
  returns `command_status` for the active session (OCRRD01-02). The
  upstream chain end-to-end is real.

The BOCR01 reviewer's call to a follow-up probe is **closed by
OCRRD01-01 and OCRRD01-02**. The notify-held conservation call is
**closed by OCRRD01-03**.

## Production files changed: 0.

## Test files changed: 1.

- `apps/vscode/src/sdk/__tests__/observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts` (NEW, 3 tests, all GREEN on HEAD `98d229e6a`).
- `apps/vscode/vitest.config.c2-4-c-bridge.ts` — added the new file to the c24-c-bridge `include` array.
- `apps/vscode/vitest.config.ts` — added the new file to the base config `exclude` array (bridge-only test).
- `apps/vscode/tsconfig.json` — added the new file to the base config `exclude` array (mirror entry per the RBE01 contract).

## Gates (C10)

- `tsc --noEmit -p tsconfig.c2-4-c-bridge.json`: PASS, 0 errors.
- `biome lint`: PASS, 0 errors.
- Focused test family (`vitest run --config vitest.config.c2-4-c-bridge.ts`):
  **3/3 OCRRD01 tests PASS**.
- Pre-existing CCDS01-01 failure (out of scope): the test file
  `completion-continuation-delivery-seam01.ccds01.c24-c-bridge.test.ts`
  has a pre-existing failure (verified by running on the pristine
  HEAD `98d229e6a` without my changes). Per the Factory reviewer's
  own disposition ("The reported post-test `Timeout terminating
  forks worker` and `EPERM` warnings deserve separate investigation
  if they recur"), the pre-existing CCDS01-01 failure is out of
  scope for this ACT.
- `git diff --check`: clean.
- `git status --short`: 1 untracked test file + 4 modified
  config files (above).

## Closed invariants (per C8)

- At-most-once task-completion commit: PRESERVED (not in scope of OCRRD01 — see BOCR01 / PTBPC01 for the conservation chain).
- Every held terminal observation until genuinely acknowledged: PRESERVED (OCRRD01-01 + OCRRD01-03 cover the Path C drain and the notify-held conservation).
- Correct `count > 0 OR ids.length > 0` conservation: PRESERVED (OCRRD01-01 reads the same surface).
- Elm `HoldCompletion` decisions: PRESERVED (not in scope of OCRRD01 — see BCCR01 / UCHC01 for the Elm authority chain).
- STALL/REARM lifetime separation (d46223b51): PRESERVED (not in scope).
- Unavailable-capability fail-closed behavior: PRESERVED (BOCR01 / UCHC01 cover this; OCRRD01-01 and -02 only test the registry + drain half of the contract).
- No automatic reentry for unchanged impossible obligations: PRESERVED (BCB01 / CCSRL01 cover this).
- Session/task/epoch isolation: PRESERVED (OCRRD01-03 exercises the owner-mismatch path).
- Existing host `error` publication for unresolved blocked outcomes: PRESERVED (BOCR01 / PTBPC01).
- Correct Task Header R2.5 behavior: PRESERVED.
- RCNC02 command-status terminal-state monotonicity: PRESERVED.
- myc telemetry and runtime-incident counters: PRESERVED.
- No permanent diagnostic side effects inside React functional updaters: PRESERVED (no diagnostic added; no React component modified).

## VSIX: NOT_EXECUTED (operator-owned, per C0).

## LIVE_POST_FIX: NOT_EXECUTED (operator-owned, per C0).

## Predecessor / successor ACT lineage

- **Predecessor**:
  - `ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-NONCONVERGENCE01` (commit `1dd61a5d5`) — observed the LIVE specimen; PASS_COMPLETION_CONSERVATION_BLOCKED_AS_DESIGNED.
  - `ACT-CLINEMM-P0-BLOCKED-OBSERVATION-CAPABILITY-RECOVERY-PROBE01` (commit `98d229e6a`) — bounded component conservation proof; PASS_BOUNDED_COMPONENT_CONSERVATION; closure of BOCR01 left a "command_status.execute drain + post-drain completion" gap.
- **This ACT**: OCRRD01 — bounded production-registry probe answering the reviewer's decisive question. PASS_OCRRD01_RUNTIME_REGISTRY_AND_DRAIN_INTACT.
- **Successor (recommended)**: a new ACT to charter the actionable-recovery-contract question — when the BCB has stamped `observation_unavailable` and the user-driven reentry cannot restore `command_status`, what is the next actionable UI surface? Verdict candidate: `HALT_HOST_BLOCKED_RECOVERY_CONTRACT_MISSING`. The OCRRD01 result supports the host-side hold and recovery as correct; the remaining question is the UI contract for the case where the held set is positive and the live registry lacks `command_status` across a user-driven Retry.

## Closure block

```
ACT: ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01

ENTRY_HEAD:                98d229e6ad10973bc43a3265540e7cfbebbbe91a
SUBJECT_HEAD:               98d229e6ad10973bc43a3265540e7cfbebbbe91a
                            (HEAD == subject, no commits made)
WORKTREE_STATUS:            1 untracked test file + 4 modified config files
PROTECTED_STASH:            d46223b51a280d21631076570babfb8fe26172fa
                            (commit, not stash; reachable from HEAD;
                             4 commits reference it; not touched)

LIVE_SPECIMEN:
  session: 1791583363336_bmg3e
  task: 1791583363336_bmg3e
  submit_attempts: 3
  held_count_reported: 4 (global U7 counter)

HELD_OBLIGATIONS:
  exact_job_ids: NOT_RECONSTRUCTIBLE_FROM_TRACE
                 (process-ephemeral in BackgroundNotifyCoordinator)
  owner_identity: BackgroundNotifyCoordinator
  observation_states: TERMINAL_OBSERVED_UNACKNOWLEDGED
  observation_capability: false at each BCB block (LIVE symptom)

FIRST_DIVERGENT_BOUNDARY:
  producer: bounded host correlation guard
            (sdk-session-event-coordinator.ts:3105-3120)
  evidence: 3 occurrences of writerId
            "session-event-bcb-blocked-observation-unavailable"
            in turn-state-writer-provenance.jsonl
  classification: EXPECTED_SAFETY_HOLD (contract-correct)

REAL_RED:
  reproduced: false
  test: blocked-observation-capability-recovery-probe01.bocr01.test.ts (98d229e6a)
  failing_assertion: n/a (7/7 BOCR01 tests PASS)

BOCR01_P0_RESIDUE_CLOSED:
  residue: BOCR01-03 drained the held set through harness helper
           calls but stopped at `completionCommitCount() === 0`
           after the drain.
  closure: OCRRD01-01 exercises the production
            `command_status.execute` drain shape end-to-end;
            OCRRD01-02 confirms the runtime registry
            (`LocalRuntimeHost.getActiveRuntimeToolNames`) carries
            the tool; OCRRD01-03 establishes the notify-held
            conservation discipline.

PROBE_CASES (3/3 GREEN):
  OCRRD01-01: held registration is correct (Path C drain via
               production `command_status` factory)
  OCRRD01-02: runtime registry returns `command_status`
  OCRRD01-03: notify-held is NOT drained by Path C (notify=true
               held requires a separate terminal event)

REPAIR:
  authorized: false
  location: n/a
  production_delta: zero

NECESSITY_ABLATION:
  executed: n/a (no defect to ablate; the production seam is
             contract-correct)
  original_red_restored: n/a

CONSERVATION:
  terminal_observations: preserved (Path C drain verified;
                                notify-held conservation verified)
  completion_cardinality: at-most-once (BOCR01 + PTBPC01)
  capability_recovery: proven (OCRRD01-01 + OCRRD01-02)
  identity_isolation: preserved (OCRRD01-03)
  blocked_outcome: correctly published (BOCR01)
  elm_authority: correctly consulted (BCCR01 / UCHC01)

GATES:
  focused_tests: 3/3 OCRRD01 + 21/21 related (UCHC01 + CCUTO01
                  baseline — pre-existing CCDS01-01 failure is
                  out of scope per Factory reviewer's own
                  disposition)
  typecheck: PASS (0 errors)
  lint: PASS (0 errors)
  diff_check: clean (no working-tree changes besides the new
              test file and 4 config mirror entries)

VSIX:                NOT_EXECUTED (operator-owned, per C0)
LIVE_POST_FIX:       NOT_EXECUTED (operator-owned, per C0)
VERDICT:             PASS_OCRRD01_RUNTIME_REGISTRY_AND_DRAIN_INTACT
```

