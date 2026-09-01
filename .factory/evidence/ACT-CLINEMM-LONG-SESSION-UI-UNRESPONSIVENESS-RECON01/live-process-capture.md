# Live Process Capture — ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01

HEAD: `fbf3eef2e` (origin/main, 2026-09-01)

## Status: **PROTOCOL FROZEN — CAPTURE NOT YET RUN**

This ACT was authored from a headless / nested-sandboxed authoring
shell with no Aqua session and no live VSCodium window. The operator
must run the capture on the next "window not responding" freeze.
The artifacts (`entry-freeze.ps.txt`, `entry-freeze.vm_stat.txt`,
`entry-freeze.sample.txt`) are absent on purpose — the launch
contract says: "Do not create empty placeholder artifacts merely to
satisfy this list. Create an artifact when evidence exists."

## Capture runbook (frozen — operator-gated, corrected per reviewer P1 #1)

Pre-conditions (operator):

- VSCodium open with ClineMM active in a long-running session.
- Operator willing to capture before clicking Reopen / Close.
- `sample` available (standard on macOS).

When the dialog appears:

```bash
DIR=.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01
mkdir -p "$DIR"

# 1. Process table — sort by %CPU (column 3), NOT %MEM.
#    `%MEM` is not a CPU proxy; sorting on it sends `sample` to
#    the wrong process.
ps -axo pid,ppid,%cpu,%mem,rss,vsz,etime,command \
  | grep -E 'VSCodium|Helper \(Renderer\)|Helper \(Plugin\)|gpu' \
  | grep -v grep \
  | sort -k3,3nr \
  > "$DIR/entry-freeze.ps.txt"

# 2. VS Code / VSCodium native process classification.
#    Use whatever the Factory launcher invokes (codium / code /
#    factory-codium), NOT a system-wide `codium` if it would
#    attach to a different isolated instance.
codium --status > "$DIR/entry-freeze.vscode-status.txt" 2>&1 || true

# 3. Memory pressure
vm_stat > "$DIR/entry-freeze.vm_stat.txt"
memory_pressure 2>/dev/null >> "$DIR/entry-freeze.vm_stat.txt" || true

# 4. Per-process `sample` — DO NOT auto-pick a single hot PID.
#    A CPU-heavy freeze (case A/C) and a memory/GC-heavy freeze
#    (case E) present differently; the operator chooses from the
#    ps table which process(es) are materially hot and samples
#    each.
#
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

Operator discipline:

- Do NOT click **Reopen** before `sample` completes.
- "Keep Waiting" is preferable so the freeze is observable.

## Expected interpretation rules (operator + reviewer)

After the capture is in, this is the smallest classification. **The
process class is unbound** at the time of writing; this table is
what the capture chooses between.

| Evidence                                                | Classification                            |
|---------------------------------------------------------|-------------------------------------------|
| Chat's webview renderer (`Helper (Renderer)` with largest chat-sized RSS) is materially CPU-hot; `sample` lands in JS-frame work (render/layout), not in V8 `Serializer` | **CASE A** — webview renderer CPU/render cost |
| Extension host (`Helper (Plugin)`) is materially CPU-hot; `sample` lands in V8 `Serializer` / `JSON.stringify` / `subscribeToState.ts:62-70` / `statePostDebouncer` / `getStateToPostToWebview` | **CASE C / F** — extension-host JSON-serialize hotpath |
| Extension host hot but `sample` lands elsewhere | **CASE C** — extension-host CPU, exact seam TBD |
| Workbench renderer hot, webview renderer cold, host cold | **CASE B** — workbench renderer block (LOW PRIOR / OPEN pre-capture) |
| Main process hot, all helpers cold | **CASE D** — main process block (LOW PRIOR / OPEN pre-capture) |
| `vm_stat` / `memory_pressure` shows pressure, no CPU hotspot | **CASE E** — memory/GC |
| Multiple processes hot                                   | Multi-process starvation — extend capture with consecutive `sample`s |
| All processes cold                                       | **CAPTURE_INSUFFICIENT** — re-capture with longer samples or instrumented `Buffer.byteLength` log |

These rules are deliberately mutually exclusive; if the evidence
contradicts them, the answer is `CAPTURE_INSUFFICIENT` and the next
ACT's runbook extends the capture (e.g. consecutive `sample`s, or
instrumented `Buffer.byteLength` log around the state post).
