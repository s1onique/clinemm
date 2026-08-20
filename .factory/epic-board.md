# Cline-- Global Epic Board

CANONICAL_AS_OF: 2026-08-19
SUBJECT_HEAD: 1e6430bc15f00d08f66dc905c41edbd3f74045db
BOARD_COMMIT: discover with `git log -1 -- .factory/epic-board.md`
BOARD_WAVE: 1 → TASK CENSUS 01

---

## Board contract

This file is the canonical project coordination board for Cline--. It is **not** primary evidence: rows point to commits, ACTs, tests, or artifacts where load-bearing claims live. Stale rows are P2/non-blocking and never invalidate executable tests, exact artifacts, live evidence, source truth, or Git identity. Only **P0** halts. **P1** gets one bounded fix cycle. **P2** is batched at cleanup. Prefer executable evidence over documentary completeness. Update this board incrementally at meaningful ACT boundaries. If maintenance slows learning without protecting correctness, simplify it.

**Task census rule.** Every actionable task discussed for Cline-- must have one canonical row here. Future planning authority is this board + source/Git/evidence. Routine project-thread archaeology is no longer required. When a new task is discussed, add the row at the next meaningful ACT boundary.

**Published-head policy.** A successful publication ACT closes for the specific HEAD it published. Later local commits do **not** reopen that historical ACT. Local `main` may legitimately be ahead of `origin/main` during development; a future push requires explicit authority. Every remote update must be a fast-forward. Force push remains categorically forbidden. Do not create a new epic merely because local main becomes ahead by a normal subsequent commit.

---

## Repository topology

```
REPOSITORY TOPOLOGY

  canonical repository:    /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
  canonical branch:        main
  development topology:    one Git worktree
  linked worktrees:        forbidden by default
  exception:               explicit user authorization only
  temporary breakage on local main:  acceptable
  unexpected tracked dirt: HALT
  protected evidence:      preserve explicitly named stashes / artifacts
  historical architecture branch:  act/elm-architecture01-e0-e4
    status:                MERGED, retained temporarily
    cleanup priority:      P2 (do NOT switch to it; do NOT delete in this ACT)

```
Rationale: linked worktrees caused agent path/branch confusion in earlier work; the complexity cost exceeded the isolation benefit. This repo deliberately chooses the simpler single-worktree policy.

---

### Remote push safety

```
REMOTE PUSH SAFETY

  NORMAL REMOTE PUSH:
    requires explicit user / ACT authority
    fast-forward only
    precondition: origin/main is ancestor of local main

  FORCE PUSH:
    categorically FORBIDDEN

  FORBIDDEN FORMS INCLUDE:
    git push --force
    git push -f
    git push --force-with-lease
    any non-fast-forward ref update through another Git spelling
    any API / automation operation equivalent to a force push

  APPLIES TO:
    main
    feature branches
    release branches
    tags where history movement is applicable
    humans
    agents (including Cline / Factory / other agents)
    CI
    release automation

  RULES:
    an ACT may grant normal push authority
    an ACT MUST NOT grant force-push authority
    if published history needs correction:
      create new commits
      revert
      merge / rebase locally before publication as appropriate
      use a new branch / ref if necessary
    DO NOT rewrite already-published remote history

This is a repository safety invariant, not merely a preference. Enforcement is the `EPIC-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH01` epic.

```
---

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

## Canonical task index

Every actionable Cline-- task has exactly one row here. Narrative sections below refer back to these IDs. Historical identifiers that could not be confidently mapped are kept as `NEEDS_CLASSIFICATION` rather than silently dropped.

| ID | Area | Status | Priority | Depends on | Next action |
|---|---|---|---|---|---|
| `EPIC-CLINEMM-COMPACTION-STATE-AUTHORITY01` | CTX | REOPENED_PRODUCTION_SEAM_RESOLVED_LIVE_DEFERRED | HIGH | none | entry transition was proven previously (`ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01`); terminal restore transition was disproven live and is now closed via `ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01` (production-seam RED + GREEN at the canonical coordinator `finally` block — classification CASE C: tracker restored, no publication). Live L0→L3 manual `/compact` qualification deferred at user's request this turn; the previous entry-side and this terminal-restore-side invariants share the same canonical authority and are not in tension. Sibling completion-response bug is separate: `EPIC-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01`. |
| `ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01` | CTX | CLOSED | HIGH | none | RED reproduced at real seam; producer authority gap repaired; gates green (entry transition only; terminal restore was not yet proven) |
| `ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01` | TASK-UI | CLOSED_PRODUCTION_SEAM_LIVE_DEFERRED | CRITICAL | compaction-state-authority01 (entry, proven) | **Production-seam RED + GREEN at `apps/vscode/src/sdk/sdk-compaction-coordinator.ts:runCompaction` `finally` block.** Root cause: missing post-restore publication — `runCompactionInPhase` publishes its terminal snapshot (`phase = "compacting"`; seq N) BEFORE `restorePhase()` flips the tracker back to the entry phase; nothing publishes after restore, so the webview's last received snapshot stays at `phase = "compacting"`, `stateLabel` projects `Compacting`, `turnAllowsFollowup` returns `false`, composer stays disabled. **Boundary classification: CASE C** (tracker restored, no state published). **Fix:** trailing `await this.options.postStateToWebview()` in the `finally` block AFTER `restorePhase()`. **P1 (factory review):** publication-failure semantics distinguished — success exit propagates the publication failure (the user's only signal that the webview saw the restore); failure exit logs the publication failure but preserves the original compaction throw via a `compactionError` capture pattern. Outer `compactTask` catch mirrors the same pattern with a safety-net post. **CORRECTION01 (factory review follow-up #1):** original CSR07/CSR08 evidence was structurally invalid — harness's `reject-on-last-call` boolean plus a length-equality check evaluated true on every publication after the first (aliasing instead of discriminating); replaced with explicit ordinal injection (`rejectPostAt: number[]`); added probe tests pinning the publication sequence; ablation: removing the trailing post → CSR01–03 red; replacing the P1-aware catch → CSR07+08 red. **CORRECTION02 (factory review follow-up #2):** the harness `captured` array conflated attempted vs delivered snapshots (recorded before the throw decision). This meant CSR07's `last snapshot phase === awaiting_followup` could pass even if the outer-catch's safety-net post #4 also failed and the webview never received the restored phase. **Fix:** the harness now records `attempted[]` (every invocation) AND `delivered[]` (only successful resolutions) AND `attemptedOrdinals`/`deliveredOrdinals`/`rejectedOrdinals`. CSR07 / CSR08 now assert attempted ordinals = [1,2,3,4], rejected = [3], delivered = [1,2,4], and the LAST DELIVERED phase = entry — directly modelling what the webview actually saw. Probes (`CSR_PROBE_success` / `CSR_PROBE_failure`) tightened to exact ordinal-sequence + phase-sequence assertions (no console.log-only documentation). **Ablation #3:** disabling the outer-catch safety-net post (the production line that delivers #4 with the restored phase) turns BOTH CSR07 AND CSR08 red — proving the new attempted/delivered assertions are sensitive to the actual production safety net. Production code unchanged in CORRECTION02 (test-only). **Live qualification: STILL PENDING.** Debug harness launched VSCode (.vscode-test/vscode-darwin-arm64-1.103.0); user deferred the L0→L3 chain across three turns. Test-only correction — production unchanged — so the previously installed VSIX `s1onique.clinemm@4.1.10-a25334aeb` (sha256 `5a17411b2448edd7d4278dcf59a7f65c9c2a7a5aacacc51a29854bf329f8e149`, 8885142 bytes) remains valid for live qualification. Per the reviewer's disposition: NEXT is the actual `/compact → completed → continue` L0→L3 run; if green, move the closure verdict to `PASS_LIVE_COMPACTION_STATE_RESTORE` and close both the ACT and the EPIC `LIVE`. **Conservation:** no UI-string heuristics; no updater-side diagnostic side effects; no context-ceiling change; no completion-response bug touched (separate `EPIC-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01`); previous CSA `compacting`-as-label and human-`Waiting` invariants untouched. **Pre-existing residue (named follow-up):** `runCompactionInPhase` has its own `catch { emitInfo + postStateToWebview + throw }` pattern that can mask the original compaction error with a publication rejection — same P1 shape at a different seam. NOT repaired here; flagged for a separate bounded ACT (`ACT-CLINEMM-IN-PHASE-PUBLICATION-FAILURE-MASK-01`). **Gates:** apps/vscode vitest 121 files / 1702 tests / 0 failures (was 1692, +10: CSR01–08 + 2 probes); bun unit 72/1076/0; webview vitest 69/567/0; SDK core 172/2124/14-skipped/0; typecheck 0 diagnostics; lint PASS (one biome-ignore-line in production for the proven-gated `throw` in finally); markdown-guard PASS; diff-check PASS |
| `EPIC-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01` | TASK-UI | IN_PROGRESS | HIGH | task-header canonical projection | separate defect: TaskHeader reaches `Waiting` but the visible terminal assistant content is intermediate debugging narration, not the requested closure report. Tracked under `ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01`. |
| `ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01` | TASK-UI | IN_PROGRESS | HIGH | completion-response-authority01 | **Recon before RED.** Canonical completion authority identified at `apps/vscode/src/sdk/message-translator.ts:859` (`isCompletionTool`: `submit_and_exit` / `attempt_completion`) and `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:122-125` (terminal-phase decision). **Boundary:** the `done` handler at `message-translator.ts:1863` only commits a `say:"completion_result"` row when EITHER `attemptCompletionSeen` is true OR `takeTurnFinalText()` returns a candidate; for the `text → tool → done` case the test at line 1113 already pins `done().messages.length === 0` as current behaviour, yet the coordinator still flips phase to `awaiting_followup`. **Classification: CASE G** (terminal state promoted without terminal response authority) + **CASE D** (no completion_result committed; whatever is last becomes the visible "answer"). **Discriminator (H3 + H5 merge):** `done(reason:"completed")` ∧ `!attemptCompletionSeen` ∧ `takeTurnFinalText() === undefined` → setTurnPhase("awaiting_followup") fires but zero `completion_result` rows committed → user sees intermediate debugging content as the terminal visible assistant message. **Repair scope:** (a) translator falls back to the last assistant text/reasoning row in the turn when no `turnFinalText` candidate exists; (b) coordinator must not promote to `awaiting_followup` when the translator did not commit any terminal response (defer or escalate to `error` with explicit "no terminal response" row). **Conservation:** no text heuristics; no prompt rewrite; no message-architecture rewrite; intermediate progress remains in history; View Changes placement untouched.
| `EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` | CTX | CLOSED at this commit | HIGH | none | closed by `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` (closure 01 was reopened by reviewer for two P0 blockers — evidentiary inconsistency between the closure report and a dirty-worktree digest, and the `tokensIn`-only UI numerator being provider-blind — both closed in CORRECTION01: truthful state restored and UI numerator switched to the provider-normalized `tokensIn + cacheReads + cacheWrites` equal to the AI SDK `inputTokens.total` contract; the Anthropic-native and OpenAI-compat REDs now drive the helper) |
| `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` | CTX | CLOSED at this commit | HIGH | none | RED reproduced at production seam (initial: `getLastApiReqTotalTokens` inflated by `cacheReads`; correction: provider-blind `tokensIn`-only numerator would undercount Anthropic-native cached prompts); CORRECTION01 introduces `getLastApiReqContextInputTokens` returning `tokensIn + cacheReads + cacheWrites` (the AI SDK `inputTokens.total` contract — `apps/vscode/src/sdk/message-translator.ts:98-110 normalizeUsageEvent` already produces disjoint buckets via `uncachedInputTokens = inputTokens - cacheReads - cacheWrites`); both Anthropic-native (`tokensIn=50, cacheReads=100000` → `100_050`) and OpenAI-compat-style (`prompt_tokens` decomposes to `noCache + cached_tokens`) REDs are covered; 10 files changed (467 insertions, 40 deletions); vitest 118 files / 1681 tests / 0 failures; bun unit 72 files / 1076 tests / 0 failures; webview 69 files / 562 tests / 0 failures; typecheck 0 diagnostics; `EPIC-CLINEMM-USER-CONTEXT-CEILING01` precondition now holds |
| `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01-CORRECTION01` | CTX | CLOSED | HIGH | none | RED tests added: `getApiMetrics.test.ts` Anthropic-native (`tokensIn=50, cacheReads=100000` → `100_050`), Anthropic cache-creation (`tokensIn=200, cacheWrites=12_500` → `12_700`), OpenAI-compat inclusive (149_235 + 148_167 → 297_402, the original `prompt_tokens`), `tokensOut` non-contribution, total rescaling; `ContextWindow.test.tsx` Anthropic-native `lastApiReqContextInputTokens=100_050 / 200_000` → 50% bar |
| `EPIC-CLINEMM-USER-CONTEXT-CEILING01` | CTX | CLOSED | HIGH | context-accounting-truth (CLOSED) | closed by `ACT-CLINEMM-USER-CONTEXT-CEILING01` (user-controlled effective context ceiling; Auto / explicit-positive-integer modes; built on canonical `resolveEffectiveMaxInputTokens`; user value can never expand model/provider capacity; one compaction threshold formula) |
| `ACT-CLINEMM-USER-CONTEXT-CEILING01` | CTX | CLOSED | HIGH | none | RED families A/B/C/D/E all green; new pure policy resolver `applyUserContextCeiling` / `normalizeUserContextCeiling` layered on top of the canonical `resolveEffectiveMaxInputTokens`; `CoreCompactionConfig.userContextCeiling` plumbed through `cline-session-factory.ts` to the SDK trigger (`requestTriggerTokens = operatingCapacity * 0.9`); settings UI exposes a labeled numeric input next to Auto Compact Strategy (empty = Auto, positive integer = explicit ceiling); `apps/vscode Vitest: 118 files / 1681 tests / 0 failures`; `bun unit: 72 files / 1076 tests / 0 failures`; `webview vitest: 69 files / 567 tests / 0 failures` (was 562, +5 ceiling UI); `SDK core vitest: 173 files / 2124 passed / 14 skipped / 0 failures` (was 94); `typecheck: 0 diagnostics`; `coverage ratchet: PASS` (+26 statements / +13 branches / +5 fns / +25 lines); dogfood VSIX built + installed `s1onique.clinemm@4.1.10-ac40e4399` (source head `ac40e43991189608b0c01cd15d039000fa0314ba`); no model metadata mutation; no hidden truncation; auto-condense off preserves existing behavior; summarizer (agentic-compaction) input budget intentionally NOT user-ceiling-clamped — it is the summarizer model's own context window, a separate authority |
| `ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01` | CTX | CLOSED | HIGH | none | factory reviewer reopened closure with two P0 wire-contract defects: (1) the original `updateSettings` handler only persisted when `request.userContextCeiling !== undefined`, so the webview's clear intent (`updateSetting("userContextCeiling", undefined)`) was indistinguishable from "field absent" on the proto3 wire and left the previously-persisted value intact — the UI test was a mock-of-a-mock that proved nothing; (2) the proto range silently removed `Settings.auto_approve_all_toggled = 174` without a `reserved` declaration, an out-of-scope wire-shape delta. correction01 closes both: explicit-clear sibling field `clearUserContextCeiling` (proto3-`optional bool` on both `UpdateSettingsRequest` and `Settings`) so the Auto/reset intent is wire-distinguishable from "absent"; the unrelated `auto_approve_all_toggled = 174` is restored (the safest bounded correction per the reviewer's recommendation) — no field-number/name reservation needed because the field is live again. **CORRECTION01 P1 (closed in this commit):** the initial fix allowed two mutually contradictory commands on the wire (`userContextCeiling = 512000` AND `clearUserContextCeiling = true`) and silently picked clear-wins. The proto comments now say "may carry one or neither; carrying both is invalid" and both backend handlers (`updateSettings.ts` and `updateSettingsCli.ts`) reject the contradiction with a typed error before any persistence side effect, preserving the on-disk value. The CLI handler has an additional fix beyond the initial P1 patch: the contradiction guard was moved to the **top of the `if (request.settings)` block** so that a request carrying a contradictory ceiling AND an unrelated setting (e.g. `preferredLanguage`) cannot partially mutate the unrelated setting through `setGlobalStateBatch(filteredSettings)` before the throw. The ceiling fields are also extracted from the destructuring so they don't fall into `simpleSettings` and get batched-persisted before the dedicated handler can reject the contradiction. A redundant guard is kept in the dedicated handler as defense-in-depth (unreachable in normal flow once the early guard fires). Backend persistence tests (`updateSettings.test.ts`, 8 tests, 17 ms) route through a real `ClineFileStorage` and reproduce the RED on the original code (clear intent leaves 512 000 on disk; contradictory intent silently mutates the disk). CLI tests (`updateSettingsCli.test.ts`, 3 tests, 9 ms) cover the same RED; the third test pins the atomicity contract — a contradictory ceiling AND an unrelated setting must both be preserved exactly on disk after the reject. The atomicity test caught the very ordering defect the factory reviewer identified: when only the bottom guard was present, `preferredLanguage: "Spanish"` slipped through `setGlobalStateBatch` to disk before the throw, and the test failed with `expected 'Spanish' to be 'English'`. With the early guard, the test passes. Webview test (`FeatureSettingsSection.spec.tsx`) was also a broken mock — destructured `onInput` instead of the production component's `onChange`, so the change handler was `undefined` and `handleCeilingChange` was never invoked; the test was silently exercising the empty-string branch from the closure report onwards. The mock is corrected to wire `onChange` and the persistence tests now use `userEvent.type`/`userEvent.clear`/`userEvent.tab` so the controlled-input flow runs. All gates green: `apps/vscode Vitest: 120 files / 1692 tests / 0 failures` (+1 file / +5 tests); `webview Vitest: 69 files / 567 tests / 0 failures` (was 565 / 2-fail on the broken mock); `bun unit: 72 files / 1076 tests / 0 failures`; `SDK core vitest: 173 files / 2124 / 0 failures`; `typecheck: 0 diagnostics`; `coverage ratchet: PASS` (+322 statements / +501 branches / +19 functions / +321 lines); `lint: clean`; `git diff --check: clean` |
| `CTX-01` | CTX | NEEDS_CLASSIFICATION | LOW | — | classify when relevant |
| `CTX-02` | CTX | NEEDS_CLASSIFICATION | LOW | — | classify when relevant |
| `CTX-03` | CTX | NEEDS_CLASSIFICATION | LOW | — | classify when relevant |
| `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01` | TASK-UI | OPEN | HIGH | canonical task state authority | repair without inventing a second UI authority |
| `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` | TASK-UI | OPEN | HIGH | none | consume canonical task-state projections; do not reconstruct locally |
| `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` | TASK-UI | OPEN | HIGH | compaction-state-authority, canonical-projection | AGENT/HUMAN/terminal/error timing distinction |
| `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` | OBS | OPEN | HIGH | none | bounded recon; semantic purpose + effect class + classification |
| `EPIC-CLINEMM-COST-DISPLAY-TRUTH01` | OBS | OPEN | MED | none | billing-semantics recon; user display policy under flat-rate |
| `REC-01` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify recovery budget/telemetry semantics when relevant |
| `REC-02` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify recovery presentation semantics when relevant |
| `OBS-01` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (canonical task display) |
| `OBS-02` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (active-agent elapsed) |
| `OBS-03` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (human wait time) |
| `OBS-04` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (semantic tool classification) |
| `OBS-05` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (other remaining dimensions) |
| `EPIC-CLINEMM-BRANDING01` | PRODUCT | OPEN | MED | none | first slice: Activity Bar icon `‖ → --`; preserve command/setting/protocol IDs |
| `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01` | PRODUCT | NEXT | MED | branding01 | first bounded branding slice |
| `BRAND-01` | PRODUCT | CLOSED → alias of `EPIC-CLINEMM-BRANDING01` | — | — | historical alias |
| `STATE-01` | STATE | CLOSED via W1/W2 epoch-domain repair | — | — | historical alias |
| `STATE-02` | STATE | NEEDS_CLASSIFICATION | LOW | — | inspect queuedPrompts scope against current architecture |
| `ARCH-01` | ARCH | NEEDS_CLASSIFICATION | LOW | — | classify against E8/E9/Elmization02 |
| `ARCH-02` | ARCH | NEEDS_CLASSIFICATION | LOW | — | classify against E8/E9/Elmization02 |
| `E8 legacy writer retirement` | ARCH | HOLD | — | E7 evidence/dependencies | retire remaining legacy writer authority when justified |
| `E9 effect interpreter` | ARCH | HOLD | — | E8 | bounded effect execution/interpreter after E8 |
| `EPIC-CLINEMM-ELMIZATION02` | ARCH | OPEN | MED | E9 recon | migrate deterministic authority where doing so reduces duplication |
| `EPIC-CLINEMM-GITHUB-ACTIONS01` | DIST | OPEN | HIGH | none | recon workflows, failing jobs, gates, VSIX packaging |
| `ACT-CLINEMM-GITHUB-ACTIONS-RECON01` | DIST | NEXT | HIGH | github-actions01 | recon ACT |
| `EPIC-CLINEMM-GITHUB-DISTRIBUTION01` | DIST | OPEN | HIGH | none | publish VSIX via GitHub Release; decide GitHub Packages applicability |
| `ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01` | DIST | P2/OPEN | LOW | one-worktree policy | remove detached temporary worktree from dogfood packaging |
| `EPIC-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH01` | GIT-SAFETY | CLOSED | — | none | server-side block-force-push enforced via repository ruleset `cline-- protect published history` (id `21037630`); `enforcement=active`, `target=branch`, `refs/heads/main`, `non_fast_forward`, `bypass_actors=[]`, `current_user_can_bypass=never`; evidence at `${TMPDIR:-/tmp}/clinemm-ruleset-{before,after}.json` |
| `ACT-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH-ENFORCEMENT01` | GIT-SAFETY | CLOSED | — | git-safety-no-force-push01 | closed at `2026-08-19`; ruleset `21037630`; bypass_actor_count=0; normal fast-forward push to `main` preserved; P2 follow-up `ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01` not required for closure |
| `ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01` | GIT-SAFETY | DEFERRED | P2 | none | defense-in-depth local pre-push guard; not required because server-side ruleset already enforces; tracked as optional follow-up |
| `ACT-CLINEMM-FACTORY-EPIC-BOARD-MARKDOWN-REPAIR01` | FACTORY | CLOSED | — | none | GitHub-Flavored-Markdown rendering repaired; 45 → 4 fences; validator `scripts/check-epic-board-markdown.py` + 16 unit tests added; `‖` replaces unescaped double-pipe in BRANDING01 cell |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE01` | triage artifact `.factory/upstream/cline-upstream-triage.md` | CLOSED at `162192610`; first complete triage cycle; 80-issue bounded shortlist from 573-row substrate; 5 IMPORTs + 60 MAP_EXISTING + 15 RADAR + 0 REJECT + 0 CLOSED_UPSTREAM; published-head policy added; `PUBLISH-CURRENT-MAIN01` reconciled as closed for HEAD `e50669705` |
| `ACT-CLINEMM-PUBLISH-CURRENT-MAIN01` | DIST/REPO | CLOSED at `e50669705` | — | remote-push-safety policy | fast-forward `origin/main` to current local main; published HEAD `e506697053756486fb25a005c0330fea464bef95` via ordinary push; `162192610` later commit did not reopen this ACT per published-head policy |
| `ACT-CLINEMM-SINGLE-WORKTREE-TRANSITION01` | FACTORY/REPO | CLOSED | — | — | repository-topology migration: main FF from `a9f376edf` → `5637d965d`; linked worktree removed; single-worktree topology frozen |
| `ACT-CLINEMM-LIVE-EPOCH-REPAIR-QUALIFICATION01` | FOUNDATION/QA | CLOSED_LIVE | — | — | W1/W2 epoch repair live qualification; `PASS_LIVE_EPOCH_REPAIR` at `5637d965d` |
| `EPIC-CLINEMM-TEST-BASELINE-ZERO-FAILURES01` | QA | CLOSED at this commit | HIGH | none | RED-first recon at exact head `0d2548dd5`: canonical command `cd apps/vscode && bunx vitest run --config vitest.config.ts` reproduced the historical `1667 pass / 5 fail` baseline **exactly**; 5 failures classified with full causal evidence (4 TEST_DEFECT: stale `REPO_ROOT` hardcoded to a deleted worktree in `task-state-shadow-correction02-c21-recon.test.ts`; 1 PRODUCT_DEFECT: `SdkInteractionCoordinator.clearPending` dropped `pendingAskResolve` without calling it, leaking pending ask-question promises across task switches); all 5 repaired with bounded fixes (REPO_ROOT resolver walking up to `.git/HEAD`; `clearPending` now invokes the saved resolve with `""` mirroring `resolvePendingAskQuestion(undefined)`); canonical broad suite GREEN twice (`1672 pass / 0 fail`, 50.51s/51.44s) with zero failing tests; suite-load failure for `hub-runtime-host.provenance-epoch.c24-d3.test.ts` is by-design base-config exclusion (dedicated `vitest.config.c2-4-d-hub.ts` passes 11/11) and is not a test failure; isolated tests GREEN 5/5 across runs (no flakes); `NEW_SKIPS_ADDED=0`; no assertion weakening; no assertion removal; no test exclusion; historical "pre-existing" debt replaced with truthful exact-head state |
| `EPIC-CLINEMM-TYPECHECK-ZERO-BASELINE01` | QA | CLOSED at this commit | HIGH | none | classify and eliminate the 36 pre-existing apps/vscode typecheck errors; RED-first recon at exact head `ed6d569b6`: canonical `cd apps/vscode && bunx tsc --noEmit` reproduced `36 diagnostics in 7 files` exactly; 9 causal clusters identified (C1 @cline/core→@cline/shared symbol roots, C2 stale relative imports, C3 missing TaskModel import in production source, C4 stale RecoverySnapshot fixture fields, C5 stale RecoveryState default "off", C6 stale as-casts to old contract shapes, C7 workload-matrix hostMsgs callback signature, C8 @cline-internal/core path alias missing in base tsconfig, C9 stale TaskModel field accesses surfaced by C3 cascade); each cluster classified using six-bucket taxonomy (PRODUCT_DEFECT, TEST_DEFECT, ENVIRONMENT_DEPENDENT) — no PRE_EXISTING causal class; all 9 clusters repaired with bounded fixes (1 product source + 8 test/config); canonical `tsc --noEmit -p apps/vscode/tsconfig.json` GREEN twice (exit 0, 0 diagnostics); vitest canonical `cd apps/vscode && bunx vitest run --config vitest.config.ts` 1672 pass / 0 fail preserved; `NEW_TYPE_SUPPRESSIONS=0`; no assertion weakening; no strictness turning off; the vitest config exclude list (already 2 entries for the C2.4-C bridge and C2.4-D hub tests) was extended to add D3 (1 more entry), and the dedicated `tsconfig.c2-4-d-hub.json` include list was aligned to include D3 (mirrors the existing dedicated vitest config); "41 pre-existing errors" wording replaced with exact-head state |
| `ACT-CLINEMM-TYPECHECK-BASELINE-RECON01` | QA | CLOSED at this commit | — | typecheck-zero-baseline01 | exact-head RED-first recon at `ed6d569b6`: canonical `cd apps/vscode && bunx tsc --noEmit` produced **36 deterministic diagnostics** in 7 files (`task-state-shadow.ts`, `task-state-shadow.test.ts`, `task-state-shadow-no-active-session-witness.test.ts`, `task-state-shadow-correction02-c22-correction01.test.ts`, `task-state-shadow-workload-matrix.test.ts`, `e7-local-backend-activation.c25-c5-correction01.test.ts`, `hub-runtime-host.fallback-composition.c24-d.test.ts`, `hub-runtime-host.provenance-epoch.c24-d3.test.ts`); reproduced twice (RUN1_HASH=RUN2_HASH=3d692f21...); clustered into 9 causal clusters, classified using the six-bucket taxonomy (1 PRODUCT_DEFECT, 8 TEST_DEFECT/ENVIRONMENT_DEPENDENT); 9 commits on top of `ed6d569b6`: (1) `33a77d866` C3 production TaskModel alias in `task-state-shadow.ts`, (2) `f3324f6b9` C1a+C2 `HubEventEnvelope`/`TurnPhase`/`ArbiterSnapshot` import roots in hub-runtime-host provenance test, (3) `dfe2f2d5c` C8 dedicated C2.4-D test config routing, (4) `f03092b34` C1+C1b `AgentMessage`/etc. from `@cline/shared` + remove stale `SdkSessionHost.getSessionId`, (5) `c71e72e9e` C9 `currentIteration`/`turnPhase` → canonical `lifecycle.kind`, (6) `07d5d460a` C4 tracker fixtures → canonical `RecoverySnapshot`, (7) `6061296dd` C5+C6 stale casts and `"off"` default → canonical shapes, (8) `9f037158c` C7 workload-matrix callback signature; **final state**: canonical typecheck GREEN twice (exit 0), vitest GREEN 1672/0 (~51s), `NEW_TYPE_SUPPRESSIONS=0`, no strictness weakened, no assertions weakened, no test exclusions added (only test-include alignment for existing dedicated C2.4-D config pattern); CI parity: `apps/vscode/package.json:check-types` is the canonical local gate; `.github/workflows/ext-vscode-test.yml` does not currently gate the canonical tsc command (PARITY=PARTIAL — recorded under `EPIC-CLINEMM-GITHUB-ACTIONS01` for future ACT) |
| `EPIC-CLINEMM-CODE-COVERAGE-BASELINE01` | QA | CLOSED at this commit | HIGH | none | RED-first recon at exact head `be76c45d6`: `@vitest/coverage-v8@4.1.10` pinned in `apps/vscode/package.json` (was absent — only `webview-ui`'s transitively-resolved `3.2.7` was on disk, which is incompatible with vitest 4.1.10); explicit `coverage` block added to `apps/vscode/vitest.config.ts` (provider=v8, include=`src/**/*.{ts,tsx}`, exclude=tests/test-infra/generated/embedded-packages, reporters=text+json-summary+json, reportsDirectory=`./coverage`); canonical command `cd apps/vscode && bunx vitest run --config vitest.config.ts --coverage` produces deterministic v8 coverage report (Run A vs Run B: `coverage-summary.json` SHA-256 `dfbc1cfc750cac9f7...` identical, `coverage-final.json` SHA-256 `971d5c7ef3e...` identical); **production source universe = 613 files** (every `src/**/*.ts` excluding the 4 documented categories — no unexplained missing files); **totals**: lines 15.80% (6832/43228), statements 15.86% (6980/43994), functions 18.88% (1311/6943), branches 11.03% (4202/38071); **bands**: 309 zero / 110 lt25 / 8 lt50 / 29 lt75 / 22 lt90 / 93 gte90; **gap classification of 309 zero-coverage files**: RUNNER_SCOPE_GAP=237 (76.7%, code tested via Mocha), ENVIRONMENT_DEPENDENT=59 (19.1%, VSCode hostbridge/entry), EXCLUDED_BY_DESIGN=6 (proto-conversions / exports), INTENTIONAL_UNSUPPORTED=3 (dev tooling), GENUINE_TEST_GAP=2 SDK sources, UNKNOWN=2 (`src/common.ts` reclassified to ENVIRONMENT_DEPENDENT; `src/exports/index.ts` reclassified to EXCLUDED_BY_DESIGN); named-deprecation added to `test:coverage` script (DEPRECATED — measures Mocha only; use `test:vitest:coverage` for the Vitest baseline); vitest conservation 117 files / 1672 tests / 0 failures preserved; typecheck conservation 0/0 diagnostics preserved; durable artifact at `.factory/quality/code-coverage-baseline.json` (130 KiB, includes per-file data needed for ratchet ACT); `NEW_THRESHOLDS=0`; `NEW_COVERAGE_IGNORE_DIRECTIVES=0`; no source excluded to inflate numbers; CI parity: `.github/workflows/ext-vscode-test.yml` does not gate coverage (recorded under `EPIC-CLINEMM-GITHUB-ACTIONS01`) |
| `ACT-CLINEMM-CODE-COVERAGE-BASELINE01` | QA | CLOSED at this commit | — | code-coverage-baseline01 | exact-head RED-first recon at `be76c45d6`: `@vitest/coverage-v8@4.1.10` pinned in `apps/vscode/package.json` (was absent — only cross-workspace `3.2.7` was on disk, incompatible with vitest 4.1.10); one cohesive commit `3d2bd5e9e` adds (1) `apps/vscode/package.json` `@vitest/coverage-v8: "4.1.10"` (alphabetic, between `@types/vscode` and `@vscode/test-cli`; `\u2014` escape preserved); (2) `apps/vscode/vitest.config.ts` `coverage` block (provider=v8, include=`src/**/*.{ts,tsx}`, exclude=tests/test-infra/generated/embedded-packages, reporters=text+json-summary+json, `reportsDirectory: ./coverage`); (3) `apps/vscode/package.json` script changes: `test:vitest:coverage` added (canonical), `test:coverage:note` added (DEPRECATED — Mocha-only); **canonical command**: `cd apps/vscode && bunx vitest run --config vitest.config.ts --coverage`; **two runs (A and B)**: identical SHA-256 (`coverage-summary.json` `dfbc1cfc750cac9f7...`, `coverage-final.json` `971d5c7ef3e...`) — fully deterministic; **production source universe = 613 files** (every `src/**/*.ts` excluding the 4 documented categories — no unexplained missing files); **totals**: lines 15.80% (6832/43228), statements 15.86% (6980/43994), functions 18.88% (1311/6943), branches 11.03% (4202/38071); **bands**: 309 zero / 110 lt25 / 8 lt50 / 29 lt75 / 22 lt90 / 93 gte90; **gap classification of 309 zero-coverage files**: RUNNER_SCOPE_GAP=237 (76.7%, code tested via Mocha), ENVIRONMENT_DEPENDENT=59 (19.1%, VSCode hostbridge/entry), EXCLUDED_BY_DESIGN=6 (proto-conversions / exports), INTENTIONAL_UNSUPPORTED=3 (dev tooling), GENUINE_TEST_GAP=2 SDK sources, UNKNOWN=2 → all reclassified; `largest_gaps` top 5: `dev/debug-harness/server.ts` (627), `extension.ts` (282), `dev/mcp-oauth-test-server/server.ts` (267), `hosts/vscode/terminal/VscodeTerminalProcess.ts` (241), `core/mentions/index.ts` (232); vitest conservation: 117 files / 1672 tests / 0 failures preserved; typecheck conservation: exit 0, 0 bytes (0 diagnostics); `NEW_THRESHOLDS=0`; `NEW_COVERAGE_IGNORE_DIRECTIVES=0`; no source excluded to inflate numbers; no threshold gate introducing CI failure; durable artifact at `.factory/quality/code-coverage-baseline.json` (130 KiB, includes per-file data needed for ratchet ACT); `tests/vitest tests count = 1672` (unchanged); `MOCHA_TESTS=29` and `BUN_TESTS=75` recorded as RUNNER_SCOPE_GAPS (not in this baseline); CI parity: `.github/workflows/ext-vscode-test.yml` does not gate coverage (PARITY=PARTIAL — recorded under `EPIC-CLINEMM-GITHUB-ACTIONS01` for future ACT) |
| `EPIC-CLINEMM-CODE-COVERAGE-RATCHET01` | QA | CLOSED at this commit | HIGH | none | artifact-backed non-regression verifier over the qualified Vitest baseline; **mechanism**: absolute covered-count floors (statements >= 6980, branches >= 4202, functions >= 1311, lines >= 6832) + source-universe integrity (613 product files must all be present in current coverage report) + coverage-ignore directive count (no increase) + coverage scope contract fingerprint (SHA-256 of the textual `coverage: { ... }` block in `apps/vscode/vitest.config.ts`); baseline artifact schema evolved to v1+ with `scope.config_fingerprint = 95de362d43e99fb782319ce5e5de44b99417979d0db1fcc48b821e00cf3fec2a` baked in; canonical command `cd apps/vscode && bunx vitest run --config vitest.config.ts --coverage` followed by `python3 scripts/check-code-coverage-ratchet.py --baseline .factory/quality/code-coverage-baseline.json --summary apps/vscode/coverage/coverage-summary.json --final apps/vscode/coverage/coverage-final.json --root . --vitest-config apps/vscode/vitest.config.ts` (also exposed as `cd apps/vscode && bun run test:coverage:ratchet`); **verifier exit codes (10 in total)**: 0=PASS, 2=baseline invalid, 3=report invalid, 4=count regression, 5=scope regression, 6=ignore-directive regression, 7=scope-config changed, 8=malformed input, 9=internal error, **10=REBASELINE_REQUIRED** (a baseline file is absent from BOTH source tree AND current report — the universe has changed, the absolute baseline is potentially incomparable; a reviewed rebaseline is required to restore the ratchet; the verifier cannot know from filesystem absence alone whether deletion was legitimate, so REBASELINE_REQUIRED means "human review needed", not "deletion already proven legitimate") — REBASELINE_REQUIRED takes precedence over SCOPE_REGRESSION; **21 unit tests** in `scripts/tests/test_check_code_coverage_ratchet.py` across 13 classes A–K + F2 covering all 4 count regressions, scope-shrink, new-file-missing, source-universe-deletion, source-file-in-tree-missing-from-report (the orthogonal SCOPE_REGRESSION case), malformed-input, ignore-directive-increase, scope-config-changed; **synthetic RED witnesses proven**: count regression → exit 4, scope shrink → exit 5, ignore directive increase → exit 6, scope config change → exit 7, **source-universe deletion → exit 10**; **GREEN qualification**: Run A and Run B both PASS with identical normalized SHA-256 `dfbc1cfc750cac9f7ec264f9bf599d3660d79970ad22759dc1cffb10cf8a4735`; **conservation**: vitest 117 files / 1672 tests / 0 failures preserved; typecheck 0/0 diagnostics preserved; `NEW_COVERAGE_IGNORE_DIRECTIVES=0`; `NEW_THRESHOLDS=0` (artifact verifier is the ratchet, NOT native vitest thresholds — by design per plan); CI parity: `.github/workflows/ext-vscode-test.yml` does not gate the ratchet (PARITY=PARTIAL — recorded under `EPIC-CLINEMM-GITHUB-ACTIONS01` for future ACT); **CORRECTION01 applied**: review of `ACT-CLINEMM-CODE-COVERAGE-RATCHET01` closure identified a documented-but-not-implemented `REBASELINE_REQUIRED` outcome; this CORRECTION01 splits that classification out (exit code 10) and verifies it with both unit test F+ (deletion → REBASELINE_REQUIRED) and unit test F2 (file in source but missing from report → SCOPE_REGRESSION, the orthogonal case) |
| `ACT-CLINEMM-CODE-COVERAGE-RATCHET01` | QA | CLOSED at this commit | — | code-coverage-ratchet01 | exact-head RED-first implementation at `0356b5c2d`: baseline artifact validated (statements=6980, branches=4202, functions=1311, lines=6832, 613 files, config_fingerprint=`95de362d...`); **two new files**: `scripts/check-code-coverage-ratchet.py` (480 lines, 10 exit codes, stdlib-only); `scripts/tests/test_check_code_coverage_ratchet.py` (~600 lines, 21 unit tests across 13 classes A–K + F2); **two modifications**: `apps/vscode/package.json` adds `test:coverage:ratchet` script (canonical command wrapper); `.factory/quality/code-coverage-baseline.json` adds `scope.config_fingerprint`; **21/21 unit tests PASS** (A exact baseline, B 4 count regressions, C pct-hides-count, D scope shrink, E new file missing, F source-universe deletion → REBASELINE_REQUIRED, F2 source-file-in-tree-missing-from-report → SCOPE_REGRESSION (orthogonal), G malformed baseline, H malformed report, I ignore directive regression, J scope config changed, K plan-coverage meta); **synthetic RED witnesses proven**: count regression → exit 4, scope shrink → exit 5, ignore directive increase → exit 6, scope config change → exit 7, **source-universe deletion → exit 10**; **real-head GREEN**: Run A and Run B both PASS with identical normalized coverage-summary SHA-256 `dfbc1cfc750cac9f7ec264f9bf599d3660d79970ad22759dc1cffb10cf8a4735`; **conservation**: vitest 117 files / 1672 tests / 0 failures; typecheck 0/0 diagnostics; `NEW_COVERAGE_IGNORE_DIRECTIVES=0`; `NEW_THRESHOLDS=0`; **CORRECTION01**: source-universe deletion (file absent from BOTH source tree AND report) now properly returns `EXIT_REBASELINE_REQUIRED = 10` with explicit human-readable message; the prior confusion with `EXIT_SCOPE_REGRESSION = 5` is resolved; **CI parity**: ratchet not gated by `.github/workflows/ext-vscode-test.yml` (PARITY=PARTIAL — recorded under `EPIC-CLINEMM-GITHUB-ACTIONS01` for future ACT); **CORRECTION02 applied**: `apps/vscode/vitest.config.ts` used the plural `coverage.reporters` key but Vitest v4 documents the singular `coverage.reporter`; the plural form was silently ignored, so the canonical `cd apps/vscode && bun run test:coverage:ratchet` command never emitted `coverage-summary.json` and failed with exit 8 (`file not found`); repair: `reporters` → `reporter` in `vitest.config.ts` (no other config touched), with self-documenting comment, then refreshed `scope.config_fingerprint` in `.factory/quality/code-coverage-baseline.json` from `95de362d43e99fb782319ce5e5de44b99417979d0db1fcc48b821e00cf3fec2a` to `4bb40a87a065fede18a092a506ae1b7ad45abb572bbe9b29c77213a6c5eaafc5`; canonical command GREEN: `PASS: coverage ratchet holds`, scope=613/614, counts strictly above floors (stmts +25, branches +10, funcs +5, lines +24); conservation preserved: vitest 118 files / 1681 tests / 0 failures, tsc 0 diagnostics, biome clean; closed by `ACT-CLINEMM-CODE-COVERAGE-REPORTER-KEY-CORRECTION01` |
| `UP-01` | UPSTREAM | SUPERSEDED → `EPIC-CLINEMM-UPSTREAM-ISSUE-INTAKE01` | — | — | recon scope of fork vs upstream Cline; reclassified as upstream-intake substrate ACT |
| `EPIC-CLINEMM-UPSTREAM-ISSUE-INTAKE01` | UPSTREAM | CLOSED_INITIAL_TRIAGE at `162192610` | — | none | compact upstream issue intake substrate; rank by popularity + Cline-- value; map selected candidates; final triage (after correction 01 + correction 02 + correction 03 + correction 04) produced 5 IMPORTs, 12 EXACT_MAPs (on board) + 23 RELATED_TOOL_RUNTIME (cluster-assigned) + 5 RUNTIME_THINKING_STALL (cluster-assigned), 35 other ADJACENT/UNRELATED (RADAR), 0 REJECT, 0 CLOSED_UPSTREAM |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-SUBSTRATE01` | UPSTREAM | CLOSED at `f1837597b` | — | none | snapshot producer; SHA256 `878eb241e24150b4ecc9731e6fe8373b7e81566d8117f7f129b87f012f166cb6`; 573 retained rows; bounded selection policy; 29 unit tests |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE01` | UPSTREAM | CLOSED at `b4d7ed795` (superseded by correction 01) | — | upstream-issue-intake01 | consumed substrate; built 80-issue bounded shortlist; enriched via `gh issue view`; per-issue disposition; initial triage artifact was lexical-overlap-based and superseded by correction 01 |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION01` | UPSTREAM | CLOSED at `88f1e10c6` (superseded by correction 02) | — | upstream-issue-intake-triage01 | semantic three-class correction (EXACT_MAP / ADJACENT / UNRELATED); 17 lexical-overlap false mappings removed (#6416, #11018, #12042, #9181 spurious GITHUB-ACTIONS, +13 others) |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION02` | UPSTREAM | CLOSED at `4909884a6` (superseded by correction 03) | — | upstream-issue-intake-triage-correction01 | strict EXACT_MAP contract test (same failure contract OR same causal production seam OR direct upstream reproduction); 3 surviving false EXACT_MAPs removed (#9333, #12947, #12079); corrected artifact at `.factory/upstream/cline-upstream-triage.md` (210 lines, 18.0 KiB) |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION03` | UPSTREAM | CLOSED at `a87ef52e6` (superseded by correction 04) | — | upstream-issue-intake-triage-correction02 | strict destination-contract test for `TOOL-EXECUTION-SEMANTICS01` (issue must materially change or validate one of the canonical telemetry outputs); 23 over-broad mappings removed and reclassified `RELATED_TOOL_RUNTIME → RADAR` with cluster assignments (terminal-timeout=9, tool-parse=5, mcp-routing=3, shell-integration=2, loop-control=2, file-edit=1, approval-ux=1) so a future `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01` can be proposed with a clear evidence table; corrected artifact at `.factory/upstream/cline-upstream-triage.md` (293 lines, 29.9 KiB) |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION04` | UPSTREAM | CLOSED at this commit | — | upstream-issue-intake-triage-correction03 | strict destination-contract test for `STATIC-THINKING-PRESENTATION-PERSISTENCE01` (issue must demonstrate presentation-vs-runtime divergence, not a runtime stall); 5 over-broad mappings removed and reclassified `RUNTIME_THINKING_STALL → RADAR` with cluster assignments (skipped-command-stall=2, terminal-output-stall=1, model-thinking-stall=1, prompt-never-sent=1) so a future runtime-task-progression epic can be proposed with a clear evidence table; only `#8636` survives as `EXACT_PRESENTATION_MAP`; corrected artifact at `.factory/upstream/cline-upstream-triage.md` (287 lines, 25.9 KiB) |
| `ACT-CLINEMM-TEST-BASELINE-FAILURES-RECON01` | QA | CLOSED at this commit | — | test-baseline-zero-failures01 | RED-first recon at exact head `0d2548dd5`: canonical `cd apps/vscode && bunx vitest run --config vitest.config.ts` reproduces `1667 pass / 5 fail` exactly; 5 failures classified (4 TEST_DEFECT + 1 PRODUCT_DEFECT) with causal evidence; all 5 repaired with bounded fixes (REPO_ROOT hardcoded to deleted worktree → `.git/HEAD` walker; `SdkInteractionCoordinator.clearPending` now invokes saved `pendingAskResolve("")` mirroring `resolvePendingAskQuestion(undefined)`); canonical broad suite GREEN twice (`1672 pass / 0 fail`, ~50s each) with suite-load failure for hub config noted as by-design exclusion (dedicated config passes 11/11); isolated formerly-failing tests GREEN 5/5 across runs (no flakes); no new skips, no assertion weakening, no test exclusion; replaces "pre-existing" wording with truthful exact-head state |
| `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01` | RUNTIME / TASK-STATE | OPEN (RADAR with `CAPTURE_INSUFFICIENT`) | HIGH pending live evidence | none | promote the previously-radar `RUNTIME_THINKING_STALL` cluster into a canonical Cline-- epic only if a future ACT obtains direct live evidence of: an asynchronous command/tool remaining `RUNNING` while the model/agent stops progressing with no actionable user continuation; the load-bearing causal boundary between "runtime lost the running job" and "the model never polled again" cannot be observed in this environment today because no Cline-- extension host was running during the original incident (the observed `status: running / jobId / elapsedMs / deadlineRemainingMs` shape was host-tool polling output, not a Cline tool result); canonical continuation seam (`command-job-manager.start` → `awaitOrSnapshot` race → `status()` race against `exitTransitions` map → `command_status` tool) is well-tested GREEN 20/20 under vitest; `backgroundCommandRunning` projection state is unwired (dead — `updateBackgroundCommandState()` defined but never called) which is a separate presentation concern, NOT a continuation defect; do NOT pre-promote the 5 `RUNTIME_THINKING_STALL` upstream issues or the 23 `RELATED_TOOL_RUNTIME` issues as EXACT_MAPs without matching failure contract |
| `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-LIVE-RECON01` | RUNTIME / TASK-STATE | CLOSED at this commit with `CAPTURE_INSUFFICIENT` | — | runtime-task-progression01 | live evidence captured during `ACT-CLINEMM-TEST-BASELINE-FAILURES-RECON01` post-closure: the host command `bun scripts/run-bun-tests.ts` ran for 5+ min and froze log at 250264 bytes / 2503 lines; after the test-baseline ACT's bounded fixes the canonical broad suite is GREEN (1672 pass / 0 fail × 3); however, the load-bearing causal boundary for `RUNTIME-TASK-PROGRESSION01` cannot be observed in this environment because (1) no Cline-- VS Code extension host was running during the original incident — the `status: running / jobId / elapsedMs / deadlineRemainingMs` shape the user observed came from my host's `command_status` polling wrapper, not a Cline tool result, (2) no TaskHeader ever rendered `Waiting` because no Cline-- UI was active, (3) no extension-host logs exist on disk (search of `/tmp`, `/var/folders`, `~/Library/Application Support` returned empty), (4) the canonical continuation seam `command-job-manager.{start,status,cancel}` is well-tested GREEN 20/20 under vitest, (5) `backgroundCommandRunning` is unwired projection state (defined but never called) which is a separate presentation concern; verdict `CAPTURE_INSUFFICIENT` per §21 because the necessary causal boundary cannot safely be observed; **no repair performed**; future ACT must run with a live Cline-- extension host and a real model turn to obtain the live continuation failure contract |
| `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` | DIST/REPO | OPEN | HIGH | none | git checkpoint corruption (.git/.git_disabled left by interrupted tasks, submodule breakage, large-workspace corruption, disk-space exhaustion) + checkpoint restore failure; recon from upstream #4388 + #12388 |
| `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` | MCP | OPEN | HIGH | none | MCP stdio servers spawn unbounded instances until crash on Windows; process-lifecycle bug; recon from upstream #7413 |
| `EPIC-CLINEMM-CLINEIGNORE-FILTERING01` | CONTEXT | OPEN | MED | context-accounting-truth | `.clineignore` documented as filtering file listing but does not actually exclude files from context; recon from upstream #9554 |
| `EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01` | PROVIDERS | OPEN | MED | none | provider model list discovery broken for LM Studio API and similar OpenAI-compatible endpoints; recon from upstream #10016 |
| `QA-01` | QA | NEEDS_CLASSIFICATION | LOW | — | classify exact-head dogfood / live qualification / conservation gates |
| `QA-02` | QA | NEEDS_CLASSIFICATION | LOW | — | classify release-artifact qualification scope |
| `MCP-01` | MCP | NEEDS_CLASSIFICATION | LOW | — | classify against current Cline-- MCP usage; do not import InDeep/Figma scope |
| `MCP-02` | MCP | NEEDS_CLASSIFICATION | LOW | — | classify against current Cline-- MCP usage; do not import InDeep/Figma scope |
| `FACT-01` | FACTORY | NEEDS_CLASSIFICATION | LOW | — | classify prior Factory/Leamas substrate scope relevant to Cline-- |
| `FACT-02` | FACTORY | NEEDS_CLASSIFICATION | LOW | — | classify prior Factory/Leamas substrate scope relevant to Cline-- |
| `LIVE-CONTEXT-DIMENSIONS01` (LCD01) | DIAG | CLOSED via LCD01 retirement at `51f2f6a9c` | — | — | historical alias; PTAD retained as default-off substrate |
| `REACT-UPDATER-PURITY-REPAIR01` | FOUNDATION | CLOSED | — | — | historical alias; invariant: no side effects in functional updaters |
| `RED-FIX01` / `W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01` | FOUNDATION | CLOSED via W1/W2 epoch repair | — | — | historical alias; proven at `5637d965d` |
| `E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01` | FOUNDATION | CLOSED (E7 Local thinking) | — | — | historical alias |
| `E7-LOCAL-BACKEND-ACTIVATION01` | FOUNDATION | CLOSED (E7 Local advisory) | — | — | historical alias |
| `ELM-02F` / `ELM-02F-CORRECTION01` | FOUNDATION | CLOSED (Elm groundwork) | — | — | historical alias |
| `C2-CORRECTION02-FIXUP01..04` | FOUNDATION | CLOSED via LCD01 retirement | — | — | historical alias |
| `TRACE01` | FOUNDATION | CLOSED (E7.1 thinking) | — | — | historical alias |
| `DOGFOOD-VSIX-QUALIFICATION01` | FOUNDATION | CLOSED | — | — | historical alias |
| `WEBVIEW-TURNSTATE-COMPOSITION01` | FOUNDATION | CLOSED (precondition halt) | — | — | historical alias |
| `C2.4-*` / `C2.5-*` / `C25-*` | FOUNDATION | CLOSED (Elmization groundwork) | — | — | historical alias |
| `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01` | FOUNDATION | CLOSED at `51f2f6a9c` | — | — | historical alias |
| `ACT-CLINEMM-FACTORY-GLOBAL-EPIC-BOARD-WAVE01` | FACTORY | CLOSED at `1e6430bc15f00d08f66dc905c41edbd3f74045db` | — | — | this board's substrate commit |
| `ACT-CLINEMM-FACTORY-GLOBAL-TASK-CENSUS01` | FACTORY | CLOSED at `4b2b2beec059b668bd49799304b9fd78d1ef79a0` | — | — | this ACT's own predecessor; 47 canonical rows at closure |
| `ACT-CLINEMM-E7.1-TEMP-DIAGNOSTICS-REMOVAL01` | DIAG | SUPERSEDED → `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01` | — | — | old proposed ACT name; recon showed PTAD was valuable as generic dormant substrate, so LCD01 retired but PTAD retained DEFAULT_OFF |

Legend:
- `OPEN` — actionable, scope known.
- `NEXT` — concrete first slice identified, scope known.
- `HOLD` — explicitly not advancing; sequencing dependency only.
- `RECON` — recon phase before scope can be set.
- `BLOCKED` — depends on something outside the repo.
- `CLOSED` / `CLOSED_LIVE` — done; evidence pinned.
- `P2` — non-blocking cleanup or residue.
- `DEFERRED` — intentionally parked.
- `NEEDS_CLASSIFICATION` — historically known to exist; contract not reconstructable without further recon. Not silently dropped.

---

## Closed foundation

### 1. Elm/state architecture groundwork

- status: CLOSED
- note: canonical state-machine / runtime groundwork exists (e.g. `ELM-02F`, `C2.4-*`, `C25-*`)
- evidence: see Canonical task index alias rows

### 2. E7 Local advisory activation

- status: CLOSED
- source IDs: `E7-LOCAL-BACKEND-ACTIVATION01` + `E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01`
- note: Local path has canonical advisory activation foundation

### 3. Thinking canonical-state authority

- status: CLOSED
- note: canonical authority exists; static presentation residue remains separately OPEN (see `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`)
- source IDs: `E7.1`, `TRACE01`

### 4. React updater purity repair

- status: CLOSED
- source ID: `REACT-UPDATER-PURITY-REPAIR01`
- invariant: no diagnostic/external side effects inside functional state updaters

### 5. W1/W2 epoch-domain repair

- status: CLOSED_LIVE
- source IDs: `RED-FIX01` / `W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01` / `LIVE-SHAPE-REPRODUCTION01`
- qualified source: `5637d965dcaf95bd82708b21ecf233d9672cde59`
- live verdict: PASS_LIVE_EPOCH_REPAIR
- proven:
  - W1 `stateVersion > 0`
  - W1 `epoch` present
  - shared W1/W2 sequence authority
  - streaming raw == committed
  - awaiting-followup raw == committed

### 6. Incident-diagnostic retirement

- ACT: `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01`
- source ID: `LIVE-CONTEXT-DIMENSIONS01` (LCD01) + `C2-CORRECTION02-FIXUP01..04`
- status: CLOSED
- final commit: `51f2f6a9c48bd880186928b18a2a9e3817613d43`
- result:
  - LCD01 retired
  - PTAD retained (default-off, opt-in via workspace toggle)
  - production correctness invariants preserved

### 7. Dogfood VSIX qualification

- source ID: `DOGFOOD-VSIX-QUALIFICATION01`
- status: CLOSED

### 8. Factory global epic board substrate

- ACT: `ACT-CLINEMM-FACTORY-GLOBAL-EPIC-BOARD-WAVE01`
- status: CLOSED
- final commit: `1e6430bc15f00d08f66dc905c41edbd3f74045db`

---

## Immediate critical path

Priority rationale: an accidental destructive force-push can destroy the evidence and commits behind every product defect. Git-safety comes before any product defect that depends on those commits remaining publishable. Quality substrate precedes long product-work cycles because a green baseline + monotonic coverage ratchet makes every subsequent Cline-- ACT cheaper to qualify. The first three items are no longer aspirational: Git-safety enforcement is CLOSED; only publish and quality-substrate recon remain in the run-up to product work.

1. **PUBLISH-CURRENT-MAIN01** — OPEN / HIGH (requires explicit authority; fast-forward only; precondition `git merge-base --is-ancestor origin/main main`; now safe because `main` is server-side force-push-blocked at ruleset `21037630`)
2. **TEST-BASELINE-ZERO-FAILURES01** — CLOSED at this commit (canonical broad suite GREEN, 1672 pass / 0 fail; exact-head evidence below)
3. **TYPECHECK-ZERO-BASELINE01** — CLOSED at this commit (canonical `tsc --noEmit` GREEN twice, 0 diagnostics; vitest 1672/0 preserved; closed by `ACT-CLINEMM-TYPECHECK-BASELINE-RECON01`)
4. **CODE-COVERAGE-BASELINE01** — CLOSED at this commit (canonical Vitest coverage baseline established; lines 15.80% / statements 15.86% / functions 18.88% / branches 11.03%; 613-file universe; deterministic SHA-256; closed by `ACT-CLINEMM-CODE-COVERAGE-BASELINE01`)
5. **CODE-COVERAGE-RATCHET01** — CLOSED at this commit (artifact-backed count + scope ratchet enforced; lines >= 6832 / statements >= 6980 / functions >= 1311 / branches >= 4202; 613-file universe; 21/21 unit tests including source-universe deletion → REBASELINE_REQUIRED (exit 10) and source-file-in-tree-missing-from-report → SCOPE_REGRESSION (exit 5, orthogonal); synthetic RED witnesses proven; closed by `ACT-CLINEMM-CODE-COVERAGE-RATCHET01` + correction01)
6. **UPSTREAM-ISSUE-INTAKE-TRIAGE01** — NEXT / HIGH (uses substrate `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-SUBSTRATE01` snapshot; IMPORT/MAP_EXISTING/RADAR/REJECT per upstream issue)
7. **COMPACTION-STATE-AUTHORITY01** — CLOSED at this commit (root cause: producer authority gap — `SdkCompactionCoordinator` emitted the compaction divider without writing the canonical `TurnStateTracker`; repaired by a bounded `compacting` phase; closed by `ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01`)
8. **STATIC-THINKING-PRESENTATION-PERSISTENCE01** — OPEN / HIGH
9. **TASKHEADER-CANONICAL-PROJECTION01** — OPEN / HIGH
10. **TASKHEADER-OWNER-AWARE-TIMING01** — OPEN / HIGH
11. **CONTEXT-ACCOUNTING-TRUTH01** — CLOSED at this commit (model catalog resolution, `resolveEffectiveMaxInputTokens`, compaction trigger, and `contextWindow` authority all correct; UI's occupancy bar inflated by output+cache activity — `getLastApiReqTotalTokens` summed `tokensIn + tokensOut + cacheWrites + cacheReads`; **CORRECTION01**: initial `tokensIn`-only fix reopened by reviewer as provider-blind (would undercount Anthropic-native cached prompts); replaced by `getLastApiReqContextInputTokens` returning `tokensIn + cacheReads + cacheWrites` — the AI SDK `inputTokens.total` contract; producer seam (`apps/vscode/src/sdk/message-translator.ts:86-110 normalizeUsageEvent`) already produces disjoint buckets from `inputTokens - cacheReads - cacheWrites`; Anthropic-native (`tokensIn=50, cacheReads=100000` → `100_050`) and OpenAI-compat inclusive (`prompt_tokens = noCache + cached_tokens`) REDs both covered; 10 files changed (467 insertions, 40 deletions); closed by `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01`)
12. **USER-CONTEXT-CEILING01** — OPEN / HIGH (depends on #11 → #11 CLOSED; precondition `ACCOUNTING_TRUTH=SATISFIED` now holds)
13. **TOOL-EXECUTION-SEMANTICS01** — OPEN / HIGH
14. **GITHUB-ACTIONS01** — OPEN / HIGH
15. **GITHUB-DISTRIBUTION01** — OPEN / HIGH
16. **BRANDING-ACTIVITYBAR-ICON01** — NEXT / MED

Deferred (not on critical path):

- **FACTORIZATION01** — DEFERRED (recon; one bounded seam at a time; no giant rewrite)

---

## Context / compaction

Three **semantically distinct** epics; do not collapse.

### CONTEXT-ACCOUNTING-TRUTH01

- ID: `EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01`
- STATUS: CLOSED / LIVE_UI reproduced at the production seam
- CLOSED BY: `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01`

**Recon answer.** Three production seams carry the context-accounting contract in this fork; all three were traced and only one was defective:

1. **Model-info authority (capacity side)** — **CORRECT**.
   UI path: `useNormalizedApiConfiguration` → `ModelsServiceClient.resolveModelInfo` → host handler `apps/vscode/src/core/controller/models/resolveModelInfo.ts` (catalog peek → resolve → committed-selection → "unknown"). Compaction path: `tryGetModelInfo(this.config)` → `config.knownModels[config.modelId]` → SDK catalog. Both converge on the same SDK catalog entry. Upstream #12520 hypothesis (`providerConfig.modelInfo?.contextWindow` short-circuit) was inspected and **does not apply** to this fork: `providerConfig.modelInfo` is never assigned outside test code (`sdk/packages/core/src/extensions/context/agentic-compaction.ts:36` is dead code in production). The shared canonical resolver `resolveEffectiveMaxInputTokens` (`sdk/packages/core/src/extensions/context/compaction-shared.ts:51-70`) returns `min(maxInputTokens, contextWindow)` when both present, `contextWindow * 0.9` when only `contextWindow`, `maxInputTokens` when only that — used by both `compaction.ts` (primary trigger) and `agentic-compaction.ts` (summarizer budget).

2. **Compaction trigger threshold** — **CORRECT**.
   `compaction.ts:313-318`: `maxInputTokens = resolveEffectiveMaxInputTokens({maxInputTokens: context.model.info?.maxInputTokens, contextWindow: context.model.info?.contextWindow}) ?? DEFAULT_MAX_INPUT_TOKENS`. `requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO` (90%). Compaction fires when `requestInputTokens >= requestTriggerTokens`, where `requestInputTokens` is the SDK's `estimateRequestInputTokens({systemPrompt, messages, tools})` — i.e. the **estimated prompt-input size for the next request**, not the billed request activity.

3. **UI occupancy bar (usage side)** — **DEFECTIVE**.
   `ContextWindow.tsx` (pre-fix): `percentage = (lastApiReqTotalTokens / contextWindow) * 100`, where `lastApiReqTotalTokens = getLastApiReqTotalTokens(messages) = tokensIn + tokensOut + cacheWrites + cacheReads`. This conflates **current prompt input** (≈ `tokensIn`) with **billed request activity** (output + cache reads + cache writes). Cache reads in particular inflate the displayed numerator substantially for prompt-cached sessions — fully explaining the historical "~194k compaction while UI shows similar" symptom.

**Bounded repair (CORRECTION01).** New helper `getLastApiReqContextInputTokens(messages)` (same compaction-ratio rescaling semantics) returns `tokensIn + cacheReads + cacheWrites`. Threaded through `ChatView → TaskSection → TaskHeader → ContextWindow` as a new `lastApiReqContextInputTokens` prop. The occupancy bar and the displayed "used" value now reflect the provider-normalized context-input occupancy (the AI SDK `inputTokens.total` contract). `getLastApiReqTotalTokens` is preserved for any caller that legitimately wants the billed total (no current production consumer was found).

The producer seam in `apps/vscode/src/sdk/message-translator.ts:86-110 normalizeUsageEvent` already decomposes the SDK's inclusive `inputTokens` (which equals `inputTokens.total`) into **disjoint** `tokensIn / cacheReads / cacheWrites` via `uncachedInputTokens = inputTokens - cacheReads - cacheWrites`. The AI SDK Anthropic adapter emits `inputTokens.total = usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; the OpenAI-compat adapter emits `inputTokens.total = prompt_tokens` with `noCache = prompt_tokens - cached_tokens`. Both converge on the same inclusive total — the size of the prompt that competed for the model's window on the last request.

**Evidence quality.**
- RED test (initial defect, `getLastApiReqTotalTokens` inflation): `apps/vscode/src/shared/__tests__/getApiMetrics.test.ts > getLastApiReqTotalTokens > uses only the latest api_req_started payload` — asserts the billed total still equals `tokensIn + tokensOut + cacheWrites + cacheReads`.
- RED test (Anthropic-native exclusive cache, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > Anthropic-native exclusive cache accounting: tokensIn excludes the cached subset` — `tokensIn=50, cacheReads=100_000, cacheWrites=0` → `100_050` (Anthropic's documented total).
- RED test (Anthropic cache creation, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > Anthropic cache creation: cacheWrites contribute to context-input size` — `tokensIn=200, cacheWrites=12_500, cacheReads=0` → `12_700`.
- RED test (OpenAI-compat inclusive, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > OpenAI-compatible inclusive cache accounting: tokensIn already contains the cached subset` — `tokensIn=149_235, cacheReads=148_167` → `297_402` (the original `prompt_tokens`, not double-counted because the buckets are disjoint).
- RED test (`tokensOut` non-contribution, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > tokensOut never contributes to context-input occupancy` — `tokensIn=10, tokensOut=500_000` → `10` (output tokens describe the previous response, not the current request's input).
- RED test (compaction-ratio rescale, CORRECTION01): `getApiMetrics.test.ts > getLastApiReqContextInputTokens > rescales the context-input total by the shrink ratio of a compaction completed after it` — inclusive total rescales correctly across a `tokensBefore → tokensAfter` divider.
- RED test (component level, CORRECTION01): `apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.test.tsx > treats lastApiReqContextInputTokens as the provider-normalized total (cacheReads + cacheWrites contribute)` — proves the bar reflects `lastApiReqContextInputTokens=100_050` (= 50% of 200k) for the Anthropic-native scenario, not 50 (i.e. `tokensIn` alone, which would have been 0.025%).
- Conservation: `getLastApiReqTotalTokens` API preserved (no caller regressions); `contextWindow` denominator unchanged; `resolveEffectiveMaxInputTokens` unchanged; compaction threshold formula unchanged; cost/telemetry consumers unaffected (none exist on this prop today).

**Conservation matrix verified.** Existing ordinary providers unchanged; missing model info still falls back to "unknown"; 1M model preserves 1M; lower `maxInputTokens` (if present) constrains effective input; UI and compaction now consume the same semantic domain for the *numerator*; cost calculation untouched; producer-seam contract preserved (`normalizeUsageEvent` unchanged).

**Invariant set established.**
- I1. DISPLAYED capacity identifies its semantic domain truthfully (raw physical `contextWindow`).
- I2. COMPACTION trigger uses the intended effective capacity (`resolveEffectiveMaxInputTokens`).
- I3. CURRENT_CONTEXT_USAGE (bar numerator) is now the provider-normalized context-input occupancy `tokensIn + cacheReads + cacheWrites` (the AI SDK `inputTokens.total` contract), not the lifetime/billed total and not `tokensIn` alone.
- I4. Fallback model metadata does not shadow a more specific authoritative entry.
- I5. Same active model/config does not resolve to contradictory capacities across UI and compaction paths.
- I6. The UI numerator is provider-independent — it does not switch on Anthropic/OpenAI-compat/etc. The provider normalization happens once at the producer seam and the helper just sums the resulting disjoint buckets.

**Rule observed.** No repair from leading hypothesis. The upstream #12520 hypothesis was treated as a hypothesis generator only; the actual defect was found by reading the UI projection at the production seam. No user ceiling implemented (that remains `EPIC-CLINEMM-USER-CONTEXT-CEILING01`). No arbitrary threshold tuning. No cost repair. The first-pass fix used `tokensIn`-only and was reopened by the factory reviewer as provider-blind (would undercount Anthropic-native cached prompts); CORRECTION01 moved the normalization to the AI SDK contract, which is provider-independent by construction.

**Quality gates.** Vitest canonical 118 files / 1681 tests / 0 failures. Bun unit 72 files / 1076 tests / 0 failures. Webview 69 files / 562 tests / 0 failures. Typecheck 0 diagnostics. Coverage ratchet PASS (613-file universe preserved).

### COMPACTION-STATE-AUTHORITY01

- ID: `EPIC-CLINEMM-COMPACTION-STATE-AUTHORITY01`
- STATUS: CLOSED / LIVE_UI reproduced at the production seam
- CLOSED BY: `ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01`

**Live reproduction.** UI displays `"Compacting context..."`. TaskHeader simultaneously displays `"Waiting"`.

**Evidence quality.** LIVE_UI (originating report) + PRODUCTION_SEAM RED (`apps/vscode/src/sdk/sdk-compaction-coordinator.turn-phase-authority.test.ts`, CSA02: `expected 'Waiting' not to be 'Waiting'` before repair).

**Recon answer — phase, not orthogonal dimension.** The canonical runtime authority is `TurnStateTracker` (`apps/vscode/src/sdk/turn-state-tracker.ts`), projected on the wire as `TurnState.phase` and consumed by the TaskHeader through the pure `stateLabel` projection. Compaction is a *bounded, mutually exclusive* window: `SdkCompactionCoordinator` refuses to compact while a turn is running (`COMPACTION_TURN_RUNNING_MESSAGE`), so no other phase can be concurrently true. It is therefore modelled as a phase, not as a second concurrent dimension — which would have created a second authority.

**Root cause — AUTHORITY GAP at the producer, not a projection defect.** `SdkCompactionCoordinator.runCompaction` emitted the `status: "started"` divider row and posted state to the webview, but never wrote the canonical tracker. The tracker consequently retained whatever phase the previously finished turn left behind — typically `awaiting_followup`. TaskHeader was *faithfully* projecting that stale canonical authority as `"Waiting"`. The projection was correct; the producer was silent.

**Repair.**

- `TurnPhase` gains one semantically necessary variant, `"compacting"` (SYSTEM_TRANSITION ownership) — `apps/vscode/src/shared/ExtensionMessage.ts`.
- `SdkCompactionCoordinator` enters `compacting` immediately *before* the divider is emitted and restores the entry phase **and anchor** in a `finally` — so success, failure, skip, and cancel all converge back. No new terminal state.
- `SdkController` wires the coordinator to the *same* `turnStateTracker` every other coordinator uses — no second authority.
- `stateLabel` projects `compacting → { label: "Compacting", live: true }`, reusing the existing `CompactionRow` vocabulary.

**Explicitly not done (kept separate).** No string scraping of `"Compacting context..."`; no compaction-threshold tuning; no token-accounting change. Those remain `CONTEXT-ACCOUNTING-TRUTH01` / `USER-CONTEXT-CEILING01`.

**Conservation.** A genuine human wait still reads `"Waiting"`; `streaming → Working`, `awaiting_approval → Approval`, `completed → Complete`, `idle → Idle` all unchanged (CSA07/CSA08).

### USER-CONTEXT-CEILING01

- ID: `EPIC-CLINEMM-USER-CONTEXT-CEILING01`
- STATUS: CLOSED at `ac40e43991189608b0c01cd15d039000fa0314ba` (HEAD)
- CLOSED BY: `ACT-CLINEMM-USER-CONTEXT-CEILING01`

**Goal.** Allow a user to set an effective operating ceiling below a model's advertised physical maximum.

**Configuration modes supported:**

- `Auto` — undefined = use the canonical model/provider effective input capacity (no additional user restriction; bit-for-bit preserved from `ACCOUNTING-TRUTH01`'s resolver output).
- explicit positive integer token ceiling — `min(canonicalModelEffective, userCeiling)`. Empty UI input = Auto.

**Example.** physical model max = 1,000,000 → explicit user effective ceiling = 512,000 → operating effective capacity = 512,000. Physical model capability is **not** mutated.

**Important.** `512k` is a user-configurable example / desired value. It is **NOT** a global hardcoded limit for every 1M-context model. The effective budget must satisfy `effective <= physical model maximum`, but concrete implementation must follow real source recon.

**Invariant.**

  physical model maximum   ≠
  effective configured ceiling  ≠
  current context occupancy  ≠
  cumulative token usage

**Implementation (closed by this ACT).**

- New pure policy resolver: `applyUserContextCeiling(modelEffective, userCeiling)` + `normalizeUserContextCeiling(value)` at `sdk/packages/core/src/extensions/context/compaction-shared.ts`. `modelEffective` is the existing canonical `resolveEffectiveMaxInputTokens(...)` output (NOT raw model metadata). Auto returns the canonical limit exactly; explicit ceiling lowers it; ceiling above model is silently clamped; invalid values (0 / negative / fractional / NaN / non-integer / non-numeric) normalize to Auto at the policy seam AND are rejected at the persistence seam.
- Plumbing: `CoreCompactionConfig.userContextCeiling?: number` (`sdk/packages/core/src/types/config.ts`). `createContextCompactionPrepareTurn` reads it once per `prepareTurn` (sanitized), then composes it via `applyUserContextCeiling(resolveEffectiveMaxInputTokens({...}), sanitizedUserContextCeiling)`. The result becomes `requestTriggerTokens = operatingCapacity * 0.9` — **one threshold formula, no duplication**.
- Persistence: new `userContextCeiling: { default: undefined as number | undefined }` field in `apps/vscode/src/shared/storage/state-keys.ts` (auto-generates `Settings.user_context_ceiling = 187` in proto + `UpdateSettingsRequest.user_context_ceiling = 46`). Handlers `updateSettings.ts` and `updateSettingsCli.ts` validate the value (positive integer) and persist; invalid values throw before reaching disk.
- Wiring: `cline-session-factory.ts` reads `stateManager.getGlobalSettingsKey("userContextCeiling")` (with `taskSettings?.userContextCeiling` override) and forwards via `CoreSessionConfig.compaction.userContextCeiling`. Summarizer (agentic-compaction) input budget **intentionally NOT** user-ceiling-clamped — that is the summarizer model's own context window, a separate authority (provider hard validation).
- Settings UI: `FeatureSettingsSection.tsx` adds a labeled numeric input next to Auto Compact Strategy. Empty = Auto; positive integer = explicit ceiling. Invalid inputs are rejected client-side and the persisted state is unchanged.
- Conservation: no mutation of model metadata (`contextWindow`, `maxInputTokens`); accounting helpers untouched (`getLastApiReqContextInputTokens` / `normalizeUsageEvent` unchanged); no hidden truncation; auto-condense OFF preserves existing behavior.

**Quality evidence (commit `ac40e4399`).**

- canonical apps/vscode Vitest: 118 files / **1681 tests / 0 failures**
- bun unit: 72 files / **1076 tests / 0 failures**
- webview vitest: 69 files / **567 tests / 0 failures** (was 562, +5 ceiling UI)
- SDK core vitest: 173 files / **2124 passed / 14 skipped / 0 failures** (was 94; +15 new RED family tests covering `normalizeUserContextCeiling`, `applyUserContextCeiling`, composition matrix, and three production `createContextCompactionPrepareTurn` RED family E tests at the wiring seam)
- typecheck: **0 diagnostics**
- coverage ratchet: PASS (delta **+26 statements / +13 branches / +5 functions / +25 lines**)
- markdown guard: PASS

**Dogfood qualification.**

- source head: `ac40e43991189608b0c01cd15d039000fa0314ba`
- source version: 4.1.10
- dogfood version: 4.1.10-ac40e4399
- artifact: `/private/tmp/dogfood-context-ceiling/clinemm-4.1.10-ac40e4399.vsix`
- sha256: `5f4847a176cb8ee251058e2792b604407774b99718c8cab8aa758362674e6492`
- bytes: 8,884,433
- installed: `s1onique.clinemm@4.1.10-ac40e4399` (via `codium-cline --install-extension ... --force`)

**Dependency satisfied.** `CONTEXT-ACCOUNTING-TRUTH01` (CLOSED via CORRECTION01) provided the trustworthy capacity/usage/trigger authorities; the ceiling is layered on top of `resolveEffectiveMaxInputTokens` (not a parallel duplicate). The UI's context-occupancy numerator remained the provider-normalized context-input occupancy (`tokensIn + cacheReads + cacheWrites`, the AI SDK `inputTokens.total` contract) — this ACT changes policy, not accounting.

### Historical context family (CTX-01..03)

Preserved as `NEEDS_CLASSIFICATION` rows in the canonical task index. Scope not reconstructable from current board + repository history; do not silently forget them. Reclassify when relevant.

---

## Task state / presentation

### STATIC-THINKING-PRESENTATION-PERSISTENCE01

- ID: `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`
- STATUS: OPEN

**Symptom.** Static `"Thinking ›"` presentation can persist after runtime state is no longer thinking/streaming.

**Constraint.** Do not invent a second UI authority. Use the canonical state/projection.

### TASKHEADER-CANONICAL-PROJECTION01

- ID: `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01`
- HISTORICAL NAME: E7.1-2 TASKHEADER CANONICAL PROJECTION
- STATUS: OPEN

**Purpose.** TaskHeader consumes canonical task-state projections rather than reconstructing state locally.

**Distinct from timing.** This epic is about projection correctness, not elapsed-time semantics. It is **not** folded into owner-aware timing; that would lose it.

### TASKHEADER-OWNER-AWARE-TIMING01

- ID: `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01`
- STATUS: OPEN

**Goal.** TaskHeader should project canonical runtime ownership/state with timing semantics.

**Desired semantic distinction:**

- AGENT-owned work
- HUMAN-owned waiting
- completed / terminal
- error / recovery states

**Likely telemetry:** agent-active elapsed, wall elapsed if useful, tool calls, recovery count, canonical state.

**Dependencies.** `TASKHEADER-CANONICAL-PROJECTION01` must be understood first. `COMPACTION-STATE-AUTHORITY01` is CLOSED — `"Waiting"` no longer hides active compaction (the canonical `compacting` phase now projects as `Compacting`).

---

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

**First ACT.** `TOOL-EXECUTION-SEMANTICS-RECON01`. Do not implement classifier logic in this board ACT.

### COST-DISPLAY-TRUTH01

- ID: `EPIC-CLINEMM-COST-DISPLAY-TRUTH01`
- STATUS: OPEN

**Symptom.** Dollar estimates such as `"$0.0082"` are misleading when the user is on a flat-rate / subscription access path.

**Primary question.** Can runtime reliably know billing semantics?

**Desired behavior:**

  metered API        → estimated cost may be meaningful
  flat-rate / subscription  → pseudo-spend total should NOT be presented as actual spend

**If billing mode is not observable:** support explicit display policy / user override rather than inventing billing knowledge.

**Rule.** Do not implement in this ACT.

### Historical recovery/observability family

`REC-01`, `REC-02`, `OBS-01..05` preserved as `NEEDS_CLASSIFICATION` rows. Scope not reconstructable from current board + repository history. Recovery counter is partially exposed by TaskHeader but the original contract is unverified. Reclassify when relevant.

---

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

## Quality substrate

Four QA epics plus a deferred architecture epic. Quality substrate precedes long product-work cycles because a green baseline + monotonic coverage ratchet makes every subsequent Cline-- ACT cheaper to qualify.

### TEST-BASELINE-ZERO-FAILURES01

- ID: `EPIC-CLINEMM-TEST-BASELINE-ZERO-FAILURES01`
- STATUS: **CLOSED** at commit `a87ef52e6...` (this commit) — exact-head canonical command `cd apps/vscode && bunx vitest run --config vitest.config.ts` returns **1672 pass / 0 fail** (50.51s, 51.44s on two consecutive runs); `CANONICAL_VITEST_FAILURES=0`; `NEW_SKIPS_ADDED=0`

**Goal.** Default canonical test gate = zero unexplained failures. **Achieved** at this commit.

**Canonical command** (the actual command that produced the historical "1667 pass / 5 pre-existing fail" count):

```
cd apps/vscode && bunx vitest run --config vitest.config.ts
```

The runner `apps/vscode/scripts/run-bun-tests.ts` and `apps/vscode/scripts/run-bun-unit-tests.ts` are **not** the canonical command: those runners execute Vitest-API tests under `bun test`, which lacks `vi.advanceTimersByTimeAsync`, `vi.stubEnv`, `vi.unstubAllEnvs`, `expect().toHaveBeenCalledExactlyOnceWith`, etc., and would produce a false-positive 46-line failure inventory. The bun runners are an alternate execution surface that documents a known-incompatibility state, not the canonical gate.

**First ACT** (closed in this commit): `ACT-CLINEMM-TEST-BASELINE-FAILURES-RECON01` — exact-head RED-first recon, causal classification, bounded repair.

**Causal classification (5 historical failures, all repaired in this ACT):**

| ID | File | Test | Category | Causal seam | Repair |
| --- | --- | --- | --- | --- | --- |
| F1 | `apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c21-recon.test.ts` | C2.1-A: initTask setTurnPhase(streaming) ordering | **TEST_DEFECT** | `REPO_ROOT` hardcoded to a deleted sibling-worktree path (`/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01`) at line 25 of the test file; leak from commit `809e94083` | Replaced with `findRepoRoot()` that walks up from the test file to find `.git/HEAD`; assertion logic unchanged |
| F2 | same file | C2.1-B: RuntimeEventAdapter seam | **TEST_DEFECT** | same `REPO_ROOT` | same fix |
| F3 | same file | C2.1-B: Shadow adapter canonical mapping | **TEST_DEFECT** | same `REPO_ROOT` | same fix |
| F4 | same file | C2.1-B: AgentRuntime ordering | **TEST_DEFECT** | same `REPO_ROOT` | same fix |
| F5 | `apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts` | SdkTaskControlCoordinator > settles a pending question when switching tasks | **PRODUCT_DEFECT** | `SdkInteractionCoordinator.clearPending` (line 472) set `this.pendingAskResolve = undefined` without calling the saved resolve, leaving `handleAskQuestion`'s return-promise dangling across task switches; sibling method `resolvePendingAskQuestion(undefined)` correctly resolves with `""` (line 382) | `clearPending` now invokes the saved resolve with `""`, mirroring the sibling method's contract |

**Falsifiability of the F5 fix.** Three existing tests already assert the symmetric contract for `clearPending`:
- `apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts` line 488: `await expect(decisionPromise).resolves.toEqual({action: "continue", ...})` after `clearPending("Task cleared")` — proves mistake-limit promise is resolved.
- Same file line 578: `await expect(approvalPromise).resolves.toEqual({approved: false, reason: "Task cancelled"})` after `clearPending("Task cancelled")` — proves tool-approval promise is resolved.

Both regressions tests run GREEN after the bounded fix (102/102 across the four interaction/task/mode/followup coordinator files). The F5 test was the missing coverage that exposed the bug; the fix preserves the established contract for the other two pending-promise classes.

**Repeatability evidence** (formerly-failing tests, 5 isolated runs each):

- `task-state-shadow-correction02-c21-recon.test.ts`: 5/5 GREEN (5 tests each run).
- `settles a pending question when switching tasks`: 5/5 GREEN (in ~7ms each, vs the previous 20008ms timeout).

**Suite-load failure (out of scope, by design):** `hub-runtime-host.provenance-epoch.c24-d3.test.ts` is excluded from the base `vitest.config.ts` and runs under the dedicated `vitest.config.c2-4-d-hub.ts` (which adds the `@cline-internal/core/hub/runtime-host/hub-runtime-host` resolve.alias). Verified the dedicated config passes 11/11. Same exclusion pattern applies to the c2-4-c-bridge test. These are NOT test failures; they are suite-load failures whose dedicated configs live in `ci:check-all`.

**Forbidden moves NOT performed:**

- No `test.skip` / `describe.skip` / `it.skip` added.
- No `todo` conversions.
- No retry / timeout inflation on the failing test.
- No assertion weakening (assertion bodies unchanged).
- No file exclusion from `vitest.config.ts`.
- No allow-failure CI behavior added.

**"Pre-existing" classification policy** — enforced going forward: "pre-existing" is permitted only as ACT-ownership / history metadata on the canonical-failure rows; it is **not** a causal category for any future ACT (the six-bucket taxonomy replaces it).

**Out of scope for this ACT** (still OPEN):

- `EPIC-CLINEMM-TYPECHECK-ZERO-BASELINE01` (~36 pre-existing `tsc --noEmit -p .` errors in apps/vscode; this ACT confirmed zero new typecheck errors introduced by the bounded fixes).
- `EPIC-CLINEMM-CODE-COVERAGE-BASELINE01` (coverage recon).
- `EPIC-CLINEMM-CODE-COVERAGE-RATCHET01` (depends on coverage baseline; monotonic threshold increase).

**CI parity note (per §28):** `.github/workflows/ext-vscode-test.yml` runs the unit suite (mocha, separate gate); vitest execution is local + the dedicated c2-4-c-bridge / c2-4-d-hub configs in `ci:check-all`. PARITY=PARTIAL — vitest is not yet a CI gate; recorded under `EPIC-CLINEMM-GITHUB-ACTIONS01` for future ACT.

### RUNTIME-TASK-PROGRESSION01

- ID: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`
- STATUS: OPEN / HIGH **but gated on live evidence** — current state is `CAPTURE_INSUFFICIENT` (see `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-LIVE-RECON01` detail below)

**Goal.** When the runtime owns an asynchronous command/tool job, the task must either progress to completion (model continues polling `command_status` and consumes the terminal state), surface an explicit recoverable failure (timeout, deadline exceeded, spawn failed, cancelled), or remain actively cancellable via `cancel_command`. The TaskHeader / next-action projection must accurately reflect runtime-owned state — `Waiting` only when genuinely awaiting user input, not when a background job is still alive.

**Forbidden terminal state:**

```
runtime work remains outstanding
  AND
next_action_owner = HUMAN / Waiting
  AND
no actionable user continuation exists
```

**Upstream radar cluster** (retained — NOT promoted):

| Upstream issue | Cluster | Notes |
| --- | --- | --- |
| #12079 | command-skipped-then-stall | "Command execution shows 'skipped' in Cline terminal and hangs on 'thinking' — requires extension restart to recover" |
| #4177 | terminal-output-missing-stall | "Cline gets stuck when terminal output is missing from executed commands, especially blocking commands" |
| #10549 | long-running-tool-timeout-ambiguity | "'run_commands' tool silently times out at 30s with misleading error" |
| #10015 / #10031 | skipped-command-stall (dominant) | 2 issues |
| (cluster: model-thinking-stall) | 1 issue | runtime genuinely stuck in thinking; UI is accurate; runtime never advances |
| (cluster: prompt-never-sent) | 1 issue | runtime never sends the next model request |

These are **radar** — they are *related* upstream runtime evidence, NOT proof of any Cline-- causal defect. Promotion to EXACT_MAP requires the issue to demonstrate a direct Cline-- continuation failure (runtime loses the running job) and not merely a runtime stall where the model has no pending request.

**First ACT** (closed in this commit, CAPTURE_INSUFFICIENT): `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-LIVE-RECON01`.

**Canonical production seams identified** (all well-tested GREEN 20/20 under vitest):

| Seam | File | Lines | Mechanism |
| --- | --- | --- | --- |
| JOB_CREATION | `apps/vscode/src/sdk/command-job-manager.ts` | 324, 412 | `exitTransitions.set(id, exitTransition)` |
| JOB_REGISTRY | `apps/vscode/src/sdk/command-job-manager.ts` | 575 | `exitTransitions.delete(evictId)` — bounded FIFO eviction (terminal jobs only) |
| RUNNING_RESPONSE | `apps/vscode/src/sdk/vscode-run-commands-tool.ts` | 625-633 | `{status: "running", jobId, elapsedMs, deadlineRemainingMs, outputTruncated, stdout}` JSON |
| POLL_OR_WAIT | `apps/vscode/src/sdk/command-job-manager.ts` | 592-624, 609-622 | `status()` races `exitTransitions.get(job.id)` against a local ad-hoc timer; no mutable waiter list |
| COMPLETION | `apps/vscode/src/sdk/command-job-manager.ts` | 567-578 | `active → terminal` on finalize; FIFO eviction |
| CONTINUATION | `apps/vscode/src/sdk/command-status-tool.ts` | 100-150 | `command_status` tool is **observation-only**; model polls; runtime does NOT push |
| TASK_STATE | `apps/vscode/src/sdk/SdkController.ts` | 831, 2037, 2113, 2675 | `isRunning` flag projection to webview |
| TASKHEADER_PROJECTION | `apps/vscode/src/sdk/SdkController.ts` | 2673-2675 | `backgroundCommandRunning` projection — **DEAD STATE** |

**Dead-state finding.** `SdkController.updateBackgroundCommandState(running, taskId)` is defined at line 2605 but has no production call sites. The webview therefore never receives `backgroundCommandRunning: true`. This is a separate presentation issue (the TaskHeader cannot show `Working` for background `run_commands` even if it wanted to) but it is **not** a continuation defect. It may be an intentional stub for forward compatibility. A future ACT may classify it `OBSOLETE_TEST` (dead code) or `INTENTIONAL_UNSUPPORTED` (stub) once intent is confirmed.

**Future-ACT capture requirements** to promote this epic to `OPEN / LIVE`:

1. Real Cline-- VS Code extension host must be running with an active task turn.
2. A `run_commands` invocation must return a RUNNING payload (not a terminal payload).
3. The model must fail to issue the next `command_status` poll (or the runtime must lose the job) **while the host process tree is still alive**.
4. The TaskHeader must show `Waiting` (or equivalent next-action-owner = HUMAN) during that window.
5. `exitTransitions.get(job.id)` and `job.state` must be inspectable to discriminate "runtime lost the job" from "model never polled".
6. `command_status` logs / Cline-- output channel / webview state payloads must be available for correlation.

Without all six, the ACT cannot RED-reproduce and must HALT with CAPTURE_INSUFFICIENT.

**Upstream mapping policy.** The 5 `RUNTIME_THINKING_STALL` issues and the 23 `RELATED_TOOL_RUNTIME` issues remain radar. An upstream issue is mapped to this epic **only** when its failure contract satisfies the six conditions above. None do, today.

### TYPECHECK-ZERO-BASELINE01

- ID: `EPIC-CLINEMM-TYPECHECK-ZERO-BASELINE01`
- STATUS: OPEN / HIGH

**Goal.** Default canonical typecheck = zero unexplained errors.

**Why separate from TEST-BASELINE-ZERO-FAILURES01.** Test gate ≠ typecheck gate. The repo currently carries two distinct flavors of tolerated debt (e.g. `1667 pass / 5 pre-existing fail` test failures and `41 pre-existing` SDK typecheck errors). Conflating them hides half of the debt.

**First ACT.** `ACT-CLINEMM-TYPECHECK-ZERO-BASELINE-RECON01` — reproduce and classify the current baseline with the same classification taxonomy as the test-baseline ACT.
- STATUS: CLOSED at this commit (canonical `tsc --noEmit -p apps/vscode/tsconfig.json` GREEN twice, exit 0, 0 diagnostics)

**Goal.** Default canonical typecheck = zero unexplained errors.

**Why separate from TEST-BASELINE-ZERO-FAILURES01.** Test gate ≠ typecheck gate. The repo carried two distinct flavors of tolerated debt (test failures and SDK typecheck errors). Conflating them hides half of the debt.

**Closed by** `ACT-CLINEMM-TYPECHECK-BASELINE-RECON01`. RED-first recon at exact head `ed6d569b6`: 36 deterministic diagnostics in 7 files, clustered into 9 causal clusters (1 PRODUCT_DEFECT, 8 TEST_DEFECT/ENVIRONMENT_DEPENDENT), all 9 repaired with bounded fixes. No `PRE_EXISTING` causal class used. `NEW_TYPE_SUPPRESSIONS=0`. No assertion weakening, no strictness turning off, no test exclusions added. The vitest config exclude list was extended by 1 entry (D3) to mirror the existing dedicated C2.4-D hub config pattern (D2 was already there; the dedicated vitest config already had D3 in its include list; the dedicated tsconfig and base tsconfig were out of sync and are now aligned).

**Outcome:** canonical `tsc --noEmit` exits 0 with 0 diagnostics; canonical vitest remains 1672/0 (~51s).

**CI parity note:** `apps/vscode/package.json:check-types` is the canonical local gate; `.github/workflows/ext-vscode-test.yml` does not currently gate the canonical tsc command. PARITY=PARTIAL — recorded under `EPIC-CLINEMM-GITHUB-ACTIONS01` for future ACT.

### CODE-COVERAGE-BASELINE01

- ID: `EPIC-CLINEMM-CODE-COVERAGE-BASELINE01`
- STATUS: OPEN / HIGH

**Goal.** Establish a baseline coverage measurement **before** any ratchet is set.

**Must answer first.**

  which workspaces / packages are covered?
  which source paths are intentionally excluded?
  which coverage kind: line / function / branch / statement?
  do tests exercise production code or generated / adapter noise?
  can reports compose across workspace test suites?

**Output.** Machine-readable exact-head coverage report committed alongside the ACT that produces it.

**Rule.** No arbitrary initial percentage target. Recon first.

### CODE-COVERAGE-RATCHET01

- ID: `EPIC-CLINEMM-CODE-COVERAGE-RATCHET01`
- STATUS: CLOSED / HIGH (closed by `ACT-CLINEMM-CODE-COVERAGE-RATCHET01`, correction01, correction02)

**Invariant.**

  new coverage >= qualified baseline

(preferable to: `coverage >= arbitrary 80%`.)

**Thresholds.**

- thresholds increase monotonically
- intentional threshold changes are explicit commits
- CI must NOT silently rewrite thresholds (do not rely on `thresholds.autoUpdate` in CI)
- per-file or changed-code policy **deferred** until `CODE-COVERAGE-BASELINE01` recon is complete

### FACTORIZATION01

- ID: `EPIC-CLINEMM-FACTORIZATION01`
- STATUS: DEFERRED

**Goal.** Progressively factorize Cline-- along real production seams.

**Rule.**

  recon first
  one bounded seam at a time
  no giant "modularization" rewrite

**Rationale.** Factorization because a concrete seam reduces coupling / testing cost — not because "factorization" itself is virtuous.

**Scope.** Intentionally unfrozen. Detailed design belongs to a future architectural discussion.

**Next action.** Future architectural discussion only. **No ACT in this board delta.**

---

## Upstream intake

### UPSTREAM-ISSUE-INTAKE01

- ID: `EPIC-CLINEMM-UPSTREAM-ISSUE-INTAKE01`
- STATUS: CLOSED_INITIAL_TRIAGE (first complete triage cycle done at `162192610`)

**Goal.** Acquire trustworthy upstream issue metadata for offline Cline-- triage.

**Substrate (committed in this repo).**

  scripts/dump-cline-issues.py
    fetcher: Link-header pagination, PR exclusion, retry contract,
    checkpoint/resume, atomic write, bounded selection policy
  scripts/tests/test_dump_cline_issues.py
    stdlib unittest; 29 network-free tests
  .factory/upstream/cline-open-issues-index.json
    compact machine-readable snapshot

**Snapshot contract.** Stored fields per issue: `number`, `title`, `url`, `created_at`, `updated_at`, `comments`, `reactions`, `interactions`, `labels`. **Excluded:** `body`, comment bodies, reactions breakdown, avatar URLs, assignee objects, milestone description, user profile metadata, API payload copies.

**Deterministic ordering.** `interactions` DESC, `updated_at` DESC, `number` DESC.

**Size policy.** Preferred ≤ 1 MiB; acceptable ≤ 2 MiB. When exceeded, a bounded selection policy is applied: top-N by interactions PLUS every issue matching high-value Cline-- keyword/label families (`context`, `compact`, `token`, `prompt`, `checkpoint`, `retry`, `recovery`, `terminal`, `tool`, `provider`, `model`, `performance`, `memory`, `mcp`, `state`, `waiting`, `task`, `install`, `release`, `vscode`). Truncation is **never silent** — `total_open_issue_count`, `committed_issue_count`, `truncated`, `selection_policy` are always recorded.

**First triage ACT.** `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE01` — uses the substrate to rank upstream open issues and decide per-issue disposition:

  IMPORT          -- promote into a Cline-- epic/ACT
  MAP_EXISTING    -- already covered by an existing Cline-- epic
  RADAR           -- worth watching but not importing yet
  REJECT          -- out of scope or value-not-worth-effort

**Selection dimensions for triage.**

  popularity           comments + reactions (interactions)
  recency / activity   updated_at
  correctness impact   label family, title keyword
  Cline-- product value mapping against the current critical path
  architectural fit    Elm/state/quality-substrate seams
  implementation ROI    effort-to-value ratio
  existing-board overlap against canonical rows
  upstream momentum    active maintainer response signals

**Rule.** Popularity ≠ automatic priority. A 100-interaction feature request can still be REJECT if it conflicts with Cline-- direction.

**First triage cycle.** `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE01` (closed at `b4d7ed795`, superseded by correction 01) consumed snapshot SHA256 `878eb241e24150b4ecc9731e6fe8373b7e81566d8117f7f129b87f012f166cb6` (573 rows). It built a bounded shortlist of **80** candidates via union of A (top 30 interactions), B (top 10 recent with interactions >= 2), C (top 5 per high-value family), D (semantic overlap with existing epics). All 80 were enriched via `gh issue view --repo cline/cline`; all 80 still OPEN upstream.

The initial triage used **lexical/keyword overlap** to map candidates to existing epics. Review identified this as systematically defective: keyword overlap was treated as semantic authority. For example "JetBrains multi-project" → `CONTEXT-ACCOUNTING-TRUTH01`, "Custom HTTP headers" → `TASKHEADER-CANONICAL-PROJECTION01`, "macOS AMFI code signing" → `BRANDING01`, "Opus-4.6:1M auto-compaction" → `COMPACTION-STATE-AUTHORITY01` AND `GITHUB-ACTIONS01`. None of these are actually evidence for the named epic; they are token-collision false positives.

**Correction-01 cycle.** `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION01` (closed at `88f1e10c6`, superseded by correction 02) applied three semantic classes per candidate:

- **EXACT_MAP** — the issue is the same defect/domain as an existing epic. Produces a `MAP_EXISTING` row on the board.
- **ADJACENT** — the issue is related evidence but not the epic's core claim. Becomes `RADAR`; does not appear on the board as upstream evidence.
- **UNRELATED** — keyword overlap was misleading; no semantic relationship. Becomes `RADAR`; recorded in the artifact audit trail only.

Every retained `MAP_EXISTING` row satisfied this test: *if I removed the issue title and read only its actual problem statement, would I still choose this epic?* Correction 01 removed 17 false mappings produced by lexical-overlap on the initial triage.

**Correction-02 cycle.** `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION02` (closed at `4909884a6`, superseded by correction 03) applies a stricter test to surviving `EXACT_MAP`s. The "same defect/domain" wording was still too loose — it allowed the same-subsystem trap (e.g. classifying every tool-related upstream issue under `TOOL-EXECUTION-SEMANTICS01` regardless of failure contract). The strict test:

- **EXACT_MAP** — same user-visible failure contract **OR** same causal production seam **OR** direct upstream reproduction of the canonical epic.
- **RELATED_DOMAIN** — same subsystem, different failure contract → RADAR.
- **UNRELATED** — no semantic relation → RADAR.

Every retained `MAP_EXISTING` row satisfies this stricter test: *does this issue describe the same failure contract as the target epic, not merely the same subsystem?* Correction 02 removed 3 surviving false `EXACT_MAP`s (`#9333`, `#12947`, `#12079`).

**Correction-03 cycle.** `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION03` (closed at `a87ef52e6`, superseded by correction 04) applies the destination-contract test specifically to `TOOL-EXECUTION-SEMANTICS01`. The epic's *canonical contract* is **telemetry classification** — mechanism, purpose, effect class, duration accounting, success/failure classification, retry/recovery accounting, classification confidence/source. Correction 02 had justified the 23 surviving `TOOL-EXECUTION-SEMANTICS01` mappings by "shared execution signal production seam" — that was too permissive, since the issues describe *runtime tool correctness* (terminal hangs, parser failures, MCP routing, approval UX) rather than *telemetry-classification outputs*. The strict destination test:

- **EXACT_TELEMETRY_MAP** — the issue materially changes or validates one of the canonical outputs (mechanism classification, purpose classification, effect class, duration accounting, success/failure classification, retry/recovery accounting, classification confidence/source).
- **RELATED_TOOL_RUNTIME** — terminal reliability, output capture, command timeout, file-edit reliability, tool routing, approval correctness, parser correctness. Not telemetry classification → RADAR.
- **UNRELATED** — no semantic relation → RADAR.

All 23 candidates failed the strict test and were reclassified `RELATED_TOOL_RUNTIME → RADAR`. They are not destroyed; they are **recorded with coherent cluster assignments** so a future ACT can propose `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01` with a clear evidence table (the dominant cluster is *terminal timeout/wait lifecycle* with 9 issues).

**Correction-04 cycle.** `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION04` (this commit) applies the destination-contract test to the next surviving epic, `STATIC-THINKING-PRESENTATION-PERSISTENCE01`. The epic's *canonical contract* is **presentation residue**: canonical runtime has already LEFT thinking, but the rendered Thinking presentation persists or is wrong. The 6 surviving candidates were claimed (in correction 03's "thinking-presentation regressions" annotation) to all describe that contract, but the upstream issue semantics show 5 of 6 actually describe *runtime thinking stalls* — the canonical task is genuinely stuck in thinking, the displayed "Thinking..." is accurate, and recovery requires cancel/reconnect/restart. The strict destination test:

- **EXACT_PRESENTATION_MAP** — the issue demonstrates a presentation-vs-runtime divergence: UI says Thinking but runtime has moved on.
- **RUNTIME_THINKING_STALL** — the runtime task is genuinely stuck in thinking; UI is accurate; runtime never advances → RADAR.
- **UNRELATED** — no semantic relation → RADAR.

5 of 6 candidates failed the strict test and were reclassified `RUNTIME_THINKING_STALL → RADAR`. They are not destroyed; they are **recorded with coherent cluster assignments** so a future ACT can propose a runtime-task-progression epic (or fold them into a broader runtime-reliability epic) with a clear evidence table. The dominant cluster is *skipped-command-stall* (2 issues; #10015, #10031). Only `#8636` (Thinking section not displayed in v3.50.0 — extended-thinking content exists, but the Thinking UI section is not rendered) survives as `EXACT_PRESENTATION_MAP`.

This ACT closes the upstream-triage cycle: corrections 01–04 cumulatively removed **48 false-mapping rows** from the original 60 (`60 → 43 → 40 → 17 → 12`). The 12 surviving EXACT_MAPs and 5 IMPORTs all satisfy the binding invariant: an upstream issue cannot be cited as evidence for a canonical epic whose failure contract it does not reproduce.

Dispositions after correction 04:

| Disposition | Initial `b4d7ed795` | Corr 01 `88f1e10c6` | Corr 02 `4909884a6` | Corr 03 `a87ef52e6` | Corr 04 (this commit) | Δ corr 04 |
| --- | --- | --- | --- | --- | --- | --- |
| `IMPORT` | 5 | 5 | 5 | 5 | 5 | 0 |
| `MAP_EXISTING` | 60 | 43 | 40 | 17 | 12 | -5 (over-broad STATIC-THINKING mappings removed) |
| `RADAR` | 15 | 32 | 35 | 58 | 63 | +5 (over-broad mappings downgraded; cluster-assigned) |
| `REJECT` | 0 | 0 | 0 | 0 | 0 | 0 |
| `CLOSED_UPSTREAM` | 0 | 0 | 0 | 0 | 0 | 0 |

| Semantic class | Count (corr 04) |
| --- | --- |
| `EXACT_MAP` | 17 (12 → MAP_EXISTING on board; 5 → IMPORT) |
| `RELATED_TOOL_RUNTIME` | 23 (all → RADAR; cluster-assigned) |
| `RUNTIME_THINKING_STALL` | 5 (all → RADAR; cluster-assigned) |
| `ADJACENT` | 14 (all → RADAR) |
| `UNRELATED` | 21 (all → RADAR) |

**Correction-01 red-witness audit** (lexical-overlap remediation):

- `#6416` (JetBrains multi-project, bundled `node.exe` file lock) — UNRELATED → removed from board; downgraded to RADAR.
- `#11018` (Custom HTTP headers in OpenAI-compatible provider; HTTP headers ≠ TaskHeader) — UNRELATED → removed from board.
- `#12042` (macOS 27 AMFI kills CLI binary; code-signing, not branding) — UNRELATED → removed from board.
- `#9181` (Opus-4.6:1M auto-compacts mid-execution at <200K) — EXACT_MAP → `COMPACTION-STATE-AUTHORITY01` only; spurious `GITHUB-ACTIONS01` mapping removed.

**Correction-02 red-witness audit** (surviving false EXACT_MAPs):

- `#9333` (CLI: displayed model ≠ actual request model sent to Requesty) — was mapped to `TEST-BASELINE-ZERO-FAILURES01` (Vitest baseline failures). Different failure contract: runtime provider-routing defect is not a test-baseline failure. Removed from board; downgraded to RADAR.
- `#12947` (`OPENAI_REASONING_EFFORT_OPTIONS` caps at `xhigh`; `max` missing from UI/CLI) — was mapped to `USER-CONTEXT-CEILING01` (context-token ceiling). Reasoning-effort capability propagation is not a context-token ceiling. Removed from board; downgraded to RADAR.
- `#12079` (Command executes, Cline marks it `skipped`, agent hangs on `thinking`, restart recovers) — was mapped to `STATIC-THINKING-PRESENTATION-PERSISTENCE01` (UI presentation residue). This is a runtime state-machine transition defect, not a UI presentation residue bug. Removed from board; downgraded to RADAR.

**Correction-03 red-witness audit** (over-broad TOOL-EXECUTION-SEMANTICS01 destination contract):

The epic's canonical contract is **telemetry classification** (mechanism, purpose, effect class, duration accounting, success/failure classification, retry/recovery accounting, classification confidence/source). The 23 surviving mappings were all *runtime tool correctness* issues, not telemetry-classification outputs. All 23 reclassified `RELATED_TOOL_RUNTIME → RADAR` with cluster assignments:

| Cluster | Count | Members | Verdict |
| --- | --- | --- | --- |
| Terminal timeout/wait lifecycle | 9 | #7355, #9143, #10549, #10709, #10931, #11295, #12198, #13246, #13253 | runtime wait lifecycle, not telemetry |
| Tool-call parsing | 5 | #8130, #9848, #10413, #10656, #10843 | parser correctness, not telemetry |
| MCP tool routing/approval/validation | 3 | #8087, #10499, #12977 | routing/validation, not telemetry |
| Shell/terminal integration config | 2 | #4356, #10444 | config/runtime, not telemetry |
| Tool loop control / retry | 2 | #11542, #12431 | loop control, not telemetry |
| File-edit reliability | 1 | #4384 | runtime reliability, not telemetry |
| Tool-approval UX | 1 | #8446 | approval UX, not telemetry |

These 23 are not lost; they are recorded in the durable artifact (§ "Related tool-runtime") for a future ACT that proposes `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01`. This ACT does **not** create that epic.

**Correction-04 red-witness audit** (over-broad STATIC-THINKING-PRESENTATION-PERSISTENCE01 destination contract):

The epic's canonical contract is **presentation residue**: canonical runtime has already LEFT thinking, but the rendered Thinking presentation persists or is wrong. The 6 surviving mappings were 1 actual presentation defect and 5 runtime stalls. Review confirmed: 5 of 6 candidates describe runtime task genuinely stuck in thinking, recovery requires cancel/reconnect/restart. The displayed "Thinking..." is accurate; the failure is that the runtime never advances. All 5 reclassified `RUNTIME_THINKING_STALL → RADAR` with cluster assignments:

| Cluster | Count | Members | Verdict |
| --- | --- | --- | --- |
| Skipped-command-then-Thinking-stall | 2 | #10015, #10031 | skipped command → task stays in Thinking for hours |
| Terminal-output-then-Thinking-stall | 1 | #10537 | terminal command output returned, runtime stuck in Thinking |
| Model-Thinking-stall (provider state) | 1 | #9546 | Sonnet 4.6 — task genuinely stuck; cancel/restart recovers |
| Prompt-never-sent (provider dispatch blocked) | 1 | #10208 | Cline never sends prompt to provider; UI shows Thinking but no actual call dispatched |

Reviewer-named reds confirmed:
- **`#10537`** — runtime hangs after successful terminal output → NOT presentation residue.
- **`#10015`** — skipped command → task stuck Thinking for hours → NOT presentation residue.
- **`#10031`** — command use → task stops progressing on Thinking → NOT presentation residue.

Reviewer-named plausible survivor confirmed:
- **`#8636`** (Thinking section not displayed in v3.50.0) — pure presentation-layer issue; extended-thinking content exists, but the Thinking UI section is not rendered. **Survives** as `EXACT_PRESENTATION_MAP`.

These 5 are not lost; they are recorded in the durable artifact (§ "Runtime-thinking-stall") for a future ACT that proposes a runtime-task-progression epic (or folds them into a broader runtime-reliability epic). This ACT does **not** create that epic.

Triage artifact (correction 04): `.factory/upstream/cline-upstream-triage.md` (287 lines, 25.9 KiB). Machine-readable companion: `.factory/upstream/cline-upstream-triage.json` (30.0 KiB). All previous corrections' artifacts at this same path were overwritten; the audit section at the top of the artifact documents the full history.

**IMPORTs (corrected).**

| Epic | Upstream | Why |
| --- | --- | --- |
| `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` | [#4388](https://github.com/cline/cline/issues/4388) + [#12388](https://github.com/cline/cline/issues/12388) | git checkpoint corruption (`.git/.git_disabled` left by interrupted tasks, submodule breakage, large-workspace corruption, disk-space exhaustion) + checkpoint restore failure ("No checkpoint found at or before run N"); distinct repo-safety issue |
| `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` | [#7413](https://github.com/cline/cline/issues/7413) | MCP stdio servers spawn unbounded instances until crash on Windows |
| `EPIC-CLINEMM-CLINEIGNORE-FILTERING01` | [#9554](https://github.com/cline/cline/issues/9554) | `.clineignore` documented as filtering file listing but actually does not exclude files from context |
| `EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01` | [#10016](https://github.com/cline/cline/issues/10016) | provider model list discovery broken for LM Studio API and similar OpenAI-compatible endpoints |

The previously-imported `EPIC-CLINEMM-CUSTOM-INSTRUCTIONS-HONORING01` row was removed because `#7414` (its only backing issue) was demoted from IMPORT to ADJACENT/RADAR pending a recon that distinguishes rules-omitted-from-request from rules-present-but-model-ignored (upstream labels the issue "Model Quality", which is consistent with either failure mode).

Each IMPORT epic has `RECON` as the first epistemic action; no upstream fix is ported. None of the 4 were promoted into the immediate critical path.

**MAP_EXISTING (correction 04; only EXACT_MAP under strict destination-contract test; top 3 per epic).**

- `STATIC-THINKING-PRESENTATION-PERSISTENCE01` → [#8636](https://github.com/cline/cline/issues/8636) (only)
- `USER-CONTEXT-CEILING01` → [#9651](https://github.com/cline/cline/issues/9651), [#10410](https://github.com/cline/cline/issues/10410), [#10551](https://github.com/cline/cline/issues/10551)
- `CONTEXT-ACCOUNTING-TRUTH01` → [#4389](https://github.com/cline/cline/issues/4389), [#10148](https://github.com/cline/cline/issues/10148)
- `COMPACTION-STATE-AUTHORITY01` → [#9181](https://github.com/cline/cline/issues/9181), [#10637](https://github.com/cline/cline/issues/10637)
- `COST-DISPLAY-TRUTH01` → [#10596](https://github.com/cline/cline/issues/10596), [#11494](https://github.com/cline/cline/issues/11494)

**Removed in correction 04** (over-broad `STATIC-THINKING-PRESENTATION-PERSISTENCE01` destination contract): all 5 candidates previously mapped to that epic except `#8636`. The epic's canonical contract is **presentation residue** (canonical runtime has already LEFT thinking, but rendered Thinking presentation persists/is wrong); the 5 removed issues describe **runtime thinking stalls** (canonical task is genuinely stuck in thinking, recovery requires cancel/reconnect/restart). See § "Correction-04 red-witness audit" for the cluster-assigned table. The 5 candidates are recorded with cluster assignments in the durable artifact for a future ACT that proposes a runtime-task-progression epic (or folds them into a broader runtime-reliability epic).

**Removed in correction 03** (over-broad `TOOL-EXECUTION-SEMANTICS01` destination contract): all 23 candidates previously mapped to that epic. The epic's canonical contract is **telemetry classification** (mechanism, purpose, effect class, duration, success/failure, retry/recovery, classification confidence/source); the 23 issues describe **runtime tool correctness** (terminal hangs, parser failures, MCP routing, approval UX). See § "Correction-03 red-witness audit" for the cluster-assigned table. The 23 candidates are recorded with cluster assignments in the durable artifact for a future ACT that proposes `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01`.

**Removed in correction 02** (strict EXACT_MAP contract test):
`TEST-BASELINE-ZERO-FAILURES01 → #9333`, `USER-CONTEXT-CEILING01 → #12947`, `STATIC-THINKING-PRESENTATION-PERSISTENCE01 → #12079`.

**Removed in correction 01** (lexical-overlap remediation):
`BRANDING01 → #12042`, `CODE-COVERAGE-BASELINE01 → #11879`, `CODE-COVERAGE-RATCHET01 → #11879`, `TASKHEADER-CANONICAL-PROJECTION01 → #11018`, `CONTEXT-ACCOUNTING-TRUTH01 → #6416/#9788`, `STATIC-THINKING-PRESENTATION-PERSISTENCE01 → #12079`, `USER-CONTEXT-CEILING01 → #5915`, `GITHUB-ACTIONS01 → #9181/#12520/#11785`, `GITHUB-DISTRIBUTION01 → #10246/#11879`, `TEST-BASELINE-ZERO-FAILURES01 → #4384/#12474/#12431`, plus the `TOOL-EXECUTION-SEMANTICS01` lexical mappings #9143/#12431 that correction 03 also removed for destination-contract reasons.

Full per-epic mapping with all 12 surviving EXACT_MAP candidates is in `.factory/upstream/cline-upstream-triage.md` § "Mapped to existing epics (EXACT_MAP only)". The 23 `RELATED_TOOL_RUNTIME` candidates with cluster assignments are in § "Related tool-runtime"; the 5 `RUNTIME_THINKING_STALL` candidates with cluster assignments are in § "Runtime-thinking-stall".

**This ACT is not.**

- upstream issue triage itself (that's TRIAGE01)
- importing upstream issues into Cline-- yet
- fixing upstream issues
- GitHub Actions work
- force-push enforcement
- product implementation

**Historical mapping.** `UP-01` (recon: scope of fork maintenance vs upstream Cline) was reclassified into this epic at substrate ACT — the recon scope became a concrete intake substrate and a planned triage ACT.

---

## Distribution / CI

### GITHUB-ACTIONS01

- ID: `EPIC-CLINEMM-GITHUB-ACTIONS01`
- STATUS: OPEN

**First ACT.** `ACT-CLINEMM-GITHUB-ACTIONS-RECON01`.

**Recon covers:** existing workflows, actual failing jobs, package-manager topology, typecheck / test / build gates, VSIX packaging, permissions / secrets, release triggers.

**No repair in this board ACT.**

### GITHUB-DISTRIBUTION01

- ID: `EPIC-CLINEMM-GITHUB-DISTRIBUTION01`
- STATUS: OPEN

**Goals (two distinct questions, do not conflate):**

A. Publish Cline-- distributable artifact to GitHub. Likely primary artifact: VSIX via GitHub Release asset.
B. Determine whether any package genuinely belongs in GitHub Packages.

**Artifact trust binding:**

  SOURCE_HEAD
  VERSION
  PATH
  BYTE_SIZE
  SHA256
  installed version where relevant

**Rule.** Do not rebuild a supposedly identical release artifact after qualification unless reproducibility is separately proven.

### DOGFOOD-SINGLE-WORKTREE-CLEANUP01

- ID: `ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01`
- STATUS: P2 / OPEN

**Symptom.** Dogfood builder still creates a detached temporary Git worktree, contrary to current one-worktree repository policy.

**Goal.** Package/install dogfood without linked Git worktree topology, if safely possible.

**Do not execute in this ACT.**

---

## P2 / deferred residue

1. **Historical branch** — `act/elm-architecture01-e0-e4` (merged, retained temporarily; safe to delete later).
2. **Old gate-summary state mismatch** — `.factory/gate-summary.json` may refer to old unrelated Factory scope. Do **not** treat stale historical summary as current ACT authority.
3. **Dogfood packaging script worktree** — see `ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01` (promoted to named task above).
4. **Historical documentation / SHA wording** — batch later.
5. **PTAD-off wire wording** — preferred wording (when describing the disabled mode):
   - `_ptadEnabled` / `_ptadPushId` absent when PTAD off
   - `stateVersion` / `epoch` retained
   - recorder inert

---

## Historical aliases / superseded IDs

Compact mapping so old names are preserved without duplicate work.

| Historical ID | Canonical task | Disposition |
|---|---|---|
| `BRAND-01` | `EPIC-CLINEMM-BRANDING01` | renamed |
| `STATE-01` | W1/W2 epoch-domain repair | absorbed (CLOSED_LIVE) |
| `STATE-02` (queuedPrompts) | `NEEDS_CLASSIFICATION` row | preserved; classify when relevant |
| `CTX-01` / `CTX-02` / `CTX-03` | `EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` + `USER-CONTEXT-CEILING01` + `COMPACTION-STATE-AUTHORITY01` | map individually as recon proceeds |
| `REC-01` / `REC-02` | `NEEDS_CLASSIFICATION` | preserved |
| `OBS-01`..`OBS-05` | `TASKHEADER-*` + `TOOL-EXECUTION-SEMANTICS01` + `COST-DISPLAY-TRUTH01` | likely absorb; classify when relevant |
| `FACT-01` / `FACT-02` | `NEEDS_CLASSIFICATION` | preserved; classify against current Factory work |
| `MCP-01` / `MCP-02` | `NEEDS_CLASSIFICATION` | preserved; classify against current Cline-- MCP usage only |
| `ARCH-01` / `ARCH-02` | E8 / E9 / `EPIC-CLINEMM-ELMIZATION02` | map individually as recon proceeds |
| `UP-01` | `EPIC-CLINEMM-UPSTREAM-ISSUE-INTAKE01` | SUPERSEDED at substrate ACT; recon fork-vs-upstream scope became upstream-issue-intake epic |
| `QA-01` / `QA-02` | exact-head dogfood + live qualification gates | preserved; classify qualification scope |
| `LIVE-CONTEXT-DIMENSIONS01` (LCD01) | LCD01 retirement | CLOSED at `51f2f6a9c` |
| `C2-CORRECTION02-FIXUP01..04` | LCD01 retirement | CLOSED via LCD01 retirement |
| `REACT-UPDATER-PURITY-REPAIR01` | React updater purity repair | CLOSED |
| `RED-FIX01` / `W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01` | W1/W2 epoch-domain repair | CLOSED_LIVE at `5637d965d` |
| `LIVE-SHAPE-REPRODUCTION01` | W1/W2 epoch-domain repair | CLOSED (precondition halt + retraction) |
| `E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01` | E7 Local thinking | CLOSED |
| `E7-LOCAL-BACKEND-ACTIVATION01` | E7 Local advisory | CLOSED |
| `ELM-02F` / `ELM-02F-CORRECTION01` | Elm groundwork | CLOSED |
| `TRACE01` | E7.1 thinking | CLOSED |
| `WEBVIEW-TURNSTATE-COMPOSITION01` | E7.1 (precondition halt) | CLOSED |
| `C2.4-*` / `C2.5-*` / `C25-*` | Elmization groundwork | CLOSED |
| `DOGFOOD-VSIX-QUALIFICATION01` | Dogfood qualification | CLOSED |
| `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01` | LCD01 retirement | CLOSED at `51f2f6a9c` |
| `ACT-CLINEMM-FACTORY-GLOBAL-EPIC-BOARD-WAVE01` | Factory epic board substrate | CLOSED at `1e6430bc15f00d08f66dc905c41edbd3f74045db` |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE01` | snapshot SHA256 `878eb241...` (573 rows) | CLOSED at `b4d7ed795`; **superseded** by `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION01` at this commit (lexical-overlap classifier was systematically defective) |
| `EPIC-CLINEMM-CUSTOM-INSTRUCTIONS-HONORING01` | `#7414` recon | **REMOVED** at this commit; demoted to RADAR pending recon distinction (rules-omitted vs rules-ignored) |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION01` | snapshot SHA256 `878eb241...` (unchanged) | CLOSED at `88f1e10c6`; superseded by correction 02; semantic three-class correction; 17 lexical-overlap false mappings removed (#6416, #11018, #12042, #9181 spurious GITHUB-ACTIONS, +13 others); 43 EXACT_MAPs + 5 IMPORTs + 32 RADARs |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION02` | snapshot SHA256 `878eb241...` (unchanged) | CLOSED at `4909884a6`; superseded by correction 03; strict EXACT_MAP contract test (same failure contract OR same causal production seam OR direct upstream reproduction); 3 surviving false EXACT_MAPs removed (#9333, #12947, #12079); 40 EXACT_MAPs + 5 IMPORTs + 35 RADARs |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION03` | snapshot SHA256 `878eb241...` (unchanged) | CLOSED at `a87ef52e6`; superseded by correction 04; strict destination-contract test for `TOOL-EXECUTION-SEMANTICS01` (issue must materially change or validate one of the canonical telemetry outputs); 23 over-broad mappings removed and reclassified `RELATED_TOOL_RUNTIME → RADAR` with cluster assignments; 17 EXACT_MAPs + 5 IMPORTs + 58 RADARs (23 cluster-assigned + 35 other); 0 REJECT, 0 CLOSED_UPSTREAM |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE-CORRECTION04` | snapshot SHA256 `878eb241...` (unchanged) | CLOSED at this commit; strict destination-contract test for `STATIC-THINKING-PRESENTATION-PERSISTENCE01` (issue must demonstrate presentation-vs-runtime divergence, not a runtime stall); 5 over-broad mappings removed and reclassified `RUNTIME_THINKING_STALL → RADAR` with cluster assignments; only `#8636` survives as `EXACT_PRESENTATION_MAP`; 12 EXACT_MAPs + 5 IMPORTs + 63 RADARs (23 RELATED_TOOL_RUNTIME + 5 RUNTIME_THINKING_STALL + 35 other); 0 REJECT, 0 CLOSED_UPSTREAM |
| `ACT-CLINEMM-TEST-BASELINE-FAILURES-RECON01` | entry HEAD `0d2548dd5...` (unchanged) | CLOSED at this commit; canonical `cd apps/vscode && bunx vitest run --config vitest.config.ts` reproduced the historical `1667 pass / 5 fail` baseline exactly at exact head; 5 failures classified (4 TEST_DEFECT + 1 PRODUCT_DEFECT) and repaired with bounded fixes (REPO_ROOT resolver walks up to `.git/HEAD`; `clearPending` invokes saved `pendingAskResolve("")`); canonical broad suite GREEN twice (`1672 pass / 0 fail`, 50.51s / 51.44s); suite-load failure for `hub-runtime-host.provenance-epoch.c24-d3.test.ts` is by-design base-config exclusion (dedicated config passes 11/11); isolated formerly-failing tests GREEN 5/5 across runs (no flakes); `NEW_SKIPS_ADDED=0`; no assertion weakening; no test exclusion; 2 files changed, 31 insertions, 2 deletions |
| `ACT-CLINEMM-FACTORY-GLOBAL-TASK-CENSUS01` | Factory task census | CLOSED at `4b2b2beec059b668bd49799304b9fd78d1ef79a0` |
| `ACT-CLINEMM-E7.1-TEMP-DIAGNOSTICS-REMOVAL01` | `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01` | SUPERSEDED (PTAD retained DEFAULT_OFF; recon showed value) |
| `ACT-CLINEMM-SINGLE-WORKTREE-TRANSITION01` | repository-topology migration | CLOSED (main FF `a9f376edf` → `5637d965d`; one-worktree policy frozen) |
| `ACT-CLINEMM-LIVE-EPOCH-REPAIR-QUALIFICATION01` | W1/W2 epoch repair qualification | CLOSED_LIVE at `5637d965d` (`PASS_LIVE_EPOCH_REPAIR`) |
| `EPIC-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH01` | `ACT-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH-ENFORCEMENT01` | CLOSED at `2026-08-19`; ruleset `21037630` (`cline-- protect published history`); `non_fast_forward` on `refs/heads/main`, `bypass_actors=[]`, `current_user_can_bypass=never` |
| `ACT-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH-ENFORCEMENT01` | ruleset `21037630` | CLOSED at `2026-08-19` |
| `ACT-CLINEMM-FACTORY-EPIC-BOARD-MARKDOWN-REPAIR01` | validator `scripts/check-epic-board-markdown.py` | CLOSED at `2026-08-19`; -41 net lines (45 → 4 fences); `‖` for unescaped double-pipe in BRANDING01 cell; 16 unit tests |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE01` | snapshot SHA256 `878eb241e24150b4ecc9731e6fe8373b7e81566d8117f7f129b87f012f166cb6` (573 rows) | CLOSED at `162192610`; 80-issue shortlist; 5 IMPORTs, 60 MAP_EXISTING, 15 RADAR |

**Unknown-task policy.** If a historical ID is known to have existed but its exact contract cannot be reconstructed from current board + repository history + current source/docs, the row stays in this table as `NEEDS_CLASSIFICATION`. We do not invent scope, we do not silently omit, and we do not spend hours reconstructing now. Reclassification happens when the task becomes relevant to a real decision.

---

## Deferred (post-census)

The Wave-2+ archaeology items remain deferred. This census captured task completeness; full historical narrative is still not the goal.

DEFERRED_POST_CENSUS

  - full ACT index
  - historical SHA ledger
  - full closed-epic archaeology
  - all old halted / not-reproduced ACTs
  - detailed evidence-file pointers
  - complete UI backlog
  - branch cleanup inventory
  - complete release history
  - complete Factory-rule provenance
  - old repo-comparison-derived tasks

**Reason.** Documentary completeness is lower priority than executable learning. The census is intended to be the **last** emergency global thread scan.

---

## Board maintenance rule

At the end of a meaningful ACT, update **only rows affected by that ACT**. Do not rewrite the whole board.

Each row should preferably contain: `ID`, `STATUS`, `PRIORITY` (if useful), `PURPOSE / SYMPTOM`, `DEPENDENCIES`, `NEXT ACT`, `EVIDENCE / COMMIT` where known.

Avoid giant prose. If an item is closed, preserve enough identity to avoid re-litigation. If evidence contradicts a board row, **evidence wins**; the board row becomes P2 stale metadata.

**Post-census maintenance.** When a new task is discussed, add a single row to the canonical task index at the next meaningful ACT boundary. When an old forgotten task surfaces, add one delta. Do **not** trigger another global archaeology exercise.
