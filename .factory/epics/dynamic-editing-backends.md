# EPIC-DYNAMIC-EDITING-BACKENDS

> Editing-backend abstraction so the agent can route edits through alternative engines (e.g. Dirac-style hash-anchored / AST-aware backends) while preserving the existing Cline-native edit path. See `.factory/epic-board.md` for the active index.

## Current status

- Status: ACTIVE — fresh epic opened at FUTURE-BACKLOG-CENSUS01 (2026-08-27). No ACT authored yet; the items below are working labels (canonical ACT IDs are assigned per FACT-001 in `.factory/epics/factory-infrastructure.md`).
- Priority: P1 (a future-quality-of-life substrate for large / multi-file edits)
- Current frontier: `DIRAC-EDITING-RECON01` (working label). All other items below are BLOCKED on their declared dependency.
- Blocked by: see ACT ledger.

## Contract / durable conclusions

- **Target modes.** `cline-native`, `dirac`, `auto`. `auto` selects per-file using the backend's claimed suitability for the file class.
- **Cline-native edit path is the safety baseline.** No new backend may widen filesystem authority, weaken approval semantics, or skip the existing audit trail. The Cline-native path remains the default unless the user explicitly opts in.
- **Backends are pluggable, not fork-bound.** Each backend is identified by name + capability declaration; selection is explicit per-session or per-call, not implicit by environment.
- **Hash-anchored / AST-aware mechanics are interesting but unproven in our context.** Dirac-style mechanics (hash-anchored edits, AST-aware manipulation, multi-file batching) are a *candidate* capability, not a *proven* one — every claim about them must come from a bounded recon, not from a marketing description. ([dirac-run/dirac][1])
- **Conservative-first ordering.** Recon first, abstraction second, backend integration third, qualification fourth. Do **not** collapse this sequence.

[1]: https://github.com/dirac-run/dirac

## ACT ledger

| ACT / ID | Verdict | Head | Purpose |
|---|---|---|---|
| `DIRAC-EDITING-RECON01` (working label) | OPEN | — | Recon existing edit paths, identify which Dirac-style mechanics actually improve the product, scope a minimal viable abstraction |
| `EDIT-BACKEND-ABSTRACTION01` (working label) | BLOCKED on recon | — | Define the backend interface + capability declaration; do **not** integrate any non-native backend in this ACT |
| `DIRAC-EDIT-BACKEND01` (working label) | BLOCKED on abstraction | — | Implement the first non-native backend (Dirac) against the abstraction |
| `EDIT-BACKEND-DYNAMIC-SELECT01` (working label) | BLOCKED on backend | — | Add `auto` mode and per-file selection logic |
| `EDIT-BACKEND-QUALIFICATION01` (working label) | BLOCKED on dynamic-select | — | Qualification harness: prove no widening of filesystem authority, no approval weakening, no audit-trail skip |
| `CLINE-NATIVE-EDIT-CONSERVATION` (working label) | BLOCKED on qualification | — | Freeze the guarantee that the Cline-native path remains the safety baseline regardless of mode |

## Open work

- **`DIRAC-EDITING-RECON01`**. Working-label recon. Must characterize: current edit path (which calls, which authority, which audit), which Dirac-style mechanics are *actually* needed (not all of them), and the minimum abstraction surface required to plug a non-native backend. Do not implement anything in this ACT.
- **`EDIT-BACKEND-ABSTRACTION01`** (BLOCKED). The backend interface must be capability-based (declare what you support, not what you are); allow per-session and per-call override; preserve audit-trail parity.

Reopen / new-work conditions:

- A user-visible benefit of a non-native backend is reproduced in production-equivalent tests against the Cline-native path (→ BLOCK on `EDIT-BACKEND-ABSTRACTION01` is reconsidered).
- The Cline-native edit path widens authority / weakens approval / skips the audit trail (→ HOLD all backend work until repaired).

## Deferred work

None.

## Historical detail

Epic opened by `ACT-CLINEMM-FACTORY-FUTURE-BACKLOG-CENSUS01` (this commit). No prior history; this is the durable census entry for the Dirac-style editing-backend lane discussed in the product/sharding review.