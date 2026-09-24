# synthetic-stale-pid-initial-dead

CORRECTION01 (P0 — false-TA6 on initial-dead PID) end-to-end evidence.

## Scenario

The operator starts the external observer with `--pid 99999999` — a PID that
does not exist (e.g. the operator guessed the wrong PID, or the Extension Host
was already dead before the observer was launched). The observer polls for 1.5
seconds at 300 ms cadence, records 6 samples, and all 6 samples have
`alive: false` because the PID was never alive during the observation window.

## Expected analyzer behavior (post-CORRECTION01)

The observer writes:
- `extension_host_started_at = null` (no alive sample was ever recorded)
- `extension_host_observed_alive = false`
- `extension_host_terminated = false`
- `extension_host_restarted = false`
- `observation_window_completed = true`

The analyzer's `parentLifecycleObservedAlive` predicate is FALSE
(`extension_host_observed_alive === true` is false AND no sample has
`alive: true`). The `affirmativeNegativeWitness` predicate fails the
`parentLifecycleObservedAlive` gate. Verdict: **TA5 CAPTURE_INSUFFICIENT**.

## Expected behavior (pre-CORRECTION01 — RED)

Without the observed-alive gate, the analyzer would have computed
`affirmativeNegativeWitness = true` (because `extension_host_started_at` was
derived from `samples[0]?.at` — a non-null timestamp on a dead sample). Verdict
would have been **TA6 NOT_REPRODUCED** — recreating exactly the epistemic
failure this ACT was intended to remove.

## RED proof

The classifier-side RED proof is in
`extension-host-termination-authority01.termination-authority.test.ts`
`__RED_PROOF_TALIVE_OBSERVER_INITIAL_DEAD_01`:
`AssertionError: expected 'TA6' to be 'TA5' // Object.is equality`

The analyzer-side GREEN proof is `verdict.json`:
`classification: "TA5"`, `label: "CAPTURE_INSUFFICIENT"`,
`derived_from.parent_lifecycle_observed_alive: false`.
