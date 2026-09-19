41-selected-contract.md
=======================

# Selected contract — CORRECTION01

```
SELECTION = B_WITH_C_FUTURE_TRACK
```

CORRECTION01 narrows the rationale per the bounded
`HALT_DECISION_EVIDENCE_OVERCLAIM_AND_NOT_DURABLE`: the selection
itself is preserved (B is independently available now, A is not
qualified in this execution context, C is unavailable on the
current OS/signing substrate), but the claims about Strategy A's
host-wide status and Strategy C's macOS floor are narrowed below
to match what the substrate evidence actually supports.

## Why B (current contract)

ClineMM's current production contract, made explicit:

```
ClineMM guarantees cleanup of the primary owned process group of a
CommandJob. A command that deliberately creates a new session /
process group (setsid, Node detached:true, Python
start_new_session=True, double-fork + exit, nohup + disown) can
create descendants outside that guarantee. ClineMM does not attempt
universal descendant containment. ClineMM does not sweep same-UID
processes. ClineMM does not match executable names or process ages.
ClineMM does not parse command text to detect detachment.
```

Evidence for choosing B (per §15 of the ACT spec):

```
A is not qualified in this execution context
                        : sandbox_apply EPERM (Apple: parent-static-
                          sandbox inheritance means this is not a
                          global Seatbelt availability claim);
                          A_SEATBELT_ENFORCEMENT =
                          UNAVAILABLE_FROM_CURRENT_EXECUTION_CONTEXT;
                          general Sonoma viability = NOT_PROVEN
                          (10-strategy-a-seatbelt-recon.txt)

A blanket deny would break workflows
                        : 4 production paths require detached:true or
                          rely on unconstrained process-fork
                          (20-strategy-b-workload-inventory.txt).
                          This ACT does not prove that no finer-grained
                          SBPL policy could be written.

B is acceptable       : PGID-only contract matches existing production
                        behavior; matches upstream Cline's existing
                        model; matches the supervised-bash executor's
                        own PGID-leader primitive

PGID semantics already GREEN : PRIMARY_PGID_CLEANUP = PROVEN
                        (01-predecessor-run3-freeze.txt)
```

## Why C is on a future track (not now)

Strategy C requires gates the Factory substrate cannot satisfy
(30-strategy-c-platform.txt, 31-strategy-c-signing.txt,
32-strategy-c-entitlement.md):

```
es_new_descendants_client() : Beta API (per Apple); identified as
                              macOS 27-era by contemporary external
                              implementation work; absent from
                              macOS 14.0 SDK and from macOS 26.x SDK.
helper entitlement          : absent (adhoc-signed, no entitlements blob)
helper signing identity     : linker-signed adhoc (not Developer ID);
                              distribution vs. development grant may
                              differ per Apple capability guidance
ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED rc=5 confirmed live
ENTITLEMENT_AVAILABILITY    : UNKNOWN (not previously requested)
DISTRIBUTION_FEASIBILITY    : UNKNOWN
```

Strategy C is not rejected as a strategy; it is parked behind a
multi-gate qualification track (Apple entitlement, Developer ID
signing, macOS 27-era Beta API acceptance, un-sandboxed-host
qualification of E/F/G). ClineMM should re-open this decision when
any of those gates is crossed.

## What this ACT authorizes (and does not authorize)

This ACT authorizes ONLY:
  - Freezing the current production behavior as the documented
    contract (§§3.4, 3.5 of 21-strategy-b-product-contract.md).
  - Scheduling a successor ACT
    (ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01) that will
    implement the documentation/diagnostic surface.

This ACT does NOT authorize:
  - Any production code change.
  - Any Seatbelt profile change.
  - Any Endpoint Security entitlement request.
  - Any re-signing of the helper.
  - Any change to ⎇ telemetry.
  - Any change to CommandJobManager.

## Successor ACT

ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01
Purpose: PRODUCT_CONTRACT_QUALIFICATION
Implement the product contract from 21-strategy-b-product-contract.md
without any same-UID sweeping, without command-text heuristics,
without polling, and without resurrecting the falsified kqueue
primitive.
