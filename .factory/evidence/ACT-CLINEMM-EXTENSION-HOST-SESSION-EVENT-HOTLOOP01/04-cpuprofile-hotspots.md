# 04 — CPU Profile Hotspots

Profile: `exthost-66cdb2.cpuprofile` (38,457 samples, 5,379.2 ms).
Hot-leaf measurement uses `timeDeltas` per node id (V8 cpuprofile contract).

## Top 20 leaves by self time (sample wall time)

| Rank | Self time     | % of profile | Sample count | Function                              | Source seam                          |
|-----:|--------------:|-------------:|-------------:|---------------------------------------|--------------------------------------|
|    1 |    1,430,400us |       26.6 % |       10,801 | Logger (Node-side `outputChannel`)    | `Logger.output` → `outputChannel.appendLine` I/O wait |
|    2 |    1,240,966us |       23.1 % |        6,700 | JEi (mangled)                          | `setWithWriter` listener fan-out     |
|    3 |      459,464us |        8.5 % |        3,566 | (program)                              | top-of-stack idle                    |
|    4 |      384,304us |        7.1 % |        2,978 | `#e` (mangled `Logger.#output`)        | `Logger.#output` (private composer)   |
|    5 |      215,713us |        4.0 % |        1,670 | `n.responseStream.e.<computed>`        | gRPC server-stream wire encode       |
|    6 |      166,535us |        3.1 % |        1,290 | `handleUnaryRequest`                  | gRPC request dispatch                |
|    7 |      127,608us |        2.4 % |          965 | `(garbage collector)`                  | GC pause                             |
|    8 |      100,832us |        1.9 % |          780 | `inl` (mangled)                        | (under `setTurnPhase`)               |
|    9 |       97,531us |        1.8 % |          757 | `XI` (mangled)                        | (under `setTurnPhase`)               |
|   10 |       89,021us |        1.7 % |          691 | `drain` (ext.js:2549)                 | gRPC wire encoding drain             |
|   11 |       79,831us |        1.5 % |          620 | (anon)                                | (under `outputChannel.appendLine`)    |
|   12 |       77,879us |        1.4 % |          603 | `handleSessionEvent` (ext.js:4467)    | coordinator.handleSessionEvent       |
|   13 |       51,387us |        1.0 % |          399 | `Pyi` (mangled)                        | (under `setTurnPhase` / `setWithWriter`) |
|   14 |       39,903us |        0.7 % |          309 | `onSessionEvent` (ext.js:4469)        | `SessionHost.onSessionEvent`         |
|   15 |       39,094us |        0.7 % |          302 | `setWithWriter` (ext.js:4468)         | `TurnStateTracker.setWithWriter`     |
|   16 |       30,954us |        0.6 % |          240 | `setTurnPhase` (ext.js:4469)          | coordinator → tracker                |
## Ancestor-bucket attribution (samples whose leaf was BELOW each ancestor)

| Ancestor                       | Samples | % of total | Total self time |
|--------------------------------|--------:|-----------:|----------------:|
| (any leaf)                     |  38,457 |     100.0% |       5,379,166us |
| below `handleSessionEvent`     |  17,202 |      44.7 % |       2,597,329us |
| below `setWithWriter`          |  ~9,500 |    ~24.7 %  |       ~1,440,000us |
| below `logQueueEvents`         |   7,802 |      20.3 % |       1,007,524us |
| below `onSessionEvent`         |  ~9,500 |    ~24.7 %  |       ~1,440,000us |

**Key fact:** samples whose leaf was below `logQueueEvents` account for
**20.3% of the entire 5.4-second profile**, even though `logQueueEvents`
itself is just a thin wrapper around `Logger.log`. The actual cost is in the
synchronous `Logger.#output` → `outputChannel.appendLine` chain that
`logQueueEvents` triggers every time it runs.

## Parent-chain attribution for `Logger.#output` (rank 4)

All three distinct `#e` node ids have the IDENTICAL parent chain:

```text
#e @ extension.js:7:2055                    <- Logger.#output
log @ extension.js:7:1879                   <- Logger.log
logQueueEvents @ extension.js:4467:30148    <- coordinator.logQueueEvents
handleSessionEvent @ extension.js:4467:22424
onSessionEvent @ extension.js:4469:7730
a @ extension.js:4466:28903
emit @ extension.js:2347:6444               <- EventEmitter.emit
emit @ extension.js:2549:52397              <- nested emit
```

**100% of the rank-4 self time (384,304us / 7.1%) is attributable to the
`logQueueEvents` call site.** No other production call site feeds the
rank-4 `#e` leaf.

## Causal hypothesis (mechanical, not yet proven)

The dominant CPU monopoly in the LIVE profile is the synchronous
`outputChannel.appendLine` triggered by `logQueueEvents` on every
`pending_prompts` / `pending_prompt_submitted` event. There is no evidence
in the profile of:

- synchronous re-entry into `handleSessionEvent` (the depth discriminator
  would have flagged it, but it is not yet wired),
- session-event feedback loops (the leaf counts at the handler level are
  within an order of magnitude of the per-lifecycle expectation),
- pathological queue drain re-entry (the `drain` self time is small).

The profile points decisively at **EH4_LOGGING_HOTPATH** with a secondary
overlay of **EH2_REDUNDANT_STATE_WRITE_STORM** (same-phase writes were
captured in the LIVE trace, but the redundancy ratio needs the
EHLOOP01 counter to quantify).

## Symbolication notes

esbuild minifies single-letter identifiers (`#e`, `JEi`, `inl`, `Pyi`,
`XI`, etc.). Source-map lookup of those mangled names in `apps/vscode/dist/extension.js.map`
returns ambiguous positions because the production source-map points
several distinct minified functions at the same source line. The
symbolication is therefore restricted to the function names that are
intentionally preserved in the bundle (`handleSessionEvent`,
`setTurnPhase`, `setWithWriter`, `logQueueEvents`, `onSessionEvent`,
`drain`, `enqueue`, `emit`, etc.). For those the symbolication is
unambiguous and the source lines are accurate.
|   17 |       24,717us |        0.5 % |          192 | `runTurn`                             | `LocalRuntimeHost.runTurn`           |
|   18 |       19,745us |        0.4 % |          146 | `fromString` (Buffer.from)            | outputChannel serialization          |
|   19 |       16,640us |        0.3 % |          128 | `onSessionEvent` (other instance)     | session event source                 |
|   20 |       16,406us |        0.3 % |          127 | `enqueue` (ext.js:2549)               | `PendingPromptsController.enqueue`   |
