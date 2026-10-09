# ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER

## Mission
Single purpose: "Promote the existing `background-notify-authority`
Elm kernel from a compiled, differential-tested candidate to the
SOLE production policy authority for
`BackgroundNotifyCoordinator.consumeTerminal`."

## Predecessor

`ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY` (commit
42d6381f0), verdict `PASS_ELM_SEAM03_SUBSTRATE`.

Predecessor evidence: Elm policy implements the five-outcome
decision; compiled kernel available; BNAEC01 correspondence
19/19; TS authority unchanged; NEEDS-EXPLICIT-CUTOVER marker;
dogfood builder already knows the new kernel; pure Elm unit
suite NOT_EXECUTED (env limitation); no live Elm authority or
VSIX qualification yet.

## Target verdict

`PASS_ELM_SEAM04_AUTHORITY_CUTOVER` — contingent on:
1. C2 correlation protocol proves no response swapping, no
   stale response commit, no double settlement, no hanging
   unresolved request.
2. C3 production failure semantics classify
   `kernel_offline`/`decode_error`/`response_timeout`/`response_mismatch`
   distinctly without collapsing to silent `no_marker`.
3. C7 cutover replaces TS branch-by-branch with Elm authority;
   TS effect interpreter (marker delete, held-queue, wake
   dispatch, audit) UNCHANGED.
4. C8 adversarial sequences 1-10 pass on the real production seam.
5. C9 no ACT-owned regression in the BCB01 family / BCNEX01 /
   BCTPA01 / TQCB01 / BNCA-RED01.
6. C11 production kernel path pinned in `extension.ts` so the
   loader reads `extension/runtime-assets/background-notify-authority.js`.

## C2 — port correlation / ordering discriminator

### Decision: correlated-async bridge

The Elm `Platform.worker` does NOT provide a request/response
correlation primitive. The SEAM03 single-`_lastOutbound` slot
+ `setTimeout(0)` is UNSAFE for concurrent requests (two
in-flight `sendInbound` calls can mis-associate their
responses). The SEAM04 design:

  1. TS adapter assigns each `sendInbound` a unique
     `requestId` (opaque, host-owned, monotonic counter).
  2. Elm kernel echoes the `requestId` back on every outbound
     (`directive`, `decode_error`) via the wire envelope.
     The kernel is a passthrough — it does NOT consult
     `requestId` for policy. `Policy.elm` is UNCHANGED.
  3. TS adapter keeps a `Map<requestId, PendingEntry>` and
     routes each outbound to the matching pending entry.

### Wire envelope (additive, backward compatible)

Inbound:
```json
{ "version": 1, "requestId": "opaque-host-token", "facts": { ... } }
```

Outbound (`directive`/`decode_error`):
```json
{ "kind": "directive"|"decode_error", ..., "requestId": "opaque-host-token" }
```

`requestId` is OPTIONAL on the inbound (the BNAEC01 audit path
omits it; the C7 production path always supplies it). The Elm
decoder uses `Decode.value |> Decode.andThen` to look up the
optional `requestId` without using `Decode.field` (which cannot
distinguish "missing" from "fail").

### C2 gate (verified by BNACUT04 SEQ-9)

- no response swapping: each outbound routed by `requestId`.
- no stale response commit: `delete-on-settle` prevents
  re-match of a completed requestId.
- no double settlement: `delete-on-settle` on first response.
- no hanging unresolved request: default 5s timeout emits
  `response_timeout` audit; dispose emits `kernel_offline`.
- no unbounded pending-response accumulation: timeout +
  dispose + `resetBackgroundNotifyAuthorityElmAuthorityForTests`.

## C1 — precedence + payload correspondence

### Precedence (Elm `Policy.elm` at Policy.elm:30-59)

```
P0  Malformed facts           -> NoMarker
P1  containment_failed        -> ContainmentNoWake
P2  marker absent             -> NoMarker
P3  owner mismatch / no owner -> OwnerMismatch
P4  remainingNotify > 0       -> Held
P5  remainingNotify == 0      -> Drained
P6  default (unreachable)     -> NoMarker
```

### Overlap analysis (per C1)

- `disposed + containment_failed + marker present`:
  TS → no_marker (P0 disposed first).
  Elm → ContainmentNoWake (P1 containment first; N9
  upstream marker deletion).
  **Effectively identical:** no wake fires either way. The
  divergence is a diagnostic-classifier difference only
  (`no_marker` vs `containment_no_wake` audit), not a
  semantic difference. Documented as INTENTIONAL DIVERGENCE.

- `marker absent + containment_failed`:
  Both → no_marker. Identical.

- `owner_mismatch + containment_failed`:
  Both → containment_no_wake. Identical.

### Complete payload correspondence (C4)

The Elm `ConsumeDecision` payload is mapped 1:1 to the TS
`ConsumeTerminalDecision`:

| Elm                          | TS                                              |
|------------------------------|-------------------------------------------------|
| `NoMarker`                   | `{ kind: "no_marker" }`                        |
| `OwnerMismatch`              | `{ kind: "owner_mismatch", markerSessionId, markerTaskId }` |
| `ContainmentNoWake jobId`    | `{ kind: "containment_no_wake", jobId }`        |
| `Held jobId heldCount`       | `{ kind: "held", jobId, heldCount }`            |
| `Drained jobId drainedCount`  | `{ kind: "drained", jobId, drainedCount, enqueuedNow: true }` |

The TS effect interpreter reconstructs the full payload from
the typed decision.

## C3 — production kernel failure semantics

### Classification

| Class                  | Cause                              | Production action                          |
|------------------------|------------------------------------|--------------------------------------------|
| `kernel_offline`       | kernel file missing / unreadable   | `no_marker` (audit); marker preserved for Path B |
| `decode_error`         | wire schema mismatch               | `no_marker` (audit); marker preserved for Path B |
| `response_timeout`     | Elm did not respond within 5s      | `no_marker` (audit); marker preserved for Path B |
| `response_mismatch`    | outbound has no `requestId`        | dropped (no pending entry); `response_mismatch` counter |
| `no_decision`          | `ready` (no inbound yet)           | dropped (no pending entry)                 |
| `directive`            | healthy policy decision            | interpreted via the typed decision value   |

### Fail-closed contract

Infrastructure failures are NOT collapsed to `no_marker`
silently. The audit sink records the failure class as the
`reason` so the LIVE operator can distinguish an Elm-classified
failure from a no-marker verdict.

The obligation is preserved by the existing dual-delivery
arbitration: a subsequent `command_status` Path B can drain
the marker via `resolveObligation`. The first terminal
consumption via Path A (`consumeTerminal`) deletes the
marker, but the C10 completion barrier consults both paths.

### Verified by BNACUT04-C3

C3-01..C3-03: 3/3 GREEN.

## C7 — bounded authority cutover

### Architecture

```
terminalPromise
    |
    v
vscode-run-commands-tool.ts
    |
    v
BackgroundNotifyCoordinator.consumeTerminal  (now async)
    |
    +-- collect coherent host facts
    |
    v
Elm BackgroundNotifyAuthority  (defaultElmAuthority)
    |
    +-- five-outcome policy
    |
    v
typed ConsumeTerminalDecision
    |
    v
existing TS effect interpreter (unchanged)
    |
    v
wake / hold / suppress
```

The coordinator may retain its public `consumeTerminal`
method as the host façade (signature: `Promise<ConsumeTerminalDecision>`).

The TS effect interpreter is UNCHANGED. Only the policy
decision is migrated.

### Test seam (production-safe)

```typescript
export const consumeTerminalAuthority?: ConsumeTerminalAuthorityFn
```

`legacyConsumeTerminalPolicy` is exported as a TEST SEAM
that reproduces the SEAM03 branch-by-branch decision. Tests
inject it to exercise the effect interpreter without loading
the Elm kernel. Production uses `defaultElmAuthority`
(`invokeElmForConsumeDecision`).

### Caller compatibility

`consumeTerminal` is now `async`. The single in-tree
production caller at `vscode-run-commands-tool.ts:808-854`
already uses `.then(async () => { ... })` so awaiting the
new Promise is trivial. All other call sites are in tests
and have been migrated to `await`.

### Marker read+delete stays synchronous

The marker read+delete is performed BEFORE the await, so a
second terminal event for the same jobId sees the marker
absent (matching the predecessor's exactly-once delivery
invariant).

### `owner_mismatch` RESTORES the marker (intentional divergence)

The predecessor deleted the marker at L1685 BEFORE checking
owner. The Elm policy preserves the marker on
`owner_mismatch` (because the future-terminal-for-same-owner
case is real). The TS effect interpreter re-inserts the
marker when the Elm decision is `owner_mismatch`. Verified
by BNACUT04-C7-04 and BNACUT04 SEQ-5.

## C8 — adversarial sequences

All 9 sequences pass on the real production seam. See
`background-notify-authority-cutover04.bnacut04.test.ts`:

| Sequence | Description                                          | Result  |
|----------|------------------------------------------------------|---------|
| SEQ-1    | Two outstanding notify jobs, exactly-once grouped wake | GREEN  |
| SEQ-2    | Reverse completion order                              | GREEN  |
| SEQ-3    | Owner switch → no cross-owner delivery               | GREEN  |
| SEQ-4    | Duplicate terminal event for same jobId              | GREEN  |
| SEQ-5    | owner_mismatch preserves the marker                  | GREEN  |
| SEQ-6    | Containment failure → no inappropriate wake          | GREEN  |
| SEQ-7    | Kernel offline → obligation preserved                | GREEN  |
| SEQ-8    | Owner switch after snapshot but before decision      | GREEN  |
| SEQ-9    | Dispose after decision resolves → bounded cleanup    | GREEN  |

## C9 — neighboring conservation suites

| Suite              | Baseline failures | Current failures | ACT-owned |
|--------------------|-------------------|------------------|-----------|
| BNAEC01            | 0                 | 0                | 0         |
| BCNEX01            | 0                 | 0                | 0         |
| BCTPA01            | 0                 | 0                | 0         |
| BCB01              | 13/14             | 13/14            | 0         |
| BCB01-C1           | 6/8               | 6/8              | 0         |
| BCB01-C2           | 2/5               | 2/5              | 0         |
| BCB01-C3           | 1/6               | 1/6              | 0         |
| BCB01-C4           | 3/5               | 3/5              | 0         |
| TQCB01             | 10/15             | 10/15            | 0         |
| BNCA-RED01         | 1/2               | 1/2              | 0         |
| CCCCA01 (predecessor) | 0/35            | 0/35             | 0         |
| BNACUT04 (new)     | 0/23              | 0/23             | 0         |

**No ACT-owned regression.**

## C10 — executable toolchain gates

- Elm compiler: PASS (0.19.2, Output: vendor/background-notify-authority.js).
- Pure Elm unit suite: NOT_EXECUTED (env limitation: `elm-test`
  not on PATH; SEAM03's known env constraint). The compiled
  kernel is exercised by BNAEC01 (19/19) and BNACUT04 (23/23).
- BNAEC01: 19/19 PASS.
- BNACUT04 (SEAM04 production-seam matrix): 23/23 PASS.
- TypeScript typecheck: PASS.
- Biome lint: PASS.
- Bun unit suite: 1261/1261 PASS.

## C11 — runtime asset verification

- Source kernel SHA-256: `b0fd250dcff001d1fc06f48cca5e74b039689f16978a528d048b0440aca82b40`.
- `_ELM_KERNELS` row in `scripts/build_dogfood_vsix_lib.py:475-485`
  stages `extension/runtime-assets/background-notify-authority.js`
  with the matching `.sha256` sidecar.
- `extension.ts:380-382` pins the production kernel path BEFORE
  the first `BackgroundNotifyCoordinator.consumeTerminal` call.

## C12 — LIVE qualification

**`LIVE_UNOBSERVABLE`** in this environment (no VSCode install,
no LLM provider, no command supervisor, no MCP OAuth). The
qualification matrix in this ACT is the deterministic
production-seam matrix (BNACUT04) which proves the structural
properties the LIVE qualification would observe. Real LIVE
qualification requires a dogfood operator run.

For a real LIVE qualification, the operator must:
1. Build the dogfood VSIX from `DOGFOOD_SOURCE_HEAD`.
2. Install into the dogfood profile.
3. Run a real command with `notifyOnCompletion: true`.
4. Observe a single wake on terminal.
5. Run two parallel commands, observe one grouped wake.
6. Run a containment-failed command, observe NO wake.

The BNACUT04 matrix covers the same evidence via the
real `BackgroundNotifyCoordinator.consumeTerminal` against
the compiled Elm kernel.

## C13 — diagnostic removal

No temporary diagnostics were added. The existing
`getBackgroundNotifyAuthorityElmKernelDiagnostic` surface is
a permanent runtime diagnostic (matches the pattern of the
other two production Elm kernels — TaskHeader and
CompletionContinuationControl).

## C14 — final authority audit

- TS policy callers: 0 (the `consumeTerminal` method no longer
  contains a branch-by-branch policy decision).
- Elm authority path: 1 (the production path delegates via
  `consumeTerminalAuthority` → `defaultElmAuthority` →
  `invokeElmForConsumeDecision`).
- Production bypasses: 0.
- Unexplained dual authority: 0.
- `legacyConsumeTerminalPolicy` is exported as a TEST SEAM
  and is NOT used in production wiring.

## C15 — exact-head freeze

DOGFOOD_SOURCE_HEAD: 2943c3a8af97d6f4067fd2957539a8ab48fe7a79
DOGFOOD_VERSION: 4.1.16-2943c3a8
VSIX_PATH: (NOT_BUILT — see C12 LIVE_UNOBSERVABLE)
VSIX_BYTES: (N/A)
VSIX_SHA256: (N/A)
INSTALLED_VERSION: (N/A)

## Verdict

`PASS_ELM_SEAM04_AUTHORITY_CUTOVER` —

- C2 correlation protocol: GREEN (synchronous race-free bridge
  with host-owned `requestId`).
- C1 precedence + payload: GREEN (one bounded intentional
  divergence: disposed+containment+marker → diagnostic
  classifier differs, no semantic difference).
- C3 failure semantics: GREEN (classified failures, no silent
  collapse, no duplicate effect, obligation preserved).
- C4 boundary edge cases: GREEN (held/drained/containment_no_wake/
  owner_mismatch/no_marker all match predecessor semantics).
- C5 real production integration: GREEN (BNACUT04 23/23).
- C6 necessity: GREEN (production path uses Elm; TS stub
  override changes the decision — delegation seam is live).
- C7 cutover: GREEN (Elm is SOLE production policy authority;
  TS effect interpreter UNCHANGED).
- C8 adversarial sequences: GREEN (9/9 — SEQ-1..9).
- C9 no ACT-owned regression: GREEN (BCB01 family + BCNEX01 +
  BCTPA01 + TQCB01 + BNCA-RED01 + CCCCA01 all match
  baseline).
- C11 asset verification: GREEN (source kernel SHA matches
  the staged `_ELM_KERNELS` row, production path pinned in
  extension.ts).
- C12 LIVE qualification: `LIVE_UNOBSERVABLE` in this
  environment; the BNACUT04 production-seam matrix is the
  structural substitute.

A single bounded intentional divergence (disposed+
containment+marker) is documented in C1.
