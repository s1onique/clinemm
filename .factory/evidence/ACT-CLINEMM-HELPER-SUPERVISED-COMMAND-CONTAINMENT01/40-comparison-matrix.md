# MECHANISM COMPARISON MATRIX

ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01

| Property                                 | A: cleanup ancestry | B: kqueue lineage              | C: ES descendants |
|------------------------------------------|--------------------:|-------------------------------:|------------------:|
| Works on A-D (inherited PGID)           | PASS (no escapes)   | PASS (no escapes)              | UNAVAILABLE       |
| Works on Node escape E                  | REFUTED (misses)    | RACE_REFUTED (loses to race)   | UNAVAILABLE       |
| Works on Python escape F                | REFUTED (misses)    | RACE_REFUTED (loses to race)   | UNAVAILABLE       |
| Survives reparenting                    | NO (ppid -> 1)      | YES (if tracked at fork time)  | UNAVAILABLE       |
| Survives new PGID/session               | NO                  | YES (after attach)             | UNAVAILABLE       |
| Recursive race-free evidence            | N/A                 | FAIL (5/5 iterations missed)   | UNAVAILABLE       |
| Kernel-backed identity                  | NO (uses ps)        | YES (kqueue + sysctl)          | UNAVAILABLE       |
| Can exclude unrelated process           | NO (would need UID) | YES (negative control PASS)    | UNAVAILABLE       |
| Requires entitlement                    | NO                  | NO                             | YES               |
| Requires beta API                       | NO                  | NO                             | YES               |
| Deployable in current LaunchAgent       | YES                 | YES                            | NO (entitlement)  |
| Production complexity                   | LOW (read ps)       | HIGH (helper-mediated spawn +  | VERY HIGH         |
|                                          |                     | reconcile, race-sensitive)     |                   |

## Detailed evidence pointers

### A: cleanup-time PPID-chain ancestry
- 10-mechanism-a-cleanup-ancestry.json (full result matrix)
- 10-mechanism-a-recon.txt (narrative)
- 11-mechanism-a-node-escape.json (specific E run, REFUTED)
- 12-mechanism-a-python-escape.json (specific F run, REFUTED)

### B: kqueue event-time lineage
- 20-mechanism-b-capability.json (initial attach test)
- 20-mechanism-b-capability.txt (narrative, 5 capability probes)
- 25-mechanism-b-control.json (negative control run)
- 25-mechanism-b-control.txt (narrative)

### C: Endpoint Security descendants client
- 30-mechanism-c-availability.txt (3-blocker diagnosis)
- 31-mechanism-c-entitlement.txt (codesign + entitlement absence)

## Verdict

A: REFUTED on correctness (cannot reach reparented grandchild).
B: **RACE_REFUTED on production feasibility for the
   spawn-then-attach sequence** (loses fork-before-attach race;
   5/5 immediate-fork iterations miss both grandchildren).
   B's primitive attach-then-spawn direction is **PASS** when the
   race is artificially avoided by external sequencing
   (`24-mechanism-b-double-fork.json`,
   `B_DOUBLE_FORK_ZERO = PASS (when race avoided, by external
   sequencing)`). The defect is the spawn-race in the
   production sequence, NOT the primitive.
C: UNAVAILABLE on this Sonoma 14.7.4 / installed-SDK substrate
   (framework absent from `/System/Library/Frameworks`,
   `/System/Library/PrivateFrameworks`, Cryptex root; helper
   adhoc-signed → cannot carry
   `com.apple.developer.endpoint-security.client`). Endpoint
   Security remains a documented macOS framework/API family
   (https://developer.apple.com/documentation/EndpointSecurity);
   C is unavailable on this substrate specifically, not as a
   general macOS fact.

Per spec §9:
    Select A only if A survives E/F AND ownership remains
        unambiguous after reparenting.
    Select B only if all E/F descendants are deterministically
        captured AND race stress is clean AND no unrelated
        process is ever admitted.
    Select C only if entitlement is actually obtainable/useable
        AND API works on target macOS AND beta dependency is
        accepted explicitly AND E/F + controls pass.

None qualify **for the current spawn-then-attach production
architecture**. The load-bearing distinction is:

    RETRACTED (Factory reviewer 2026-09-19
    HALT_CONTAINMENT_CONCLUSION_EXCEEDS_DISCRIMINATOR):
        NO_SAFE_GENERAL_DESCENDANT_CONTAINMENT_AVAILABLE
        (this label exceeded the discriminator evidence;
        the primitive's attach-then-spawn direction was never
        falsified by this ACT).

    NARROWED (this corrected closure):
        NO_SAFE_POST_SPAWN_CONTAINMENT
        AVAILABLE_IN_CURRENT_ARCHITECTURE
        (what this ACT actually proved).

Do not compensate with process-name or same-UID sweeping.

## Production consequence (per spec §25)

We keep:
    PGID_ONLY = production invariant
    ESCAPED_DESCENDANTS = known unsupported boundary
                          in the current spawn-then-attach sequence

The successor ACT (`ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01`)
falsifies (or confirms) the next causal discriminator implied by
this ACT's evidence but never run: does kqueue+reconciliation
retain complete ownership through every escape class when the
watch is installed BEFORE the user command's first fork?

This ACT does NOT make the policy/remediation decision. Only if
the successor reports REFUTED should
`ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01` be
authorized.
