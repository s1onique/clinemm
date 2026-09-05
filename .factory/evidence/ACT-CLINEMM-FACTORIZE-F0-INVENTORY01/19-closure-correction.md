# 19 — Closure correction disposition

> Captured after the C1 review on commit `a523f9471325f4b39488d4f9744d82a0b02cffce`.
> Verdict: **PASS_WITH_ONE_BOUNDED_P1 — C1: GO TO F1 RECON, NOT DIRECT REFACTOR**.
> F0 final report + recommendation stand; no production re-open.

## 19.1 Inventory of reviewer corrections

| # | Item | Class | Effect on F0 output | Effect on F1 starting state |
|---:|---|---|---|---|
| 1 | `WorkingContextHostCapture` labeled "SHADOW / dual authority" is over-strong | P1 | F0 §07 + §15 + §17 are **downgraded** (HYPOTHESIS, not finding). Inventory finding **kept**; semantic-authority finding **withdrawn**. | F1 recon must answer whether the two write ingresses are semantically distinct producers of the same derived value, before any deletion |
| 2 | Preselected F1 design ("route manual compaction through runtime event") is design-before-recon | P1 | F0 §17 + final-report recommendation paragraph: **replace with "freeze question + outcome A/B/C discriminator"** | F1 recon captures the manual-compaction chain first, answers SAME_SEMANTIC_STATE / SAME_OWNER / SAME_EVENT_DOMAIN, then selects one of three outcomes |
| 3 | Correction-density metric undercounts non-filename corrections | P2 | F0 §10 + scorecard: label as **LOWER BOUND** not authoritative; reduce `×2` weight in any future re-rank. Candidate A still wins (65 → ~61 still > next) | No effect |
| 4 | LOC metrics include generated/nested walkable source | P2 | F0 §01: relabel `PRODUCTION_LOC` → `WALKABLE_SOURCE_LOC` and `TEST_LOC` → `WALKABLE_TEST_LOC` everywhere | No effect |
| 5 | `clinemm → @cline/agents` is a valid upstream pattern, not a violation | P2 | F0 §04 + §02 dep-graph notes: downclass from `BOUNDARY_VIOLATION_CANDIDATE` to `DIRECT_LOWER_LAYER_DEPENDENCY / VALID_UPSTREAM_PATTERN` | No effect |
| 6 | Model Profiles finding is valuable but **after** F1, not instead of it | (clarification) | F0 final-report "Next" ordering preserved; F1 first | Confirms F1 sequencing |

## 19.2 Grounded evidence for the reviewer's corrections

### 19.2.1 Upstream `@cline/agents` typical consumers include `apps`

From upstream `sdk/packages/README.md` table on commit `a523f9471` (HEAD of fork):

```
Package            Primary responsibility                                                       Typical consumers
@cline/shared      Cross-package shared primitives (path resolution, session common types,    @cline/agents, @cline/core, apps
                   indexing helpers)
@cline/llms        Model catalog + provider settings schema + handler creation                 @cline/agents, @cline/core, apps
@cline/agents      Stateless agent runtime loop (tools, hooks, extensions, teams, streaming)   @cline/core, apps
@cline/core        Stateful runtime orchestration (runtime composition, session lifecycle,    CLI/Desktop apps
                   storage, local and hub runtime services, hub discovery, client helpers)
```

→ Apps consume `@cline/agents` directly upstream. **F0 §02 host→host (`@cline/cli → @cline/cline-hub`) was correctly flagged**; **F0 §04 `clinemm → @cline/agents` was over-flagged**. The latter is a valid upstream pattern.

### 19.2.2 Upstream `ARCHITECTURE.md` routing for the F1 discriminator

The upstream `Starting Points by Task` index places:

- "agent loop and tool execution" → `packages/agents/src/agent.ts` (stateless)
- "session persistence and state" → `packages/core/src/runtime/host/local-runtime-host.ts` + `packages/core/src/runtime/orchestration/`
- "settings and configuration" → `packages/core/src/settings/` + `packages/core/src/runtime/config/`

This is consistent with the reviewer's framing: **compaction and session/stateful runtime live in `@cline/core`**, while the generic prepare-turn agent loop lives in `@cline/agents`. F1's discriminator (does manual compaction mutate the same runtime W state, or is it a core-owned state update with its own publication?) is therefore the right place to start.

### 19.2.3 No upstream statement that `@cline/sdk` re-exports

Upstream `sdk/packages/README.md` lists 4 published SDK packages + `@cline/ui` (an internal web-theme package). There is **no `@cline/sdk` aggregator package listed**. F0 §01 was careful to read `@cline/sdk` from `apps/vscode/package.json` as a Cline-- alias, not an upstream package. This part of F0 is consistent with upstream.

## 19.3 Frozen replacement language for F1

Replace F0 §17 preselected solution with:

```
FREEZE QUESTION:
Can all host-visible W updates be composed through one semantically-correct
publication/mutation authority without changing runtime semantics?

REQUIRED EVIDENCE BEFORE RED:
1. Capture the NORMAL TURN chain:
   AgentRuntime.prepareTurn
   → where currentWorkingContextEstimate is written
   → event creation
   → subscription
   → WorkingContextHostCapture.observe
   → state post
2. Capture the MANUAL COMPACTION chain:
   compactTask
   → compactSessionMessages
   → currentWorkingContextEstimate
   → coordinator
   → current setLatest call
   → state post
3. Answer three discriminators:
   SAME_SEMANTIC_STATE?  YES / NO
   SAME_OWNER?           YES / NO
   SAME_EVENT_DOMAIN?    YES / NO

PERMITTED OUTCOMES:
A. Runtime state genuinely changes → use existing runtime event → delete setLatest
B. Manual compaction creates a host-visible projection but does NOT mutate
   runtime state → keep two producers; unify to ONE ASSIGNMENT PRIMITIVE
   (e.g. assign(w, provenance)) with one cache; do NOT fabricate a runtime event
C. Core already exposes a shared W publication seam both producers can use →
   use it; delete the bypass
NOT_FACTORIZABLE_AS_SINGLE_EVENT_SOURCE is a permitted outcome (B-prime).

DELETION PREDICATE (testable, not circular):
setLatest() may be deleted when ALL hold:
1. every successful producer of host-visible W can reach one
   semantically-correct publication seam
2. that seam preserves UNDEFINED_W_STALE_REUSE = FORBIDDEN
3. manual compaction updates the bar before the final state post
4. normal prepare-turn publication remains unchanged
5. skipped/failed compaction publishes no optimistic W
```

## 19.4 Re-verification of F0 load-bearing claims after correction

| F0 claim | Stands? | Reason |
|---|---|---|
| Package dep graph is acyclic + one-way | YES | Mechanical, reviewer did not contest |
| Fork center of gravity is `apps/vscode/src/sdk/` | YES | Mechanical, reviewer endorsed |
| `SdkController.ts` doubled in size + 160/71 fork/upstream commits | YES | Mechanical |
| Candidate A (working-context) is the right first experiment | YES | Reviewer approved selection |
| Candidate D (temp-external-path) is security-sensitive and recently stabilized — DO NOT factorize first | YES | Reviewer endorsed |
| Candidate C (cline-session-factory) is strategically important but larger and less covered | YES | Reviewer endorsed |
| Model Profiles precondition = characterize/retire provider legacy-fallback bridge | YES | Reviewer endorsed; **after F1** |
| No P0 discovered | YES | Reviewer confirmed |
| `WorkingContextHostCapture = SHADOW / dual semantic authority` | **NO** | Reviewer P1: weaken to `CACHE/PROJECTION WITH MULTIPLE WRITE INGRESSES; SINGLE_INGRESS_DESIRABLE = HYPOTHESIS` |
| `route manual compaction through runtime event` is the chosen F1 design | **NO** | Reviewer P1: replace with three-outcome discriminator |
| Correction density (D=6, B=5) is authoritative | **NO** | Reviewer P2: lower bound only; candidate A still wins |
| 1.84M production / 778k test LOC | **NO** | Reviewer P2: relabel to WALKABLE_*_LOC |
| `clinemm → @cline/agents` is BOUNDARY_VIOLATION_CANDIDATE | **NO** | Reviewer P2: valid upstream pattern |

## 19.5 What changes in the F0 evidence files (correction application)

| File | Change | Status |
|---|---|---|
| `04-fork-architecture-nouns.md` | Downclass `clinemm → @cline/agents` to `VALID_UPSTREAM_PATTERN / REVIEW_ONLY_IF_COUPLING_CREATES` | applied below |
| `07-compatibility-shadow-inventory.md` | Weaken `WorkingContextHostCapture` SHADOW classification to `CACHE_OR_SHADOW_HYPOTHESIS`; add the three-outcome discriminator; add SAME_* questions | applied below |
| `10-correction-density.md` | Add caveat: counts are LOWER BOUND based on filename enumeration; subsequent commit/evidence-apparent corrections may exist | applied below |
| `15-factorization-scorecard.md` | Add note: candidate A scoring depends on SHADOW-vs-CACHE discriminator; under CACHE interpretation the score is a ceiling; DEFER CANDIDATE B's path scoring until F1 recon | applied below |
| `17-recommendation.md` | Replace preselected F1 design paragraph with FREEZE_QUESTION + DISCRIMINATORS + OUTCOMES_A_B_C | applied below |
| `18-final-report.md` | Append §C4 closure correction disposition summary | applied below |

No production source touched. No new artifacts beyond `19-closure-correction.md`.

## 19.6 Acceptance of F0 ACT

```
ACT-CLINEMM-FACTORIZE-F0-INVENTORY01

VERDICT                         = PASS_WITH_ONE_BOUNDED_P1
INVENTORY                       = ACCEPTED
SELECTED SUCCESSOR              = ACCEPTED  (ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01)
PRESELECTED F1 IMPLEMENTATION   = NOT YET ACCEPTED
F0 CORRECTION CYCLE             = NONE (corrections applied in-place; no separate CORRECTION01 ACT)
NEXT                            = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01 (RECON → CHARACTERIZATION → BOUNDED FACTORIZATION, NOT DIRECT REFACTOR)
```

C1: GO.
