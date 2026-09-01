# ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01

> Status: **OPEN — RECON_ONLY / SOURCE_CANDIDATES_NARROWED /
> LIVE_PROCESS_CLASS_UNBOUND / FIRST_PROCESS_DISCRIMINATOR=DESIGNATED**
>
> **Verdict (interim):** `SOURCE_CANDIDATES_NARROWED / LIVE_PROCESS_CLASS_UNBOUND`
> — source-recon narrows the candidate set to a small handful, but
> no native process has yet been observed as blocked/hot, so the
> **process class is still unbound**. Cases A, B, C, D, E, F remain
> open per the corrected classification table in §5; the
> `ps`/`sample` capture on the next live freeze is the discriminator
> that promotes the verdict to `PROCESS_CLASS_BOUND` (or one of the
> stop-rule outcomes). No production repair authorized in this ACT.
>
> **FROZEN LIVE FACT (operator-supplied dogfood specimen):**
>
> - long-running session (~hours)
> - large accumulated task/conversation history
> - Cline activity visible in the workbench
> - macOS / VSCodium displayed: `"The window is not responding"`
> - operator recovery options: `Reopen / Close / Keep Waiting`
>
> **CAUSE = UNKNOWN.** This ACT does not label the symptom as
> `DOM_GROWTH`, `EXTENSION_HOST_BLOCK`, `IPC_STORM`, `MEMORY_LEAK`,
> `PROVIDER_STALL`, or `MAIN_PROCESS_BLOCK` until native process
> evidence discriminates.
>
> **Predecessor ACTs respected:**
>
> - `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (CLOSED, `CAPTURE_INSUFFICIENT`;
>   recon discipline applies here too — never name a defect from a
>   screenshot alone).
> - `ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01/02` (CLOSED; cause-neutral
>   discipline preserved).
> - `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`
>   (operator-gated, NOT in scope here — the long-session freeze is a
>   structurally-distinct failure class even though the dogfood specimen
>   may share the same operator machine).
>
> **Entry conditions:**
>
> - branch=main, HEAD=`fbf3eef2e` (origin/main)
> - worktree=clean, stashes=0
> - `git status --short` empty; `git diff --check` clean
> - No production code change; no new RED; no bounded repair ACT
>   authorized; no live dogfood artifact required (recon-only ACT).
>
> **Recon evidence:**
>
> - `.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/source-seam-map.md`
> - `.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/scale-inventory.md`
> - `.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/live-process-capture.md`
> - `.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/final-report.md`

## 0. Mission

> When VSCodium reports "The window is not responding" during a
> long-running ClineMM session, **which production process / seam is
> actually unable to make forward progress?**

Candidate classes (per the launch contract; matches §5):

| Code | Candidate                              | Classification (post-P0 correction) |
|------|----------------------------------------|-------------------------------------|
| A    | `CLINE_WEBVIEW_RENDERER_CPU_OR_DOM_GROWTH` | `PLAUSIBLE` |
| B    | `WORKBENCH_RENDERER_BLOCK`             | `LOW PRIOR / OPEN` (LOW structural prior, NOT source-eliminated; native capture decides) |
| C    | `EXTENSION_HOST_BLOCK`                 | `PLAUSIBLE` (canonical production seam) |
| D    | `VSCODIUM_MAIN_PROCESS_BLOCK`          | `LOW PRIOR / OPEN` (LOW structural prior, NOT source-eliminated; native capture decides) |
| E    | `MEMORY_PRESSURE_OR_GC_THRASH`         | `OPEN` (deferred to live capture; no source-recon signal) |
| F    | `CROSS_PROCESS_PUBLICATION_OR_IPC_STORM` | `OPEN` (deferred; a real IPC-payload-size probe is needed; see Q5/Q7) |
| G    | `TASK_HISTORY_DESERIALIZATION_OR_REPLAY_COST` | `DISFAVORED_BY_TRIGGER` (operator restart was NOT the trigger per the LIVE FACT; the freeze occurred mid-session) |
| H    | `TOOL_SPECIFIC_CPU_HOTPATH`            | `DISFAVORED_BY_TRIGGER / OPEN` (DISFAVORED by trigger — NOT source-eliminated; see §5) |
| I    | `OTHER / CAPTURE_INSUFFICIENT`         | `OPEN` (fall-through) |

The discriminator (per §3 / §4 below) is a **native process capture
on the next live freeze**: PID, PPID, %CPU, %MEM, RSS, ELAPSED for
VSCodium main + Helper (Renderer) + Helper (Plugin) + GPU + webview
renderers, plus `sample <PID> 10` on whichever materially-hot
process(es) the operator selects from the `ps` table (sorted by
`%CPU`, NOT `%MEM`, and cross-checked with `codium --status`).
`webview-renderer` / `extension-host` is hottest. This is the smallest
measurable boundary that distinguishes A from C.

`REPAIR_AUTHORIZED = NO`. Stop after source-recon + discriminator
designation; the discriminator itself runs operator-side on the next
freeze, not in this shell.

## 1. External radar (non-causal)

Carried as RADAR only. None of these are evidence that ClineMM has the
same cause; they are evidence of the failure **class**.

| Source     | ID     | Class (radar)                                  | Note |
|------------|--------|------------------------------------------------|------|
| Cline      | #9011  | `HISTORY_LOAD_DESERIALIZATION`                 | large `api_conversation_history.json` + `ui_messages.json` (~5–10MB) freezes IDE during history click. **Not** our live symptom (operator did not click a history item) but it proves the storage layer can become a freeze-class factor. |
| Cline      | #13306 | `LONG_SESSION_HEAP_GROWTH`                     | post-prolonged-use whole-VS-Code reload. Radar only; no confirmed bound. |
| Cline      | #13339 | `EXTENSION_HOST_PRESENTATION_LOOP`             | `schedule assistant presentation` floods log 9,000+ times until host freezes. This is the most direct analogue to **case C**, but we have not yet observed a corresponding log storm in ClineMM. |
| Cline      | #12939 | `EXTENSION_HOST_EDIT_HOTPATH`                  | `replace_in_file` (parseUpdateFile) consumes 92%+ CPU for 5s+. Radar only — operator reports no edit was in flight when the dialog appeared. |
| VS Code    | #297349| `WEBVIEW_CHAT_DOM_NON_VIRTUALIZED`             | long chat panel retains all messages in DOM, reaches 10k+ nodes and multi-GB renderer memory. **Most direct analogue to case A**; ClineMM uses `react-virtuoso`, which mitigates the literal symptom but **does not eliminate it** (see Q3). |

Chronology ≠ causal identity. Upstream symptom similarity ≠
ClineMM root cause. The above proves the family is real, not that
ClineMM's instance is in any one class.

## 2. Source-recon — Q1 through Q12

Answers below cite absolute file paths and line numbers from
HEAD `fbf3eef2e`. All cited code was re-read at this HEAD during the
recon; nothing here is inferred from component names.

### Q1 — Which process owns the ClineMM chat DOM?

**Answer:** the **webview renderer** for the chat view proper
(`ChatView` content), which is a separate Electron renderer process
sandboxed by VS Code. The chat DOM does **not** live in:

- the workbench renderer (workbench renders only the sidebar shell
  + tab title);
- the extension host (Node process; no DOM);
- the main process (Electron main; no chat DOM).

Webview content is mounted by `VscodeWebviewProvider` and is isolated
from the workbench renderer. (See
`apps/vscode/src/hosts/vscode/VscodeWebviewProvider.ts` — the
webview host wiring sits in the workbench renderer, but the rendered
chat React tree lives in the webview renderer process.)

**Implication:** the live freeze's "window not responding" is a
**whole-window** symptom — that crosses process boundaries. macOS's
`Not Responding` is reported by `launchd` based on the NSApp's main
thread run loop. Any process hosting a window that stops draining
events can cause it. So the candidate set is broader than just the
webview renderer: the workbench renderer, the main process, and the
GPU process can each independently starve the run loop.

### Q2 — How are historical Cline messages supplied to the webview?

**Answer:** Two channels, both converging on the same in-memory
replica.

The **partial-message stream** is the streaming channel for in-session
events (text deltas, tool calls, reasoning). The **state stream**
rebuilds and ships the **full ExtensionState** on every
`postStateToWebview()`. The **replica reducer**
(`apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:236-270`)
merges the two using `ts` (identity) + `seq` (freshness) + `epoch`
(fence).

Trace (file → file, absolute):

1. SDK session event arrives → `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:52 handleSessionEvent()`
2. `translateSessionEvent` → messages
3. `messages.appendAndEmit(result.messages, event)` →
   `apps/vscode/src/sdk/sdk-message-coordinator.ts:98` → stamps `seq/epoch`,
   pushes to `task.messageStateHandler.addMessages`
4. `emitSessionEvents(messages, event)` → invokes registered
   listeners
5. `apps/vscode/src/sdk/webview-grpc-bridge.ts:56 createListener()` listener →
   `apps/vscode/src/sdk/webview-grpc-bridge.ts:69 handleSessionEvent()`
6. Each message → `pushPartialMessage` →
   `sendPartialMessageEvent` (per-message wire; cheap)
7. On `ended` / `done` / `error` → `pushStateUpdate` →
   `getStateFn()` → `apps/vscode/src/core/controller/state/subscribeToState.ts:61 sendStateUpdate(state)`
   (full ExtensionState JSON; expensive; **this is the IPC-burst
   candidate for case F**)

Initial load goes through `apps/vscode/src/core/controller/state/subscribeToState.ts:19 subscribeToState()`
— also calls `controller.getStateToPostToWebview()` and ships the
whole thing as the first `stateJson`.

### Q3 — Does the webview currently render the full conversation list?

**Answer (corrected):** the webview uses **`react-virtuoso`** — but
with a caveat that materially affects this recon.

`apps/vscode/webview-ui/src/components/chat/chat-view/components/layout/MessagesArea.tsx:4`:

```ts
import { Virtuoso } from "react-virtuoso"
```

and `MessagesArea.tsx:241-267`:

```tsx
<Virtuoso
  data={displayedGroupedMessages}
  increaseViewportBy={{
    top: 3_000,
    bottom: Number.MAX_SAFE_INTEGER, // <-- renders ALL rows below viewport
  }}
  initialTopMostItemIndex={displayedGroupedMessages.length - 1}
  itemContent={itemContent}
  ...
/>
```

**`bottom: Number.MAX_SAFE_INTEGER`** is intentional (see the
in-source comment on line 256: "hack to make sure the last message is
always rendered to get truly perfect scroll to bottom animation").
Per the `react-virtuoso` contract, `increaseViewportBy.bottom`
enlarges the bottom viewport in pixels; `MAX_SAFE_INTEGER` is an
arithmetic upper bound that Virtuoso's `sizeRangeSystem` clamps, but
the **structural** effect is that the downward viewport overscan is
deliberately unbounded. Practically:

- At the **normal bottom-of-chat pin** (which `initialTopMostItemIndex
  = length - 1` and `subscribeToPartialMessage` maintain), there are
  no rows below the viewport in the user's frame of reference, so an
  infinite bottom overscan does **not** by itself force-mount old
  history above the viewport. **Full long-history mount during
  normal bottom-pin is NOT PROVEN from source.**
- When the user **scrolls upward** to old history, however, all
  rows between the user's current scroll position and the bottom of
  the list become candidates for mounting under the bottom overscan.
  A long upward scroll can therefore bring a large fraction of the
  remaining transcript into the mounted set.

The hazard is therefore characterized as:

```text
WEBVIEW_OVERSCAN_HAZARD              = STRUCTURAL / PROVEN
FULL_LONG_HISTORY_MOUNTED_DURING_NORMAL_BOTTOM_PIN = NOT PROVEN
CASE_A                              = PLAUSIBLE, requires renderer evidence
```

This is **not** the literal "10k DOM nodes" VS Code #297349 pathology
(unmediated chat panel with no virtualization); ClineMM does already
use Virtuoso, which is structurally better. But it is also **not**
a clean "fully virtualized" boundary, and case A remains a
plausible process-class candidate pending native render-process
evidence.

`filterVisibleMessages` (`apps/vscode/webview-ui/src/components/chat/chat-view/utils/messageUtils.ts:116-177`) is purely a
visibility filter, not a windowing filter — it can reduce the row
count by a small constant (drop `api_req_finished`, `subagent_usage`,
`checkpoint_created`, etc.) but never slices the array to a bounded
window. `groupMessages` is purely structural.

### Q4 — What expensive per-publication work runs over the ENTIRE task history?

**Answer:** the full `clineMessages` array is **shallow-copied and
serialized to JSON on every state post**.

`apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:92`:

```ts
const clineMessages = [...(controller.task?.messageStateHandler?.getClineMessages?.() || [])]
```

Then `apps/vscode/src/core/controller/state/subscribeToState.ts:62-86`:

```ts
stateJson = JSON.stringify(state)               // serializes EVERYTHING
…
for (const responseStream of activeStateSubscriptions) {
  responseStream({ stateJson }, false).catch(...)
}
```

**Per-post cost:**

| Step | Cost | Scales with N = `clineMessages.length` |
|------|------|-----------------------------------------|
| Shallow copy `[...arr]` | O(N) refs | linear |
| `JSON.stringify(state)` | O(total bytes of state) | linear in total serialized bytes (per-row unbounded content makes **total bytes** large, but stringify itself is not super-linear in tool output) |
| Structured-clone on the postMessage boundary | O(bytes) | same |
| `recordStateSizeTelemetry` | O(bytes) | same |
| Webview reducer merge via `applyStateSnapshot` (`apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:236-270`) | O(N) per message × snapshot size | linear per push, but multiplied by push frequency |

The debouncer (`apps/vscode/src/sdk/state-post-debouncer.ts`) caps
post frequency at one per ~50ms during a streaming turn, so the
amortized per-second cost is bounded — but the **per-post cost**
still scales linearly with conversation length.

**Implication for case F:** the IPC payload size scales linearly with
conversation length, and `JSON.stringify` runs once per debounced
post. If `N` reaches 5–10k messages and a typical row is 1–10kB
(reasoning text, tool output, command output), the per-post JSON can
reach tens of MB. The 50ms debounce is a backpressure, not a
**bandwidth** cap. The `ps` / `top` of the **extension host** is
the only process that has the cost; the webview's per-push work
(react state diff) is on the other side of the IPC.

### Q5 — What is the ExtensionState/message publication cadence?

**Answer:** during a streaming turn, two channels fire concurrently:

| Channel            | Triggered by                                      | Frequency during streaming |
|--------------------|--------------------------------------------------|----------------------------|
| Partial-message    | every assistant / tool event                     | dozens to hundreds/sec (SDK chunk rate) |
| State post         | `pending_prompts`, `ended`, `done`, `error`, plus every `postStateToWebview()` call site | throttled to **20/sec (50ms debounce)** at peak; can drop lower when the debouncer drains a long queue |

Coalesced state-post cadence observed in production = ≤20/sec;
debouncer cap is `apps/vscode/src/sdk/SdkController.ts:712 STATE_POST_DEBOUNCE_MS = 50`.

**Implication for case F:** during a streaming turn the extension host
runs `JSON.stringify` over a multi-MB state every 50ms. The exact
CPU/bandwidth magnitude is **unmeasured** in this ACT — `LIVE_COST_MAGNITUDE = UNMEASURED`,
`JSON_STRINGIFY_CAUSALITY = HYPOTHESIS_ONLY`. What is structurally proven is
`HOST_SERIALIZATION_SCALE_HAZARD = STRUCTURAL / PROVEN`: the cost
scales with the **byte size** of the state, which scales with
session length. Native `sample` on the extension host during such a
window will land inside `JSON.stringify` (or `statePostDebouncer` →
`sendStateUpdate` → `JSON.stringify`) **if** the host is the hot
process — and that "if" is what the live capture decides.

### Q6 — Does `SdkController` / `getStateToPostToWebview` serialize/copy conversation-scale structures on each state publication?

**Answer:** YES for `clineMessages` (line 92 above; shallow spread
of the full array), and PARTIALLY for `taskHistory` (the history
**list** is bounded to 100 via `slice(0, 100)` on line 98, but
**each item** carries a `task` summary string whose length can be
unbounded if a user submitted a very long initial prompt).

The shallow spread `[...arr]` is not a deep copy; it copies only the
array slot references. `JSON.stringify` then walks every message's
nested fields (text, images, files, reasoning, tool blocks, etc.) and
serializes them — that is the actual hot path.

**No cached pre-built state object.** `getStateToPostToWebview` is
called from scratch on every `pushStateUpdate()` and on every
`postStateToWebview()` flush. There is no incremental diff and no
byte-level shared structure between consecutive posts. (The webview
side has `applyStateSnapshot` which does merge incrementally, but the
extension host does the **full** serialize every time.)

### Q7 — Which state fields scale with session length?

**Answer:** the inventory is in
`.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/scale-inventory.md`
(scale-inventory table). Summary:

- `clineMessages` — **O(session length)**; COPIED + JSON-SERIALIZED
  + CROSSES IPC + RENDERED (within Virtuoso's working set)
- `taskHistory` — bounded to 100; per-item `task` summary is a string
  whose length can be large but not session-length
- `turnState` / `thinkingPresentation` / `taskTelemetry` — O(1) per post
- `currentTaskItem` — O(1)
- All settings / banners / MCP / toggles — O(1)

The single **session-length-scaling** field that crosses the IPC is
`clineMessages`. Everything else is bounded or O(1).

### Q8 — How are old tool outputs/code blocks represented after they scroll far offscreen?

**Answer:** `react-virtuoso` keeps them unmounted **above** the
viewport (within `top: 3000px` buffer) and mounted within the
**bottom** buffer — but it does **not** collapse or unmount them
visually. There is no per-row offscreen-collapse logic in
`apps/vscode/webview-ui/src/components/chat/ChatRow.tsx` or
`apps/vscode/webview-ui/src/components/chat/chat-view/components/messages/MessageRenderer.tsx`
for tool outputs or diffs. They render at full expansion when mounted.

`filterVisibleMessages` drops `api_req_finished`, `subagent_usage`,
`checkpoint_created`, `mcp_server_request_started`, etc., but does
**not** drop rows that have already scrolled offscreen.

**Implication:** the per-row **render cost** for a long session is
not amortized — every row that Virtuoso keeps mounted re-renders on
any state change (e.g. typing in the input). A 10k-row session in
which 200 rows are mounted at any time pays the cost of 200 row-RCTs
per keystroke. With `partial` messages and `streaming` TurnState
updating constantly during streaming, the React re-render pressure
on the webview renderer during a streaming turn is **O(visible_rows ×
state-post rate)**.

### Q9 — What existing performance diagnostics exist?

| Diagnostic                                  | Location                                                    | Status |
|---------------------------------------------|-------------------------------------------------------------|--------|
| `recordStateSizeTelemetry` (state JSON bytes) | `apps/vscode/src/core/controller/state/subscribeToState.ts:88-90`; emits `telemetryService.captureGrpcResponseSize` | **LIVE in production.** Records every post size but only as a telemetry event. |
| `activity.publication.v1` ring (D knob gated) | `apps/vscode/src/sdk/activity-publication-v1.ts` + `apps/vscode/src/sdk/host-ownership-diagnostic-runtime.ts` | **DOGFOOD-OPT-IN.** Captures one ring record per state publication (stateVersion, pushId, six raw host facts). Off by default. |
| `telemetryService.captureGrpcResponseSize`  | underlying sink                                             | LIVE. |
| `performance.now` / `profiler`              | —                                                          | **NONE** in production code paths relevant here. |
| `setTimeout(... STATE_POST_DEBOUNCE_MS ...)` latency probe | —                                                          | **NONE.** Debouncer has no timing log. |
| Webview render-time instrumentation         | —                                                          | **NONE.** No `Profiler` boundary on `MessagesArea` or `ChatView`. |
| Native `sample` integration                 | —                                                          | **NOT EXISTENT.** This ACT does not invent one — operator runs `sample <pid> 10` ad-hoc. |

**Implication:** the only "live" signal we already have is
`recordStateSizeTelemetry` — the **post-size telemetry** is in place
and will tell us post-hoc whether the per-post JSON was the smoking
gun. The ring-buffer `activity.publication.v1` is opt-in and not
captured by default; the operator can enable it via the workspace
toggle, but that requires the freeze to recur.

### Q10 — Can task-history loading itself synchronously block the extension host?

**Answer:** Possibly, but **not** in the operator's reported trigger
sequence. The operator did NOT report "clicked on a history item" as
the trigger — the freeze happened **mid-session** during active
work. Per upstream #9011 the `readMessages` path through
`sdk-session-history-loader.ts` can be expensive (large
`api_conversation_history.json` + `ui_messages.json`); ClineMM
stores the equivalent on the SDK side via `ConversationStore`
(`sdk/packages/core/src/session/stores/conversation-store.ts`). But
case G is only triggered on **task open / restore**, not on every
post — so it's structurally unlikely to be the per-second
reproducible freeze.

**Implication for case G:** carry as RADAR. The discriminator
script in §3 does NOT need to catch a history-load moment.

### Q11 — Can an event/publication loop recursively trigger another publication?

**Answer:** Searched for: postMessage → setState → extension-state
update → assistant presentation scheduling → taskHeader publication →
task message translation cycles.

Findings:

- The webview side has a **pure** functional updater
  (`apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:666` setState body) — R9-purity enforced,
  no nested setState calls, no `replicaRef` writes during the
  functional updater. This is the FIXUP04 / PURITY-REPAIR01 invariant.
- The host side `postStateToWebview()` is called from many sites,
  but every call site is **either** an event-driven trigger
  (session event, button click, settings change) **or** a
  coordinator-drained flush — there is no production-seam
  `postStateToWebview → handleSessionEvent → postStateToWebview`
  recursion in the path I traced.

**Implication:** a **classical** IPC storm (Cline #13339 analogue) is
not visible in the ClineMM code at the production seam. The residual
risk is the **frequency** of `postStateToWebview()` per second during
streaming (case F, not case D-as-storm). Case D stays on the table
only as "the debouncer fails closed under heavy load" — not as
"unbounded recursion."

### Q12 — What is the smallest safely observable boundary that distinguishes A vs C?

**Answer (corrected per reviewer P1 #1):** the discriminator is
**native process / stack classification** — ps + `--status` +
per-process `sample` — and it picks between `extension host hot` /
`webview renderer hot` / `multiple hot` / `nothing hot`, **not** a
single hot PID by one numeric column (auto-picking a single PID by
one metric sends `sample` to the wrong process on memory-heavy vs
CPU-heavy freezes).

1. **Process identity.** `ps -axo pid,ppid,%cpu,%mem,rss,vsz,etime,command`
   on VSCodium main + Helper (Renderer) + Helper (Plugin) + GPU
   + webview renderer(s), sorted by `%CPU` (column 3), NOT by
   `%MEM`. The chat's webview renderer is identifiable because
   VS Code names its helper renderers `Helper (Renderer)` and the
   Cline webview is the one with the largest RSS for a
   chat-window-sized workload — but **role is inferred from RSS,
   not from `ps`**; cross-check with `--status` so we don't infer
   roles from a single proxy.
2. **VS Code / VSCodium native classification.** `codium --status`
   (or whatever the Factory launcher invokes — NOT a system-wide
   `codium` that could attach to a different isolated instance).
3. **Native `sample`.** `sample <PID> 10 -file <artifact>` on each
   materially-hot process in turn (extension host if hot, chat
   webview renderer if hot, both if both). 10s is enough to get a
   top-symbols stack on macOS. If nothing is hot, capture
   `top -l 1 -n 30` as a non-blank artifact rather than auto-pick
   a single PID.
4. **`vm_stat`, `memory_pressure`** to bound memory-pressure
   narrative (case E).

**This is the discriminator designated by this ACT.** It is
designated, not run — running it requires the operator to capture
on the next live freeze, which is not reproducible in this shell.

## 3. Entry live-capture protocol (operator runbook)

> Status: NOT EXECUTED in this shell (the headless / nested-sandboxed
> authoring shell has no VSCodium Aqua session to capture). The
> protocol is frozen so the operator can run it deterministically
> on the next freeze; the run is gated on the operator.

Pre-conditions:

- Operator has VSCodium open with ClineMM in the active session.
- Operator is willing to capture before clicking Reopen / Close.
- Operator has `sample` available (standard on macOS).

On the next "The window is not responding" dialog:

```bash
DIR=.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01
mkdir -p "$DIR"

# 1. PROCESS TABLE — sort by %CPU (column 3), NOT %MEM.
#    `%MEM` is not a CPU proxy; sorting on it sends `sample` to
#    the wrong process. `%CPU` is column 3 of `ps -axo`.
ps -axo pid,ppid,%cpu,%mem,rss,vsz,etime,command \
  | grep -E 'VSCodium|Helper \(Renderer\)|Helper \(Plugin\)|gpu' \
  | grep -v grep \
  | sort -k3,3nr \
  > "$DIR/entry-freeze.ps.txt"

# 2. VS CODE / VSCODIUM NATIVE PROCESS CLASSIFICATION.
#    Captures the IDE's own view of its processes so we don't have
#    to infer roles from RSS. Use whatever the Factory launcher
#    invokes (codium / code / factory-codium), NOT a system-wide
#    `codium` if it would attach to a different isolated instance.
codium --status > "$DIR/entry-freeze.vscode-status.txt" 2>&1 || true

# 3. MEMORY PRESSURE
vm_stat > "$DIR/entry-freeze.vm_stat.txt"
memory_pressure 2>/dev/null >> "$DIR/entry-freeze.vm_stat.txt" || true

# 4. PER-PROCESS `sample` — DO NOT auto-pick a single hot PID.
#    A CPU-heavy freeze (case A/C) and a memory/GC-heavy freeze
#    (case E) present differently; the operator chooses from the
#    ps table which process(es) are materially hot and samples
#    each. Convention:
#     - If the extension host (`Helper (Plugin)`) is materially
#       CPU-hot → sample IT (candidate C/F).
#     - If the chat's webview renderer (the `Helper (Renderer)`
#       with the largest RSS for a chat-window-sized workload) is
#       materially hot → sample IT (candidate A).
#     - If multiple processes look hot, sample each in turn.
#     - If nothing looks hot at all, capture `top -l 1 -n 30` as
#       `entry-freeze.top.txt` so the artifact is not blank.
sample <PID> 10 -mayDie -file "$DIR/entry-freeze.<role>.sample.txt"
```

Operator runbook constraints:

- Do NOT click **Reopen** before `sample` completes.
- "Keep Waiting" is preferable so the freeze can be observed
  stably. The `sample` runs while the dialog is showing; that is the
  point of the protocol.
- The artifacts above are committed into
  `.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/`
  by the operator.

## 4. Single-process discriminator

Picked (in priority order, per the launch contract):

1. **Native process CPU/RSS + `sample` stack** — this is what
   distinguishes A (webview renderer is hot) from C (extension host
   is hot). The capture runbook in §3 sorts `ps` by `%CPU` (not
   `%MEM`) and lets the operator sample each materially-hot process
   in turn; auto-picking a single PID by one numeric column is
   deliberately avoided because CPU-heavy and GC/memory-heavy
   freezes present differently.
2. **Existing `recordStateSizeTelemetry`** — already in production;
   the operator can pull a recent telemetry sample to see if
   per-post JSON crossed tens of MB at the time of the freeze.
   This is a **diagnostic-only** signal: large JSON proves
   `HOST_SERIALIZATION_SCALE_HAZARD` is exercised at that moment,
   not that it is the cause of the freeze.
3. **Only then, minimal temporary instrumentation** — out of scope
   for this ACT; reserved for a downstream bounded-repair ACT if
   case F is confirmed.

**Only one discriminator in this ACT.** No concurrent DOM profiler,
extension-host profiler, IPC counter, or heap sampler. The capture
protocol is the entire post-recon instrumentation.

## 5. Classification (corrected per reviewer P0)

```text
LIVE_FAILURE                  = REAL / LIVE

STRUCTURAL FINDINGS (from source-recon):
  clineMessages is session-length-scaling state
  full-state JSON serialization scales with its byte size
  Virtuoso has extreme downward overscan (bottom: MAX_SAFE_INTEGER)
  no obvious recursive postState loop found

LIVE PROCESS CLASS             = UNBOUND

CANDIDATES:
  A webview renderer / render cost     PLAUSIBLE
  B workbench renderer                 LOW PRIOR / NOT ELIMINATED (OPEN)
  C extension host                     PLAUSIBLE
  D main process                       LOW PRIOR / NOT ELIMINATED (OPEN)
  E memory / GC                        OPEN
  F bounded high-bandwidth state post  OPEN
  G history load                       DISFAVORED_BY_TRIGGER
  H tool-specific deferred work        DISFAVORED_BY_TRIGGER (NOT source-eliminated)
  I other                              OPEN

ROOT_CAUSE                      = UNKNOWN
REPAIR_AUTHORIZED               = NO
```

Per the launch contract:

- **case A — `WEBVIEW_RENDERER_DOM_OR_RENDER_COST`** — `PLAUSIBLE`.
  Source-recon shows Virtuoso with `bottom: MAX_SAFE_INTEGER`
  (`WEBVIEW_OVERSCAN_HAZARD = STRUCTURAL / PROVEN`); the
  `FULL_LONG_HISTORY_MOUNTED_DURING_NORMAL_BOTTOM_PIN` claim is NOT
  proven from source. Native capture (renderer materially hot in
  `ps`, `sample` lands in JS-frame work) is required to confirm.
- **case B — `WORKBENCH_RENDERER_BLOCK`** — `LOW STRUCTURAL PRIOR /
  NOT ELIMINATED`. The chat DOM is in the webview renderer (Q1),
  which is the ClineMM-side reason to suspect the workbench
  renderer less. But VS Code/Electron scheduling, IPC pressure, and
  Chromium/Electron renderer interactions can render a window
  unresponsive even if no ClineMM function literally executes in
  the workbench renderer. Source-recon alone does not eliminate B;
  native capture does.
- **case C — `EXTENSION_HOST_BLOCK`** — `PLAUSIBLE`. The per-post
  `JSON.stringify` is exactly the kind of work that can dominate
  the host's event loop when `clineMessages` is large.
  `JSON_STRINGIFY_CAUSALITY = HYPOTHESIS_ONLY`; `HOST_SERIALIZATION_SCALE_HAZARD
  = STRUCTURAL / PROVEN`. Native capture (extension host materially
  hot in `ps`, `sample` lands in `JSON.stringify` / `statePostDebouncer` /
  `getStateToPostToWebview`) confirms.
- **case D — `VSCODIUM_MAIN_PROCESS_BLOCK`** — `LOW STRUCTURAL PRIOR /
  NOT ELIMINATED`. The ClineMM-side argument that no chat-specific
  code runs in the main process is correct (Q1), but main-process
  freezing can still happen via IPC plumbing, sandbox mediation,
  or V8 host coordination; source-recon alone does not eliminate D.
- **case E — `MEMORY_PRESSURE / GC`** — `OPEN`. `vm_stat` +
  `memory_pressure` in §3 are sufficient to confirm or deny.
- **case F — `CROSS_PROCESS_PUBLICATION_OR_IPC_STORM`** — `OPEN`
  (bounded high-bandwidth state post). Not a recursion-storm (Q11)
  but a sustained-cost publication: 50ms debounce × multi-MB JSON.
  Same `sample`-evidentiary shape as case C. The debouncer caps it
  at ~20/sec, so this is **not** a classical unbounded storm; if
  confirmed it falls under case C in practice.
- **case G — `TASK_HISTORY_DESERIALIZATION_OR_REPLAY_COST`** —
  `DISFAVORED_BY_TRIGGER` (operator did not click a history item at
  the freeze). Carry as RADAR.
- **case H — `TOOL_SPECIFIC_CPU_HOTPATH`** — `DISFAVORED_BY_TRIGGER`
  (no current tool call visibly executing at the freeze per the
  operator's chronology). This is **NOT** a source-level
  elimination: deferred tool-side work could still have been
  in flight. Carry as RADAR. The upstream Cline #13339 chronology
  demonstrates that an apparently UI-level freeze can come from
  extension-host scheduling activity rather than DOM growth, so
  disconfirming H requires native capture, not source-recon.

## 6. Scale inventory (full table)

See
`.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/scale-inventory.md`.
Required artifact per the launch contract §9.

## 7. Required artifacts (status)

| Path                                                                              | Status        | Note |
|-----------------------------------------------------------------------------------|---------------|------|
| `.factory/acts/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01.md`           | **AUTHORED**  | this file |
| `.factory/evidence/.../source-seam-map.md`                                        | **AUTHORED**  | Q1–Q12 inventory |
| `.factory/evidence/.../scale-inventory.md`                                        | **AUTHORED**  | required scale table |
| `.factory/evidence/.../live-process-capture.md`                                   | **PROTOCOL FROZEN** (no capture yet — operator-gated) | live freeze did not recur during this recon |
| `.factory/evidence/.../final-report.md`                                           | **AUTHORED**  | classification + disposition |
| `.factory/evidence/.../entry-freeze.*`                                            | **NOT YET**   | depends on operator-side live freeze |

Per the launch contract: "Do not create empty placeholder artifacts
merely to satisfy this list. Create an artifact when evidence
exists." So `entry-freeze.*` are absent on purpose.

## 8. Temporary diagnostics

**None added in this ACT.** The `recordStateSizeTelemetry` already
in production is the only live signal we need; if the per-post JSON
crossed tens of MB during the operator's freeze, it would already
be in the telemetry stream and that is sufficient to confirm case F.

If case F is confirmed and a downstream bounded-repair ACT is
authorized, the temporary diagnostics would be:

- DEFAULT_OFF (opt-in workspace toggle)
- zero state-semantic delta when disabled
- bounded (e.g. last-1000-posts ring)
- removable (single-file)
- no public protocol field

That ACT is NOT this ACT.

## 9. Stop rules

Per the launch contract:

- If the operator's live capture isolates a single hot seam (chat's
  webview renderer = case A; extension host in `JSON.stringify` /
  `statePostDebouncer` / `getStateToPostToWebview` = case C / F),
  then disposition is `ROOT_CAUSE_ISOLATED` and a downstream
  **bounded repair ACT** may be authored. **This ACT does NOT
  pre-authorize that repair.**
- If only the **process class** is identifiable (webview renderer
  vs extension host) but the exact seam inside that process is
  not, disposition is `PROCESS_CLASS_BOUND` — this is the
  threshold the headline must reach before we are entitled to
  label the freeze that way — and a follow-on ACT's discriminator
  picks the seam. We pause here.
- If no recurrence and no deterministic reproduction, disposition is
  `NOT_REPRODUCED` and we STOP rather than repairing a leading
  hypothesis. Preserve the source-seam map for the next dogfood
  regression.
- If evidence cannot distinguish processes (all candidates are
  cold in the captured `ps` / `sample`), disposition is
  `CAPTURE_INSUFFICIENT` and the next ACT's runbook extends the
  capture (e.g. consecutive `sample`s, or instrumented
  `Buffer.byteLength` log around the state post) to break the
  tie.

## 10. Forbidden

Per the launch contract §14, preserved verbatim:

- NO speculative virtualization (no `react-virtuoso` swap; no
  `react-window` swap).
- NO global 100-message truncation.
- NO deleting old history to "fix" rendering.
- NO provider-context changes.
- NO automatic task splitting.
- NO timer/debounce "responsiveness" hacks.
- NO arbitrary sleeps.
- NO giant permanent telemetry framework.
- NO touching TSWPD / VIAPD lane.
- NO reopening Idle / TurnState work.
- NO unrelated Seatbelt work.

## 11. Final disposition (interim, pre-live-capture)

```text
ACT_ID                       = ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01
STATE                        = OPEN / RECON_ONLY /
                              SOURCE_CANDIDATES_NARROWED /
                              LIVE_PROCESS_CLASS_UNBOUND
SOURCE_RECON                 = PASS (Q1-Q12; cases A/C PLAUSIBLE;
                              cases B/D LOW PRIOR / OPEN;
                              cases E/F OPEN; cases G/H DISFAVORED_BY_TRIGGER;
                              case I OPEN)
LIVE_CAUSE                   = UNBOUND
ROOT_CAUSE                   = UNKNOWN
LIVE_FAILURE                 = REAL / LIVE (operator dogfood specimen)
SOURCE_CANDIDATES_NARROWED   = YES
PROCESS_CLASS_BOUND          = NO (process not yet observed hot)
FIRST_PROCESS_DISCRIMINATOR  = DESIGNATED (native ps sorted by %CPU +
                              --status + sample on materially-hot process(es))
FIRST_BROKEN_BOUNDARY        = UNBOUND
WEBVIEW_OVERSCAN_HAZARD      = STRUCTURAL / PROVEN
FULL_LONG_HISTORY_MOUNTED_DURING_NORMAL_BOTTOM_PIN = NOT PROVEN
HOST_SERIALIZATION_SCALE_HAZARD = STRUCTURAL / PROVEN
LIVE_COST_MAGNITUDE          = UNMEASURED
JSON_STRINGIFY_CAUSALITY     = HYPOTHESIS_ONLY
REPAIR_AUTHORIZED            = NO
PRODUCTION_DELTA             = ZERO
NEW_TESTS                    = ZERO
ENTRY_HEAD                   = fbf3eef2e
ORIGIN_MAIN                  = fbf3eef2e
LANE_OF_PRECEDENT            = NEW (no prior long-session-freeze epic in the repo; the
                              closest substrate is tool-runtime-reliability, which is
                              cause-disjoint per its durable scope boundary)
PARALLEL_OPERATOR_GATE       = ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
                              (operator-gated; NOT blocking this ACT; outcome does not
                              affect this ACT's disposition)
NEW_REVIEW_ROUND             = NO (this is the first round; recon ACT)
NEXT (operator-gated)        = run §3 capture protocol on next freeze → classify
                              {extension host hot / renderer hot / neither /
                              multiple hot} → either ROOT_CAUSE_ISOLATED
                              (downstream bounded repair ACT) or
                              PROCESS_CLASS_BOUND (next discriminator) or
                              NOT_REPRODUCED (STOP) or CAPTURE_INSUFFICIENT
```

**C1: GO_RECON done. No production repair authorized. Next gate is the operator-driven live-capture protocol in §3.**
