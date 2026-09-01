# Final Report — ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01

HEAD: `fbf3eef2e` (origin/main, 2026-09-01)

## Status

```text
STATE                        = OPEN / RECON_ONLY /
                              SOURCE_CANDIDATES_NARROWED /
                              LIVE_PROCESS_CLASS_UNBOUND
SOURCE_RECON                 = PASS (Q1-Q12)
LIVE_CAUSE                   = UNBOUND (capture not yet run)
ROOT_CAUSE                   = UNKNOWN
SOURCE_CANDIDATES_NARROWED   = YES
PROCESS_CLASS_BOUND          = NO (process not yet observed hot)
FIRST_PROCESS_DISCRIMINATOR  = DESIGNATED (ps sorted by %CPU +
                              --status + per-process sample)
FIRST_BROKEN_BOUNDARY        = UNBOUND
WEBVIEW_OVERSCAN_HAZARD      = STRUCTURAL / PROVEN
FULL_LONG_HISTORY_MOUNTED_DURING_NORMAL_BOTTOM_PIN = NOT PROVEN
HOST_SERIALIZATION_SCALE_HAZARD = STRUCTURAL / PROVEN
LIVE_COST_MAGNITUDE          = UNMEASURED
JSON_STRINGIFY_CAUSALITY     = HYPOTHESIS_ONLY
REPAIR_AUTHORIZED            = NO
PRODUCTION_DELTA             = ZERO
NEW_TESTS                    = ZERO
```

## What this ACT proves (and what it does not)

**Proved from source (HEAD `fbf3eef2e`):**

1. **The chat DOM is owned by the webview renderer** (Q1). This is
   the ClineMM-side reason to suspect the **workbench renderer**
   less — but **not** a source-level elimination of case B:
   VS Code/Electron scheduling, IPC pressure, and Chromium/Electron
   renderer interactions can render a window unresponsive even
   when no ClineMM function literally executes in the workbench
   renderer.
2. **No chat-specific ClineMM code path runs in the VSCodium main
   process** (Q1). Same caveat as (1): main-process freezing can
   still happen via IPC plumbing, sandbox mediation, or V8 host
   coordination; case D is LOW PRIOR, **not source-eliminated**.
3. **There is a real, single scaling field** that crosses IPC and
   gets rendered in the webview — `clineMessages` at
   `getStateToPostToWebview.ts:92`. Every other field is bounded
   or O(1) per post. (See scale-inventory.md.)
4. **The chat list is already virtualized** via `react-virtuoso`,
   but with `bottom: Number.MAX_SAFE_INTEGER` (`MessagesArea.tsx:255`).
   The structural hazard is `WEBVIEW_OVERSCAN_HAZARD =
   STRUCTURAL / PROVEN`. The concrete claim that full long history
   is mounted during normal bottom-pin is `FULL_LONG_HISTORY_MOUNTED_DURING_NORMAL_BOTTOM_PIN
   = NOT PROVEN`; mounting risk increases when the user scrolls
   upward. This is **not** the literal "10k DOM nodes" pathology
   of upstream VS Code #297349, but case A remains PLAUSIBLE
   pending native render-process evidence.
5. **The host's per-post hotpath is `JSON.stringify(state)`** at
   `subscribeToState.ts:62-70`, capped at ≤20/sec by
   `STATE_POST_DEBOUNCE_MS = 50` (`SdkController.ts:712`). For a
   session whose `clineMessages.length × avg-row-bytes` reaches
   tens of MB, the cost in the host's event loop scales linearly
   with total serialized bytes. `HOST_SERIALIZATION_SCALE_HAZARD =
   STRUCTURAL / PROVEN`; `JSON_STRINGIFY_CAUSALITY = HYPOTHESIS_ONLY`;
   `LIVE_COST_MAGNITUDE = UNMEASURED`.
6. **There is NO production-seam IPC recursion** in ClineMM today
   (Q11). The webview's functional updater is R9-pure
   (`ExtensionStateContext.tsx:666`); the host's
   `postStateToWebview` is not re-entered from its own event
   handlers. The Cline #13339 analogue (unbounded storm) is
   eliminated.

**What this ACT does NOT prove:**

- It does NOT prove which process is hot. Source-recon narrows the
  candidate set; the live capture (ps sorted by %CPU + `--status` +
  per-process sample) chooses between them. Until that capture
  runs, `PROCESS_CLASS_BOUND = NO`.
- It does NOT prove that `JSON.stringify` is the smoking gun. It
  shows that `JSON.stringify` is the only host-side hotpath whose
  cost scales with conversation length. The smoking gun is still
  hypothetical until `sample` confirms it.
- It does NOT prove that the upstream #9011 / #13306 / #13339 /
  #12939 / VS Code #297349 radar has the same root cause as
  ClineMM. Chronology ≠ causal identity.

## Classification (corrected per reviewer P0)

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

## Decisions made

- **No production code change.** `git status --short` shows only
  the `.factory/` additions and the `.gitignore` whitelist line;
  no production file touched.
- **No new RED.** The launch contract authorized at most one
  bounded production-seam probe at HEAD. With no recurrence and
  no deterministic reproduction, no RED was authored.
- **No bounded repair ACT authorized.** `ROOT_CAUSE_ISOLATED`
  requires the live capture; this ACT is `SOURCE_CANDIDATES_NARROWED
  / LIVE_PROCESS_CLASS_UNBOUND`, not `PROCESS_CLASS_BOUND`.
- **No new temp diagnostic.** The existing
  `recordStateSizeTelemetry` is the only live signal we need;
  if the per-post JSON crossed tens of MB during the operator's
  freeze, the telemetry stream already has it. (This proves the
  hazard was exercised; it does NOT prove it caused the freeze.)

## Next gate (operator-driven)

The next decision is gated on the operator running §3 of the ACT MD
on the next live freeze. The artifact path is:

```
.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/
  entry-freeze.ps.txt            (process table, sorted by %CPU)
  entry-freeze.vscode-status.txt (codium --status)
  entry-freeze.vm_stat.txt       (memory pressure)
  entry-freeze.<role>.sample.txt (one or more 10s native samples)
```

After the operator commits those artifacts, this ACT can be
re-opened and disposition becomes one of:

- `ROOT_CAUSE_ISOLATED` → a downstream bounded-repair ACT may be
  authored (NOT pre-authorized by this ACT).
- `PROCESS_CLASS_BOUND` (with case identified but exact seam not) →
  a follow-on ACT picks the next-most-deep discriminator.
- `NOT_REPRODUCED` (no second occurrence after sufficient waiting) →
  STOP. Recon is the deliverable; preserve the source-seam map
  for the next dogfood regression.
- `CAPTURE_INSUFFICIENT` (all candidates cold, no tie-break) →
  next ACT extends capture (consecutive `sample`s, instrumented
  `Buffer.byteLength` log around state post).

## Cross-references

- Source-seam map (file:line inventory):
  `.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/source-seam-map.md`
- Scale table (per-field growth + IPC + render):
  `.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/scale-inventory.md`
- Live-capture protocol (operator runbook):
  `.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01/live-process-capture.md`
- ACT MD (full Q1-Q12 + classification):
  `.factory/acts/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01.md`

## Operator runbook copy-paste

(Same as in `live-process-capture.md`; reproduced here for the
reviewer to verify)

```bash
DIR=.factory/evidence/ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01
mkdir -p "$DIR"

# 1. Process table — sort by %CPU (column 3), NOT %MEM.
ps -axo pid,ppid,%cpu,%mem,rss,vsz,etime,command \
  | grep -E 'VSCodium|Helper \(Renderer\)|Helper \(Plugin\)|gpu' \
  | grep -v grep \
  | sort -k3,3nr \
  > "$DIR/entry-freeze.ps.txt"

# 2. Native IDE classification. Use the Factory launcher's binary.
codium --status > "$DIR/entry-freeze.vscode-status.txt" 2>&1 || true

# 3. Memory pressure
vm_stat > "$DIR/entry-freeze.vm_stat.txt"
memory_pressure 2>/dev/null >> "$DIR/entry-freeze.vm_stat.txt" || true

# 4. Per-process sample — DO NOT auto-pick a single PID by one
#    metric. Operator selects materially-hot process(es) and samples
#    each in turn.
sample <PID> 10 -mayDie -file "$DIR/entry-freeze.<role>.sample.txt"
```

**End of ACT-CLINEMM-LONG-SESSION-UI-UNRESPONSIVENESS-RECON01.**
