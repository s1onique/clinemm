# 03 — RED Reproduction

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01`
Labels: `REAL`, `REAL_PRODUCTION_SEAM`

---

## C3.1 Exact command, test name, source HEAD, output

```
$ cd apps/vscode
$ export PATH="$HOME/.bun/bin:$PATH"
$ bun x vitest run --config vitest.config.ts \
    src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts
```

* Source HEAD: `e0e30879f9e5cf0716242b00dc3cd9447fbaa6e1`
* Installed incident source: `1d9a37bcd408c185ef356303e1e5ac6237a15307` (byte-identical on all causal-path files)
* Test file: `apps/vscode/src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts`
* Test file SHA-256: `f5b1937ba162bea52d522fd9422d088879add4abd0d015cf20eaa024bc5b0ba3`

### Result

```
 ✓ src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts (5 tests) 312ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Test names:

| # | Test name | Role |
|---|---|---|
| 1 | `OPPOR01-REPLAY: the recorded incident sequence reproduces the hold / pending_prompt decision` | **R1 RED** |
| 2 | `OPPOR01-CF: supplying the source-backed continuation_started(promptId, runId) removes the pending_prompt hold` | C5/A2 counterfactual |
| 3 | `OPPOR01-NECESSITY: removing the continuation_started correlation restores the pending_prompt hold` | C5/A3 necessity |
| 4 | `OPPOR01-ADVERSARIAL: the counterfactual does not authorize completion when real obligations remain outstanding` | C5/A4 conservation |
| 5 | `OPPOR01-H1-H7: the REAL producer emits continuation_started only when a canonical run-started joins the held prompt` | C4 discriminator |

## C3.2 R1 — the reproduced hold

`OPPOR01-REPLAY` replays the 64 retained incident records through the real
production seams. Observed output:

```json
OPPOR01-REPLAY-REPORT {
  "sessionId": "1794840293250_5ugld",
  "recordsReplayed": 64,
  "adapterDirect": 15,
  "adapterInsufficientIdentity": 44,
  "adapterUnmodeled": 0,
  "filteredOut": 5,
  "continuationStartedDelivered": 0,
  "finalKind": "hold",
  "finalHoldReasons": [
    "pending_prompt",
    "scheduled_continuation"
  ],
  "recordedConsultCount": 8,
  "recordedHoldReasons": [
    "pending_prompt"
  ]
}
```

**Incident-specific symptom reproduced exactly:**

```
Elm decision = hold
Elm reason   = pending_prompt
```

`finalHoldReasons[0] === "pending_prompt"` — the head of the hold list, exactly
matching the eight recorded production consultations
(`elmDecision: "hold"`, `elmReason: "pending_prompt"`, eventSeq 6252/6254/6256/
6260/6264/6266/6270/6272).

### Per-record adapter results (baseline arm)

| count | stage | adapter verdict |
|---|---|---|
| 1 | `task_started` | DIRECT -> `task_started` |
| 1 | `run_turn_started` | DIRECT -> `run_started` |
| 5 | `agent_turn_done` | DIRECT -> `agent_turn_done` |
| 2 | `pending_prompt_enqueued` | DIRECT -> `pending_prompt_enqueued` |
| 2 | `pending_prompt_dequeued` | DIRECT -> `pending_prompt_dequeued` |
| 2 | `continuation_scheduled` | DIRECT -> `continuation_scheduled` |
| 2 | `submit_and_exit_seen` | DIRECT -> `submit_and_exit_seen` |
| 44 | `terminal_committed` | **INSUFFICIENT_IDENTITY** (no `terminalKind`) |
| 5 | `execute_turn_prelude_enter` | FILTERED_OUT (not in `AUTHORITY_STAGES`) |
| **0** | **`continuation_started`** | **NO SUCH RECORD IN THE EXPORT** |

`continuationStartedDelivered = 0`.

### Elm state after each meaningful transition (baseline arm)

| after | prompts | activeRun | hold reasons |
|---|---|---|---|
| seq 3 `run_turn_started` | — | `run_rCw8nsup` | `active_run` |
| seq 41 `agent_turn_done` | — | (none) | — |
| seq 46/47/48 (P1) | P1 = `scheduled` | (none) | `pending_prompt`, `scheduled_continuation` |
| seq 50 `agent_turn_done` | P1 = **`scheduled`** (unchanged) | (none) | `pending_prompt`, `scheduled_continuation` |
| seq 54/56/57 (P2) | P1 = `scheduled`, P2 = `scheduled` | (none) | `pending_prompt`, `scheduled_continuation` |
| seq 59 / 64 `agent_turn_done` | P1, P2 = **`scheduled`** (unchanged) | (none) | `pending_prompt`, `scheduled_continuation` |

**Remaining prompt IDs and states at the final consultation:**

```
P1 = pending_1794841243556_-tSbr  -> scheduled   (PromptScheduled)
P2 = pending_1794841410962_5gjid  -> scheduled   (PromptScheduled)
activeRun = (none)
```

**Final `computeHoldReasons`:** `[pending_prompt, scheduled_continuation]`
**Final completion decision:** `hold` / `pending_prompt`

## C3.3 R2 — is the reproduced `pending_prompt` an INVALID hold?

The primary invariant under test:

> A completion must not remain blocked solely by an orphaned prompt after every
> obligation belonging to that prompt has demonstrably settled.

### Proof that the prompts are orphaned (not outstanding)

Using the **real producer/consumer contract** — not the aggregate TypeScript
pending count:

1. **Every continuation turn ran to completion.** The recorded chronology for
   the session contains five `execute_turn_prelude_enter` (turns entered
   `executeTurn`) and five `agent_turn_done` (turns finished). The last
   `agent_turn_done` is seq 64 at `1794841469117`, i.e. **~18 seconds before**
   the final recorded authority consult at `2026-11-16T15:04:29.118Z`
   (the last `agent_turn_done` is `1794841469117` = 2026-11-16T15:04:29.117Z).
   The final consult at `15:04:29.118Z` is **1 millisecond** after the last turn
   finished.

2. **No `run_turn_started` exists for any continuation turn.** Only seq 3
   (`run_rCw8nsup`, the explicit-user turn). So no continuation run was ever
   correlated to a prompt.

3. **The `agent_turn_done` for the continuation turns carries the FIRST turn's
   runId.** `run_rCw8nsup` on seq 41, 50, 55, 59, 64. Under Elm semantics,
   `AgentTurnDone r` consumes `PromptRunning r` — but the prompts were never
   `PromptRunning`, and the run reference is the wrong one anyway.

4. **The TypeScript-side conservation predicates were already clear** (per the
   operator's C10 reevaluation at the same boundary): `remainingBlockingJobCount
   = 0`, `unconsumedTerminalCount = 0`, `ownerStillRunning = false`,
   `heldObligation = false`, `outstandingAutonomousWork = false`.

5. **No `completed` task phase was ever published for the incident.**

### RED criteria assessment

```
prompt execution demonstrably settled                -> YES (5/5 turns finished; no run ever started for either prompt)
no legitimate outstanding obligation                  -> YES (C10 conservation clear; no running job; no unconsumed terminal)
Elm continues to hold that prompt                      -> YES (hold / pending_prompt, 8 recorded consults)
```

**A genuine RED is established.**

The independent production-seam witness (PPLC-08, pre-existing, passing at this
HEAD) independently corroborates that the canonical subscription — i.e. the
`continuation_started` producer — is NECESSARY for the hold to clear.

## C3.4 RED rules compliance

| Rule | Compliance |
|---|---|
| Preserve exact command, test name, source HEAD and output | YES — recorded verbatim above and in `06-executable-receipts.md` |
| Capture failure identity, not just counters | YES — the failure identity is `elmReason: "pending_prompt"` + the two `PromptScheduled` prompt IDs + `continuationStartedDelivered = 0` |
| Do not leave an intentionally failing test in the default suite | YES — the RED is asserted as a PASSING witness: the file asserts `hold` + `pending_prompt`, so it passes against the UNMODIFIED production code and would FAIL once the defect is repaired. The file is included in the default vitest glob (`src/sdk/**/*.test.ts`) |
| Do not use a mock that replaces the causally important production adapter | YES — `adaptRecord` is the REAL imported function |
| Do not treat a hand-constructed Elm model as a real-production reproduction | YES — no Elm `Model` is ever constructed; every Elm state comes from the REAL kernel |

**No `HALT_RED_NOT_REPRODUCED`.** The RED reproduces.
