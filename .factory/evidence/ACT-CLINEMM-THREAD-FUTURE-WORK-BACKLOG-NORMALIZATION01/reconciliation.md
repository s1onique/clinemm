# ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01

> Reconciliation ledger for `FW-01 .. FW-11` future-work items raised
> in the 2026-08-29 ClineMM engineering thread.
>
> **Purpose.** Persist the *knowledge* of every thread-raised idea into
> the repository-backed Factory backlog so nothing useful disappears,
> without implementing any of them. This ACT is **DOCS-ONLY**:
> no production code, no tests, no RED, no implementation ACT.
>
> **Recon discipline.** Each item below is classified as:
>
> ```text
> EXISTING_PRESERVED       — an existing backlog item already covers
>                            the intent; no new durable artifact needed
> EXISTING_UPDATED        — an existing item already covers the intent,
>                            this ACT adds a cross-link / one-line note
> NEW_BACKLOG_ROW         — a new deferred / future row is added to an
>                            existing epic detail file under "Deferred work"
> SUPERSEDED_NO_ACTION    — another item on this list already owns the
>                            intent; nothing extra is needed
> IMPLEMENTED_NO_ACTION   — the idea has already landed in production;
>                            re-litigating it would be a regression
> ```
>
> **Authority.** This ACT does not promote anything to NEXT or OPEN. It
> only makes sure the existing durable backlog preserves every idea
> discussed, so a future reviewer does not have to re-derive the
> discrimination.
>
> **Stop rule.** After this commit, the next operational action is
> `RETURN_TO ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
> HOST-REQUIRED LIVE QUALIFICATION`. This ACT must NOT be used to
> piggyback any implementation work.

---

## Thread items

### FW-01 — DESTRUCTIVE / BROAD MUTATION SCOPE REFINEMENT

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | (none — proposed) `ACT-CLINEMM-DESTRUCTIVE-SCOPE-REFINEMENT-RECON01` |
| OWNER_EPIC | `approval-protection.md` (command-policy / approval-safety surface; the natural substrate next to `EDITOR-TOOL-APPROVAL-FRICTION-RECON01`) |
| PRIORITY | HIGH |
| STATUS | FUTURE / UNIMPLEMENTED |
| ACTION | NEW_BACKLOG_ROW (deferred row appended to `approval-protection.md` Deferred work section) |
| ANCHOR | none in current backlog — `REFINE_SCOPE`, `scope.refinement`, `destructive.scope`, `broad.mutation` all yield zero matches in `apps/`, `sdk/`, `webview-ui/`, `.factory/`, `docs/` |

**Why a new row.** No existing ACT or backlog entry proposes a typed
`REFINE_SCOPE` decision between ALLOW/ASK/DENY for broad or
selector-based destructive mutations. The current command-risk
classification (CLOSED framework; see `command-risk-classification.md`
+ V1/V2 parser-assisted classifier) classifies WHAT a command is; it
does not classify "this command matches an `rm *.tmp` selector and
the impact is hard to bound from a single line" as a separate decision
that warrants a model intent-refinement turn before execution.

**Doctrine anchor.** Upstream Cline approvals explicitly allow an
agent to reformulate after a denied tool call (per upstream SDK
`permission-handling.mdx` and the `approval-handlers.ts` server),
which is the existing behavioral substrate a future typed refinement
response could plug into without inventing an alien control loop.

**Anti-pattern anchor.** A syntactic-only `rm` / `find ... -delete`
classifier is demonstrably brittle in other coding agents; syntactic
variants of `rm` escape heuristic classification
(see Codex `exec_policy.rs` and the reported `rm`-variant fall-through).
The future doctrine must be semantic scope refinement, not more regex.

**Constraints carried into the deferred row.**

- `BROAD_MUTATION != AUTHORIZED_MUTATION`.
- Initial exemplar: `rm *.tmp`, `rm -rf generated/`, `find ... -delete`,
  `git clean -fdx`. Future generalization: mass edits, force ops,
  K8s label-selector deletes, Terraform destroys, broad SQL
  DELETE/UPDATE, recursive chmod/chown, wildcard package removal,
  broad secret/config access, broad firewall/network-policy mutation.
- No "Are you sure?" self-review. No free-form "explain why this is
  safe" as sufficient proof. No rm-specific regex-only architecture.
  No automatic execution merely because the second model turn agrees.
- Escalation ladder (NOT frozen as numeric thresholds in this ACT):
  `L0 NORMAL` → `L1 REFINE_SCOPE` → `L2 JUSTIFY_SCOPE` →
  `L3 PLAN_ONLY` → `L4 HUMAN_APPROVAL`.

**Recon-first discipline.** Future ACT must do recon (Phase 0: capture
live scope-refinement specimen; Phase 1: trace the existing approval
reformulation substrate; Phase 2: RED on a bounded `rm *.tmp` family)
before any production code lands.

---

### FW-02 — APPROVAL TRANSACTION OBSERVABILITY / PENDING CAPTURE GAP

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` |
| OWNER_EPIC | `approval-protection.md` |
| PRIORITY | HIGH after current SSH live qualification |
| STATUS | OPEN / LIVE_RUNNING_STATE_BOUND — specimen at `20260829T060942Z-349b48f1` already bound to `CAPTURE_INSUFFICIENT` |
| ACTION | EXISTING_PRESERVED (no new row; no parallel approval-friction ACT) |
| ANCHOR | `.factory/epics/approval-protection.md` L25 (the contract already records "Actual observed friction moved to the non-command / editor-tool surface"); `.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/captures/specimen-20260827-command-approval01.json`; capture at `20260829T060942Z-349b48f1/{pending,resolved}/` |

**Why preserved, not duplicated.** The thread's "visible Pending
approval existed, capture artifact itself PASSed, approval events
before = 0, approval events after = 0, `SPECIMEN_BINDING =
CAPTURE_INSUFFICIENT`" finding is the *current* live state of the
existing recon ACT — it is already durable in the specimen JSON
and the recon ACT's existing "Reopen / new-work conditions" block
already authorizes "Phase 2: exact RED with YOLO+Seatbelt on the
live-prompt tool; possible outcomes — `callback=ASK` → policy
defect, `callback=ALLOW` + UI still prompts → completion/UI seam
defect, callback never reached → seam moved." Authoring a parallel
approval-friction ACT would split the substrate.

**Future-work seam (carried into the recon ACT, not into a new file):**

- Smallest DEFAULT_OFF persistent approval transaction recorder at
  the real approval entry/terminal seam.
- Required future fields: schema version, timestamp, session
  identity, task identity if available, canonical approval /
  correlation identity, tool name, policy auto-approve state,
  `shouldAutoApproveTool` result, `ENTRY | TERMINAL`,
  approved / rejected / cancelled outcome.
- Constraints: no policy change; no diagnostic side effect inside
  semantic state updaters; no heuristic `toolName + timestamp`
  identity; no "latest pending approval" correlation;
  bounded / removable / default-off; reuse canonical approval
  identity if current runtime supplies one.
- Existing `tools/factory/capture-approval-specimen.py` remains the
  consumer; do not redesign it in this backlog ACT.

---

### FW-03 — COMPLETION RESULT / COMPLETED FRAME COPY BOUNDARY

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | `COMPLETION-RESULT-COPY-BOUNDARY-RECON` |
| OWNER_EPIC | `task-presentation.md` |
| PRIORITY | DEFER / MED |
| STATUS | DEFER (no live reopen trigger) |
| ACTION | EXISTING_PRESERVED (no new row) |
| ANCHOR | `.factory/epics/task-presentation.md` L56–L95 (verbatim "### COMPLETION-RESULT-COPY-BOUNDARY-RECON" section under Deferred work) |

**Why preserved, not duplicated.** The deferred section is already
the canonical durable claim; reopening it under a new identity would
resurrect closed work under a working label (the same anti-pattern
the task-presentation epic explicitly calls out at L44). The
constraints in the deferred section match the thread doctrine
verbatim: compatibility-first, no widening of completion authority,
no inference of completion from prose, no runtime completion
semantics change.

---

### FW-04 — UPSTREAM SETTINGS SURFACE PARITY / LOST "EXTENDED" AREA

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` |
| OWNER_EPIC | tentative — `product-config-branding.md` (decision deferred to the ACT's §11 owning-epic decision tree; may spawn `EPIC-CLINEMM-SETTINGS-SUBSTRATE01` if §5 has ≥3 restore entries spanning distinct categories) |
| PRIORITY | P2 / HOLD_FOR_EXECUTION |
| STATUS | OPEN / HOLD_FOR_EXECUTION |
| ACTION | EXISTING_PRESERVED (the thread-derived subitems — no wholesale upstream copy, no bespoke PTAD tab, Advanced/Diagnostics placement if PTAD binds — are already explicit guards in the existing ACT's §7 / §9 / GUARD_NO_PTAD_TAB) |
| ANCHOR | `.factory/acts/ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01.md` (whole file, 446 lines); board row 26 in `.factory/epic-board.md`; epic ledger row in `.factory/epics/product-config-branding.md` L39 |

**Why preserved, not duplicated.** The ACT's §2 scope already names
the two surfaces to compare (`UPSTREAM-SETTINGS` vs
`CLINEMM-SETTINGS`); §3 specifies the capture order (enumerate
upstream FIRST, then classify against ClineMM, to avoid "we're
fine" bias); §4 names the five-way classifier (`MISSING_ACCIDENTALLY`
/ `REMOVED_INTENTIONALLY` / `SUPERSEDED_BY_CLINEMM` /
`UPSTREAM_NOT_APPLICABLE` / `PRESENT_IN_BOTH`); §7 holds the
`GUARD_NO_WHOLESALE_UPSTREAM_COPY` and `GUARD_NO_PTAD_TAB` guards;
§8 records the external radar (upstream 3.16.0 Advanced settings
migration, 3.30/3.31 settings-visible YOLO mode) so a future
reviewer can distinguish "upstream no longer has this surface"
from "the fork drifted away"; §11's decision tree preserves both
the "small-bore fits in `product-config-branding.md`" and the
"`>= 3 restore entries spanning distinct categories` ⇒ spawn
`EPIC-CLINEMM-SETTINGS-SUBSTRATE01`" branches.

The thread-derived subitems are therefore already covered:

- "recover/reconcile upstream Extended/Advanced surface if genuinely
  lost" → will fall out of §3's `MISSING_ACCIDENTALLY` row + §6's
  `TEST_RESTORE_FROM_UPSTREAM_PARENT` or `TEST_RESTORE_NEEDS_PLUMBING`.
- "PTAD / diagnostics controls should live inside an existing
  Advanced/Extended/Diagnostics area if parity recon supports it" →
  is exactly the `GUARD_NO_PTAD_TAB` discipline (PTAD lives in an
  existing Advanced / Diagnostics section if it lives anywhere).
- "No bespoke top-level PTAD tab" → `GUARD_NO_PTAD_TAB` + ACT §0 stop
  rule.
- "Stop proliferating opaque env-var-only controls where a stable
  product setting is appropriate" → this becomes a sub-finding the
  recon may surface as a `SUPERSEDED_BY_CLINEMM` row (the
  `CLINEMM_SAFE_YOLO_*` env vars may eventually warrant a stable
  settings surface — see FW-05 / FW-11).

---

### FW-05 — SEATBELT / SAFE-YOLO USER-FACING SETTINGS SURFACE

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | (proposed as a sub-finding under) `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` |
| OWNER_EPIC | tentative — `product-config-branding.md` (per §11 decision tree of the settings-parity ACT) |
| PRIORITY | HIGH-MED |
| STATUS | FUTURE / UNIMPLEMENTED |
| ACTION | EXISTING_UPDATED (one-line cross-link from `safe-yolo-seatbelt.md` Deferred work → settings-parity ACT §5) |
| ANCHOR | settings-parity ACT §3 / §4 / §5; safe-yolo-seatbelt.md (new deferred row appended) |

**Why no separate ACT.** The ACT instruction explicitly says: "This
may fold into FW-04 after settings-parity recon. Do NOT create a
duplicate ACT if the settings parity lane already owns it." The
settings-parity ACT's §3 enumerates upstream FIRST and classifies
each missing entry; if the ClineMM internal env controls
(`CLINEMM_SAFE_YOLO_NETWORK`, `CLINEMM_SAFE_YOLO_SSH_AGENT`, PTAD
env controls) are classified as either `SUPERSEDED_BY_CLINEMM`
(keeping the env surface, but adding a stable settings surface) or
`MISSING_ACCIDENTALLY` (some upstream-visible equivalent exists),
then §5's candidate-restore list will include the seatbelt-user-
facing surface under FW-05's existing shape:

- `Network egress` → upstream "Allow outbound network" toggle
  candidate (corresponds to current `CLINEMM_SAFE_YOLO_NETWORK`).
- `Authentication` → SSH agent toggle (corresponds to current
  `CLINEMM_SAFE_YOLO_SSH_AGENT`).
- `Diagnostics / Advanced` → PTAD controls.

**Constraints carried forward (from this backlog entry into any
future restore ACT).**

- Independent capabilities, not one giant YOLO switch.
- No top-level bespoke PTAD tab (already `GUARD_NO_PTAD_TAB`).
- No raw `~/.ssh` key-read toggle in V1 (`readonly`-identity-file
  mode is OUT OF SCOPE for V1 per `safe-yolo-seatbelt.md` SSH
  RECON01 §15 contract; preserved verbatim).
- Do not silently convert temporary env controls into permanent
  public API — the env controls remain; the settings surface
  supersedes them only when the settings surface can fully cover
  the same capability.
- Placement depends on settings-parity §11 decision.

**Cross-link added.** A one-line cross-link from
`safe-yolo-seatbelt.md` "Deferred work" → settings-parity ACT §5
ensures a future reviewer can find this item without re-deriving
the discrimination.

---

### FW-06 — HUSKY TOOLCHAIN PATH PORTABILITY

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | (proposed as working label) `HUSKY-TOOLCHAIN-PATH-PORTABILITY01` |
| OWNER_EPIC | `factory-infrastructure.md` (Factory/DevEx/tooling substrate; `EPIC-FACTORY-INFRASTRUCTURE` is the natural owner of repo-wide developer-tool portability) |
| PRIORITY | P2 / DEFER |
| STATUS | FUTURE / DEFER (not currently reproducible by anyone other than the operator; activation criteria explicit) |
| ACTION | NEW_BACKLOG_ROW (deferred row appended to `factory-infrastructure.md`) |
| ANCHOR | `.husky/pre-commit` (current hook hard-codes `/opt/homebrew/bin/gitleaks`, `/usr/local/bin/gitleaks`, `/home/linuxbrew/.linuxbrew/bin/gitleaks` and falls back to `command -v gitleaks`); `.gitignore` / lint-staged path injection (operator-side `PATH` workaround) |

**Why a new row, but DEFER.** No existing backlog entry owns
repository-hook toolchain portability. The historical symptom is
bounded and already mostly worked around (the gitleaks branch
explicitly enumerates Homebrew prefixes for `darwin-arm64`,
`darwin-x86_64`, and Linuxbrew); `bun` / `bunx` remain operator-side
PATH-injected (the `cd apps/vscode && bunx lint-staged` line in
`.husky/pre-commit` does not enumerate prefixes).

**Activation criteria (explicit).**

- Another operator / CI environment reproduces the failure (a new
  hook-related tool dropped from PATH on a fresh checkout).
- OR Factory decides developer-tool portability warrants proactive
  work (e.g. the upcoming Codex issue cluster includes a similar
  PATH-shadowing finding that would benefit from a unified
  resolution).

**Constraints (carried into the deferred row).**

- Recon first.
- No machine-specific tracked symlinks.
- No broad global PATH mutation unless evidence justifies it.
- Prefer bounded per-tool discovery if opened (e.g. `command -v`
  chain with documented fallbacks).
- Do NOT silently weaken the `gitleaks` requirement (the current
  hook fails closed if `gitleaks` cannot be located; that posture
  must be preserved).

---

### FW-07 — TASK COST / BILLING-SEMANTIC PRESENTATION

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | `ACT-CLINEMM-TASK-COST-TRUTH-RECON01` |
| OWNER_EPIC | `product-config-branding.md` |
| PRIORITY | P1 (HOLD) |
| STATUS | OPEN / HOLD_FOR_EXECUTION — TWO-LAYER framing (Layer-1 per-request arithmetic subordinate + Layer-2 billing-semantic presentation primary); canonical MiniMax Ultra case = `(C, II)` forecast → `PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1` rather than an accumulator repair |
| ACTION | EXISTING_PRESERVED |
| ANCHOR | `.factory/acts/ACT-CLINEMM-TASK-COST-TRUTH-RECON01.md` (whole file); board row 25; epic ledger row at `product-config-branding.md` L38; closed-family note at L14–L15 |

**Why preserved, not duplicated.** The ACT explicitly preserves
the distinction `PAYG_EQUIVALENT_ESTIMATE != AUTHORITATIVE_USER_BILLED_COST`,
already records the canonical MiniMax Ultra case, already forecasts
the presentation-repair ACT (`PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1`),
and already rules out provider-id exception logic via the
`Layer-2` semantic invariant at §17 (`HALT_BILLING_SEMANTIC_UNPROVEN`).
A new presentation-repair ACT is *forecasted*, not yet opened; the
ACT spec's "Do NOT build provider-id exception logic" rule is
already enforced at the §17 closed-class.

---

### FW-08 — RUNTIME BACKGROUND COMMAND / FOREGROUND OWNERSHIP

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` |
| OWNER_EPIC | `runtime-task-progression.md` |
| PRIORITY | HIGH |
| STATUS | OPEN / LIVE_RUNNING_STATE_BOUND (awaiting terminal chronology; see epic ledger row 58) |
| ACTION | EXISTING_PRESERVED — explicitly DO NOT open `ACT-CLINEMM-BACKGROUND-COMMAND-LOOP-LIVENESS01` |
| ANCHOR | `.factory/epics/runtime-task-progression.md` L85–L87 (the `HOST_DEFERRED_FOREGROUND_OWNERSHIP_CONTRACT = UNDEFINED` block AND the explicit "DO NOT OPEN `ACT-CLINEMM-BACKGROUND-COMMAND-LOOP-LIVENESS01`" verdict at L87) |

**Why preserved, not duplicated.** The existing epic already owns:

- The "OWNED/AWAITED vs DETACHED" candidate product contract.
- The `notifyParent`-style steering analogue (per
  `cline/sdk/examples/plugins/background-terminal.ts`).
- The `PRODUCTION_CONTRACT_CANDIDATE` marker in `live-failure.json:
  open_product_questions_recorded` — explicitly NOT a
  implementation decision.
- The terminal-state capture gap (`cmd_mtcjhkhygpteq8v9` or
  deterministic bounded repro) — UNOBSERVED; recommended next
  capture path is recorded.
- The "no prompt hacks, no fake Continue messages, no 'keep
  Working visually' deception, no universal synchronous blocking,
  no background-execution ban" constraints.

A new ACT `ACT-CLINEMM-BACKGROUND-COMMAND-LOOP-LIVENESS01` is
explicitly FORBIDDEN by L87 unless the recon's §3 discriminator
proves a repair that is causally distinct from the
runtime-task-progression family.

---

### FW-09 — JANUARY-1 EXTENSION ICON DEMO

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | (proposed) `ACT-CLINEMM-BRANDING-DEMO-JAN1-ICON01` |
| OWNER_EPIC | `product-config-branding.md` (under the existing `EPIC-CLINEMM-BRANDING01` umbrella; the existing umbrella epic already owns visible-branding ACTs) |
| PRIORITY | DEMO / LOW |
| STATUS | FUTURE / UNIMPLEMENTED |
| ACTION | NEW_BACKLOG_ROW (deferred row appended to `product-config-branding.md` Deferred work section) |
| ANCHOR | none in current backlog — zero matches for `JANUARY-1`, `JAN-1`, `festive`, `shiny`, `BRANDING.*DEMO`, `release.*plumbing` outside the unrelated `cline-parser-helper` legacy binary's address-table strings |

**Why a new row, but DEMO/LOW.** This is a deliberately tiny
end-to-end demo task for product/UI release plumbing. No existing
backlog entry owns date-driven icon decoration, and the existing
`EPIC-CLINEMM-BRANDING01` umbrella's first bounded slice is the
icon-replacement ACT (different concern: `‖ → --`). Adding a
DEMO/LOW backlog row under the umbrella epic keeps the eventual
ACT visible without promoting it to NEXT.

**Constraints carried into the deferred row.**

- Deterministic date seam (e.g. `Date.now()` within a configurable
  date range, or a build-time `JAN1_DEMO_ENABLED` flag — NOT a
  clock-driven side effect without an explicit toggle).
- Testable without waiting for January 1 (the date seam must
  accept a fakeable "now" for tests).
- No external network dependency.
- No large branding redesign (single decorative treatment on
  Jan 1 only; preserve the normal icon on every other date).
- Easy revert / removal (the entire feature lives behind one
  date-configurable seam).
- This is a demo task, not product-critical work. The DEMO/LOW
  priority is intentional and must not be promoted ahead of any
  `P0` / `P1` work.

---

### FW-10 — COMPLETION PRESENTATION / STREAM PLACEMENT

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | `COMPLETION-RESULT-COPY-BOUNDARY-RECON` (same as FW-03) |
| OWNER_EPIC | `task-presentation.md` |
| PRIORITY | DEFER / MED |
| STATUS | DEFER (no live reopen trigger) |
| ACTION | SUPERSEDED_BY_FW03 (FW-03's deferred row already owns this — the symptom described is the same "completion framing may appear mid-stream; part of the closing model message may fall outside the Completed container" finding) |
| ANCHOR | `.factory/epics/task-presentation.md` L56–L95 |

**Why no new row.** FW-10 explicitly says "If FW-03 already
completely owns this, do not add another row." The deferred row
already covers the symptom, the constraints (compatibility-first,
no runtime-authority change, preserve upstream-style completion
container unless evidence warrants divergence), and the reopen
triggers (recurring user complaint, explicit user demand, upstream
presentation change).

---

### FW-11 — TEMPORARY INTERNAL CONTROL → PRODUCT CONTROL CLEANUP

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | (cross-cutting child of settings-parity + safe-yolo seats; no separate ACT) |
| OWNER_EPIC | `safe-yolo-seatbelt.md` (primary; the env controls are owned by the seatbelt substrate) + cross-link from settings-parity ACT §3 inventory |
| PRIORITY | P2 / DEFER |
| STATUS | FUTURE / DEFER (no current user demand; the env controls remain valid until a stable settings surface can fully cover them — see FW-05) |
| ACTION | NEW_BACKLOG_ROW (deferred row appended to `safe-yolo-seatbelt.md` Deferred work section) |
| ANCHOR | `.factory/epics/safe-yolo-seatbelt.md` L14 (workspace-write), L15 (network-open — `CLINEMM_SAFE_YOLO_NETWORK`); SSH-agent authority RECON01 §15 (frozen contract for `CLINEMM_SAFE_YOLO_SSH_AGENT`); `post-terminal-authority-diagnostic-runtime.ts` L51 (PTAD env controls); `sandbox-backend.ts` L34 (`createSandboxBackendFromEnv` — `CLINEMM_EXPERIMENTAL_SANDBOX`) |

**Why a deferred row, not a new ACT.** This is an inventory +
classification task: each temporary / internal control must be
classified as `KEEP_INTERNAL` / `REPLACE_WITH_SETTING` /
`REMOVE_AFTER_SUCCESSOR` / `DEBUG_ONLY` before any cleanup ACT can
be opened. No inventory exists yet; opening a "cleanup" ACT
without the inventory would be premature.

**Inventory (to be made durable in the deferred row).**

- `CLINEMM_SAFE_YOLO_NETWORK` — current internal control;
  classification = `REPLACE_WITH_SETTING` (see FW-05).
- `CLINEMM_SAFE_YOLO_SSH_AGENT` — current internal control;
  classification = `REPLACE_WITH_SETTING` (see FW-05).
- PTAD env controls (`post-terminal-authority-diagnostic-runtime.ts`)
  — current internal control; classification =
  `REPLACE_WITH_SETTING` (settings-parity §3 inventory will
  determine the surface; `GUARD_NO_PTAD_TAB` preserved).
- `CLINEMM_EXPERIMENTAL_SANDBOX` (`sandbox-backend.ts`) —
  classification = `KEEP_INTERNAL` (substrate-only; not user-facing).
- Any still-live `CLINEMM_EXPERIMENTAL_*` naming that is
  semantically stale — classification TBD by inventory.

**Constraints (carried into the deferred row).**

- No action in this backlog ACT beyond making the debt durable.
- The settings-parity ACT's §3 inventory may surface these env
  controls as `SUPERSEDED_BY_CLINEMM` rows (env control remains,
  stable settings surface added).
- The "do not silently convert temporary env controls into
  permanent public API" rule from FW-05 carries forward.

---

## Explicitly NOT backlogged (per ACT instruction)

These items were raised earlier in the thread but are already
implemented / closed; re-opening them as future work would be
a regression, not a normalization:

| Item | Why not a future-work row |
|---|---|
| Seatbelt-YOLO explicit completion authority | Implemented by `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01` + `…-IMPLEMENTATION01` (CLOSED); see `safe-yolo-seatbelt.md` ledger |
| `submit_and_exit` registration / rebuild / failure / re-arm mechanics | Closed in `safe-yolo-seatbelt.md` core substrate closure; production-equivalent evidence preserved |
| SSH agent `deny \| agent` product contract itself | Frozen at RECON01 §15; implementation / qualification is `ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01` (OPEN, NEXT live qualification path) — this is the live ACT immediately after this backlog normalization closes |
| SSH-agent backend / profile production implementation | Already landed; the next act is executable qualification only |
| Network mechanism implementation | Already landed (`SEATBELT-NETWORK-EGRESS-RECON01` mechanism substrate proven; product-policy contract still open per board row 23) |

Existing qualification / evidence steps remain in their owning ACTs;
they are not new backlog features.

---

## Recon / classification totals

```text
ITEMS_RECONCILED                  = 11
NEW_ITEMS                         = 4   (FW-01, FW-06, FW-09, FW-11)
EXISTING_ITEMS_UPDATED            = 1   (FW-05 — cross-link only)
EXISTING_ITEMS_PRESERVED_NO_DIFF  = 5   (FW-02, FW-03, FW-04, FW-07, FW-08)
SUPERSEDED_NO_ACTION              = 1   (FW-10 → FW-03)
IMPLEMENTED_NO_ACTION             = 5   (see table above)

PRODUCTION_FILES_CHANGED          = 0
TEST_FILES_CHANGED                = 0
NEW_VALIDATOR_FAILURES_FROM_THIS_ACT = 0   (target)
EDITOR_CAPTURE_RESIDUE_PRESERVED  = yes (foreign residue under
                                     ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01
                                     byte-for-byte untouched)
STASH_PRESERVED                   = yes (stash@{0}: c2-green-and-c2-p1-delta
                                     untouched)
```

Pre-existing validator failures (NOT introduced by this ACT — see
`bun tools/factory/validate-epic-board.ts` output at entry):

```text
NO_OVERSIZED_INDEX_TABLE_CELL  (HARD, FAIL)
  table@L16 row7 "Work" = 424 chars  (>280)
  table@L56 row4 "State" = 366 chars  (>280)

INDEX_TARGET_READABLE          (ADVISORY, FAIL)
  224 lines  (target ≤220, warn 221..399)
```

Per ACT instruction "Do not repair unrelated historical oversized
cells" — these are pre-existing and out of scope for this ACT.
The ACT introduces no NEW validator failures.

---

## Files modified by this ACT

```text
.factory/epics/approval-protection.md          + FW-01 deferred row + FW-02 cross-link note
.factory/epics/factory-infrastructure.md       + FW-06 deferred row
.factory/epics/product-config-branding.md      + FW-09 deferred row + FW-11 cross-link
.factory/epics/safe-yolo-seatbelt.md           + FW-05 cross-link + FW-11 deferred row
.factory/evidence/ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01/
    reconciliation.md                           (new — this file)
.gitignore                                      (whitelist entry for the evidence dir,
                                                 mirrors .factory/evidence/ default-deny
                                                 + whitelist precedent)
```

No files in `apps/`, `sdk/`, `webview-ui/`, package manifests, tests,
runtime config, or generated files are modified. The board
(`epic-board.md`) is NOT modified — this ACT only adds cross-links
inside epic detail files under their respective `Deferred work`
sections, which is below the board index layer per
`_index-contract.md` §1.

---

## Verdict

```text
ACT_ID          = ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01
ENTRY_HEAD      = d8c53cbc73f50d79adacc04fbba3aa35de354555
FINAL_HEAD      = ad787635fb5a06654388ca68ff02969e353b8bf7
VERDICT         = PASS_THREAD_FUTURE_WORK_BACKLOG_NORMALIZED

NEXT OPERATIONAL ACTION IS:

  RETURN_TO
  ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
  HOST-REQUIRED LIVE QUALIFICATION

  specifically:
    Terminal.app / iTerm2
    → real-kernel SSH-03/04/06/12
    → ablation
    → live ssh-agent SSH qualification

STOP. Do NOT start any of these future items.
Do NOT review them again.
Do NOT implement REFINE_SCOPE.
Do NOT touch Settings.
Do NOT touch approval diagnostics.
Do NOT polish the backlog.
```
