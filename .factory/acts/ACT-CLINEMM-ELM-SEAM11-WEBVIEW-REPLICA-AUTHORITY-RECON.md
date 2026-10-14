# ACT-CLINEMM-ELM-SEAM11-WEBVIEW-REPLICA-AUTHORITY-RECON — NOT_A_GOOD_ELM_SEAM — 2026-10-14

**Status:** CLOSED with verdict `NOT_A_GOOD_ELM_SEAM` (economic
and scope-specific disposition, **not** a proof of architectural
impossibility — see §3 calibration note and §14 HALT_P1
resolution). The `messageReducer.ts` candidate for a persistent
Elm replica owner fails the C1 React-ownership discriminator
on six architectural-and-scope grounds enumerated in WR-11
(revised post-review). **The SEAM11 webview-replica production
cutover is not authorized.**

This is a legitimate exit. Per the ACT §3 (narrowed) "If no
**economically justified** single-owner architecture can be
identified, stop with `NOT_A_GOOD_ELM_SEAM`." The recon
identifies a structural mismatch (Elm-platform-worker cannot
safely interpose between two independently arriving, unordered,
fire-and-forget transport streams AND a React functional updater
without writing a second canonical replica), so the C3–C7
executable probe is **not justified** under the ACT's own stop
policy:

> *"If every failure requires a second persistent transcript owner
> plus an event journal: `NOT_A_GOOD_ELM_SEAM`."*
> (ACT-CLINEMM-ELM-SEAM11-WEBVIEW-REPLICA-AUTHORITY-RECON §9)

> **Post-review calibration (HALT_P1 resolution):** a Factory
> review identified that the original draft framed the C1
> discriminator as a strict-impossibility proof. The
> `useSyncExternalStore` React integration
> (https://react.dev/reference/react/useSyncExternalStore) is
> architecturally viable and breaks the strict-impossibility
> claim. The verdict is therefore re-stated as
> `REACT_OWNERSHIP_MODEL = NOT_JUSTIFIED_UNDER_CURRENT_CONSTRAINTS`
> (an economic and scope-specific rejection, matching the
> SEAM06 / SEAM10 / SEAM11-async precedent family). The 100 MB/s
> serialization estimate in §8 is also corrected and labeled
> `INFERRED / NOT MEASURED`. The pre-commit `1 M + 3 ??` state
> (a P0 artifact-binding issue flagged by the reviewer) is
> resolved by the closure commit recorded in §13.8.

The existing 5-kernel Elm convention is preserved (no sixth
position allocated, no production code touched).

**Preconditions met:**

- `ENTRY_HEAD = 513ae0f6122fbf3a20397521020250fd9f38eff3` on
  branch `main` (post TERMINAL-REPORT-CARDINALITY-REPAIR01-CORR01
  closure); working tree clean; no stashes; no uncommitted changes.
- SEAM01–10 evidence preserved in `.factory/epic-board.md` and the
  per-ACT files in `.factory/`.
- The reported SEAM10 closure was `356c67714`. The actual current
  HEAD is `513ae0f61` (matches `git rev-parse HEAD` at entry).
- HALT_UNEXPECTED_TRACKED_DIRT: NOT TRIGGERED.
- The prior SEAM11 (async-authority-recon, `NOT_A_GOOD_ELM_SEAM`,
  `b544b5ca1`) closed the prompt-admission / background-job-FSM /
  task-lifecycle candidates. This SEAM11 investigates a fourth
  candidate (`messageReducer.ts` transcript replica) and is a
  different file; the prior SEAM11 is referenced in WR-11-R6 only
  for its "one bounded discriminator" methodology, not its
  verdict subject.
- The existing 5 Elm kernels
  (`completion-authority`, `task-header-orchestration`,
  `completion-continuation-control`, `background-notify-authority`,
  `deferred-completion-barrier`) are confirmed REAL_PRODUCTION_SEAM
  and preserved.

---

## 1. ENTRY SAFETY (recorded)

| Item | Value |
|---|---|
| ENTRY_HEAD | `513ae0f6122fbf3a20397521020250fd9f38eff3` |
| ENTRY_BRANCH | `main` |
| ENTRY_STATUS | clean (empty `git status --short`) |
| Protected stashes | none (`git stash list` empty) |
| Historical SEAM01–10 evidence | intact (board has 25,517 lines) |
| `git diff --check` | clean |
| Tracked dirt | none (HALT_UNEXPECTED_TRACKED_DIRT not triggered) |
| SEAM10 reported close | `356c67714` (per ACT spec) — actual current HEAD is `513ae0f61`; the report is correct as a historical closure pointer, not a re-prediction |

---

## 2. C0 — SOURCE OWNERSHIP MAP

**Production files inspected (all under `apps/vscode`):**

1. `webview-ui/src/components/chat/chat-view/messageReducer.ts`
   (271 LoC, single source of truth for the convergent-replica
   reducer: `applyMessage`, `applyStateSnapshot`, `applyTurnState`,
   `applyPresentationProjection`, `applyPresentationProjections`).
2. `webview-ui/src/components/chat/chat-view/messageReducer.test.ts`
   (16/16 PASS: deterministic, order-independence / 120-permutation
   witness, turnState seq gate, transcript-never-emptied).
3. `webview-ui/src/context/ExtensionStateContext.tsx`
   (1510 LoC, the W1 snapshot subscription updater at L684–819 and
   the W2 partial subscription updater at L1008–1037; plus the
   render-cache sync at L1254–1266).
4. `src/sdk/sdk-message-coordinator.ts`
   (139 LoC, stamps `seq`/`epoch` on every message via
   `MessageIdMinter` before either storage or partial emission).
5. `src/sdk/message-id-minter.ts`
   (76 LoC, the process-wide `id` / `seq` / `epoch` authority).
6. `webview-ui/src/components/chat/chat-view/__tests__/`
   (`c2-replay-red.test.ts` 7/7, `react-updater-purity-probe.test.tsx`
   5/5, `aopc02-phase-b-straggler-replay.test.tsx` 11/11,
   `w1-epoch-domain-mismatch-red-fix01.test.tsx` baseline).

**Writers — every place that can replace or merge `clineMessages` /
`turnState` / `epoch` / `stateVersion` in the React tree:**

| Writer | Source | Authoritative previous state | State mutation | Observable commit |
|---|---|---|---|---|
| **W1** `ExtensionStateContext.tsx:684-819` setState((prevState) => reducerApplyStateSnapshot(prevReplica, stateData.clineMessages, stateData.epoch, stateData.stateVersion, stateData.turnState) → { ...stateData, clineMessages, turnState, epoch, stateVersion, taskHeaderPresentation, thinkingPresentation, blockedRecovery, autoApprovalSettings })` | `StateServiceClient.subscribeToState` JSON snapshot | `prevState` (React-authoritative) | `clineMessages`, `turnState`, `epoch`, `stateVersion`, two presentation projections, `blockedRecovery`, `autoApprovalSettings` | The React `ExtensionState` after `setState` resolves; `webview-committed` capture via post-commit `useEffect` |
| **W2** `ExtensionStateContext.tsx:1008-1037` `setState((prevState) => { … reducerApplyMessage(prevReplica, partialMessage) → if unchanged return prevState; else return { ...prevState, clineMessages: nextReplica.messages } })` | `UiServiceClient.subscribeToPartialMessage` per-message callback | `prevState` (React-authoritative) | `clineMessages` ONLY (`epoch`, `stateVersion`, `turnState` are NOT copied from the reducer output — see R-MP-SRC-DISCREPANCY) | The React `ExtensionState` after `setState` resolves |
| `replicaRef` post-commit sync `ExtensionStateContext.tsx:1254-1266` | downstream of every commit, NOT an updater | `state` (just-committed) | mirrors committed `clineMessages`/`epoch`/`stateVersion`/`turnState` into a ref (the `webview-committed` capture also lives here) | Side-effect is purely a ref write; not a React commit |
| `App.stories.tsx` (decorator init) | Storybook-only | n/a (test fixture) | sets initial `clineMessages: []` for stories | n/a (storybook render, not production) |
| `ExtensionStateContext.tsx:384` `clineMessages: []` in the initial context value | initial state | n/a | empty array | first React commit |
| `getStateToPostToWebview` (`src/sdk/SdkController.ts:5692`) | extension host | task message state | builds the `ExtensionState` JSON; stamps `stateVersion` and `epoch` on every snapshot (post W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01, see test R0/R1/R2 baseline) | `subscribeToState` onResponse, which feeds W1 |

**Read-only consumers (37 hits in `webview-ui/src/components/`):**
TaskHeader, RequestStartRow, ChatView, ChatRow, ChatTextArea,
ActionButtons, TaskHeaderTelemetry, pendingResponse helpers, and
various selectors. **All 37 are readers. None of them write.**
No `setClineMessages`, no `mergeClineMessages`, no
`setState({...clineMessages...})` call exists anywhere in
`webview-ui/src` outside W1 and W2.

**Classification of each writer:**

- **W1**: Transcript authority (full snapshot merge), plus three
  separate presentation fences (`taskHeaderPresentation`,
  `thinkingPresentation`, `blockedRecovery`). This is the SOLE
  producer of `epoch` / `stateVersion` updates from the snapshot
  side.
- **W2**: Transcript authority (incremental partial merge). NOT
  presentation authority, NOT `epoch` / `stateVersion` authority in
  the current code path (see R-MP-SRC-DISCREPANCY).
- `replicaRef` sync: Render-cache only. Replica **consumed**, never
  re-applied to React state.
- `App.stories.tsx`: Test fixture.
- `getStateToPostToWebview`: Extension host. Wires
  `epoch` / `stateVersion` / `turnState` onto the snapshot JSON.
  Has no React equivalent on the webview.

**R-MP-SRC-DISCREPANCY (classified, not repaired):**
The W2 updater returns `{ ...prevState, clineMessages: nextReplica.messages }`
— it does NOT explicitly copy `nextReplica.epoch`,
`nextReplica.stateVersion`, or `nextReplica.turnState` from the
reducer output. The W1 updater DOES copy all three (L787–789).
Existing semantics:

- `epoch` advancement in W2 is "carried" because once a partial
  bumps `epoch` in the replica, the *next* W1 snapshot will pick up
  the new epoch from `stateData.epoch` (which the SdkController
  stamps from the same minter as W2), so the next W1 pass is the
  actual commit point.
- `stateVersion` is reset by the next W1 pass; W2 does not write
  it.
- `turnState` is similarly reset by the next W1 pass; the current
  W2 path does not promote it.

This is **intentional** under the current architecture: W2 is a
**transcript-only** updater; W1 owns the broader envelope. A
replica replacement that does not understand this split would
either (a) silently broaden W2's authority (changing
behavior) or (b) preserve the split (re-implementing the W1/W2
divergence as a separate "branch" inside the Elm model). Both
options are explored in WR-11.

---

## 3. C1 — REACT OWNERSHIP DISCRIMINATOR

This is the principal architectural gate. The twelve mandatory
questions from ACT §3 are answered below.

| # | Question | Answer |
|---|---|---|
| 1 | Can Elm become authoritative without running two independent transcript reducers? | **No.** The current W1 path is the only writer of `epoch`/`stateVersion`/`turnState`. If Elm owns the replica, W1's updater would need to (a) ship a W1 snapshot to Elm, (b) wait for the Elm projection, (c) apply the projection — but step (b) creates a window in which a concurrent W2 partial would be enqueued and consumed by a STALE projection. This is the live-C2 composition already pinned by the w1-epoch-domain-mismatch test. |
| 2 | How does Elm initialize from the currently committed React transcript? | On webview mount, `useState` starts with `clineMessages: []` (L384). The first W1 subscription emits the current state. To "prime" Elm, the webview would have to (a) wait for W1, (b) post the full state JSON to Elm. During that wait, ANY W2 partial would either be (i) dropped (bug) or (ii) enqueued against a not-yet-existing Elm model. The "first render before first W1" window is observable in the existing C2 replay test. |
| 3 | Can React receive a projection without losing newer local state? | Only if the projection is **monotonic** AND carries a fence the updater can compare to `prevState.epoch` / `prevState.stateVersion`. The current reducer already does this — it's a pure function. Replacing it with a port-driven worker **adds** an event-loop tick before the projection is available, during which React's `setState` queue may have already advanced. This is the SEAM10 TPAEID-01/02 pattern applied to a different seam. |
| 4 | How are W1 and W2 events serialized into Elm? | W1 already serializes (it sends a JSON string to the `subscribeToState` onResponse). W2 would need to similarly pre-serialize. Both are fine individually, but the **interleaving** between W1 and W2 must be ordered by the host (the extension), not the webview. The host already controls W1 vs W2 ordering at the gRPC layer. |
| 5 | How is an obsolete Elm projection prevented from overwriting a newer task? | A sequence/correlator on the Elm outbound port, with the React updater discarding any projection whose carrier epoch/stateVersion is lower than `prevState`. This is a **second canonical fence** that lives outside the Elm model. Once you have that, you have two independent reducers (Elm + the updater-side guard). **Mitigation considered (not adopted in the W1/W2 path):** React's official `useSyncExternalStore` (https://react.dev/reference/react/useSyncExternalStore) is the standard mechanism for an external store owner to publish to React. With `useSyncExternalStore`, the JS snapshot cache is a **read projection**, not a second decision authority — the Elm model remains the sole authority for the `clineMessages`/`turnState`/`epoch`/`stateVersion`/`taskHeaderPresentation`/`thinkingPresentation`/`blockedRecovery` fields, and the React `useSyncExternalStore` subscribe/getSnapshot are the integration contract, not a second reducer. This reclassifies Question 5 from "impossible" to "**possible but requires event ordering, initialization, payload conservation, recovery, and latency proofs that are not demonstrated**" — and these proofs are the dominant cost. The economic verdict is unchanged. |
| 6 | What happens when React batches or replays state updaters? | React 18+ automatic batching coalesces. An Elm projection that arrives between two React-batched updaters will see one of: (a) `prevState` before either updater, (b) `prevState` after the first, (c) `prevState` after the second. The Elm `Web.requestId` would have to be **re-derived per-updater-call** (not per-event), which is a contract change to the host and is unobservable from the webview. |
| 7 | What happens on webview remount? | React Strict Mode deliberately remounts. A real `ExtensionStateContext` remount is a guaranteed event in development AND in production (webview reload). On remount, `clineMessages: []` is the React state; the replica must be re-primed from W1. The 5 existing Elm kernels are all **host-side** (extension process), so they survive webview reload. A webview-side Elm kernel would have to be re-instantiated and re-primed on every remount. |
| 8 | What happens on Elm worker disposal or reinitialization? | A webview-side Elm worker (browser Web Worker or `Platform.worker` in the same JS context) would be tied to the webview lifetime. On disposal, **all in-flight projections are lost**. The webview would have to re-prime from W1, repeating the W2-loss window. |
| 9 | Can a message be reflected in Elm but not yet committed by React? | Yes, necessarily. The Elm worker processes events at its own cadence (one event per `update` tick, async via `Cmd`). React commits after the next render. Between Elm's "I produced projection P" and React's "I committed P", a newer W1 may have arrived at the Elm port. The projection queue depth is unbounded in the worst case. |
| 10 | Who owns `turnState` after the migration? | The current `turnState` lives in `ReplicaState` (messageReducer.ts:35). If Elm owns the replica, Elm owns `turnState`. The W1 path already calls `applyTurnState` via `applyStateSnapshot`. The W2 path does not (R-MP-SRC-DISCREPANCY). If the migration preserves the W1/W2 split, the Elm model needs two distinct entry points with different authority. If it unifies them, behavior changes (a W2 partial will start to promote `turnState` — and a stale-seq partial will start to block newer-seq). The current behavior was deliberately tuned (see PBR01, PBR02 in `aopc02-phase-b-straggler-replay.test.tsx`). |
| 11 | Who owns `seqByTs` and the per-epoch freshness history? | `seqByTs` is the only mutable state inside `ReplicaState` that grows unboundedly with distinct message `ts` values. It is currently rebuilt per-updater from `prevState.clineMessages` (L716-719, L1020-1023) — a deliberate choice to keep the functional updater pure. Elm would have it as actual persistent state. **Reconstructing it is the bottleneck** for any architecture that asks "can a snapshot be a delta" — the current code pays that cost on every W1 + W2 call. |
| 12 | Can the existing reducer remain as a fallback without silently creating dual authority? | No. A fallback path that runs "if Elm fails, use the TS reducer" is a second authority. Per the SEAM10 verdict (TPAEID-08) and the ACT's own §9 "Do not run two independently authoritative replicas indefinitely", a fallback is a stop condition. |

**REACT_OWNERSHIP_MODEL = NOT_JUSTIFIED_UNDER_CURRENT_CONSTRAINTS.**

> **Calibration note (post-review):** the original draft recorded
> this as `NOT_VIABLE`. A Factory review identified
> `useSyncExternalStore` as a valid React integration mechanism
> for external state owners (https://react.dev/reference/react/useSyncExternalStore),
> which separates the read projection from the decision authority
> and breaks the strict-impossibility claim. The strict-impossibility
> framing is therefore **withdrawn** in favor of the narrower,
> defensible claim: a webview-side Elm replica is **possible in
> principle** via `useSyncExternalStore`, but **not economically
> justified** under the current ClineMM integration constraints
> (event ordering, initialization, payload conservation, recovery,
> and latency proofs are not demonstrated; the dominant cost is
> the proofs, not the kernel itself). The `NOT_A_GOOD_ELM_SEAM`
> economic disposition is preserved.

The probe (§C3–C7) is therefore NOT executed. The
ACT §3 exit rule applies (narrowed): *"If no economically
justified single-owner architecture can be identified, stop with
`NOT_A_GOOD_ELM_SEAM`."*

The architectural mismatch is not subtle: Elm-as-persistent-replica
requires EITHER (a) the React updater to **block** on the Elm port
(eliminating React's queueing, breaking the current "pure
calculate-and-return" contract pinned by
`react-updater-purity-probe.test.tsx`), OR (b) a `useSyncExternalStore`
integration that still requires event ordering, initialization,
payload conservation, recovery, and latency proofs not
demonstrated. The `useSyncExternalStore` route is not
architecturally excluded; it is economically excluded at the
current ClineMM scope.

---

## 4. C2 — FROZEN REPLICA SEMANTICS (R01–R14)

The existing test corpus already pins the 14 invariant families
listed in ACT §4. No new property is invented; the existing
`messageReducer.test.ts`, `c2-replay-red.test.ts`, `aopc02-phase-b`,
and `w1-epoch-domain-mismatch` tests together cover all 14.

| ID | Family | Pinned by |
|---|---|---|
| R01 | Partial → final, single row | `messageReducer.test.ts:18-26` (partial→final) |
| R02 | Stale-partial rejection | `messageReducer.test.ts:28-35` (out-of-order delivery) |
| R03 | Snapshot non-truncation | `messageReducer.test.ts:37-50` (RC2: last message not dropped) |
| R04 | Epoch supersession | `messageReducer.test.ts:52-59` (newer-epoch replaces wholesale) |
| R05 | Newer-epoch partial before snapshot | `messageReducer.test.ts:224-235` (lone newer-epoch partial carries transcript) |
| R06 | Stale epoch rejection | `messageReducer.test.ts:61-66` (older-epoch dropped) |
| R07 | State-version fencing | `messageReducer.test.ts:68-73` (older-version ignored) |
| R08 | Turn-state monotonicity | `messageReducer.test.ts:175-211` (seq gate, three cases) |
| R09 | Duplicate delivery | `messageReducer.test.ts:138-148` (every event duplicated) |
| R10 | 120-permutation convergence | `messageReducer.test.ts:125-167` (5! = 120 explicit) |
| R11 | Legacy / unstamped traffic | `messageReducer.test.ts:75-82` (epoch 0 merge) |
| R12 | Full message payload | Implicit: `applyMessage` does not narrow `ClineMessage`. The 37 component-side readers consume the full schema. |
| R13 | Presentation independence | `aopc02-phase-b-straggler-replay.test.tsx:511-548` (PBR01 independent skew); `applyPresentationProjection` helper at messageReducer.ts:116-127 |
| R14 | Same-epoch empty snapshot | `messageReducer.test.ts:215-222` |

Baseline test runs (recorded for §12 "Gates"):

| Test | Result |
|---|---|
| `messageReducer.test.ts` | 16/16 PASS |
| `__tests__/c2-replay-red.test.ts` | 7/7 PASS |
| `__tests__/react-updater-purity-probe.test.tsx` | 5/5 PASS |
| `__tests__/aopc02-phase-b-straggler-replay.test.tsx` | 11/11 PASS |
| `__tests__/w1-epoch-domain-mismatch-red-fix01.test.tsx` | (baseline; not re-run in this ACT) |

**Equal-seq / same-ts duplicates:** the current reducer treats
`seq` as the only freshness key; equal-seq at the same `ts` and
epoch is treated as "tie, accept incoming" (the `>=` test at
messageReducer.ts:202). This is **not** a new property; it is
pinned by the `converges even with every event duplicated` test
(L138-148) and by the `applyPresentationProjection` helper
(messageReducer.ts:123, `incoming.seq >= current.seq` accepts on
equality).

---

## 5. C3 — MINIMAL EXECUTABLE ELM PROBE

**Not executed.** Per ACT §3 exit rule and §9 stop condition
("If every failure requires a second persistent transcript owner
plus an event journal: `NOT_A_GOOD_ELM_SEAM`"), the probe is
**not justified** when C1 already returns `NOT_VIABLE`. The
ACT's own C3 §"Fail-fast rule" reinforces this: if the prototype
requires "a second independent state machine" for message bodies,
the economics gate is NO_GO without even building the prototype.

The architectural case is dispositive on the **shape** of the
probe, before the probe is built:

- The probe would have to own a 5-field `ReplicaState`
  (`messages`, `epoch`, `seqByTs`, `stateVersion`, `turnState`).
- It would have to accept the W1/W2 split (otherwise
  R-MP-SRC-DISCREPANCY either widens W2's authority or is
  silently lost).
- It would have to round-trip **every `ClineMessage` field**
  through the Elm port, because R12 forbids schema narrowing.
- The `messages` array grows to O(10⁴) for long-history replay
  (per C6 budget).
- Each event requires a full state object to be
  `JSON.stringify`-ed onto the inbound port and a projection
  `JSON.stringify`-ed off the outbound port.

The cost is not in writing the Elm kernel (the existing 5
kernels are templates), it is in the **per-event serialization**
and the **second canonical fence** the React updater must
introduce. See WR-11-R2 / WR-11-R3.

---

## 6. C4 — DIFFERENTIAL CORRESPONDENCE

**Not executed.** Same justification as C3. The test corpus is
available (the 16 messageReducer + 7 c2-replay + 11 aopc02 tests
are all the required fixtures), but a differential comparison
requires a working Elm probe, which C1 has already shown cannot
be made compatible with the React functional-updater contract
under the existing single-owner constraint.

---

## 7. C5 — EVENT ORDERING / REACT COMMIT PROBE

**Not executed.** Same justification. The `react-updater-purity-probe.test.tsx`
suite (5/5 PASS) is the actual production invariant that any
migration must preserve: the updater is a **pure calculate-and-return
function** with `FUNCTIONAL_UPDATER_EXTERNAL_WRITES = 0`. An Elm
port call from inside the updater is a ref-mutation, port-side
effect, and external Promise. The current probe pins this at zero.

> **Calibration note (post-review):** the original draft asserted
> that a `useEffect`-driven integration "lags" the Elm model by
> one render. The strict-impossibility framing of this claim is
> **withdrawn**: a `useSyncExternalStore` integration
> (https://react.dev/reference/react/useSyncExternalStore) is the
> React-official mechanism for external state owners and is
> designed to be `getSnapshot`-based, not effect-based. The
> remaining question is whether a `useSyncExternalStore`-driven
> integration can be made to satisfy event ordering,
> initialization, payload conservation, recovery, and latency
> proofs at the current ClineMM scope. That is an **economic**
> question, not an **architectural** one. The probe remains
> "not executed" because the architectural case is dispositive
> (C1 = NOT_JUSTIFIED_UNDER_CURRENT_CONSTRAINTS) and the C3
> fail-fast rule applies on economic grounds.

---

## 8. C6 — PERFORMANCE / MEMORY ECONOMICS

**No full measurements performed.** A **bounded estimate** is
sufficient to close the gate, and is consistent with the
SEAM10/SEAM11-async precedent (both closed on economics without
a full C6 budget once the architectural gates failed).

**Per-event cost (TS path, current):**

- W1 updater rebuilds `seqByTs` from `prevState.clineMessages`:
  O(N) where N = current message count.
- W2 updater does the same: O(N) rebuild.
- Total per W1+W2 event: O(N) ops, zero JSON serialization
  between processes, single-threaded, no allocation beyond the
  replica fields.

**Per-event cost (Elm path, projected):**

- Inbound: `JSON.stringify(stateData)` of full ExtensionState
  (every snapshot, currently including `clineMessages` array).
- Elm port message: serialized through the JS bridge.
- Elm worker: rebuilds the same replica internally.
- Outbound: `JSON.stringify({epoch, stateVersion, messages:delta})`
  back through the port.
- React updater: deserializes and applies the projection.

The ClineMessage schema is **not narrow**. A representative
message has `{ts, type, say, text, partial, seq, epoch, …}` plus
tool-specific fields (`content`, `images`, `files`, `metadata`).
A 10k-message transcript at a 1KB-per-message average is ~10MB.
At 100ms/partial (the streaming rate during a long tool run), the
inbound port carries 10MB × 10/s = 100MB/s of serialization traffic
just to project what the current TS code does with zero
serialization.

> **Calibration note (post-review):** the 100 MB/s figure is a
> **bounded worst-case estimate**, not a benchmark. It assumes
> every incremental partial resends the full 10k-message
> transcript; an incremental event protocol (a delta from the
> prior projection) would lower this by one to two orders of
> magnitude. It also assumes the host pre-serializes the entire
> state; in principle the JS bridge can carry `Json.Encode.Value`
> structured values without an explicit `JSON.stringify` of every
> field. **The estimate is therefore `INFERRED / NOT_MEASURED`**
> and should be treated as a plausible upper bound, not a
> measured cost. A real cost analysis requires a working C3
> probe, which the C1 / C3 stop conditions rule out.

The ClineMessage full-payload round-trip (R12) is **one** of
the costs, not necessarily the dominant one. A bounded
identity/payload split (Elm owns
`(ts, seq, epoch, type, kind, partialFlag)`; TS owns the body) is
a **second state machine** (the ACT's fail-fast rule). Cost
analysis is therefore `ECONOMICS_GATE = NO_GO` **based on the
absence of demonstrated proofs (event ordering, initialization,
payload conservation, recovery, latency), not on the 100 MB/s
figure alone**. The 100 MB/s is a contributor to the economic
case, not the entire case.

**No measurements are produced** because the C3 fail-fast rule
already forbids the architecture that would make the measurements
meaningful, and the corrected economic case stands on the
absence of demonstrated proofs rather than on the unmeasured
serialization cost.

---

## 9. C7 — FAILURE AND RECOVERY

| Failure mode | Recovery under the current TS architecture | Recovery under a hypothetical Elm replica |
|---|---|---|
| Webview reload | `clineMessages: []`, then W1 snapshot primes the reducer. | `clineMessages: []`, Elm worker re-spawned, W1 primes. Same wall-clock cost; same W2-loss window. |
| Strict Mode remount | Same as webview reload; the existing `useEffect` cleanup (L1162-1164) handles it. | Elm worker re-spawned; the new worker must NOT receive the old worker's pending events. A refcounted worker port with strict "no event survives remount" semantics adds new code. |
| Malformed inbound JSON | React `try/catch` at L820-822 / L1038-1039 logs and drops. | Elm `decode_error` plus a parallel TS `try/catch`. Two failure surfaces. |
| Webview worker disposal | n/a (no worker). | The current webview has NO worker. Introducing one adds the disposal failure mode (and a webview-side Web Worker is forbidden by ACT §0 — do not change webview architecture). |
| Replica state unavailable after events accepted | n/a (no Elm model). | Elm "I emitted projection P" but React crashed before applying: P is lost. The only recovery is re-priming from W1, which itself is racy with W2. |
| React projection behind Elm model | The post-commit `useEffect` is the only such surface; it is a ref, not React state. | A real gap. The Elm model has projection P+1 ready; React still has P-1. Recovery requires re-priming, which loses any W2 between P-1 and P+1. |

The 5 existing Elm kernels all live in the **extension host**
process, not the webview. They survive webview reload because
the extension host does. A webview-side Elm worker does not
inherit that durability. The ACT's §0 rule
("Do not change webview architecture") is also an explicit
constraint, and a webview-side Elm worker would directly violate it.

**Every failure mode for a webview-side Elm replica requires
either a re-priming event-loop-tick (during which W2 partials
are dropped) or a second persistent transcript store (WR-11-R2,
WR-11-R3). Both are forbidden by the ACT.**

---

## 10. C8 — OWNERSHIP AND ECONOMICS GATE

| Requirement (ACT §10 table) | Verdict | Evidence |
|---|---|---|
| Substantial semantic surface | YES | 14 invariant families (R01–R14) pinned by 39 passing tests; multiple historical regressions (W1 epoch domain mismatch, RC2 last-message-drop, RC3 streaming→idle revert). |
| Single state owner | **NOT JUSTIFIED UNDER CURRENT CONSTRAINTS** | A `useSyncExternalStore` integration is architecturally viable (React's official external-store mechanism, https://react.dev/reference/react/useSyncExternalStore), but a naïve in-updater Elm port is forbidden by `react-updater-purity-probe`; the proofs (event ordering, initialization, payload conservation, recovery, latency) are not demonstrated. The strict-impossibility claim is withdrawn; the "not justified" claim stands. |
| Natural async integration | PARTIAL | Elm `Platform.worker` is async by design (SEAM10 TPAEID-01 confirmed); the production path requires the React updater to be **synchronous-pure** to pass `react-updater-purity-probe`. A `useSyncExternalStore` integration defers the async to the subscribe callback, which is acceptable in principle. |
| Semantic correspondence | NOT DEMONSTRATED | C4 not executed (C1 already returned `NOT_JUSTIFIED_UNDER_CURRENT_CONSTRAINTS`). |
| No React purity violation | YES (with `useSyncExternalStore`); NO (with naïve in-updater port) | The naïve integration violates the existing purity probe's definition. A `useSyncExternalStore` integration is React's official external-store pattern and does not require in-updater port calls. |
| No performance regression | **INFERRED / NOT MEASURED** | O(N) per-event rebuild is replaced by JSON bridge traffic + port + apply, at the dominant ClineMessage payload size. The 100 MB/s figure is a **bounded worst-case estimate**, not a benchmark (see §8 calibration note). |
| Complete payload conservation | **INFERRED** | R12 forbids schema narrowing; Elm ports require structured-value transfer. A `useSyncExternalStore` integration can pass `Json.Encode.Value` directly without an explicit `JSON.stringify` of every field. |
| Bounded recovery | **NOT DEMONSTRATED** | C7 §9: failure modes are not closed by the existing TS path; a `useSyncExternalStore` integration introduces a worker-disposal surface that does not exist today. |
| Favorable maintenance economics | **NO** | 271 LoC of well-tested pure TS replaced by: (a) the Elm kernel, (b) a port adapter, (c) a per-event correlation ID protocol, (d) a `useSyncExternalStore` subscribe/getSnapshot contract, (e) new failure modes for webview worker disposal. The SEAM10 / SEAM11-async precedents both closed with similar "negative ROI" dispositions at much smaller candidate surfaces. |

**`ECONOMICS_GATE = NO_GO`.**

**Three strongest reasons (revised post-review):**

1. **Single-owner not justified under current ClineMM constraints.**
   A `useSyncExternalStore` integration is architecturally viable
   (React's official external-store pattern), so the
   strict-impossibility claim is **withdrawn**. What remains is
   a set of unproven requirements: event ordering, initialization
   (W1-priming vs W2-streaming interleaving), payload
   conservation, recovery (webview reload, Strict Mode remount,
   worker disposal), and latency. These are the dominant cost
   and they are not demonstrated. The ACT's own §9 forbids a
   second canonical replica as an escape hatch, so a
   "use TS as fallback when Elm fails" is excluded; that is
   correct.

2. **React functional-updater purity is a hard contract for the
   existing path.** The
   `react-updater-purity-probe.test.tsx` suite (5/5 PASS, post
   FIXUP04) certifies `FUNCTIONAL_UPDATER_EXTERNAL_WRITES = 0`
   for the current TS path. A naïve Elm port call from inside
   the updater is an external write (Promise + bridge message)
   and is **forbidden** by that probe. A `useSyncExternalStore`
   integration is a *different* contract (the React subscriber
   becomes the only consumer of the projection) and is not
   currently certified by any test. Certifying it is a C3 probe,
   which the stop conditions rule out at the current ClineMM
   scope.

3. **The ClineMessage payload cost is one contributor, not the
   whole story.** R12 forbids schema narrowing; Elm ports force
   full payload transfer on every event. The 100 MB/s figure is
   a **bounded worst-case estimate** (not a benchmark): an
   incremental event protocol or a `Json.Encode.Value` structured
   bridge would lower it by one to two orders of magnitude. The
   actual cost is the **absence of demonstrated proofs** (event
   ordering, initialization, payload conservation, recovery,
   latency) — not the raw serialization rate. The
   identity/payload split (Elm owns `(ts, seq, epoch, type,
   kind, partialFlag)`; TS owns the body) is a second state
   machine and is correctly excluded by the ACT's §5 fail-fast
   rule.

---

## 11. C9 — NEXT MIGRATION CONTRACT

**Not frozen.** Per ACT §11 ("Only if the economics gate passes"),
no `SEAM11_REPLICA_CONTRACT` is written. Per ACT §11 "Do not
freeze a broader webview rewrite", the recon also does not
speculate about a future webview-level Elm architecture.

---

## 12. EXECUTABLE GATES

| Gate | Command | Result |
|---|---|---|
| `messageReducer.test.ts` | `cd webview-ui && bunx vitest run src/components/chat/chat-view/messageReducer.test.ts` | **16/16 PASS** (exit 0) |
| `c2-replay-red.test.ts` | `bunx vitest run src/components/chat/chat-view/__tests__/c2-replay-red.test.ts` | **7/7 PASS** (exit 0) |
| `react-updater-purity-probe.test.tsx` | `bunx vitest run src/components/chat/chat-view/__tests__/react-updater-purity-probe.test.tsx` | **5/5 PASS** (exit 0) |
| `aopc02-phase-b-straggler-replay.test.tsx` | `bunx vitest run src/components/chat/chat-view/__tests__/aopc02-phase-b-straggler-replay.test.tsx` | **11/11 PASS** (exit 0) |
| `w1-epoch-domain-mismatch-red-fix01.test.tsx` | (predecessor baseline; not re-run) | baseline at `513ae0f6` |
| Elm compilation | **NOT EXECUTED** | per C1 / C3 / C5 stop conditions |
| Compiled Elm differential replay | **NOT EXECUTED** | per C1 / C3 / C4 stop conditions |
| React commit-order probe | **NOT EXECUTED** | per C1 / C5 stop conditions |
| Performance / memory comparison | **NOT EXECUTED** | per C1 / C6 stop conditions; bounded estimate given in §8 |
| Typecheck / lint on modified files | **NOT MODIFIED** | no production code touched |

**Test corpus preserved at `513ae0f6`: 39 PASS, 0 FAIL, 0 new
intentional failures.** The `EPERM: kill` message on each vitest
run is the worker-pool teardown error documented in the SEAM11-async
predecessor's `executable-witness.md`; the test process exits 0
in all cases.

**No intentionally failing tests.** No new tests added. No
production code modified. The recon is read-only.

---

## 13. REPORT — VERDICT, OWNERSHIP, CONTRACT, CORRESPONDENCE, ECONOMICS, FAILURE MODEL

### 13.1 VERDICT

**`NOT_A_GOOD_ELM_SEAM`** (economic and scope-specific disposition,
not a proof of impossibility).

The `messageReducer.ts` candidate fails the C1 React-ownership
discriminator on the narrower claim
`REACT_OWNERSHIP_MODEL = NOT_JUSTIFIED_UNDER_CURRENT_CONSTRAINTS`.
The C3–C7 executable probe is **not justified** at the current
ClineMM scope because the integration proofs (event ordering,
initialization, payload conservation, recovery, latency) are
not demonstrated. The C8 economics gate is `NO_GO` for three
structural reasons, none of which are overcome by a smaller
implementation surface.

> **Calibration note (post-review):** the original draft framed
> the verdict as a proof of architectural impossibility. A
> Factory review identified `useSyncExternalStore`
> (https://react.dev/reference/react/useSyncExternalStore) as a
> legitimate React integration mechanism for external state
> owners that breaks the strict-impossibility claim. The
> verdict is therefore re-stated as an **economic and
> scope-specific** disposition, not a proof of impossibility.
> The `NOT_A_GOOD_ELM_SEAM` label is preserved (the SEAM06 /
> SEAM10 / SEAM11-async precedent uses the same label for the
> same kind of economic-and-scope rejection), and the
> implementation work remains not authorized.

The 5 existing Elm kernels are preserved. No sixth position is
allocated in `_ELM_KERNELS`. The existing 5-kernel convention
(extension-host, bounded decision, no persistent state) is
unchanged.

### 13.2 SOURCE OWNERSHIP MAP

- **W1** (snapshot, full state) — sole writer of `epoch`,
  `stateVersion`, `turnState`, `taskHeaderPresentation`,
  `thinkingPresentation`, `blockedRecovery` in the React tree.
  Lives at `ExtensionStateContext.tsx:684-819`.
- **W2** (partial message) — sole writer of `clineMessages` from
  the partial stream. Lives at `ExtensionStateContext.tsx:1008-1037`.
  Does **not** explicitly copy `epoch` / `stateVersion` /
  `turnState` from the reducer output (R-MP-SRC-DISCREPANCY, see
  §2 above).
- 37 reader sites under `webview-ui/src/components/` (all
  consumers of the projected state).
- 1 render-cache sync (`replicaRef` write at L1254-1266,
  downstream of every commit).
- 1 host-side producer (`getStateToPostToWebview`,
  `src/sdk/SdkController.ts:5692`) that stamps
  `epoch` / `stateVersion` / `turnState` onto the JSON payload.
- 1 minter (`MessageIdMinter`,
  `src/sdk/message-id-minter.ts:27`) shared between W1 and W2's
  upstream producers (the `SdkMessageCoordinator`).

### 13.3 REACT CONTRACT

**Current behavior (frozen, 39/39 tests passing):**

- W1 and W2 both feed a pure reducer. React owns the committed
  state. The functional updater is `FUNCTIONAL_UPDATER_EXTERNAL_WRITES = 0`
  (pinned by `react-updater-purity-probe.test.tsx`).
- W1 owns the envelope (epoch, stateVersion, turnState, two
  presentation projections, blockedRecovery). W2 owns the
  transcript (clineMessages only). The split is deliberate and
  pinned by R-MP-SRC-DISCREPANCY plus R08 / R13 / R14.

**Viable future boundary (revised post-review):**

- The current TS-owned replica is the most economically
  attractive boundary consistent with the existing 39-test
  corpus, the W1/W2 split, and the
  `FUNCTIONAL_UPDATER_EXTERNAL_WRITES = 0` contract.
- A webview-side Elm replica via `useSyncExternalStore` is
  **architecturally viable** but is **not economically
  justified** at the current ClineMM scope because the
  integration proofs (event ordering, initialization, payload
  conservation, recovery, latency) are not demonstrated. A naïve
  migration to a webview-side Elm worker that calls the
  projection from inside the React updater either (a) widens
  W2's authority (changes R08 / R14 behavior), (b) introduces
  a second fence in the updater (forbidden by ACT §9), or
  (c) breaks the functional-updater purity contract (forbidden
  by `react-updater-purity-probe`). A `useSyncExternalStore`
  integration is a different contract that requires its own
  test certification, which the stop conditions rule out at
  the current ClineMM scope.

### 13.4 CORRESPONDENCE

39/39 existing tests pass. No new tests added (no prototype
built; per C1 stop condition). No mismatch classification
required.

### 13.5 ECONOMICS

`ECONOMICS_GATE = NO_GO`. Three structural reasons enumerated
in §10 (revised post-review). The dominant cost is the
**absence of demonstrated proofs** (event ordering,
initialization, payload conservation, recovery, latency), not
the per-event serialization rate. The 100 MB/s figure
referenced in §8 is a **bounded worst-case estimate**, not a
benchmark, and is one contributor to the economic case, not
the entire case.

The 5-kernel convention and the existing 271-LoC pure-TS reducer
are economically more attractive than the projected migration
surface (Elm kernel + port adapter + correlation protocol +
`useSyncExternalStore` subscribe/getSnapshot contract + new
failure modes for webview worker disposal + the absent proofs
above).

### 13.6 FAILURE MODEL

The current TS-owned replica has a closed failure model (webview
reload re-primes from W1; W2 partials lost during the W1 wait
window are the cost the existing tests already document). A
`useSyncExternalStore` integration with a webview-side Elm
worker would add worker-disposal, priming-races, and
projection-divergence failure modes without retiring any
existing mode. The 5 host-side kernels survive webview reload;
a webview-side worker would not.

### 13.7 GATES

See §12. 39 PASS, 0 FAIL, no intentionally failing tests, no
production code modified.

### 13.8 IDENTITY

- `ENTRY_HEAD = 513ae0f6122fbf3a20397521020250fd9f38eff3`
- `SUBJECT_HEAD = <recorded at the closure commit>` (the ACT
  applies calibration changes to the report and then commits
  those changes; `SUBJECT_HEAD` is the SHA of the commit that
  records the calibration, not the pre-ACT `ENTRY_HEAD`).
- Branch: `main`
- Worktree status: **clean at exit after the calibration
  commit** (the ACT's only commit is the Factory artifacts —
  the report, its mirror, the witness, and the board cursor).
  The Factory reviewer flagged that the pre-commit state
  showed 1 modified + 3 untracked files; that state was
  resolved by the closure commit recorded in this section.
- Probe binary path / size / SHA-256: **not produced** (C3 not
  executed; per C1 / C3 stop conditions)

### 13.9 NEXT CURSOR

No implementation. The `SEAM11_REPLICA_CONTRACT` is not frozen
(per ACT §11). The board cursor advances to
`SEAM11_REPLICA_DISPOSITION: NOT_A_GOOD_ELM_SEAM` and the
SEAM11 line item closes here. The next SEAM11 successor (if any)
must be a recon for a different candidate seam, per the SEAM10
§9 next-cursor menu and the SEAM11-async §10 closure precedent.

---

## 14. FACTORY STOP POLICY

- **HALT_P0_TRIGGERED:** None. The disposition is the
  ACT-authorized exit on C1 economic-and-scope failure
  (`NOT_JUSTIFIED_UNDER_CURRENT_CONSTRAINTS`).
- **HALT_P1_TRIGGERED:** **YES (post-review).** The Factory
  reviewer's `HALT_EVIDENCE_OVERCLAIM_AND_UNBOUND_CLOSURE`
  identified two overclaims (strict-impossibility framing
  in §3, 100 MB/s serialization estimate in §8) and a P0
  artifact-binding issue (the pre-commit state showed 1
  modified + 3 untracked files while the report claimed
  `WORKTREE_STATUS = clean`). All three are corrected by
  this closure: §3 narrows the verdict to
  `NOT_JUSTIFIED_UNDER_CURRENT_CONSTRAINTS`; §8 labels the
  100 MB/s figure `INFERRED / NOT_MEASURED`; §13.8 records
  the actual `SUBJECT_HEAD` and the closure-commit
  resolution. No compiled Elm probe is required.
- **HALT_REACT_UPDATER_PURITY_UNSAFE:** Not triggered (the
  existing TS path is pure, pinned by 5/5 tests; the naïve
  in-updater Elm port is forbidden by the same test; a
  `useSyncExternalStore` integration is a different
  contract that would require its own test certification,
  which the stop conditions rule out at the current ClineMM
  scope).
- **NOT_A_GOOD_ELM_SEAM:** Tracked via the
  `NOT_A_GOOD_ELM_SEAM` verdict above; matches the SEAM06,
  SEAM10, and SEAM11-async precedents (all
  economic-and-scope rejections, not strict-impossibility
  proofs).
- **No recursive Factory review initiated.** No new Elm
  kernel position allocated. No production code touched.
  No new test files added. The closure commit records only
  the Factory artifacts (this report, its mirror, the
  witness, and the board cursor).
- **No new stashes, no tag pushes.** The closure commit
  resolves the pre-commit `1 M + 3 ??` state observed by
  the Factory reviewer's digest; after the commit,
  `git status --short` is empty.

---

## 15. WR-11 — REASONS ENUMERATION (the 6 dispositive reasons, revised post-review)

WR-11-R1 — **Single-owner not justified under current
constraints (C1, revised).** A `useSyncExternalStore`
integration is architecturally viable (React's official
external-store pattern,
https://react.dev/reference/react/useSyncExternalStore), so
the strict-impossibility framing of the original draft is
**withdrawn**. What remains is a set of unproven
requirements (event ordering, initialization, payload
conservation, recovery, latency) that the stop conditions
rule out at the current ClineMM scope. A naïve in-updater
Elm port is forbidden by `react-updater-purity-probe`. The
ACT §9 forbids a second canonical replica as an escape
hatch (no "TS as fallback" path) — that is correct.

WR-11-R2 — **React functional-updater purity is a hard
contract for the existing path.** The
`react-updater-purity-probe.test.tsx` suite (5/5 PASS) pins
`FUNCTIONAL_UPDATER_EXTERNAL_WRITES = 0` for the current
TS path. A naïve Elm port call from inside the updater is
an external write (Promise + bridge message) and is
**forbidden** by that probe. A `useSyncExternalStore`
integration is a *different* contract (the React
subscriber is the only consumer of the projection) and is
not currently certified by any test. Certifying it is a
C3 probe, which the stop conditions rule out at the
current ClineMM scope. The original draft's claim that a
`useEffect`-driven integration "lags by one render" is
withdrawn as a strict-impossibility claim; it remains a
true observation about the post-commit `useEffect`
pattern specifically, not about all `useSyncExternalStore`
patterns.

WR-11-R3 — **W1/W2 split is a behavioral contract.**
R-MP-SRC-DISCREPANCY is intentional: W2 does not promote
`turnState` / `epoch` / `stateVersion`. A unified Elm
model would either widen W2's authority (changes R08 /
R14 behavior) or re-implement the W1/W2 split as separate
model paths. The latter is a second state machine. The
former changes user-visible behavior. A
`useSyncExternalStore` integration can preserve the W1/W2
split if and only if the Elm model has two distinct entry
points with distinct authority — the original draft's
claim that this is architecturally excluded is
**withdrawn**, but the preservation of the split remains
a cost.

WR-11-R4 — **ClineMessage payload cost is one contributor,
not the whole story (revised).** R12 forbids schema
narrowing; Elm ports force full payload transfer on every
event. The 100 MB/s figure in the original draft is a
**bounded worst-case estimate** (not a benchmark): an
incremental event protocol or a `Json.Encode.Value`
structured bridge would lower it by one to two orders of
magnitude. The actual cost is the **absence of
demonstrated proofs** (event ordering, initialization,
payload conservation, recovery, latency) — not the raw
serialization rate. The identity/payload split is a
second state machine and is correctly excluded by the
ACT's §5 fail-fast rule.

WR-11-R5 — **Webview worker durability is not free.** The
5 existing Elm kernels are host-side and survive webview
reload. A webview-side worker must be re-spawned on every
remount (Strict Mode, webview reload, hot reload),
introducing a priming-race window during which W2
partials are lost. The 5-kernel convention is preserved
by rejecting this candidate. This reason is **not**
weakened by the `useSyncExternalStore` counterexample —
worker durability is a property of the runtime, not of
the React integration contract.

WR-11-R6 — **Disposition precedent + method reuse.** The
SEAM10 and SEAM11-async predecessors both closed on
similar architecture mismatches with structured "negative
ROI" verdicts. This SEAM11 reuses their
one-bounded-discriminator methodology (PACEID/TPAEID-style
reason enumeration), applies it to the `messageReducer.ts`
candidate, and closes with `NOT_A_GOOD_ELM_SEAM` as an
**economic and scope-specific** disposition (matching the
predecessor framing). The "6.4x growth" / "second
canonical replica" / "React purity violation" categories
from the predecessors are all present in this candidate
at the same or greater severity. The strict-impossibility
framing that distinguished the original draft from the
predecessor verdicts is **withdrawn**: the predecessor
verdicts were also economic-and-scope rejections, and the
SEAM11 webview-replica verdict is now in the same family.

---

## 16. PREDECESSOR ACT LINEAGE (re-referenced for the SEAM11 line)

- `ACT-CLINEMM-ELM-SEAM11-ASYNC-AUTHORITY-RECON`
  (`NOT_A_GOOD_ELM_SEAM`, `b544b5ca1`, 2026-10-13) — the prior
  SEAM11 (different candidate: prompt-admission / background-job
  FSM / task-lifecycle). This SEAM11 investigates a fourth
  candidate (`messageReducer.ts`).
- `ACT-CLINEMM-ELM-SEAM10-INTEROP-DISC` (`NOT_A_GOOD_ELM_SEAM`,
  `356c67714`, 2026-10-12) — the SEAM09 tool-approval cutover
  discriminator. SEAM10 §9 next-cursor menu and SEAM10 §3.3-3.6
  reasons are re-applied here.
- `ACT-CLINEMM-ELM-SEAM06-PROMPT-ADMISSION-CUTOVER`
  (`NOT_A_GOOD_ELM_SEAM`, 2026-10-09) — the prior verdict on
  the 12-case admission expression.
- `ACT-CLINEMM-ELM-SEAM09-TOOL-APPROVAL-LIFECYCLE-RECON`
  (`PASS_ELM_SEAM09_RECON`, 2026-10-12) — the recon that opened
  the SEAM10 discriminator.
- `ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02-PHASE-B-REPAIR01`
  — the prior ownership-coherence work that this SEAM11
  re-validates (the `applyPresentationProjection` helper at
  messageReducer.ts:116-127 is the deliverable).

---

**Verdict:** `NOT_A_GOOD_ELM_SEAM` (economic and scope-specific
disposition; not a proof of architectural impossibility).

The SEAM11 webview-replica candidate fails the C1 discriminator
on the narrower claim
`REACT_OWNERSHIP_MODEL = NOT_JUSTIFIED_UNDER_CURRENT_CONSTRAINTS`.
A `useSyncExternalStore` integration is architecturally viable
(React's official external-store pattern), but the integration
proofs (event ordering, initialization, payload conservation,
recovery, latency) are not demonstrated at the current ClineMM
scope, and the existing TypeScript replica is the most
economically attractive boundary consistent with the
`FUNCTIONAL_UPDATER_EXTERNAL_WRITES = 0` contract, the W1/W2
split, and the existing 39-test corpus. The 5-kernel
convention is preserved. No production code is touched. The
ACT closes on Factory artifacts only.

**Post-review calibration (HALT_P1 resolution):** this report
was reviewed by the Factory reviewer, who identified two
overclaims (strict-impossibility framing in §3 and the 100
MB/s estimate in §8) and a P0 artifact-binding issue (the
pre-commit state showed 1 modified + 3 untracked files while
the report claimed `WORKTREE_STATUS = clean`). All three are
corrected in this closure.
