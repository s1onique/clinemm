# EPIC-PRODUCT-CONFIG-BRANDING

> Product telemetry (cost display truth, main consolidation), product configuration, and branding. See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: ACTIVE — closed cost/consolidation substrate + **2 open product fronts**
- Priority: P2 (product-facing substrate; not safety/lifecycle-critical)
- Current frontier: 2 OPEN items listed under "Open work" — `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` (first ACT `TOOL-EXECUTION-SEMANTICS-RECON01`) and `EPIC-CLINEMM-BRANDING01` (first bounded slice `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01`).
- Blocked by: n/a

## Contract / durable conclusions

- **Cost display truth is closed.** `ACT-CLINEMM-COST-DISPLAY-TRUTH01` (with its CORRECTION01 and CORRECTION02) is the canonical contract: cost values shown to the user are derived from the canonical cost source, not from re-derived approximations. Any future cost display must consume the canonical source.
- **Main consolidation landed.** `ACT-CLINEMM-MAIN-CONSOLIDATION01` closed at the consolidation commit `d844177bc` (per the prior board wave summary). The canonical main branch carries the consolidated state; non-canonical top-level branches are reconciled into it.
- **Tool-execution-semantics is an open product front.** `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` (board row 20) is `STATUS: OPEN`. Its first ACT is `TOOL-EXECUTION-SEMANTICS-RECON01`. Do **not** implement classifier logic in this board ACT — the recon precedes any classifier implementation.
- **Branding is an open product front.** `EPIC-CLINEMM-BRANDING01` (board row 21) is `STATUS: OPEN`. Its first bounded slice is the activity-bar icon replacement `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01`. Icon behavior must preserve VS Code monochrome / theming (no colored branding that breaks native Activity Bar theming).
- **Two closed product substrates.** The "Cost display truth" (`EPIC-CLINEMM-COST-DISPLAY-TRUTH01`) and "Main consolidation" (`ACT-CLINEMM-MAIN-CONSOLIDATION01`) families are CLOSED_CLEAN; the Product telemetry section that contains them is **not** closed — it carries the two open fronts above.

## ACT ledger

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `ACT-CLINEMM-COST-DISPLAY-TRUTH01` (+ CORRECTION01, CORRECTION02) | CLOSED | L3378-3574 | Cost display truth (canonical cost source) |
| `ACT-CLINEMM-MAIN-CONSOLIDATION01` | CLOSED at `d844177bc` | L3378-3574 | Main consolidation (canonical main carries consolidated state) |
| `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` | **OPEN** (umbrella epic; first ACT `TOOL-EXECUTION-SEMANTICS-RECON01` already closed `PASS_RECON`; bounded implementation slice `ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01` = `TES-IMPL-01` is now the canonical working label — mechanism-only projection, no purpose / outcome / duration in V1) | L3378-3574 | Tool-execution-semantics product front |
| `EPIC-CLINEMM-BRANDING01` | **OPEN** (umbrella epic; first bounded slice `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01`) | L3378-3574 | Branding product front |
| `ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01` (was working label `TES-IMPL-01`, under `TOOL-EXECUTION-SEMANTICS01`) | **OPEN** — mechanism projection only (6 production files + 4 test files; **48 new tests** added across the ACT lifecycle: 21 classifier (15 baseline + 6 wire-boundary) + 9 tracker + 12 webview-render (8 baseline + 4 wire-boundary) + 6 wire-boundary webview-helpers). Targeted SDK suite passes 73/73 (43 tracker pre-existing + 30 ACT-classifier-or-tracker additions); webview TaskHeader suite passes 31/31 (19 pre-existing + 12 ACT); webview helpers suite passes 35/35 (29 pre-existing + 6 ACT). V1 renders `🔧N · ✏️E · >_C · 👁R · 🔍S · 🔌M · ❓O` in the TaskHeader. `purpose` / `outcome` / `duration` / `effect` deliberately deferred (UNAVAILABLE_FROM_TRACE or out of V1 scope). Conservation: `mechanism.total === toolCalls`. Wire-boundary validator: webview trusts the projection only when `isUsableMechanismProjection` returns true (4 conditions: projection present, all fields finite non-negative integers, bucket sum === total, total === toolCalls); otherwise falls back to the legacy flat `🔧 N` rendering. The webview-side validator is semantically equivalent to the SDK-side check (separate copies — webview bundle cannot import host modules). Acceptance criteria pinned: see `.factory/acts/ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01.md` §6. | L3378-3574 | Bounded TaskHeader mechanism projection; example truthful projection: `Tools 10 · Edits 3 · Commands 3 · Reads 2 · MCP 1 · Other 1`. Do **not** infer `CODE_EDIT` from shell command strings; mechanism identity comes from the registered/native tool identity. |
| `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01` | **OPEN** (first bounded slice under `EPIC-CLINEMM-BRANDING01`) | L3378-3574 | Branding activity-bar icon replacement (`‖ → --`) |
| (substrate; no separate ACT) | CLOSED | L3575-3606 | Product configuration / branding substrate |

## Open work

Two open product fronts:

- **`EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01`** (L3378-3574). Status: OPEN. The umbrella epic is board row 20. Its first ACT is `TOOL-EXECUTION-SEMANTICS-RECON01`, which already closed `PASS_RECON`. The bounded implementation slice `ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01` (= working label `TES-IMPL-01`) is the next working slice — mechanism-only TaskHeader projection (see `.factory/acts/ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01.md`). Per the recon verdict (`docs/architecture/elm/task-state-tes01-tool-execution-semantics-recon-evidence.md`): mechanism/outcome/duration are REAL; `purpose` is `UNAVAILABLE_FROM_TRACE` and must remain UNAVAILABLE in the projection. Do **not** infer semantic purpose from command/tool arguments — classify only from the canonical registered tool identity (e.g. `apply_patch` / native write tool → EDIT; `run_commands` / `execute_command` → COMMAND; native read/search → READ/SEARCH; `mcp_*` → MCP; structurally unknown → OTHER/UNKNOWN).
- **`EPIC-CLINEMM-BRANDING01`** (L3575-3606). Status: OPEN. The umbrella epic is board row 21. Its first bounded slice is `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01` (board row 24, `NEXT / MED`). Icon: `‖ → --`. Preserve VS Code monochrome / theming behavior.
- **`ACT-CLINEMM-TASK-COST-TRUTH-RECON01`** (board row 23, `OPEN / HIGH`). Status: recon-only; binds `TASK_DISPLAYED_COST` to authoritative per-request cost evidence. Authored 2026-08-27 at the launch commit; recon §2 `PASS_RECON_SURFACE_MAPPED` at authorship, §3 live matrix deferred. Does NOT supersede `EPIC-CLINEMM-COST-DISPLAY-TRUTH01` (CLOSED) — it targets a *different* surface (per-request cost provenance within the request/display stream). The closing condition is either Bucket C (`PASS_COST_FAITHFUL` + §10 conservation evidence, no RED) or Bucket A/B/D/E (RED author + repair ACT). Until §3 produces a specimen, `CORRECTNESS = UNKNOWN` and the dollar amount is NEVER the stop rule.
- **`ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01`** (board row 24, `OPEN / MED-HIGH`). Status: tentative epic placement pending the ACT's §11 owning-epic decision tree. If the candidate restore list (§5) has ≥ 3 entries spanning distinct categories, the ACT will spawn `EPIC-CLINEMM-SETTINGS-SUBSTRATE01`; otherwise this row's detail file link is the durable answer. Authored 2026-08-27 at the launch commit; recon §2 `PASS_RECON_SURFACE_MAPPED` at authorship, §3 inventory deferred. Three epistemic guards held by the ACT: NO wholesale upstream copy (`GUARD_NO_WHOLESALE_UPSTREAM_COPY`), preserve deliberate fork divergence (`GUARD_PRESERVE_DELIBERATE_DIVERGENCE` — Seatbelted-YOLO replacing upstream plain-YOLO is the canonical example), NO bespoke PTAD tab (`GUARD_NO_PTAD_TAB` — PTAD may fold into an existing Advanced/Diagnostics section, but never a top-level tab). The recon MUST classify each missing setting as `MISSING_ACCIDENTALLY` / `REMOVED_INTENTIONALLY` / `SUPERSEDED_BY_CLINEMM` / `UPSTREAM_NOT_APPLICABLE` / `PRESENT_IN_BOTH`; only the first class drives a candidate restore.

Reopen / new-work conditions:

- Cost display observed diverging from the canonical cost source. (Distinct from the `TASK-COST-TRUTH-RECON01` lane: the display-source contract itself diverging is this epic; per-request cost provenance diverging is the new recon ACT.)
- Main branch loses the consolidated state (i.e. a non-canonical branch re-emerges as a long-lived side).
- A new visible-branding ACT lands that supersedes `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01`.
- `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` §11 decides to spawn `EPIC-CLINEMM-SETTINGS-SUBSTRATE01` — at that point, this row migrates to the new epic detail file and this row collapses to a durable cross-reference link (per the conservation rule in `_index-contract.md` §5).

## Deferred work

None.

## Historical detail

### Product telemetry — L3378-3574 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L3378-3574 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## Product telemetry

### TOOL-EXECUTION-SEMANTICS01

- ID: `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01`
- STATUS: OPEN

**Goal.** Replace an undifferentiated raw tool count with semantically useful execution telemetry.

**Important.** Mechanism ≠ purpose.

**Dimensions:** mechanism, purpose, effect class, duration, success/failure, retry/recovery, classification confidence/source.

**Purpose candidates:**

  CODE_READ        CODE_EDIT      CODE_SEARCH
  TEST             BUILD          VALIDATION
  REPO_CONTROL     EVIDENCE_CAPTURE  RUNTIME_DIAGNOSTIC
  ENVIRONMENT_SETUP  DATA_QUERY   EXTERNAL_ACTION
  DOCUMENTATION    HOUSEKEEPING   OTHER

**Effect class:**

  READ_ONLY
  LOCAL_MUTATION
  EXTERNAL_MUTATION

**Rule.** Ambiguous shell commands must remain UNKNOWN/OTHER rather than being presented as certain semantic telemetry.

**First ACT.** `TOOL-EXECUTION-SEMANTICS-RECON01`. Do not infer semantic purpose from command/tool arguments — classify only from the canonical registered tool identity (`apply_patch` / native write → edit; `run_commands` / `execute_command` → command; native read/search → read/search; `<server>__<tool>` → mcp; structurally unknown → other).

### COST-DISPLAY-TRUTH01

- ID: `EPIC-CLINEMM-COST-DISPLAY-TRUTH01`
- STATUS: CLOSED_CLEAN / TRUTHFUL_BILLING_PRESENTATION

**Symptom.** Dollar estimates such as `"$0.0082"` are misleading when the user is on a flat-rate / subscription access path.

**Primary question.** Can runtime reliably know billing semantics?

**Desired behavior:**

  metered API        → estimated cost may be meaningful
  flat-rate / subscription  → pseudo-spend total should NOT be presented as actual spend

**If billing mode is not observable:** support explicit display policy / user override rather than inventing billing knowledge.

**Closed at:** ACT-CLINEMM-COST-DISPLAY-TRUTH01 + CORRECTION01 + CORRECTION02 (branch `act/cost-display-truth01`, HEAD `7f68fa06`)

**Reproduction (RED).** ClinePass metadata already carries `usageCostDisplay = "subscription"` from `@cline/llms` (`sdk/packages/llms/src/providers/builtins.ts:682`). The catalog layer (`apps/vscode/src/sdk/model-catalog/catalog.ts:56-58`) collapsed every non-`"hide"` value to `"show"`, so the TaskHeader price-tag rendered `"$0.0082"` for ClinePass sessions. RED proven at the TaskHeader seam via `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.test.tsx > CDT02`.

**Causal classification.** C2_PROVIDER_ID_IS_AVAILABLE_BUT_PRESENTATION_IS_PROVIDER_AGNOSTIC — the catalog `UsageCostDisplay` type and its `readUsageCostDisplay` mapper dropped `"subscription"`; downstream renderers had no way to distinguish subscription from metered.

**Main repair (bounded, one place).**

  - `apps/vscode/src/sdk/model-catalog/contracts.ts` — widen `UsageCostDisplay` to `"show" | "hide" | "subscription"`.
  - `apps/vscode/src/sdk/model-catalog/catalog.ts` — `readUsageCostDisplay` forwards SDK answer verbatim.
  - `apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts` — widen return union.
  - `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx:142-156` — gate the price-tag on `usageCostDisplay === "show"` (one-character semantic flip).
  - `apps/vscode/proto/cline/models.proto` — doc comment lists the three wire values.
  - `sdk/packages/llms/src/providers/billing.test.ts` — explicit cline-pass contract test added.

**CORRECTION01 (P1 follow-up from reviewer).** Original repair still defaulted `useProviderUsageCostDisplay` to `"show"` while the catalog was loading. For a ClinePass session that meant the price-tag could render `"$0.0082"` for the brief window between component mount and SDK catalog resolution — exactly the claim this ACT exists to prevent.

  - `apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts` — consult `useProviderListings().isLoading` explicitly; fall back to `"hide"` for: providerId undefined, `isLoading`, empty providers, listing not found. Only a recognized provider with `usageCostDisplay === "show"` returns `"show"`; the metered-conservative default is now strictly narrower than before.
  - New hook-level test file `apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.test.ts` — 8 cases; ablation confirmed 4/8 RED with the old hook.
  - `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.test.tsx` — added CDT07 (subscription + unresolved → no tag) and CDT08 (metered + unresolved → no tag → resolves to `"show"` → tag appears); cleaned the stale "subscription AND hide providers leaked" comment to reflect that only the subscription class was leaking pre-repair.

**CORRECTION02 (P1 follow-up from reviewer, second pass).** CORRECTION01's hook still returned `"show"` for any `usageCostDisplay` value other than `"hide"` or `"subscription"`. The wire field is `string`, not a closed protobuf enum, so a future SDK value this fork doesn't yet know — e.g. `"credits-included"`, `"quota"`, `"enterprise-flat-rate"` — would silently default to metered, reintroducing the same false-spend class this ACT exists to prevent.

  - `apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts` — last-resort branch flipped: only explicit `"show"` authorizes a spend claim; `"subscription"` passes through; everything else (including future values, empty string, unknown shape) returns `"hide"`. Hook invariant: **"Only an explicit `"show"` authorization may produce a dollar spend claim. Everything else fails closed."**
  - `apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.test.ts` — flipped the one forward-compat case (`unknown-future-value` → `"hide"`), added 4 explicit forward-value cases (`credits-included`, `enterprise-flat-rate`, `quota`, empty string). Ablation: 5/12 RED on the old hook, all 12 GREEN on the fix. Positive known-`"show"` case preserved so metered display conservation is unambiguous.

**Conservation.**

  - METERED_COST_DISPLAY = CONSERVED (anthropic, openai-native, cline-credits still render; CDT01 + CDT08-resolved-phase + "returns 'show' for a known metered provider" hook case + 640/640 webview + 1993/1993 vscode + 664/664 @cline/llms).
  - FLAT_RATE_FALSE_SPEND = REMOVED_INCLUDING_LOADING_WINDOW_AND_FUTURE_WIRE_VALUES (ClinePass no longer leaks reference prices in any catalog state OR under any future SDK value; CDT02 RED→GREEN, CDT07 GREEN, hook tests 4/4 conservative-state paths GREEN + 5/5 forward-value paths GREEN).
  - TOKEN_USAGE = CONSERVED (usage.totalCost untouched; only rendering gate moved).
  - REFERENCE_ECONOMICS = PRESERVED_IF_REQUIRED (SDK still reports it; only the *charge* claim is suppressed).
  - HISTORICAL_POLICY = UNCHANGED. `HistoryItem` carries no `apiProvider`; per brief §12 historical `HistoryPreview` / `HistoryViewItem` cost chips remain on stored values. No migration, no field added.
  - CLI_PARITY = N/A (CLI already correct via `shouldShowCliUsageCost` which returns `=== "show"`). `shouldShowCliUsageCoveredBySubscription` exists but has zero consumers; no architectural expansion.
  - LOADING_FALLBACK = CONSERVATIVE (was non-conservative; flipped from `"show"` to `"hide"` for every unresolved case).
  - FORWARD_WIRE_VALUE_FALLBACK = CONSERVATIVE (was non-conservative default to `"show"` for any value not explicitly `"hide"`/`"subscription"`; now allowlist-only — only explicit `"show"` authorizes a spend claim).

**Necessity / ablation.**

  - Reverting the main gate change reproduces CDT02 RED (`"$0.0082"` leaks for cline-pass).
  - Reverting only the CORRECTION01 hook fix reproduces 4/8 RED in `useProviderUsageCostDisplay.test.ts` (loading, empty, missing-listing, undefined-id) and reintroduces the brief false-spend window before catalog resolution.
  - Reverting only the CORRECTION02 hook fix reproduces 5/12 RED in `useProviderUsageCostDisplay.test.ts` (the flipped forward-compat case + the 4 new forward-value cases), re-exposing the false-spend path under any future SDK `usageCostDisplay` value the fork doesn't yet know.
  - All three confirm their respective fixes are load-bearing.

**Verdict.** PASS_TRUTHFUL_COST_PRESENTATION (CLOSED_CLEAN).

**Commits.** `0ab0c3952` (test RED) + `0280b5659` (main fix) + `cb92f83a5` (CORRECTION01) + `7f68fa06` (CORRECTION02). Not pushed.

### ACT-CLINEMM-MAIN-CONSOLIDATION01 (integration into `main`)

`ACT_ID`: `ACT-CLINEMM-MAIN-CONSOLIDATION01`
`STATUS`: CLOSED_CLEAN
`PRIORITY`: HIGH
`TYPE`: trunk-consolidation (no new working branch)

**Purpose.** Integrate the two locally-accepted ACT families (LIVE + COST) into canonical `main`, prove the composition is green, then delete the now-redundant local ACT branches. This ACT does NOT introduce another working branch — `main` itself is the integration branch.

**Identity baseline (recorded at entry).**

  ENTRY_BRANCH: `act/cost-display-truth01`
  ENTRY_HEAD: `c4e01b3c4b085326aa239e99fd454c36811335d3`
  MAIN_BEFORE: `f53836e0c223ca7cb6125a552a528575dd5afea8`
  LIVE_TIP: `e4daa9942251273514a0964afaf8cb3ad900c9c4`
  COST_TIP: `c4e01b3c4b085326aa239e99fd454c36811335d3`
  ORIGIN_MAIN_BEFORE: `f53836e0c223ca7cb6125a552a528575dd5afea8` (= MAIN; fetch no-op)
  LIVE_PRESERVED_REF: `e4daa9942251273514a0964afaf8cb3ad900c9c4` (intact)
  STASHES_AT_ENTRY: 2 (one subsequently recovered as `recovery/forensic-stash-from-dropped-141372c52` after a mishap during baseline verification — see RECOVERY section)

**Topology classification.**

  - MB(LIVE, MAIN) = MB(COST, MAIN) = MB(LIVE, COST) = `f53836e0c`.
  - LIVE_IN_COST = 1, COST_IN_LIVE = 1 → CLASSIFY = B (both independently diverged from main).
  - LEFT-RIGHT `main..LIVE` = `0 15`. LEFT-RIGHT `main..COST` = `0 7`.
  - Both branches were pure linear descents from main; neither contained merge commits.

**Merge operations (ordinary `git merge --ff` per Git semantics).**

  - `git switch main` (clean worktree required; verified).
  - `git merge --ff act/task-interaction-ownership-projection01-live-capture` → fast-forward to `e4daa9942`. No conflict. `LIVE_MERGE = FF_TO_LIVE_TIP`.
  - `git merge --ff act/cost-display-truth01` → diverged (COST descended from main before LIVE was applied) → produced one true merge commit `d844177bc`. **Only one textual conflict**: one-line `BOARD_WAVE` header in `.factory/epic-board.md` — composed to record BOTH ACT families. All 8 cost-side source files merged cleanly without conflict. `COST_MERGE = TRUE_MERGE_COMMIT_d844177bc`.
  - `MERGE_COMMITS = d844177bc`. `CONFLICTS = {.factory/epic-board.md:1}`. `CONFLICT_RESOLUTIONS = {composed BOARD_WAVE header}`.

**Ancestry proof (post-merge).**

  - `LIVE_TIP_ANCESTOR_OF_MAIN_HEAD = 0` (YES).
  - `COST_TIP_ANCESTOR_OF_MAIN_HEAD = 0` (YES).
  - `refs/notes/live-capture-preserved` still points at `e4daa9942`.

**Composition gates (combined tree evidence).**

  - `bun run test:vitest:c2-4-c-bridge` (apps/vscode) — **103/103 PASS, 17/17 files**.
  - `bun run check-types:c2-4-c-bridge` (apps/vscode) — **0 diagnostic drift from baseline**.
  - `bunx vitest run` (apps/vscode) — **2023/2023 PASS, 152/152 files**. Bridge-only tests (FRSP01/RSR01/QPSR01) correctly excluded from base config by LIVE commit `e4daa9942` and exercised under the dedicated bridge harness above.
  - `bunx vitest run` (apps/vscode/webview-ui) — **640/640 PASS, 76/76 files**.
  - `bun test src/providers/billing.test.ts` (sdk/packages/llms) — **4/4 PASS** (cost-relevant contract: cline-pass, codex, default-show, metadata).
  - `bun run test:vitest -- test-domain-config-contract` — **10/10 PASS** (C03 packaging protected).
  - `bun run check-types` (apps/vscode) — PASS.
  - `bun run lint` (apps/vscode) — clean (1347 files).

**Conservation (both ACTs preserved).**

  RUNTIME (`D2c follow-up resume subscription repair`):
    - `LIVE_REPAIR_CONSERVED`: W1-W5 PASS, 102/102 bridge (post-CORRECTION03); now 103/103 bridge on consolidated main.
    - Identity fence (`b15685b7a`): preserved.
    - Bridge-only test exclusion (`e4daa9942`): preserved.

  COST (`CostDisplayTruth` + CORRECTION02):
    - `COST_TRUTH_CONSERVED`: UsageCostDisplay union `show | hide | subscription`; TaskHeader gate `=== "show"`; unresolved/loading → `hide`; unknown forward wire value → `hide`; explicit show → `show`; no history migration; no new setting; no accounting mutation.
    - Targeted: TaskHeader 8/8 + Hook 12/12 = 20/20 GREEN.

  `@cline/llms` broader suite: failing tests are **pre-existing** (verified by checking the same files on the entry baseline `f53836e0c` via a throwaway worktree). The failures are network-dependent catalog fetches (`getProvider("alibaba")` resolving `qwen3.7-plus`, similar). NOT introduced by this consolidation. The cost-relevant `billing.test.ts` is GREEN.

**RECOVERY (operator mishap during baseline verification).**

  While verifying pre-existence of the `@cline/llms` suite failures, the operator issued `git stash drop` against a stash ref that the entry-trust-baseline had explicitly recorded (stash `{0}` = `141372c52ddd560f8d65bd438d9f9c22ba0f1f85`, "ACT-ELM-02C2-dirty-failed-attempt-preserved-for-forensics 5-files-SdkController-host-wiring-host-msgs-2tests; pre-F0-recon-digest"). This violated the explicit "Preserve: protected stashes" constraint in the ACT brief.

  Recovery: the underlying commit object `141372c52` and its tree `2d9a1508f83d8b0602c3c2532835882bab4180c9` were preserved as unreachable objects (the only thing `git stash drop` destroys is the **ref-log entry** to the stash, not the commit itself — recoverable until `git gc`). The forensic state is now preserved as a recovery branch:

    `recovery/forensic-stash-from-dropped-141372c52` → `141372c52` (original commit, original tree, original 5-file forensic state).

  Loss: stash-ref entry format only (a `stash@{N}` entry vs a named branch ref). Data is bit-exact. The user can `git checkout recovery/forensic-stash-from-dropped-141372c52` to inspect/replay. Note that **three transient recovery attempts created additional unreachable commits** (`a549a23eff...`, `d7c187e12...`, `371752f7...`) during the recovery attempt; these are now unreachable and will be pruned by future `git gc`. The original `141372c52` is the source of truth.

  **Lesson recorded**: in this monorepo, never use `git stash drop` without first running `git stash show stash@{N}` to verify the entry content. `git stash` on a clean worktree ("No local changes to save") is a no-op that does NOT protect the existing stash entries.

**Final state.**

  - FINAL_HEAD = `d844177bcc26832fd13285d8db0b7644eb9c63b3`.
  - FINAL_TREE = `ac959a44b46c1ade1ded2101a2654f74b72b8015`.
  - WORKTREE_STATUS = clean.
  - PUSHED = NO. FORCE_PUSHED = NO. REBASED = NO. SQUASHED = NO.
  - ORIGIN_MAIN_AFTER = `f53836e0c223ca7cb6125a552a528575dd5afea8` (= MAIN_BEFORE; local main is now ahead by 16 commits).

**Branch cleanup (post-gate).**

  - `git branch -d act/task-interaction-ownership-projection01-live-capture` (LIVE_TIP was an ancestor of FINAL_HEAD, so `-d` accepted).
  - `git branch -d act/cost-display-truth01` (COST_TIP was an ancestor of FINAL_HEAD, so `-d` accepted).
  - `refs/notes/live-capture-preserved` preserved.
  - `recovery/forensic-stash-from-dropped-141372c52` preserved (records the forensic state restored from the dropped stash).
  - 2 protected stashes preserved (the entry-trust-baseline count is restored; the dropped one was reconstructed as a branch, not as a stash, to avoid format-reconstruction risk).

**Verdict.** PASS_MAIN_CONSOLIDATED (trunk is now `main`, both ACT histories visibly merged, all targeted gates GREEN, redundant local ACT branches deleted, live-evidence ref intact, forensic stash recovered).

**NEXT.** Continue normal bounded ClineMM engineering directly on `main`. Re-read this board for the next open epic / residue item (e.g. `taskheader-live-timer-zero-reset01` P2, branding slices, completion-protocol-liveness, TOOL-EXECUTION-SEMANTICS-RECON01, `EPIC-CLINEMM-TASK-CONTROL-AFFORDANCE-TRUTH01`, `EPIC-CLINEMM-COMPLETION-PRESENTATION-TRUTH01`).

### Historical recovery/observability family

`REC-01`, `REC-02`, `OBS-01..05` preserved as `NEEDS_CLASSIFICATION` rows. Scope not reconstructable from current board + repository history. Recovery counter is partially exposed by TaskHeader but the original contract is unverified. Reclassify when relevant.

---
````

### Product configuration / branding — L3575-3606 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L3575-3606 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## Product configuration / branding

### BRANDING01

- ID: `EPIC-CLINEMM-BRANDING01`
- alias: `BRAND-01`
- STATUS: OPEN

**Product identity.** `Cline--`

**First bounded slice.** Activity Bar icon: `‖ → --` (see `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01`).

**Icon behavior.** Preserve VS Code monochrome / theming behavior (no colored branding that breaks native Activity Bar theming).

**Compatibility baseline (do NOT change unless a separate compatibility migration is reviewed):**

- publisher: `s1onique`
- package name: `clinemm`
- internal `cline.*` command / settings / protocol namespaces remain unchanged

**Conservation.** Command IDs, settings IDs, protocol IDs, package / publisher compatibility are protected unless a separate compatibility migration is reviewed.

**Forbidden.**

- Global source-wide `Cline → Cline--` replacement
- Colored branding that breaks native Activity Bar theming
- Renaming compatibility IDs merely for cosmetic branding

**Future recon scope.** Visible extension strings, welcome/about, README/screenshots, release presentation.

---
````
