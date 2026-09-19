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

A: REFUTED on correctness (cannot reach reparented grandchild)
B: RACE_REFUTED on production feasibility (loses fork-before-attach race)
C: UNAVAILABLE on substrate (framework absent, entitlement impossible)

Per spec §9:
    Select A only if A survives E/F AND ownership remains
        unambiguous after reparenting.
    Select B only if all E/F descendants are deterministically
        captured AND race stress is clean AND no unrelated
        process is ever admitted.
    Select C only if entitlement is actually obtainable/useable
        AND API works on target macOS AND beta dependency is
        accepted explicitly AND E/F + controls pass.

None qualify. Per spec §9:
    If B fails and C is unavailable:
        Close:
            CAPTURED_ARCHITECTURAL_LIMIT
            NO_SAFE_GENERAL_DESCENDANT_CONTAINMENT_AVAILABLE
        Do not compensate with process-name or same-UID sweeping.

## Production consequence (per spec §25)

We keep:
    PGID_ONLY = production invariant
    ESCAPED_DESCENDANTS = known unsupported boundary

A separate ACT must decide whether to prohibit or mediate
detached process creation in Cline-owned commands. This ACT
does NOT make that decision; it only establishes that no
safe containment primitive is deployable on this substrate
for the setsid()/detached:true escape class.
