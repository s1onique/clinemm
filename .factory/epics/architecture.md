# EPIC-ARCHITECTURE

> Architectural decisions and post-recon epics (E8 / E9 / ELMIZATION02). See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: ACTIVE — open recon + held epics
- Priority: P2 (architectural substrate, not directly user-facing)
- Current frontier: 3 items listed under "Open work" below. E8 and E9 are explicitly held pending upstream evidence; ELMIZATION02 is OPEN and gated on E9.
- Blocked by: E8 and E9 each have an explicit HOLD — no action in this board ACT.

## Contract / durable conclusions

- **E8 — legacy writer retirement.** Retire the remaining legacy writer authority **only when E7 evidence and dependencies justify it** (per source L3612). No action in this board ACT.
- **E9 — effect interpreter.** Bounded effect execution / interpreter work after E8 (per source L3618). No action in this board ACT.
- **ELMIZATION02 — directional boundary.** Migrate deterministic behavioral authority where doing so reduces duplicated state/policy decisions. The target direction is:
  - **Elm** → deterministic state transitions, policy, projections
  - **TypeScript** → VS Code APIs, filesystem/network/process effects, adapters
  - **React** → rendering, DOM/event adaptation

  Forbidden goal: `"Rewrite everything in Elm"` (per source L3634). First post-E9 action: authority-domain recon (per source L3636).

- **Historical architecture family** (`ARCH-01`, `ARCH-02`) is preserved as `NEEDS_CLASSIFICATION` — scope is not reconstructable from the current board + repository history (per source L3640).

## ACT ledger

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `E8` (legacy writer retirement) | HOLD | L3609-3613 | Retire remaining legacy writer authority only when E7 evidence and dependencies justify it |
| `E9` (effect interpreter) | HOLD | L3615-3619 | Bounded effect execution/interpreter work after E8 |
| `EPIC-CLINEMM-ELMIZATION02` | OPEN / POST-E9 RECON | L3621-3636 | Migrate deterministic behavioral authority where doing so reduces duplicated state/policy decisions |
| `ARCH-01`, `ARCH-02` | NEEDS_CLASSIFICATION (historical) | L3638-3640 | Historical architecture family; scope not reconstructable from current board + repository history |

## Open work

Three items (2 HOLD + 1 OPEN):

- **`E8` — legacy writer retirement** (L3609-3613). Purpose: retire remaining legacy writer authority only when E7 evidence and dependencies justify it. **No action in this board ACT.**
- **`E9` — effect interpreter** (L3615-3619). Purpose: bounded effect execution/interpreter work after E8. **No action in this board ACT.**
- **`EPIC-CLINEMM-ELMIZATION02`** (L3621-3636). Goal: migrate deterministic behavioral authority where doing so reduces duplicated state/policy decisions. Target direction: Elm → deterministic state transitions / policy / projections; TypeScript → VS Code APIs + effects; React → rendering / DOM/event adaptation. Forbidden goal: "Rewrite everything in Elm". First post-E9 action: authority-domain recon.

Reopen / new-work conditions:

- E7 evidence and dependencies justify legacy writer retirement (→ unblock E8).
- E8 unblocks E9 (→ effect interpreter work begins).
- E9 unblocks ELMIZATION02 (→ authority-domain recon starts).
- The `NEEDS_CLASSIFICATION` historical rows (`ARCH-01`, `ARCH-02`) get a bounded reclassification ACT.

## Deferred work

None directly. The `NEEDS_CLASSIFICATION` rows are not deferred — they're blocked on a reclassification ACT, which is its own line of work.

## Historical detail

The text below is migrated verbatim from the prior single-file `.factory/epic-board.md` (L3607-3643, pre-sharding) so the durable conclusions remain anchored to their source lines. **Do not rewrite history here unless the underlying ACT itself is being amended.**

### Architecture — L3607-3643 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L3607-3643 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## Architecture

### E8 — legacy writer retirement

- STATUS: HOLD
- Purpose: retire remaining legacy writer authority only when E7 evidence and dependencies justify it.
- **No action in this board ACT.**

### E9 — effect interpreter

- STATUS: HOLD
- Purpose: bounded effect execution/interpreter work after E8.
- **No action in this board ACT.**

### ELMIZATION02

- ID: `EPIC-CLINEMM-ELMIZATION02`
- STATUS: OPEN / POST-E9 RECON

**Goal.** Migrate deterministic behavioral authority where doing so reduces duplicated state/policy decisions.

**Target direction:**

  Elm         → deterministic state transitions, policy, projections
  TypeScript  → VS Code APIs, filesystem/network/process effects, adapters
  React       → rendering, DOM/event adaptation

**Forbidden goal.** `"Rewrite everything in Elm"`.

**First post-E9 action.** Authority-domain recon.

### Historical architecture family

`ARCH-01`, `ARCH-02` preserved as `NEEDS_CLASSIFICATION` rows. Scope not reconstructable from current board + repository history.

---
````
