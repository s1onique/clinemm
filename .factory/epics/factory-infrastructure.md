# EPIC-FACTORY-INFRASTRUCTURE

> Cross-cutting factory infrastructure: Git safety rules, Factorize doctrine, board maintenance rule. See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: ACTIVE (substrate-level rules)
- Priority: P0 (substrate)
- Current frontier: see board row 23 (`REMOVE TEMPORARY YOLO BYPASS`) and the deterministic-vs-heuristic item under deferred (BYPASS01 currently vacuous)
- Blocked by: none

## Contract / durable conclusions

- **Git safety.** Repository ruleset `cline-- protect published history` (`id=21037630`) blocks force pushes to `main`. `BYPASS_ACTOR_COUNT = 0`. Reopen conditions: ruleset disabled; `non_fast_forward` removed; any bypass actor added; branch protection changed to allow force pushes; default branch moves out of `refs/heads/main`; ownership/topology changes.
- **Board maintenance rule.** At the end of a meaningful ACT, update **only rows affected by that ACT**. Do not rewrite the whole board. Each row should preferably contain: `ID`, `STATUS`, `PRIORITY`, `PURPOSE / SYMPTOM`, `DEPENDENCIES`, `NEXT ACT`, `EVIDENCE / COMMIT`. Avoid giant prose. If an item is closed, preserve enough identity to avoid re-litigation. If evidence contradicts a board row, **evidence wins**; the row becomes P2 stale metadata.
- **Post-census maintenance.** New task → add one row to the canonical task index at the next meaningful ACT boundary. Old forgotten task → add one delta. Do **not** trigger another global archaeology exercise.
- **Factorize doctrine.** (see Historical detail below; cross-references into `quality-substrate.md` for the per-Fn ACTs F0..F5)

## ACT ledger

| ACT / ID | Verdict | Head | Purpose |
|---|---|---|---|
| `EPIC-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH01` (ruleset id 21037630) | CLOSED | `ACT-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH-ENFORCEMENT01` (closed 2026-08-19) | Block force pushes to `main` via GitHub ruleset |
| `ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01` | OPEN (P2, non-blocking) | — | Defense-in-depth local pre-push hook |
| Factorize ACTs (F0..F5 + tooling + intake) | CLOSED | see `quality-substrate.md` | Factorize tooling and intake |

## Open work

- `ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01` (P2, non-blocking)

## Deferred work

None.

## Historical detail

The text below is migrated verbatim from the prior single-file `.factory/epic-board.md` (Git safety + Factorize doctrine + Board maintenance rule, see front-matter block at top of fenced payload for source-line ranges) so the durable conclusions remain anchored to their source lines. **Do not rewrite history here unless the underlying ACT itself is being amended.**

```text
SOURCE: .factory/epic-board.md L87-163 (Git safety) + L3849-3895 (Factorize doctrine) + L4545-4554 (Board maintenance rule) (pre-sharding).

## Git safety

### GIT-SAFETY-NO-FORCE-PUSH01

- ID: `EPIC-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH01`
- STATUS: CLOSED

**Authority model.**

  GitHub repository ruleset
    name = cline-- protect published history
    id   = 21037630
    target          = branch
    enforcement     = active
    conditions.ref_name.include = ["refs/heads/main"]
    rules           = [{type: "non_fast_forward"}]   -- i.e. "Block force pushes"
    bypass_actors   = []
    current_user_can_bypass = "never"

**Effective state on `main`.**

- Force pushes to `main` are server-side rejected by GitHub before they reach ref storage.
- Branch is reported as `protected: true` via the GitHub branches API.
- The classic `/branches/main/protection` endpoint returns 404 because protection is now expressed via ruleset (the authoritative mechanism), not legacy branch-protection rules.
- No branch-protection rule was added, modified, or removed.

**Conservation.**

  NORMAL_FAST_FORWARD_PUSH_POLICY_DELTA = 0
  EXISTING_RULES_REMOVED                = 0
  EXISTING_RULES_WEAKENED               = 0
  RULES_ADDED                           = 1  (block_force_pushes on main)
  BYPASS_ACTORS_REMAINING               = 0

**Recon pre-state** (committed to `${TMPDIR:-/tmp}/clinemm-ruleset-before.json`, not committed to repo):

  rulesets = []
  default_branch_protection = ABSENT
  branches_summary = [act/elm-architecture01-e0-e4, act/session-autonomy01-correction02,
                     act/settings-authority-parity01, main]
  collaborators = [{alexclear: admin, maintain, push, triage, pull}]
  installed_github_apps = []

**Recon post-state** (committed to `${TMPDIR:-/tmp}/clinemm-ruleset-after.json`, not committed to repo):

  rulesets = [{id:21037630, name:"cline-- protect published history",
               target:branch, enforcement:active}]
  default_branch_protection = ABSENT (ruleset is the authority)
  branches_summary = same as pre; main now reports protected:true

**Bypass analysis.** Bypass actors were inventoried:

- Repository administrators (the current token user `alexclear`): classified NOT_REQUIRED. The created ruleset has `current_user_can_bypass: "never"`, so even admins cannot bypass.
- Organization owners: N/A (this is a personal repository, not an org).
- Teams: none configured.
- Users (other collaborators): none.
- GitHub Apps: none installed.
- Deploy keys: none (this is an SSH-based remote, deploy keys would be for HTTPS).
- Automation identities: none other than the current admin user.

Conclusion: `BYPASS_ACTOR_COUNT = 0`.

**Reopen conditions** (any one of these should reopen the epic):

- Ruleset `21037630` becomes disabled.
- The `non_fast_forward` rule is removed from `21037630`.
- Any bypass actor is added to `21037630`.
- Branch protection is changed to allow force pushes (legacy mechanism).
- Default branch moves outside `refs/heads/main`.
- Repository ownership/topology changes such that the rule no longer applies.

**Optional follow-up (P2, non-blocking).** `ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01` — defense-in-depth local pre-push hook to catch `git push --force` invocations before they leave the developer machine. Not required for closure; the server-side ruleset is sufficient.

**Closure ACT.** `ACT-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH-ENFORCEMENT01` closed at `2026-08-19`.

---

## Board maintenance rule

At the end of a meaningful ACT, update **only rows affected by that ACT**. Do not rewrite the whole board.

Each row should preferably contain: `ID`, `STATUS`, `PRIORITY` (if useful), `PURPOSE / SYMPTOM`, `DEPENDENCIES`, `NEXT ACT`, `EVIDENCE / COMMIT` where known.

Avoid giant prose. If an item is closed, preserve enough identity to avoid re-litigation. If evidence contradicts a board row, **evidence wins**; the board row becomes P2 stale metadata.

**Post-census maintenance.** When a new task is discussed, add a single row to the canonical task index at the next meaningful ACT boundary. When an old forgotten task surfaces, add one delta. Do **not** trigger another global archaeology exercise.

---

## Factorize doctrine

Source-derived principles captured by `ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01` from the Factorize architecture review. These are **decision rules** for the `EPIC-CLINEMM-FACTORIZE01` wave plan, not implementation steps.

### FACT-001 — One semantic rule, one executable authority
A product semantic rule (e.g. "task wall-clock age", "completion liveness", "compaction selection") has exactly one executable authority in the system. Where multiple authorities appear, they must converge on one (substrate vs projection are not separate authorities — the substrate is the authority).

### FACT-002 — Coordinator requires lifecycle ownership
A `*Coordinator` module is justified only when it owns persistent lifecycle/state across multiple lower-level services. Sequential calls alone do not justify a coordinator; neither does grouping unrelated steps behind one entry point. Pure routers / dispatchers / selectors are not coordinators; relabel them rather than expand them.

### FACT-003 — Migration / compatibility seam has a deletion predicate
Every `shadow` / `bridge` / `compat` / `fallback` / `migration` / `temporary` seam carries an explicit deletion predicate (owner, introduced_by, canonical replacement, remaining producers, remaining consumers, latest intended removal stage). Seams without such predicates are not architecture — they are residue and must be reclassified honestly.

### FACT-004 — Factorization reduces change radius
A successful factorization reduces the semantic change radius: a representative product flow can be understood and modified by touching fewer files / concepts. Refactors that grow the abstraction surface without shrinking change radius are not successes.

### FACT-005 — Authority refactors narrow integration seams
When authority moves (e.g. from a host controller into the canonical SDK), the integration seam must narrow so that unrelated behavior cannot regress through the same composition point. If the refactor makes the seam broader, the refactor is wrong.

### FACT-006 — Factorize ACTs delete / retire / consolidate structural entropy
An implementation Factorize ACT must **delete, retire, consolidate, or obsolete** structural entropy (legacy writer, fallback branch, dual authority, naming fork). Adding abstractions alone is not success. If a Factorize ACT ships only additions, its evidence row must justify why entropy decreased elsewhere.

### FORK-001 — Converge on upstream package seams
Fork-local architecture converges on upstream package seams rather than forming parallel runtime architecture. Fork-only modules and fork-only public types are admitted only when the upstream seam cannot host the semantic without an upstream change; otherwise the fork contribution flows upstream.

### ELM-001 — Elmize state machines, not the whole repository
Elmization is applied to **state machines** (canonical state authority, deterministic transitions, host projections), not to utilities, adapters, or the repository wholesale. Forcing Elm shape onto stateless adapters produces decoration, not authority.

### Direction (not thresholds)

These metrics are tracked as **directions**, not absolute thresholds (per §21 of the intake ACT):

  fork-modified upstream production files      ↓
  fork-only state authorities                  ↓
  shadow / compatibility seams                 ↓
  cross-layer imports                          ↓
  dependency cycles                            ↓
  duplicate semantic implementations          ↓
  files required to explain a representative flow ↓
  host-specific business semantics             ↓
  canonical reusable core semantics            ↑
  upstream merge-conflict surface              ↓

`FACTORIZE-F0-INVENTORY01` chooses the exact measurable set; `FACTORIZE-F0B-BASELINE-RATCHET01` encodes it.
```
