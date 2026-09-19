40-decision-matrix.md
=====================

# Decision matrix (filled from substrate evidence) — CORRECTION01

CORRECTION01 narrows the matrix per the bounded
`HALT_DECISION_EVIDENCE_OVERCLAIM_AND_NOT_DURABLE`:

  - Strategy A row previously claimed NO enforceability on Sonoma
    from a single EPERM observation. The honest claim is
    UNAVAILABLE_FROM_CURRENT_EXECUTION_CONTEXT — the agent process
    that produced the observation is itself sandboxed, so Apple-
    documented parent-static-sandbox inheritance means an EPERM
    observed from a sandboxed parent is not evidence Seatbelt is
    globally unavailable on the host. General Sonoma viability is
    NOT_PROVEN.

  - Strategy A "blanket deny" row previously conflated "no kernel
    policy can be written that does not break all four paths" with
    "blanket (deny process-fork) breaks all four paths". Only the
    latter is proven.

  - Strategy C row previously said "macOS 15+ floor". Per Apple
    documentation the symbol is **Beta** and is identified by
    contemporary external implementation work as a macOS 27-era API
    absent from macOS 26.x SDK/runtime. The honest claim is
    CURRENT_APPLE_BETA_API_FLOOR = macOS 27 / current beta SDK
    generation; CURRENT_SONOMA_SUBSTRATE = UNAVAILABLE. Do NOT
    infer "macOS 15" merely because SDK 14 lacks the symbol.

| Property                             | A: kernel-enforced deny           | B: PGID-only contract               | C: Endpoint Security                     |
| ------------------------------------ | --------------------------------- | ----------------------------------- | ---------------------------------------- |
| Safe against G counterexample        | UNKNOWN / NOT_PROVEN (qualification on un-sandboxed host required) | YES by contract (G is outside the documented scope) | YES by API (descendants-client is recursive over the subtree) |
| Enforceable in this execution context | NO (sandbox_apply returns EPERM; see 10-strategy-a-seatbelt-recon.txt) | YES (already used by CommandJobManager) | NO (helper has no entitlement; see 31-strategy-c-signing.txt) |
| Enforceable on Sonoma generally      | NOT_PROVEN — needs un-sandboxed developer-Mac qualification (precedent: ACT-CLINEMM-SEATBELT-GO-DEFAULT-CACHE01) | YES (already used by CommandJobManager) | NO (es_new_descendants_client is a Beta symbol, absent from SDK 14 and SDK 26.x; see 30-strategy-c-platform.txt) |
| No Apple special entitlement         | YES                                | YES                                  | NO (requires com.apple.developer.endpoint-security.client) |
| Works with local adhoc helper        | UNKNOWN (cannot be measured without un-sandboxed qualification) | YES (already works)                  | NO (es_new_client returns ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED; see 31-strategy-c-signing.txt) |
| Allows arbitrary daemonization       | Depends on policy shape — blanket `(deny process-fork)` would deny; finer-grained shape is TBD | YES (with documented caveat)        | YES (recursive subtree tracking does not require user cooperation) |
| Strong zero-descendant guarantee     | UNKNOWN without un-sandboxed qualification | NO (PGID-bounded by contract)      | YES (descendants-client is recursive by design) |
| Breaks existing legitimate workflows | Blanket deny: YES (4 production paths require detached:true). Finer-grained shapes: not addressed by this ACT. | NO (existing behavior preserved)     | NO (the descendants-client is non-cooperative from the child's POV) |
| Production complexity                | HIGH (kernel-level policy generator + un-sandboxed qualification tests + Apple distribution story) | LOW (diagnostic + doc update)       | VERY_HIGH (entitlement + Developer ID signing + macOS-27-era Beta-API acceptance + un-sandboxed host qualification) |
| New privileged/trusted surface       | YES (kernel Seatbelt is a new trust boundary) | NO                                  | YES (ES client is a new trust boundary) |
| Current deployability                | NOT_QUALIFIED_HERE                | YES                                  | NO (CURRENT_SONOMA_SUBSTRATE = UNAVAILABLE; ENTITLEMENT = UNKNOWN; DISTRIBUTION = UNKNOWN) |

Honest verdicts:

```
A current deployability:           NOT QUALIFIED HERE
A general enforceability on Sonoma: UNKNOWN / NOT PROVEN
B:                                 AVAILABLE — current production contract
C:                                 ARCHITECTURALLY PROMPING,
                                   CURRENTLY UNAVAILABLE,
                                   ENTITLEMENT = UNKNOWN,
                                   DISTRIBUTION = UNKNOWN
```

Notes per row (only non-obvious ones):

- "Safe against G counterexample" for B: by contract, fixture G is
  exactly the kind of pattern that is OUTSIDE the containment boundary
  that Strategy B promises. B does not try to contain G; B documents
  G as an unsupported boundary. So B is "safe" only in the sense that
  it does not make the promise that G falsifies.

- "Breaks existing legitimate workflows" for A: the four production
  paths in 20-strategy-b-workload-inventory.txt (connector supervisor,
  hub daemon, browser automation, supervised-bash PGID leadership)
  all use detached:true or rely on process-fork being unconstrained.
  This proves that a blanket `(deny process-fork)` would break them;
  it does NOT prove that no finer-grained SBPL policy could be
  written that preserves the legitimate workflows while still
  blocking session escape. The general kernel-policy existence
  question is out of scope for this ACT.

- "Strong zero-descendant guarantee" for A: would be true IF A were
  enforceable in a qualified way; on this substrate we only have
  an in-context observation, so the row is academic.

- "Production complexity" for B: only diagnostic + doc update. No new
  primitives, no new code paths, no new dependencies.

- "Production complexity" for C: requires (a) Apple-granted
  entitlement (development and Developer ID distribution may have
  separate grant requirements), (b) Developer ID signing, (c)
  acceptance of the Beta API on a macOS 27-era runtime floor,
  (d) live E/F/G qualification on an un-sandboxed host. These
  compound; the runtime floor alone may force a ClineMM
  feature-deprecation path.

