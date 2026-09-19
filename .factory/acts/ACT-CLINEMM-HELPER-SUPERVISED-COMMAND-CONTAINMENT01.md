# ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01 — CONTAINMENT_PRIMITIVE_DISCRIMINATOR (NOT YET FROZEN)

## Goal

**Discriminate** which real macOS authority primitive can
actually survive the reproduced Node `detached:true` and Python
`start_new_session=True` escape, then pick one (and only one)
for the helper-supervised spawn boundary. This ACT does NOT
yet freeze a mechanism — it freezes a decision procedure for
mechanism selection.

## Status: RE-SCOPED per Factory reviewer P1 (2026-09-18)

The earlier draft of this ACT assumed a cleanup-time
PPID/`proc_pidinfo` walk would recover escaped descendants.
Per the Factory reviewer's P1 finding, this assumption is NOT
established:

  - Apple distinguishes `ppid` from `original_ppid`. Once a
    process is reparented to PID 1, the current `ppid` no longer
    gives you the chain back to the helper-owned root.
    [Apple Developer: original_ppid](https://developer.apple.com/documentation/endpointsecurity/es_process_t/original_ppid?language=objc)
  - Current Apple Endpoint Security
    `es_new_descendants_client` API observes a process and its
    recursively created descendant subtree, including
    subsequent forks/execs — which is exactly the semantic
    problem here — but it requires the Endpoint Security
    entitlement and Apple currently marks the API beta.
    [Apple Developer: es_new_descendants_client](https://developer.apple.com/documentation/endpointsecurity/es_new_descendants_client%28_%3A_%3A%29?changes=_2_1_1&language=objc)
  - macOS `EVFILT_PROC` with `NOTE_FORK` exposes event-time
    fork lineage tracking. This is an event-time approach
    worth discriminating rather than reconstructing ancestry
    after the fact.
    [Apple: EV_SET(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/EV_SET.2.html)

So the previous "default is the stronger primitive;
`helperSupervised=false` is the backward-compat default"
framing in this ACT was internally contradictory — a primitive
that has not been chosen cannot be the default. Re-scoped.

## Background (carried over from ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01)

  - Bounded PGID cleanup works for cooperative descendants
    (fixtures A-D, all descendants gone).
  - Escape fixtures E-F (`node-escape`, `python-escape`) survive
    PGID cleanup: the descendant process is reparented to PID 1
    with its own PGID.
  - Reproduction is on the real helper substrate (PPID=1, new
    PGID evidence). See
    `.factory/evidence/ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01/{node-escape,python-escape}.json`
    and Appendix A of `03-current-pgid-contract.md`.

## Non-goals

  - This ACT does NOT modify the existing PGID-only cleanup path.
    That path remains the bounded-correct behavior under
    `TERMINAL CommandJob ⇒ PRIMARY OWNED PGID GONE` (the
    invariant pinned by ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
    correction05).
  - This ACT does NOT pick a default. Until the discriminator
    produces a verdict, no new primitive is selected by
    configuration. The codebase remains on the bounded PGID
    path; the escape is documented as REFUTED for the bounded
    invariant and OUT-OF-SCOPE for the helper-supervised
    boundary until the discriminator completes.

## Decision procedure (this ACT's actual content)

Test three candidate authority mechanisms against the already-
reproduced E/F escapes. Each is exercised against the same
helper substrate used in ACT-CLINEMM-REAL-LAUNCHAGENT-SIGNAL-DISCRIMINATOR02
so the verdict is comparable to the existing bounded-invariant
evidence. The verdict is the first mechanism that produces a
deterministic, fail-closed classification for BOTH bounded
fixtures (A-D, all `descendants_zero = TRUE`) AND escape
fixtures (E-F, `descendants_zero = TRUE`).

  - **A. Cleanup-time PPID/`proc_pidinfo` reconstruction.**
    Walk `proc_pidinfo` for the helper-owned root, walk each
    descendant by `ppid`. **EXPECTED FAILURE** on the
    reproduction substrate: Apple distinguishes `ppid` from
    `original_ppid`, so the chain breaks at reparenting. This
    is the disproof of the previously-frozen mechanism.
  - **B. Event-time fork lineage tracking from the helper.**
    Subscribe the helper to `EVFILT_PROC NOTE_FORK` on the
    owned root, accumulate a fork-lineage set across the
    job's lifetime, walk the set at exit time and `kill(-pgid,
    0)`/`kill(pid, 0)` for each member.
  - **C. Native stable descendant authority.** Use
    `es_new_descendants_client` (Endpoint Security) to observe
    the process and its recursively-created descendants
    including subsequent forks/execs. Requires the Endpoint
    Security entitlement; Apple marks the API beta. **Cannot
    be the default** if the entitlement is not granted or the
    beta API is unacceptable.

## Verdict selection (frozen at ACT close)

After all three mechanisms have been exercised, this ACT
freezes ONE of:

  - `MECHANISM_A`: kept (B and C deferred — but A's
    disproof means the freeze is "A is not enough; we accept
    that the escape case remains REFUTED for the helper-
    supervised boundary"). This ACT becomes a
    CONTAINMENT-DENIAL verdict: no real primitive survives.
  - `MECHANISM_B`: accepted (default selection is event-time
    fork lineage tracking). The previous "default is stronger
    primitive" framing is replaced with a configuration flag
    `helperSupervised: "event-fork-trace" | "pgid-only"`.
  - `MECHANISM_C`: accepted (default selection is Endpoint
    Security descendant tracking). The configuration flag
    `helperSupervised: "es-descendants" | "pgid-only"`.
    Requires entitlement work and beta-API risk acceptance
    documented in the verdict.

A verdict other than `MECHANISM_A` rejects the prior
"helperSupervised default = stronger primitive" framing and
asserts the configuration flag explicitly. The default selection
question is DECIDED here, not assumed.

## Success criteria

  - All escape fixtures (E-F) report `descendants_zero = TRUE`
    under the chosen mechanism.
  - All bounded fixtures (A-D) still report `descendants_zero =
    TRUE` under both modes (no regression).
  - The verdict is committed at ACT close; the chosen
    mechanism is documented with the entitlement / API-maturity
    caveats that informed the choice.

## Gates

  - `bunx tsc --noEmit` clean.
  - DCCT matrix extended with the chosen mechanism's
    composition coverage.
  - Webview gauge tests preserved (no regression on the
    `⎇ N` rendering).

## Authorization

This ACT is authorized by ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
correction05 (bounded fix cycle, 2026-09-18). The bounded fix
cycle established `PRIMARY_PGID_CONSERVATION = PROVEN` (with
`terminal_committed` gated on `gone`) and reproduced CASE_B; no
further recon is needed to justify the discriminator work.
Mechanism selection is the only remaining epistemic gap.
