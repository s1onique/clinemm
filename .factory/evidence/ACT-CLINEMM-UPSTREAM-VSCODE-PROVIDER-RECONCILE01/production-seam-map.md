# Production-Seam Map — C2 Source Reconnaissance at the Merged Head

Subject HEAD: `eab87e94759deb483571904b7943e6ad53f9e42b`
Scope guard: the accepted fork-authority map
`.factory/evidence/ACT-CLINEMM-UPSTREAM-DIVERGENCE-AND-INTEGRATION-RECON01/fork-authority-conservation-map.tsv`

Recon method: inventory the RESOLVED merged source (not the upstream side, not
ancestry), follow producer -> typed transition -> consumer for each boundary, and
classify each domain as **CONSERVED / OBSERVED_REGRESSION / UNOBSERVABLE /
NOT_APPLICABLE** with `source:line` references.

Two structural facts were established FIRST and constrain every finding below:

**F-1 — the entire Elm authority is byte-identical to the fork baseline.**
```
$ git diff --name-only 265044bf3 HEAD -- apps/vscode/elm/ | wc -l
0
```
The merge changed **ZERO** files under `apps/vscode/elm/` (~40 source files plus
`.sha256` sidecars).  The C9/C10 completion authority, the BCB continuation
control and the task-header orchestration kernels are the fork's, unmodified.
This is not inference from a "clean textual merge": the 5 built kernels each
reproduce a **byte-identical SHA-256** against their tracked sidecars.

**F-2 — upstream has no counterpart for the fork's authorities.**  The fork-authority
map's `UPSTREAM_EQUIVALENT` column reads "NONE" for the native editor, the Elm
authority, C9/C10, BCB, MiniMax M3.1 and the portable trace.  Upstream therefore
cannot "win" or "lose" those seams; the only possible regression is a **merge
conflict resolution that weakened the fork side**, or a **shared-file rewrite
that changed a downstream consumer**.

---

## Domain 1 — Task lifecycle / completion authority

**Disposition: CONSERVED**

| Role | Path | Evidence |
|---|---|---|
| Producer | `apps/vscode/src/sdk/completion-authority-elm-authority.ts` (Elm decision: AUTHORIZE / HOLD / FAILURE) | fork file, unchanged |
| Producer | `apps/vscode/src/sdk/continuation-cardinality-authority.ts` (C9 capture seam) | fork file, unchanged |
| Producer | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3347-3351` (`pending_prompts` -> `setQueuedPromptCount`) | the ONLY upstream-authored line in this file; additive |
| Authority | `apps/vscode/src/sdk/completion-continuation-control-elm.ts` (`pickContinuationDirectiveForPublication`) | fork file, unchanged |
| Consumer | `apps/vscode/src/sdk/SdkController.ts` -> `sdk-session-event-coordinator.ts` -> webview task header | preserved |

* The upstream delta in `sdk-session-event-coordinator.ts` is exactly **one line**
  (`git diff 265044bf3 HEAD -- .../sdk-session-event-coordinator.ts` shows a
  1-line change): it forwards Core's queue length to the new
  `sessions.setQueuedPromptCount(...)`.  It touches **no** C9/C10, completion,
  marker, authority or commit path.
* `sdk-session-lifecycle.ts` grew by 269 lines, all **upstream cloud-session
  plumbing**: `trackSessionStart`, `waitForSessionStarts`, `waitForTurnSend`,
  `turnGeneration`, `pendingStarts`, `turnSends`, `attachExistingSession`,
  `hostOverride`, `toSessionMode`.  These are additive; the fork's fence logic
  (`SessionStartSupersededError`, `shouldContinue()` checks) is retained and
  *strengthened* by three extra `shouldContinue()` guards
  (`sdk-session-lifecycle.ts:508-510, 537-540, 587-591`).
* The merge ALSO removed a fork-dead upstream feature from the webview:
  `onRelinquishControl` / `subscribeToRelinquishControl`.  Upstream commit
  `93e5e455e` ("chore: remove the dead subscribeToRelinquishControl stream")
  removed the proto RPC (`apps/vscode/proto/cline/ui.proto`), the server handler
  (`src/core/controller/ui/subscribeToRelinquishControl.ts`) and the webview
  subscription together.  A repository-wide grep confirms **no orphan** remains:
  the only surviving hits are an unrelated comment in

Executable evidence (all at HEAD `eab87e947`):

| Witness | Result | Meaning |
|---|---|---|
| `completion-authority-contract01.h03.test.ts` + `.neg.h03.test.ts` + `.chart02.h03.test.ts` | **51/51 GREEN**, exit 0 | A-01…A-07 contract: C9 capture, BCB hold, Elm consult, **C10 commit through the ACTUAL tracker**, containment veto, Elm refusal cannot publish, completion identity/cardinality, Elm input filtering |
| `c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts` | **20/20 GREEN** | committed-terminal vs transcript-tail discrimination |
| `c9-c10-statechart-causal-repair01.c9c10scr01.test.ts` + `.cons.test.ts` | **19/19 GREEN** | statechart transitions + conservation |
| `completion-authority-elm-first-seam01.case01.test.ts` + `.preservation.test.ts` | **12/12 GREEN** | first-seam + preservation |
| `completion-authority-effect-discriminator01.cae01.test.ts` | **3/3 GREEN** | effect discriminator |
| `task-header-elm-orchestration-authority01.test.ts` | **78/78 GREEN** | Elm task-header orchestration |
| `task-header-authority-cutover.authority03.test.ts` | **21/21 GREEN** | authority cutover |
| `task-header-canonical-task-activity-ownership.cta01.test.ts` | **4/4 GREEN** | activity ownership |
| `continuation-cardinality-authority01.ccard01.test.ts` | **12/12 GREEN** | continuation cardinality |
| `sdk-session-lifecycle.test.ts` | **38/38 GREEN** | lifecycle |
| `sdk-task-start-coordinator.test.ts` | **22/22 GREEN** | start coordinator |
| `SdkController.test.ts` | **44/44 GREEN** | controller |
| `sdk-session-event-coordinator.test.ts` | 2 failed / **131 passed** | see PRE-EXISTING below |

### PRE-EXISTING (not ACT-owned) — `sdk-session-event-coordinator.test.ts`

Two failures: `CPL02: done with committed terminal response AND attempt-completion
transitions to completed (control: completion-tool path)` and
`OWN01 RED: bare done + no terminal commit + no attempt_completion + no
user-yield authority MUST NOT yield to awaiting_followup`.

Proven PRE-EXISTING by A/B against the fork baseline `265044bf3`:
```
merged : 2 failed | 131 passed (133)
fork   : 2 failed |  27 passed ( 29)
```
The **same two test names fail**, and a JSON-reporter diff of
`/tmp/cline-recon01/sec-merged.json` vs `/tmp/cline-recon01/sec-fork.json` shows
**identical assertion messages** for both (`SAME-FAIL` for each).  Upstream added
104 passing tests; it did not change either failure's mode.  The merged
`OWN01 RED` name is itself a declared RED.

### Elm kernels (rebuilt from source at HEAD)

| Kernel | Build | Test | vs accepted baseline |
|---|---|---|---|
| `background-notify-authority` | PASS | **25/0** | 25/0 — exact match |
| `completion-authority` | PASS | **31/0** | 31/0 — exact match |
| `completion-continuation-control` | PASS | **39/2** | 39/2 — exact fork-parity RED |
| `task-header-orchestration` | PASS | **48/0** | 48/0 — exact match |
| `deferred-completion-barrier` | PASS | n/a | no test module (accepted baseline: "N/A (no tests)") |

All five kernel JS outputs reproduce their tracked `.sha256` sidecars EXACTLY.

The 2 `completion-continuation-control` failures were A/B'd as JSON reports
against the fork baseline and are **identical in label AND in expected/actual
value**:
```
fork   : 'C9 facts-isolation / negative unconsumedCount is always MalformedFacts'
         expected 'FailClosed MalformedFacts', actual 'RetryCompletion'
merged : IDENTICAL
fork   : 'HELD-SET-PROGRESS-AUTHORITY01 C2 / long passive accumulation (LIVE STALLED-REARM-LOOP01)'
         expected 'PassiveAccumulation', actual 'Indeterminate'
merged : IDENTICAL
```

  `apps/vscode/src/shared/combineCommandSequences.ts` and an unrelated assertion

---

## Domain 2 — Host -> webview / Elm ownership

**Disposition: CONSERVED**

| Role | Path | Evidence |
|---|---|---|
| Producer (authority) | `apps/vscode/src/sdk/task-header-elm-authority.ts` (132 lines; projects `{phase, source, seq}`) | **byte-identical to the fork baseline** (`git diff 265044bf3 HEAD -- .../task-header-elm-authority.ts` = empty) |
| Producer (shadow) | `apps/vscode/src/sdk/completion-authority-elm-shadow-runtime.ts` | fork file, unchanged |
| Transport | `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts` | upstream delta = **3 lines** (`hostPlatform`/`hostName` for a cloud badge); no phase/seq change |
| Consumer | `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx` | upstream delta is additive cloud-task rendering + a `compactDisabled`/`compactTask` prop pair |
| Consumer | `apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts` | upstream delta = cloud-creation-unconfirmed button + `getTurnStateMessage`/`isOptionsAskActive` helpers; the Elm phase mapping is untouched |
| Consumer | `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx` | upstream delta = `settingsNavigationRequest` replacing `settingsTargetSection`, plus the `onRelinquishControl` removal (see Domain 1) |

The fork-authority map's rule for this domain is explicit:
*"KEEP FORK VERBATIM; upstream webview task-header changes MUST be re-projected
through the Elm authority, not merged into the React projection directly."*
That is what the merged tree does: the **authority** (`task-header-elm-authority.ts`)
is byte-identical, and the React files consume it.  No upstream author wrote a
phase or a `seq` into React.

### React functional-updater purity (C3 matrix item 3)

The upstream delta to `ExtensionStateContext.tsx` replaces
`settingsTargetSection?: string` with a structured
`settingsNavigationRequest?: SettingsNavigationRequest`, and it removes the
`onRelinquishControl` callback/ref/subscription block.  Neither touches the
reducer or the updater.  The convergent-replica reducer (`messageReducer.ts`) and
its `applyStateSnapshot` / `applyMessage` entry points are unchanged.

Distinguishing the five stages named in the brief — request-time, updater
evaluation, reducer output, returned state, commit, effect — the upstream delta
does not introduce any diagnostic write into a functional updater: the only
removed block was a *subscription* (side effect at subscribe time), and the only
added block is `createSettingsNavigationRequest(...)` evaluated **at
request-time**, inside `navigateToSettings`/`navigateToSettingsModelPicker`
`useCallback`s, *before* `setSettingsNavigationRequest(...)` is called.

Witnesses (all GREEN at HEAD):
* `webview-ui/src/components/chat/chat-view/__tests__/react-updater-purity-probe.test.tsx` — **5/5 GREEN**
  (includes `R-PURITY-4 (PASS, post-repair): full real-provider render with one W1 push invokes applyStateSnapshot (wiring smoke)`).
* `webview-ui/.../c2-correction02-fixup04-updater-purity.test.ts` — **2/2 GREEN**.
* `webview-ui/.../c2-correction02-fixup04-committed-witness.test.tsx` — **1/1 GREEN**.
* `webview-ui/.../aopc02-phase-b-straggler-replay.test.tsx` — run as part of the same
  webview vitest invocation.

---

  in `VscodeTerminalManager.test.ts`.  The removal is complete and consistent.


---

## Domain 3 — Model / provider request (MiniMax M3.1 wire)

**Disposition: CONSERVED**

| Role | Path | Evidence |
|---|---|---|
| Routing authority | `sdk/packages/llms/src/providers/routing/minimax-thinking.ts` | **byte-identical to the fork baseline** |
| Effort ladder / exact ID | same file, `modelReasoningOptions` (`:50-73`) | `"minimax-m3.1-flash"`, `"minimax/minimax-m3.1-flash"`, `"MiniMax-M3.1-Flash"` each -> effort `[low, medium, high, xhigh, max]`; the CAPITALISED official id is present |
| Provider-option guard | `sdk/packages/llms/src/providers/routing/portable-reasoning.ts:79-113` (`NATIVE_REASONING_OPTION_PROVIDERS` + `requiresNativeReasoningOption`) | fork guard RETAINED |
| Upstream adaptation | same file `:126-179` (`snapToAdvertisedEffort`, `fitDisableToModel`) and `:190-238` (`resolvePortableLevel`) | upstream model-facts model COMPOSED on top, not substituted |
| Transport | `sdk/packages/llms/src/providers/ai-sdk.ts` | upstream changed; MiniMax effort travels in the `anthropic` bucket -> `output_config.effort` |
| Catalog | `sdk/packages/llms/src/catalog/catalog.generated.ts` | upstream delta is only the generated `version:` stamp; the `minimax-m3.1-flash` entries are present (`:29923, :33816, :40525`) |
| Trace attribution | `sdk/packages/agents/src/agent-runtime.ts` (wire-reasoning trace) | fork file; witness GREEN below |

The fork-authority map's rule for this domain:
*"KEEP the fork native-option guard AND the fork explicit-None provenance;
upstream model-facts logic must be ADAPTED, not substituted."*
The merged source does exactly that and says so in-source
(`portable-reasoning.ts:71-77` "R3: upstream replaced this capability guard with
a model-facts/capability model. That upstream rewrite is ADAPTED here, not
substituted"; and `:198-204` "the fork's native-option guard runs FIRST and is
authoritative").

### Executable evidence (all GREEN, exit 0)

| Witness | Result | Covers |
|---|---|---|
| `minimax-m31-exact-id-wire01.test.ts` | **8/8** | exact wire ID, effort ladder on the wire |
| `minimax-m31-unregistered01.test.ts` | **4/4** | unregistered-model behaviour |
| `minimax-m31-wire-reasoning-trace01.test.ts` | **3/3** | requested vs wire effort, trace attribution |
| `minimax-reasoning-wire01.test.ts` | **6/6** | reasoning wire |
| `minimax-reasoning-wire-probe.test.ts` | **7/7** | reasoning wire probe |
| `minimax-unsupported-reasoning-off01.test.ts` | **9/9** | low vs unsupported "None" |
| `reasoning-options.test.ts` | **10/10** | effort normalisation |
| `provider-options.test.ts` | **149/149** | provider-option rules incl. native guard |
| `catalog-m31-flash-snapshot01.test.ts` | **4/4** | M3.1 catalog entry does not disturb its sibling |

---

## Domain 4 — Cross-boundary conservation

**Disposition: CONSERVED**

| Concern | Path | Evidence |
|---|---|---|
| Token / compaction authority | `sdk/packages/core/src/extensions/context/compaction.ts` | fork authority; witnesses GREEN |
| Native editor + approval scope | `sdk/packages/core/src/extensions/tools/executors/editor.ts` + `edit-target-resolution.ts` + `edit-observation.ts` + `edit-checkpoint-registry.ts` | fork-only files, unchanged; realpath path intact |
| Pending-prompt cardinality | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` | 15/15 GREEN |
| ClineMM trace provenance | `sdk/packages/core/src/runtime/observability/model-behavior-trace*` + `apps/vscode/src/sdk/model-behavior-trace*` + `scripts/compare-model-behavior-traces.ts` | fork-only subsystem, unchanged |
| Hub remote-event optimisation | `sdk/packages/core/src/hub/server/hub-client-contributions.ts:513-516` | **byte-identical to upstream head `a6507a62`**; filter set = 4 types (`assistant-text-delta`, `assistant-reasoning-delta`, `tool-call-delta`, `tool-updated`); both filter commits `94980446c` and `590785eff` are ancestors of HEAD; the fork's recorder is a separate inline `ModelBehaviorTraceSink` producer, so the filter cannot change what it observes |

### Executable evidence

| Witness | Result | Covers |
|---|---|---|
| `core: compaction.test.ts` | **112/112 GREEN** | compaction authority |
| `core: compaction.real-producer-seam-red.test.ts` | **1/1 GREEN** | real-producer seam |
| `core: compaction.working-context-ratio.test.ts` | **3/3 GREEN** | working-context ratio |
| `core: pending-prompt-service.test.ts` | **15/15 GREEN** | pending-prompt cardinality |
| `core: editor.realpath-authority.test.ts` | **3 failed / 4 passed** | the INTENTIONAL RED matrix C/D/E (see below) |
| `core: edit-workspace-effect-trace01.test.ts` | **12/12 GREEN** | no duplicate native edits |
| `core: edit-efficiency-trace01.test.ts` | **19/19 GREEN** | edit efficiency trace |
| `vscode: editor-effective-destination-approval.r0-green` / `.r1-classifier` / `.r2-lattice` / `.r3-composed-movepath` / `.r4-necessity-ablation` | **24/24 GREEN** | approval scope / effective destination |

### INTENTIONAL RED preserved exactly — `editor.realpath-authority.test.ts`

```
✓ A. control: clean write inside cwd passes
✓ B. relative lexical traversal escape (../...) is refused today
× C. ABSOLUTE OUTSIDE TARGET — RED: must be refused
× D. EXISTING SYMLINK ESCAPE — RED: lexical-inside must still be refused (effective destination)
× E. nonexistent descendant of an outside root — RED: must be refused
✓ F. control: in-root canonical variant still passes
✓ H. control: ordinary workspace edit still passes
Test Files  1 failed (1)
      Tests  3 failed | 4 passed (7)
```
**3 failed / 4 passed — EXACT match to the accepted baseline**, same case
letters, same failure mode, same test file **byte-identical** to the fork
baseline.  The realpath / approval path was NOT widened.

### INTENTIONAL RED preserved exactly — `showtask-withid-deferred-completion-barrier.showtask01.test.ts`

This file's own header declares it a **"RED suite"** whose `RED-01` is "the
parental RED".  At HEAD it reports **5 failed / 4 passed**.  A/B against the fork
baseline `265044bf3` gives **5 failed / 4 passed** with the **same five test
names** and — via a JSON-reporter diff — **identical assertion messages**:
```
SAME  failed  RED-01: showTaskWithId on the active task must NOT lose the BCB01 continuation callback
SAME  failed  CONTROL-02: same state WITHOUT showTaskWithId -> marker survives -> continuation enqueued -> callback reached
SAME  passed  SAME-03 / SAME-03a / DIFFERENT-04 / IDEMPOTENCE-08
SAME  failed  SESSION-IDENTITY-05 / CANCEL-06 / EXACTLY-ONCE-07
```
Note this file and its production seam
(`sdk-task-control-coordinator.ts`, `sdk-session-lifecycle.ts`,
`sdk-session-event-coordinator.ts`) all DIFFER from the fork baseline — upstream
refactored them — yet the RED's failure mode is **bit-for-bit conserved**.

---

## Four-domain disposition summary

| # | Domain | Disposition | Basis |
|---|---|---|---|
| 1 | Task lifecycle / completion (C9/C10, cancel epoch, task switch) | **CONSERVED** | Elm tree byte-identical; 51/51 contract GREEN; 39/39 C9/C10 GREEN; 12/12 lifecycle GREEN; 2 pre-existing REDs A/B-identical |
| 2 | Host -> webview / Elm ownership (React purity) | **CONSERVED** | authority file byte-identical; upstream React delta additive; 5/5 + 2/2 + 1/1 purity witnesses GREEN |
| 3 | Model / provider request (MiniMax M3.1 wire) | **CONSERVED** | routing authority byte-identical; native guard retained and upstream adaptation composed; 6 MiniMax witness files GREEN (8/4/3/6/7/9) + 163/163 provider-options/reasoning/catalog |
| 4 | Cross-boundary conservation (compaction, editor, pending-prompt, trace, hub) | **CONSERVED** | 116/116 compaction; 31/31 edit-trace; 15/15 pending-prompt; 15/15 hub; realpath RED exactly 3/4; hub filter byte-identical to upstream and 4/4+2/2 discriminator GREEN |

**OBSERVED_REGRESSION: NONE.**
**UNOBSERVABLE:** the installed-VSIX dogfood UI, a live MiniMax/Strata provider
turn, and a live Hub CLI end-to-end — none of which this ACT owns (see §UNOBSERVABLE).
**NOT_APPLICABLE:** upstream's cloud-session / cloud-task UI features and the
upstream `onRelinquishControl` removal, which have no fork authority to conserve.

### UNOBSERVABLE in this environment (explicitly NOT claimed)

| Item | Status | Why | Owner |
|---|---|---|---|
| Installed-VSIX dogfood UI qualification | **LIVE_UNOBSERVABLE** | the VSIX was built and packaged but **NOT installed**; no installed VS Code build is driven here | U04 |
| Live model-provider turn (real MiniMax / Strata credential) | **NOT_EXECUTED** | no provider credential is configured in this environment; all MiniMax results are **offline wire/catalog** witnesses | U04 |
| CLI end-to-end against a live hub daemon | **NOT_EXECUTED** | requires a live `@cline/cline-hub` daemon + credentials; the CLI **JSON event** surface was qualified offline (67/67 GREEN) | U04 / A01 |
| Hub cross-client attach / reconnect (live) | **NOT_EXECUTED** | the offline cross-client witness (`runtime-event-adapter`) is GREEN; a live hub attach is not observable here | U04 |

**An unexecuted live gate is never a structural failure and is never a PASS.**
None of the above was counted as passing.

| `core: hub-capability-tool-executors.test.ts` | **10/10 GREEN** | upstream's own filter witness |
| `core: hub-event-log / ui-events / replay-wire / hub-plugins` | **15/15 GREEN** (writable `CLINE_DIR`) | hub server |
| `core: runtime-event-adapter.e2f-f0-witnesses.test.ts` | **10/10 GREEN** | cross-client runtime events |
| `core: model-behavior-trace.test.ts` + `session-runtime.model-behavior-trace.test.ts` | **17/17 GREEN** | model-behaviour trace (core) |
| `core: hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts` | **4/4 GREEN** | the C2 cardinality discriminator |
| `vscode: test:vitest:c2-4-d-hub` | **2 files / 15 GREEN** | VS Code hub suite |
| `vscode: background-completion-barrier01.bcb01` + corrections 01–04 | **38/38 GREEN** | BCB automatic continuation |
| `vscode: post-terminal-working-cancel-correction01.ptwcr01c01` | **10/10 GREEN** | stale "Resume Task" not exposed |
| `vscode: test:vitest:b2po01` | **2 files / 9 GREEN** | the premature-Resume-Task witness |
| `vscode: sdk-task-control-coordinator.test.ts` | **24/24 GREEN** | task switch / clearTask fence |
| `vscode: auto-approve-overlay-regression.test.ts` | **3/3 GREEN** | settings overlay |
| `vscode: session-auto-approval.controller.test.ts` | **10/10 GREEN** | task-specific approval settings |

| `agent-runtime.model-behavior-trace.test.ts` | **9/9** | model-behaviour trace |
| `agent-runtime.minimax-reasoning-trace01.test.ts` | **4/4** | MiniMax reasoning trace |
| `agent-runtime.hub-trace-cardinality-discriminator...test.ts` | **2/2** | hub trace cardinality (agents) |

**All six MiniMax witness files and `minimax-thinking.ts` are byte-identical to
the fork baseline**, so these results are directly comparable to the accepted
receipts.  The `portable-reasoning.ts` file DOES differ from the fork (it
carries the R3 upstream adaptation) — and it is GREEN in the merged tree.
