# ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01

> Status: **OPEN / MED-HIGH** — recon-only ACT; inventories the
> current upstream Cline Settings webview surface against the current
> ClineMM fork Settings webview surface, classifies each missing
> setting by intent, and emits a candidate-restore list (NOT a
> wholesale upstream copy).
>
> **Primary purpose**: answer "what did our fork drift away from
> upstream on the Settings surface, and which drifts are
> accidental?" — and do so without overwriting deliberate
> ClineMM policy differences (e.g. Seatbelted-YOLO replacing
> upstream's settings-visible YOLO toggle).
>
> **Explicitly NOT**: author a bespoke PTAD tab. A bespoke PTAD tab
> increases divergence and is rejected at §0. The follow-on
> implementation (`PTAD-SETTINGS-UI01`) is **only** authorized if
> recon finds no natural Advanced / Diagnostics section in the
> current Settings webview. Absorb PTAD into this ACT's
> candidate-restore list; do not create a separate ACT up front.
>
> **Owning epic**: TBD — likely `product-config-branding.md` (which
> already owns `BRANDING-ACTIVITYBAR-ICON01`) or a new dedicated
> settings-substrate epic if recon reveals one is needed. Decided
> by §11 below, not pre-baked.
>
> **Predecessor**: none — first ACT in the settings-substrate recon
> lane.

---

## §0 — Stop rule

This ACT halts at `HALT_UPSTREAM_NOT_INVENTORIED` if the upstream
Cline Settings webview cannot be inventoried (e.g. upstream removed
or moved the surface, or no reproducible surface exists). The
candidate-restore list is the deliverable; the implementation is
a separate downstream ACT (or absorbed into an existing epic), not
this one.

Authoring any **bespoke PTAD tab** in this ACT is forbidden.
Authoring any **wholesale upstream copy** in this ACT is forbidden.
Recon-only.

## §1 — Entry discipline

Authored under the standard ACT gate contract. No source
modifications in this ACT. No tests added. No upstream wholesale
copy. **Recon only.** The board + this ACT are the only artifacts
produced in this commit.

## §2 — Scope

### Two surfaces to compare

```text
UPSTREAM-SETTINGS  = current Cline (main branch) Settings webview
                      surface, captured against an arbitrary
                      reproducible SHA.

CLINEMM-SETTINGS   = current ClineMM fork Settings webview surface
                      captured against this ACT's commit.
```

### Comparison lens

For each surface entry, record:

```text
id (canonical upstream id, if any)
label (display label, if shown)
category (sidebar group / tab / sub-section)
present_in_upstream      yes | no
present_in_clinemm       yes | no
clinemm_intent_class     MISSING_ACCIDENTALLY
                       | REMOVED_INTENTIONALLY
                       | SUPERSEDED_BY_CLINEMM
                       | UPSTREAM_NOT_APPLICABLE
                       | PRESENT_IN_BOTH
evidence_path            upstream SHA + repo path
clinemm_path             repo path
restoration_recommend    restore | supersede | leave | investigate
```

The `clinemm_intent_class` is the load-bearing output. Most rows
will land in `REMOVED_INTENTIONALLY` or `UPSTREAM_NOT_APPLICABLE`
(see §6 for the deterministic test); only `MISSING_ACCIDENTALLY`
rows drive a candidate restore.

## §3 — Live inventory (NOT YET CAPTURED)

### Upstream inventory inputs

```text
upstream_main_sha            (frozen at ACT creation)
upstream_settings_webview    (file path + render source)
upstream_settings_keys       (canonical keys; the SETTINGS_SCHEMA
                              or equivalent)
upstream_sidebar_groups      (the section / tab labels)
```

### ClineMM inventory inputs

```text
clinemm_main_sha             (this ACT's commit hash)
clinemm_settings_webview     (file path + render source)
clinemm_settings_keys        (canonical keys; SETTINGS_SCHEMA or
                              equivalent)
clinemm_sidebar_groups       (the section / tab labels)
```

### Required output

A single table that classifies every upstream Settings entry
against every ClineMM Settings entry. The table is the §3 frozen
specimen — once captured, §4 is mechanical.

Capture policy: enumerate upstream FIRST (the larger set), then
classify each row against ClineMM. Do NOT start with ClineMM and
back-fill "what's missing upstream" — that inverts the direction
and biases the inventory toward "we're fine" answers.

## §4 — Primary discriminator

```text
MISSING_ACCIDENTALLY    ⇒ candidate restore (entry appears in §5)
REMOVED_INTENTIONALLY   ⇒ no restore (the entry was a deliberate
                          fork policy; preserve the removal)
SUPERSEDED_BY_CLINEMM   ⇒ no restore (ClineMM has a fork-native
                          replacement; record the supersession)
UPSTREAM_NOT_APPLICABLE ⇒ no restore (the upstream entry is
                          inapplicable to the ClineMM product, e.g.
                          upstream's plain-YOLO toggle is replaced
                          by Seatbelted-YOLO)
PRESENT_IN_BOTH         ⇒ no action
```

The candidate restore list (§5) is therefore the
`MISSING_ACCIDENTALLY` rows, optionally filtered by §6's
`restoration_recommend = investigate` follow-ups.

No row is pre-classified into any of these classes. The
classification is the *output* of §3 + §4, not its input.

## §5 — Candidate restore list (deferred to §3 / §4)

The candidate restore list is the `MISSING_ACCIDENTALLY` rows from
§4. Each entry must carry:

```text
id
sidebar_group_target
semantic_equivalent_upstream_render
clinemm_render_path (where the restored entry would live)
downstream_act_id (the implementation ACT that would do the
                   restoration; this ACT does NOT do it)
```

If the candidate restore list is empty, the ACT closes with
`PASS_NO_DRIFT_FOUND` — no further action.

If the list is non-empty, each entry is a candidate for a separate
bounded downstream implementation ACT, *not* an in-this-ACT repair.

## §6 — Deterministic classification tests

Each `MISSING_ACCIDENTALLY` row must be defended by at least one
of the following tests (otherwise it lands in `investigate`):

```text
TEST_RESTORE_FROM_UPSTREAM_PARENT
  The ClineMM fork has the upstream entry's data-flow path intact
  (settings key wired, persistence intact, plumbing complete) but
  the webview render was deleted. Restoring the render alone
  is sufficient; no plumbing change is needed.

TEST_RESTORE_NEEDS_PLUMBING
  The data-flow path is also missing. A full bounded slice
  (key + persistence + render + test) is required. This is a
  candidate for a downstream implementation ACT, not an in-this-ACT
  repair.

TEST_SUPERSESSION_CLAIM_VERIFIED
  The row is a deliberate fork substitution (e.g. plain-YOLO
  toggle replaced by Seatbelted-YOLO). Classify as
  SUPERSEDED_BY_CLINEMM and explain the supersession; no restore.

TEST_UPSTREAM_INAPPLICABILITY_VERIFIED
  The row is structurally inapplicable to the ClineMM product
  surface (e.g. upstream's cloud-only entry). Classify as
  UPSTREAM_NOT_APPLICABLE; no restore.
```

The classifier for each row must cite at least one of these tests
by ID. No row ships without one.

## §7 — Epistemic guards

```text
GUARD_NO_WHOLESALE_UPSTREAM_COPY
  Recon never "upgrades" ClineMM by copying a current upstream
  file verbatim. Restoration is per-entry, with the four tests
  above defended.

GUARD_PRESERVE_DELIBERATE_DIVERGENCE
  ClineMM's deliberate fork policy (Seatbelted-YOLO replacing
  upstream plain-YOLO is the obvious example; PTAD as a
  developer/CI opt-in instead of a user-facing toggle may be
  another) is preserved. The recon MUST NOT classify deliberate
  divergence as MISSING_ACCIDENTALLY.

GUARD_NO_PTAD_TAB
  This ACT does not author a bespoke PTAD tab. The PTAD
  surface, if it lives in the Settings webview at all, must live
  in an existing Advanced / Diagnostics section discovered by §3,
  not in a new top-level PTAD tab.
```

## §8 — Permitted repair boundaries (deferred to §3)

Per spec. No preferred row count or category is pre-baked. The
ACT is better without a pre-judged "X missing items, restore all".

### External radar (informational only)

```text
EXTERNAL_RADAR:
Cline's CHANGELOG records VS Code Advanced settings being
migrated into the Settings webview in 3.16.0, with all advanced
settings moving to the settings page shortly after. A dedicated
Feature Settings area for feature toggles is the current upstream
shape. A settings-visible YOLO mode arrived around 3.30/3.31.

This radar is recorded so §3 captures upstream's Feature Settings
shape correctly and so a future reviewer can distinguish
"upstream no longer has this surface" from "the fork drifted
away". It does NOT influence §4 classification.

Terminology caution: upstream's "Extended Thinking" is a model
capability/setting, not the historical "Advanced Settings"
general-area label.
```

This radar must NOT influence §4 classification.

## §9 — Explicit forbidden repair

```text
DO NOT:
  - copy current upstream settings files into the fork verbatim
    (GUARD_NO_WHOLESALE_UPSTREAM_COPY)
  - re-litigate deliberate fork divergence as MISSING_ACCIDENTALLY
    (GUARD_PRESERVE_DELIBERATE_DIVERGENCE)
  - author a bespoke PTAD tab in this ACT or in any downstream
    implementation ACT spawned by it
    (GUARD_NO_PTAD_TAB)
  - restore an entry without one of the four §6 tests defended
```

## §10 — Conservation suite (deferred to §3 / §4)

```text
- Every MISSING_ACCIDENTALLY row has at least one §6 test ID cited
- Every REMOVED_INTENTIONALLY row has a one-sentence rationale
  captured (the rationale is the durable evidence for the
  preservation; a future ACT cannot re-litigate without re-reading
  this row)
- Every SUPERSEDED_BY_CLINEMM row has the superseding entry
  referenced (so the supersession is reviewable)
- Every UPSTREAM_NOT_APPLICABLE row has the inapplicability
  reason captured (one sentence is sufficient)
- The candidate restore list (§5) is the only output of §4
  that drives downstream ACTs
```

## §11 — Owning epic decision (deferred to §3)

```text
DECISION_TREE:
  if candidate restore list (§5) is empty:
      owning epic: no change (this ACT closes with PASS_NO_DRIFT_FOUND)
  elif §5 has >= 3 restore entries spanning distinct categories:
      owning epic: NEW EPIC-CLINEMM-SETTINGS-SUBSTRATE01
      rationale:    the substrate needs its own boundary;
                    bolting it onto product-config-branding
                    or task-presentation obscures ownership
  else:
      owning epic: existing product-config-branding.md (which
                   already owns BRANDING-ACTIVITYBAR-ICON01)
                   if any entry is a settings-tab visual, or
                   the most-relevant existing epic otherwise.
      rationale:    small-bore fits in an existing epic.
```

The decision is made by the §5 size + category distribution, not
pre-baked into this ACT. Both branches remain authorized.

## §12 — Forbidden side effects

No source files modified. No tests added. No new Settings
sections rendered. No new settings keys added to the schema.

## §13 — Gates

Recon (this ACT):
```text
[ ] UPSTREAM_INVENTORY_FROZEN      (deferred to §3)
[ ] CLINEMM_INVENTORY_FROZEN       (deferred to §3)
[ ] DELTA_TABLE_CLASSIFIED         (deferred to §4)
[ ] MISSING_ACCIDENTALLY_DEFENDED  (deferred to §6)
[ ] CANDIDATE_RESTORE_LIST_DONE    (deferred to §5)
[ ] OWNING_EPIC_DECIDED            (deferred to §11)
[x] PASS_RECON_SURFACE_MAPPED      (this ACT — surface + classes +
                                    tests + guards + forbidden-repair)
[x] PASS_NO_PREFERRED_COUNT        (this ACT — no verdict pre-baked)
[x] PASS_NO_PTAD_TAB_AUTHORED      (this ACT — GUARD_NO_PTAD_TAB held)
```

Unticked-on-purpose: any gate above `[ ]` is `NOT_YET_CAPTURED`,
not `PASS`. Promotion rules forbid the latter without a specimen.

Implementation (NOT in this ACT; downstream ACTs only):
```text
[ ] RESTORE_ENTRY_RENDER_ONLY      (TEST_RESTORE_FROM_UPSTREAM_PARENT)
[ ] RESTORE_ENTRY_FULL_SLICE       (TEST_RESTORE_NEEDS_PLUMBING)
[ ] PTAD_UI_BIND                   (only if §3 finds no natural
                                    Advanced/Diagnostics section;
                                    otherwise folded into a restore
                                    entry above)
[ ] TYPECHECK
[ ] TARGETED_VITEST
[ ] LINT/BIOME
[ ] git diff --check
[ ] exact-head dogfood
```

## §14 — Live qualification

This ACT itself does not require dogfood — the inventory is a
read-only diff against upstream. Downstream restore ACTs spawned
by §5 do require dogfood, on a per-entry basis, scoped to the
specific entry's risk surface.

## §15 — Evidence layout

```text
.factory/evidence/ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01/
    upstream-inventory.md     (the §3 frozen upstream snapshot)
    clinemm-inventory.md      (the §3 frozen ClineMM snapshot)
    delta-table.md            (the §4 classification with §6 test IDs)
    candidate-restore.md      (the §5 candidate restore list)
    owning-epic-decision.md   (the §11 decision + rationale)
```

factory/docs ≤ 2 (this ACT + evidence dir).

## §16 — Relationship to other recon ACTs

```text
TASK-COST-TRUTH-RECON01            → cost provenance (request/display stream)
EDITOR-TOOL-APPROVAL-FRICTION-RECON01 → approval UX
UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01 → settings webview inventory
                                        (this ACT)

These are independent recon ACTs. None depends on another. They
share a single contract: recon-only, no source modification,
the §13 gates expose [x] PASS only for what was actually done
in the recon ACT.
```

## §17 — Halt conditions (closed-class)

```text
HALT_UPSTREAM_NOT_INVENTORIED  — upstream Settings webview cannot
                                  be enumerated (e.g. moved/restructured
                                  beyond reproducible capture)
HALT_DRIFT_NOT_REPRODUCIBLE    — delta table cannot be reconstructed
                                  from the frozen §3 snapshots
HALT_TEST_NOT_DEFENSIBLE       — a MISSING_ACCIDENTALLY row cannot
                                  defend its §6 test ID; that row
                                  must be reclassified (most likely
                                  into REMOVED_INTENTIONALLY or
                                  UPSTREAM_NOT_APPLICABLE) and the
                                  classification re-evidenced
HALT_PTAD_TAB_REQUEST          — any in-this-ACT or downstream ACT
                                  request to author a bespoke PTAD
                                  tab; the request must be rejected
                                  at the gate (GUARD_NO_PTAD_TAB)
```

Stop here. **C1: GO_WAIT_FOR_INVENTORY**.
