# ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01

**Primary epistemic purpose:** `REMEDIATION_DECISION`

**Status:** PASS (BOUNDED CORRECTION01 applied per
`HALT_DECISION_EVIDENCE_OVERCLAIM_AND_NOT_DURABLE`). The original
closure overclaimed Strategy A as "REFUTED on Sonoma" when only
"unavailable in this execution context" was proven, and mis-stated
the Strategy C macOS floor as "15+" when the API is in fact a
current-beta / macOS-27-era symbol absent from the 14.0 and 26.x
SDKs. The selection itself (`B_WITH_C_FUTURE_TRACK`) does not depend
on the overclaim — B is independently available now, A is not
qualified in this execution context, and C is unavailable on the
current OS/signing substrate — so the bounded narrowing preserves
the selection. ACT body, evidence packet, result.json, decision
matrix, and epic-board row are all committed in this round so the
closure is durable.

**C1: GO.**

## 0. Identity

- ACT family: descendants / process-containment / substrate remediation.
- Predecessor (now frozen): ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01.
- Successor (NOT in this ACT): ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01.
- Reviewers: Factory reviewer, macOS process-control engineer, ClineMM runtime architect.

## 1. Decision

```
SELECTION = B_WITH_C_FUTURE_TRACK
```

ClineMM adopts the **PGID-only containment contract** (Strategy B) as its
current production contract. Strategy C (Endpoint Security descendants
client) is parked on a future qualification track.

No production code changes are made by this ACT. This ACT freezes the
decision and authorizes exactly one successor ACT.

## 2. Predecessor closure

The following facts are inherited from predecessor ACTs and not
re-litigated here (full bound evidence in
`.factory/evidence/ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01/01-predecessor-run3-freeze.txt`):

```
PRIMARY_PGID_CLEANUP              = PROVEN for inherited-PGID trees
ACTIVE_JOB_GAUGE                   = GREEN (⎇ counts CommandJobs, not processes)
DESCENDANT_ESCAPE                  = REAL / REPRODUCED
A_cleanup_time_ppid_reconstruction = REFUTED
B_spawn_then_attach_kqueue         = RACE_REFUTED
B_suspended_preattach_kqueue       = REFUTED by RUN_3 fixture G
C_endpoint_security_descendants    = unavailable on CURRENT Sonoma/SDK/signing substrate
GENERAL_DESCENDANT_CONTAINMENT     = NOT IMPLEMENTED
```

The 100× kqueue race hammer was **not run** because the primitive is
already falsified by a stronger single counterexample (fixture G =
double-fork-setsid). Fixture G is constructed so the second fork
happens immediately after setsid in the child, and is observed in
ground truth as `pid=43372, start_us=1789826834840193`, which is
absent from the kqueue-tracked set `{43370, 43371}`. Hammering the
witness adds the same `(pid,start_us)` pair 100 more times without
strengthening the falsification.

The eight oracle-correction rounds of the predecessor ACT are NOT
re-opened. Their only purpose was to make the negative result
trustworthy.

## 3. Strategy evaluation

### 3.1 Strategy A — kernel-enforced escape denial

Recon target: macOS Seatbelt `(deny process-fork)` profile.

**Substrate result (HONEST, narrowed per the bounded correction):**
the Seatbelt `sandbox_apply` system call returns `EPERM (rc=71)`
when invoked from THIS execution context — which is itself a sandboxed
ClineMM agent process — even for the trivial `(version 1) (allow default)`
profile. Apple documents that a child process inherits the parent's
static sandbox, so an EPERM observed from a sandboxed parent is not
evidence that Seatbelt is *globally* unavailable on this host.

The production Seatbelt availability probe (`probeSeatbeltAvailability()`
in `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-availability.ts`)
also returns `false` for this execution context.

What this ACT actually proves:

```
A_SEATBELT_ENFORCEMENT =
    UNAVAILABLE_FROM_CURRENT_EXECUTION_CONTEXT
STRATEGY_A_CURRENTLY_QUALIFIED              = NO
STRATEGY_A_GENERAL_VIABILITY_ON_SONOMA      = NOT_PROVEN
```

Strategy A is therefore **NOT currently qualified** in this execution
context. We do not claim it is impossible everywhere. A future
qualification on an un-sandboxed developer-Mac (per the
ACT-CLINEMM-SEATBELT-GO-DEFAULT-CACHE01 pattern, where the same
EPERM-from-sandboxed-parent hazard was encountered) would be required
to refute Strategy A globally.

A second note: a blanket `(deny process-fork)` policy is *not* the
target primitive. The real goal — preventing session escape while
allowing ordinary fork/exec — would require a more carefully scoped
SBPL profile that does not deny `process-fork` outright. The 4
inventory paths that rely on unconstrained fork demonstrate that
*a blanket deny cannot be the policy shape*, not that *no possible
policy could be written*. This ACT does not prove the latter.

The 4 production paths that intentionally use `detached:true` or rely
on unconstrained `process-fork` are still relevant for whatever
policy shape is eventually chosen:

| # | Path | Owner |
|---|------|-------|
| 1 | `sdk/packages/core/src/services/connectors/connector-supervisor.ts:426` | Slack/Telegram/WhatsApp/GChat connectors |
| 2 | `sdk/packages/core/src/hub/daemon/index.ts:381` (`spawnDetachedHubServer`) | Hub daemonization |
| 3 | `apps/vscode/src/services/browser/BrowserSession.ts:123` | Puppeteer Chrome relaunch |
| 4 | `sdk/packages/core/src/extensions/tools/executors/bash.ts:806` | Supervised bash executor's PGID-leader pattern |

Full inventory at `20-strategy-b-workload-inventory.txt`.

### 3.2 Strategy B — explicit PGID-only contract

ClineMM already terminates the leader PGID of a CommandJob via the
helper-owned PGID (ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01).
The contract here is to make explicit what is already in force:

  - Contained: leader + inherited-PGID descendants.
  - Not contained: anything that has called `setsid()` /
    `detached:true` / `start_new_session=True` / nohup+disown /
    double-fork+exit.
  - ⎇ stays as "active CommandJobs" (already correct).
  - No same-UID sweeping. No process-name matching. No command-text
    parsing. No polling.

This is a product-contract decision, not a technical failure. The
contract is what upstream Cline already operates under; ClineMM is
making it explicit.

```
STRATEGY_B = VIABLE / ACCEPTABLE
```

Full contract: `21-strategy-b-product-contract.md`.

### 3.3 Strategy C — Endpoint Security descendants client

Semantically attractive: per Apple documentation
(`es_new_descendants_client(_:_:)`), the descendants-client scopes
an Endpoint Security client to the entire descendant subtree of the
caller, recursively, including existing and future descendants, and
requires the Endpoint Security entitlement while not requiring root
or TCC approval. That is exactly the containment primitive we wanted.

Currently deployable: **NO**, on three independent grounds:

| Gate | Current state |
|------|---------------|
| SDK API `es_new_descendants_client()` | Absent from macOS 14.0 SDK (this host runs 14.7.4). Per Apple the symbol is **Beta** and contemporary external implementation work identifies it as a **macOS 27-era** API, absent even from the macOS 26.x SDK/runtime. Do NOT infer "macOS 15 floor" merely because SDK 14 lacks the symbol. |
| Helper signing identity | Linker-signed adhoc, no Developer ID. Distribution vs. development entitlements may differ (Apple guidance on capability grants). |
| Helper entitlements | None; live `es_new_client()` returns `ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED` (rc=5), confirming the `com.apple.developer.endpoint-security.client` entitlement is missing. |
| Apple entitlement grant | UNKNOWN — not previously requested. |
| Beta API acceptance | PENDING — no prior decision in Factory ACTs. |

```
CURRENT_APPLE_BETA_API_FLOOR = macOS 27 / current beta SDK generation
CURRENT_SONOMA_SUBSTRATE      = UNAVAILABLE
STRATEGY_C                    = ARCHITECTURALLY_PROMISING
                             / CURRENTLY UNAVAILABLE
ENTITLEMENT_AVAILABILITY      = UNKNOWN
DISTRIBUTION_FEASIBILITY      = UNKNOWN
```

Strategy C is parked on a future track. ClineMM should re-open this
decision when (a) the Apple beta graduates to a release that ships on
ClineMM's minimum supported macOS, (b) ClineMM acquires a Developer ID
signing identity, (c) the Apple entitlement grant is requested and
received, and (d) live E/F/G qualification has been run on an
un-sandboxed developer-Mac.

## 4. Matrix (narrowed)

| Property | A | B | C |
|----------|---|---|---|
| Safe against G counterexample | UNKNOWN / NOT PROVEN | YES by contract | YES by API |
| Enforceable on current execution context | NO | YES | NO |
| Enforceable on Sonoma generally (un-sandboxed host) | NOT_PROVEN | YES (already proven) | NO |
| No Apple special entitlement | YES | YES | NO |
| Works with local adhoc helper | UNKNOWN (no qualified measurement) | YES | NO |
| Allows arbitrary daemonization | DEPENDS on policy shape (blanket deny: NO; finer-grained: TBD) | YES | YES |
| Strong zero-descendant guarantee | UNKNOWN (needs un-sandboxed qualification) | NO | YES (Beta, requires entitlement) |
| Breaks existing legitimate workflows | UNKNOWN at finer-grained shapes (blanket deny: YES) | NO | NO |
| Production complexity | HIGH | LOW | VERY_HIGH |
| New privileged/trusted surface | YES (Seatbelt profile distribution) | NO | YES (Endpoint Security entitlement) |
| Current deployability (this execution context) | NOT QUALIFIED HERE | YES | NO |

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

Full matrix: `40-decision-matrix.md`.

## 5. Causal ordering actually executed

```
1. Freeze predecessor conclusions.                     [01-predecessor-run3-freeze.txt]
2. Recon Seatbelt substrate (Strategy A).              [10-strategy-a-seatbelt-recon.txt]
3. Strategy A RED confirmed.                           [11-strategy-a-red.txt]
4. Strategy A GREEN matrix blocked at substrate.       [12-strategy-a-green.txt]
5. Inventory B production demand.                      [20-strategy-b-workload-inventory.txt]
6. Specify B product contract.                         [21-strategy-b-product-contract.md]
7. Read-only C feasibility packet.                     [30-31-32-strategy-c-*.txt|md]
8. Fill matrix.                                        [40-decision-matrix.md]
9. Select.                                             [41-selected-contract.md]
10. STOP. (no implementation in this ACT)
```

This was a short ACT.

## 6. Explicit non-goals (per §22 of the ACT spec)

The following were NOT done and MUST NOT be re-attempted:

```
- rerun the 100x kqueue hammer
- repair kqueue recursively
- add polling
- resurrect PPID reconstruction
- kill same-UID processes
- match process names
- parse commands to detect "node detached:true"
- add Endpoint Security entitlement blindly
- change helper protocol
- modify CommandJobManager
- touch the ⎇ telemetry
```

## 7. Evidence packet

```
.factory/evidence/ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01/
├── 00-entry.txt
├── 01-predecessor-run3-freeze.txt
├── 02-predecessor-adjudication.txt
├── 10-strategy-a-seatbelt-recon.txt
├── 11-strategy-a-red.txt
├── 12-strategy-a-green.txt
├── 20-strategy-b-workload-inventory.txt
├── 21-strategy-b-product-contract.md
├── 30-strategy-c-platform.txt
├── 31-strategy-c-signing.txt
├── 32-strategy-c-entitlement.md
├── 40-decision-matrix.md
├── 41-selected-contract.md
├── 50-gates.txt
├── 80-run3-operator-entry.txt
├── 81-run3-single-shot-summary.txt
├── 82-run3-{shell-A,node-B,python-C,mixed-D,node-escape-E,python-escape-F,
│            double-fork-setsid-G,exec-fork-H,signal-triggered-fork-I,
│            double-fork-1,fork-storm-16}.jsonl
├── 83-run3-negative-controls.txt
├── 84-run3-adjudication.txt
└── result.json
```

Raw probe captures:
```
.factory/tmp/ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01/probe/
├── 40-seatbelt-setsid-probe.c
├── 40-seatbelt-setsid-probe  (built binary)
├── profile-baseline-allow-all.sbpl
├── profile-production-shaped.sbpl
└── profile-process-fork-deny.sbpl
```

## 8. Successor

**ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01** — purpose:
`PRODUCT_CONTRACT_QUALIFICATION`.

Implement `21-strategy-b-product-contract.md` §§3.3, 3.4 without:
  - same-UID sweeping machinery (§3.5),
  - command-text heuristics (§§7, 22),
  - resurrecting the falsified kqueue primitive,
  - changing ⎇ telemetry semantics,
  - changing CommandJobManager.

If Strategy C ever re-opens:
**ACT-CLINEMM-ENDPOINT-SECURITY-DESCENDANT-CONTAINMENT01** —
purpose: `ARCHITECTURE_QUALIFICATION`. Signing, entitlement, target-OS
support, and live E/F/G qualification are all mandatory before
integration. Strategy C does not exit this ACT's research lane today.

## 9. Closure

```
CLOSURE_TAXONOMY         = PASS_SELECT_B_CURRENT_C_FUTURE_TRACK
DECISION_CLAIMS_NARROWED = PASS  (Strategy A: UNAVAILABLE_FROM_CURRENT_EXECUTION_CONTEXT;
                                  Strategy C: CURRENT_APPLE_BETA_API_FLOOR = macOS 27)
ACT_ARTIFACT_BOUND       = PASS  (ACT + evidence + result.json + epic-board row committed)
BOARD_DURABLE            = PASS  (epic-board row present and committed)
```

This ACT closes read-only. No source code modified. No build artifact
modified. No helper re-signed. No entitlement requested.

### 9.1 Bounded correction log

CORRECTION01 (this round, per
`HALT_DECISION_EVIDENCE_OVERCLAIM_AND_NOT_DURABLE`):
  - Strategy A: REFUTED → UNAVAILABLE_FROM_CURRENT_EXECUTION_CONTEXT.
    Added the un-sandboxed qualification needed for global viability
    claims; cross-referenced the ACT-CLINEMM-SEATBELT-GO-DEFAULT-CACHE01
    EPERM-from-sandboxed-parent precedent.
  - Strategy A: noted that a blanket `(deny process-fork)` is not the
    target primitive; finer-grained policy shapes are not addressed by
    the 4-path inventory.
  - Strategy C: macOS 15+ floor → macOS 27 / current beta SDK generation.
    Removed "macOS 15" inference; documented Beta status and the
    missing-from-SDK-14 vs. macOS-26.x distinction.
  - Closure durability: ACT body + evidence + result.json + matrix +
    epic-board row all committed in this round; `git status --short`
    empty after commit.
