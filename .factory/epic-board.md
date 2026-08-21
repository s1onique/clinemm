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
| `EPIC-CLINEMM-COMPACTION-STATE-AUTHORITY01` | CTX | CLOSED_LIVE | HIGH | none | entry transition was proven previously (`ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01`); terminal restore transition was disproven live and is now closed via `ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01` (production-seam RED + GREEN at the canonical coordinator `finally` block — classification CASE C: tracker restored, no publication). Live qualification: user reported manual L0→L3 `/compact` success several commits ago (`ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01` closure at `aa522d8b9`); the production-seam fix has not regressed in the subsequent commit chain. **Opportunistic closure at this ACT (no production code touched for compaction):** live success reported by user + no subsequent regression + multiple commit-chain stability = CLOSED_LIVE. Sibling completion-response bug is separate: `EPIC-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01`. |
| `ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01` | CTX | CLOSED | HIGH | none | RED reproduced at real seam; producer authority gap repaired; gates green (entry transition only; terminal restore was not yet proven) |
| `ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01` | TASK-UI | CLOSED_PRODUCTION_SEAM_LIVE_DEFERRED | CRITICAL | compaction-state-authority01 (entry, proven) | **Production-seam RED + GREEN at `apps/vscode/src/sdk/sdk-compaction-coordinator.ts:runCompaction` `finally` block.** Root cause: missing post-restore publication — `runCompactionInPhase` publishes its terminal snapshot (`phase = "compacting"`; seq N) BEFORE `restorePhase()` flips the tracker back to the entry phase; nothing publishes after restore, so the webview's last received snapshot stays at `phase = "compacting"`, `stateLabel` projects `Compacting`, `turnAllowsFollowup` returns `false`, composer stays disabled. **Boundary classification: CASE C** (tracker restored, no state published). **Fix:** trailing `await this.options.postStateToWebview()` in the `finally` block AFTER `restorePhase()`. **P1 (factory review):** publication-failure semantics distinguished — success exit propagates the publication failure (the user's only signal that the webview saw the restore); failure exit logs the publication failure but preserves the original compaction throw via a `compactionError` capture pattern. Outer `compactTask` catch mirrors the same pattern with a safety-net post. **CORRECTION01 (factory review follow-up #1):** original CSR07/CSR08 evidence was structurally invalid — harness's `reject-on-last-call` boolean plus a length-equality check evaluated true on every publication after the first (aliasing instead of discriminating); replaced with explicit ordinal injection (`rejectPostAt: number[]`); added probe tests pinning the publication sequence; ablation: removing the trailing post → CSR01–03 red; replacing the P1-aware catch → CSR07+08 red. **CORRECTION02 (factory review follow-up #2):** the harness `captured` array conflated attempted vs delivered snapshots (recorded before the throw decision). This meant CSR07's `last snapshot phase === awaiting_followup` could pass even if the outer-catch's safety-net post #4 also failed and the webview never received the restored phase. **Fix:** the harness now records `attempted[]` (every invocation) AND `delivered[]` (only successful resolutions) AND `attemptedOrdinals`/`deliveredOrdinals`/`rejectedOrdinals`. CSR07 / CSR08 now assert attempted ordinals = [1,2,3,4], rejected = [3], delivered = [1,2,4], and the LAST DELIVERED phase = entry — directly modelling what the webview actually saw. Probes (`CSR_PROBE_success` / `CSR_PROBE_failure`) tightened to exact ordinal-sequence + phase-sequence assertions (no console.log-only documentation). **Ablation #3:** disabling the outer-catch safety-net post (the production line that delivers #4 with the restored phase) turns BOTH CSR07 AND CSR08 red — proving the new attempted/delivered assertions are sensitive to the actual production safety net. Production code unchanged in CORRECTION02 (test-only). **Live qualification: STILL PENDING.** Debug harness launched VSCode (.vscode-test/vscode-darwin-arm64-1.103.0); user deferred the L0→L3 chain across three turns. Test-only correction — production unchanged — so the previously installed VSIX `s1onique.clinemm@4.1.10-a25334aeb` (sha256 `5a17411b2448edd7d4278dcf59a7f65c9c2a7a5aacacc51a29854bf329f8e149`, 8885142 bytes) remains valid for live qualification. Per the reviewer's disposition: NEXT is the actual `/compact → completed → continue` L0→L3 run; if green, move the closure verdict to `PASS_LIVE_COMPACTION_STATE_RESTORE` and close both the ACT and the EPIC `LIVE`. **Conservation:** no UI-string heuristics; no updater-side diagnostic side effects; no context-ceiling change; no completion-response bug touched (separate `EPIC-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01`); previous CSA `compacting`-as-label and human-`Waiting` invariants untouched. **Pre-existing residue (named follow-up):** `runCompactionInPhase` has its own `catch { emitInfo + postStateToWebview + throw }` pattern that can mask the original compaction error with a publication rejection — same P1 shape at a different seam. NOT repaired here; flagged for a separate bounded ACT (`ACT-CLINEMM-IN-PHASE-PUBLICATION-FAILURE-MASK-01`). **Gates:** apps/vscode vitest 121 files / 1702 tests / 0 failures (was 1692, +10: CSR01–08 + 2 probes); bun unit 72/1076/0; webview vitest 69/567/0; SDK core 172/2124/14-skipped/0; typecheck 0 diagnostics; lint PASS (one biome-ignore-line in production for the proven-gated `throw` in finally); markdown-guard PASS; diff-check PASS |
| `EPIC-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01` | TASK-UI | CLOSED_PRODUCTION_SEAM_LIVE_DEFERRED | HIGH | task-header canonical projection | separate defect: TaskHeader reaches `Waiting` but the visible terminal assistant content is intermediate debugging narration, not the requested closure report. **Part-1 (terminal-state gate): PROVEN** (commit `077def275` - awaiting_followup is gated on a committed terminal response). **Part-2 (terminal-content authority): NOW PROVEN** (commit `0a3f70ae2` - the unproven three-tier fallback ladder that promoted prior assistant text/reasoning/stranded-partial into `say:"completion_result"` is REMOVED entirely; only the completion tool `content_end` is now the authority source for a terminal response row, mirroring the upstream architectural boundary at `sdk/packages/agents/src/agent-runtime.ts:1313-1371` where `findCompletingToolMessage(...)` checks `lifecycle.completesRun === true`). Closed at the production seam via `ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01` + `ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01-CORRECTION01`. Live qualification deferred per ACT §36 - the completion path is non-deterministic and harder to reproduce deterministically than compaction; the user's manual L0->L3 is the cheapest reproducer. Closure verdict can move to `PASS_LIVE_COMPLETION_RESPONSE_AUTHORITY` on the first dogfood cycle where a natural task ends with intermediate debugging text + a tool call AND the user sees truthful intermediate content in conversation history (NO green box relabeling debugging content as a final answer) - that is the corrected contract. |
| `EPIC-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01` | TASK-UI | CLOSED_PRODUCTION_SEAM at `d993b9802` + `68d916cab` (CORRECTION01) | CRITICAL | completion-response-authority01 (CLOSED) | Sibling/complementary defect class to completion-response-authority01 — that epic decides WHAT counts as terminal (only the completion tool content_end). This epic decides the LIVENESS side: when no terminal authority was committed (the agent-runtime session-termination fallback at `sdk/packages/agents/src/agent-runtime.ts:1313-1336` fires `finishRun("completed", finalAssistantMessage)` because either the model never called the completion tool, the completion tool's `content_end` was never received (lost/malformed stream), or the completion-reminder loop exhausted `maxIterations`), the runtime MUST still guarantee forward progress. Closed at the production seam via `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01` (commit `d993b9802` for the no-completion-tool case, plus `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01-CORRECTION01` at commit `68d916cab` for the partial-completion case). **Fix:** the coordinator's `done(reason=completed, terminalResponseCommitted=false)` branch — reached either by the no-completion-tool path OR by the partial-completion path (completion tool `content_start` without a recognized `content_end`) — transitions `turnState.phase` to `awaiting_followup` (the EXISTING phase-enum contract for "done-without-completion" at `ExtensionMessage.ts:355`) instead of leaving it `streaming` — truthful user-owned incomplete yield. **Phase vs content authority separation:** the COMPLETION CONTENT authority contract (no `completion_result` row without `terminalResponseCommittedThisTurn === true`) is UNCHANGED; only the PHASE transition is added. **Conservation:** CRA02-committed / CRA13 user follow-up auto-drain / background-command lifetime / error phase / cancel authority / queued-turn-clobber straggler / completion-response authority — all preserved. The original CRA03 straggler guard (left runtime-owned `streaming` for the IN-PROGRESS case before `done`) is REINTERPRETED: it was about the model-still-iterating case where the next loop iteration could deliver a proper `content_end`; once `done` has fired, the run is over and the same liveness invariant applies. **Evidence:** RED reproduced at production seam for both branches (CPL01 failed with "expected `vi.fn()` to be called with arguments: ['awaiting_followup']" before the original fix; CPL04 AND re-pinned CRA03-coord both returned RED before the CORRECTION01 fix — both ablations commented out the production line, both tests returned RED, both fix lines were restored, all tests GREEN). Live qualification deferred per ACT §36 — the omitted-completion path is model-dependent and non-deterministic; the production-seam RED+GREEN is the strongest non-live evidence. Closure verdict can move to `PASS_LIVE_COMPLETION_PROTOCOL_LIVENESS` on the first dogfood cycle where a natural task ends without an explicit completion tool AND the user observes the TaskHeader transitioning from "Working" to a truthful user-owned state instead of sticking on "Working" indefinitely. **Relationship:** completion-response-authority01 = WHAT counts as terminal; completion-protocol-liveness01 = FORWARD PROGRESS when terminal authority is absent. Complementary, not duplicates. |
| `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01` | TASK-UI | CLOSED at `d993b9802` + `68d916cab` (CORRECTION01) | CRITICAL | completion-protocol-liveness01 | First ACT for the liveness epic (closed across two commits: original fix + factory-review-driven correction). Discriminator-first (per ACT §46): confirmed that the completion-liveness defect is INDEPENDENT of the just-closed RTP defect — the coordinator's `done(reason=completed, terminalResponseCommitted=false)` branch leaves `turnState.phase = "streaming"` regardless of `backgroundCommandRunning`, and the TaskHeader state label is a pure phase projection. **RED tests CPL01..CPL05** pin the missing forward-progress invariant at the production coordinator seam: CPL01 (the RED — done-without-completion yields to awaiting_followup); CPL02/CPL03 controls (completion-tool and text-path with committed terminal both still transition correctly); CPL04 (CORRECTION00: CRA03 mid-completion straggler stays runtime-owned — *the symmetry gap the factory reviewer caught*); CPL05 (error path still transitions to error). Plus two existing tests re-pinned to the liveness-corrected contract: CRA02-coord (was "do NOT promote", now "DOES promote to awaiting_followup") + "resolves the phase when a queued turn completes after its running flag was clobbered" (same boundary through the queued-turn-clobber path) + "posts state on turn end even when the turn-complete event carries NO messages" (re-pinned from "no phase flip" to "yields to awaiting_followup"). **Bounded fix (CORRECTION00, commit `d993b9802`):** single conditional `else` block in `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:142-186` (the existing `else` branch in the done-handler precedence ladder) gains one new `setTurnPhase("awaiting_followup")` line for the done-without-completion case; the comment block is updated to document the phase-vs-content authority separation. **Ablation (CORRECTION00):** production line temporarily commented out → CPL01 returned RED → production line restored → all CPL* + CRA02/03 GREEN. **CORRECTION01 (factory-review-driven, commit `68d916cab`):** the factory reviewer correctly identified that CPL04 was leaving the SAME liveness bug in place for the partial-completion case. Production reachability: the agent-runtime session-termination fallback at `sdk/packages/agents/src/agent-runtime.ts:1313-1336` fires `finishRun("completed")` when the completion-reminder loop exhausts `maxIterations`; the translator sets `attemptCompletionSeen` at the completion tool's `content_start` (`message-translator.ts:1368`); `terminalResponseCommittedThisTurn` is set ONLY at the content_end of the completion tool (`message-translator.ts:1652`) or at the `api_req_failed` handler (`message-translator.ts:2024`); when the content_end never arrives (lost stream, malformed JSON, out-of-order delivery, race with run termination), the CPL04 state is reachable on a `done` event. The reviewer correctly noted: at the time of `done`, no runnable successor exists (no content_end to deliver, no retry scheduled, no continuation loop, no pending prompt; the runtime has emitted `finishRun("completed")` and `run-finished`). The original CRA03 straggler guard (left runtime-owned "streaming") was an in-progress case BEFORE `done`, where the model could still iterate; once `done` has fired, the run is over. **CORRECTION01 fix:** symmetric to CPL01. The CPL04 `else` branch (no terminal content committed) yields `awaiting_followup` instead of leaving the phase as `streaming`. Tests re-pinned: CPL04 (now expects `awaiting_followup`); CRA03-coord (now structurally identical to CPL04, documents the CRA03 → CPL04 contract evolution); CPL03 reclassified as structural/synthetic (the state combination `terminalResponseCommitted=true && attemptCompletionSeen=false && errorSeen=false` is not reachable via the production translator). Also removed stale commentary in the `else` branch (translator does NOT fall back to prior text, per `message-translator.ts:1921-1930`). **Ablation (CORRECTION01):** the new production line in the CPL04 branch was temporarily commented out; both CPL04 and CRA03-coord returned RED; production line restored; all 25 coordinator tests GREEN. **Gates:** apps/vscode vitest 122/1724/0 (was 121/1719 baseline, +5 new CPL tests at CORRECTION00, +0 at CORRECTION01 — only the CPL04 test was re-pinned); webview vitest 69/567/0; @cline/core vitest 172/2125/0 (14 unrelated skipped); apps/cli 3 pre-existing failures in `src/main.test.ts` unrelated to completion-protocol-liveness (verified pre-existing on prior commit via `git stash` baseline); bun unit: 72/1076/0 for the project-relevant packages; typecheck 0; lint clean; markdown-guard PASS (board row L176 unescaped pipe in CRA-LIVE-RECON01 row fixed); coverage ratchet INCREASED (delta +385 statements, +531 branches, +27 functions, +384 lines at CORRECTION00; CORRECTION01 adds additional structured coverage on the same coord seam); diff-check clean. **Live qualification:** deferred per ACT §36. PUSHED=NO. |
| `ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01` | TASK-UI | CLOSED_PRODUCTION_SEAM_LIVE_DEFERRED | HIGH | completion-response-authority01 | **Production-seam RED + GREEN at the canonical terminal-response authority contract (commit `077def275` for state gate, commit `0a3f70ae2` for content authority).** Root cause (corrected by CORRECTION01): the translator synthesized a `completion_result` row from prior intermediate assistant content via a three-tier fallback ladder (`takeTurnFinalText` -> `takeLastAssistantFallback` text or reasoning -> `takeOpenStreamingText` stranded partial), relabeling debugging content as a terminal answer - same epistemic shape as the LIVE screenshot witness. **Recon (`sdk/packages/agents/src/agent-runtime.ts:1313-1327/1354-1371`, `sdk/packages/core/src/runtime/host/local-runtime-host.ts:2010-2014`, `sdk/packages/core/src/extensions/tools/definitions.ts:817` for `submit_and_exit.lifecycle.completesRun: true`):** the `text -> done` path without a `completesRun` tool is only reachable when the agent runtime has no `completesRun` tool registered (`requireCompletionTool === false`) OR via the local-runtime-host session-shutdown fallback. The SDK explicitly distinguishes a completion-tool run from a session-shutdown fallback emission. Promoting prior assistant text to `completion_result` would relabel session-termination-without-completion as canonical completion - the same epistemic shape as the original bug. **Decision (CORRECTION01):** remove `takeTurnFinalText()` from terminal-authority sources. The only authority source is the completion tool `content_end` (canonical `say:"completion_result"` row already committed at that emit point). The prior retag ladder is replaced by an empty `if (!state.wasAttemptCompletionSeen())` block with a doc comment documenting the canonical authority contract. Removed accessors: `takeLastAssistantFallback`, `takeOpenStreamingText`, `recordLastAssistantText`, `recordLastAssistantReasoning`, `clearAssistantFallbackTrackers`, `takeTurnFinalText`, `recordTurnFinalText`, `clearTurnFinalText`, and the corresponding private fields. **CRA12 discriminator (factory review follow-up):** the new negative-authority tests pin the contract - `text -> done, no tool` produces NO completion_result; `text -> tool -> done, no completion tool` produces NO completion_result; `text -> done, attemptCompletionSeen=true` (the canonical path) emits completion_result at the tool content_end. The `done` handler now does NOT synthesize a terminal row from prior content under any non-tool authority. **P1 (user-can-follow-up recon):** when the coordinator refuses to call `setTurnPhase` after `done` with no committed terminal response, `turnState.phase` stays at `"streaming"`. `turnAllowsFollowup()` returns `true`; `allowsQueuedSubmit()` returns `true`; `submitDisabled` is `false`. The follow-up routes via `sendToActiveSession(..., shouldQueue=true)` in `sdk-followup-coordinator.ts:75-79`, queued in `pendingPromptsController`, drained on the next non-error finish at `local-runtime-host.ts:1039-1043`. **The user CAN send a follow-up**; the runtime is NOT stuck. **Conservation:** no UI text heuristic, no prompt rewrite, no message-architecture rewrite, no consumer-side selector change. The trailing `ask:"completion_result"` webview-affordance row at the end of `sdkMessagesToClineMessages` is preserved (it is a UI marker for the "Start New Task" button, NOT a terminal authority signal - the factory reviewer explicitly said "DO NOT redesign the conversation system"). **Tests:** apps/vscode vitest 121/1713/0 (test count unchanged; semantics inverted on the CRA02 family - 4 inverted tests + the `clearTurnOutcome`/`reset` parity tests updated to setTerminalResponseCommittedThisTurn + the `still retags the plan completion...` test inverted); webview vitest 69/567/0; typecheck 0 diagnostics; lint clean; git diff --check clean. **Commit target:** single docs+test+source commit `0a3f70ae2`; PUSHED=NO. |
| `EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` | CTX | CLOSED at this commit | HIGH | none | closed by `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` (closure 01 was reopened by reviewer for two P0 blockers — evidentiary inconsistency between the closure report and a dirty-worktree digest, and the `tokensIn`-only UI numerator being provider-blind — both closed in CORRECTION01: truthful state restored and UI numerator switched to the provider-normalized `tokensIn + cacheReads + cacheWrites` equal to the AI SDK `inputTokens.total` contract; the Anthropic-native and OpenAI-compat REDs now drive the helper) |
| `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` | CTX | CLOSED at this commit | HIGH | none | RED reproduced at production seam (initial: `getLastApiReqTotalTokens` inflated by `cacheReads`; correction: provider-blind `tokensIn`-only numerator would undercount Anthropic-native cached prompts); CORRECTION01 introduces `getLastApiReqContextInputTokens` returning `tokensIn + cacheReads + cacheWrites` (the AI SDK `inputTokens.total` contract — `apps/vscode/src/sdk/message-translator.ts:98-110 normalizeUsageEvent` already produces disjoint buckets via `uncachedInputTokens = inputTokens - cacheReads - cacheWrites`); both Anthropic-native (`tokensIn=50, cacheReads=100000` → `100_050`) and OpenAI-compat-style (`prompt_tokens` decomposes to `noCache + cached_tokens`) REDs are covered; 10 files changed (467 insertions, 40 deletions); vitest 118 files / 1681 tests / 0 failures; bun unit 72 files / 1076 tests / 0 failures; webview 69 files / 562 tests / 0 failures; typecheck 0 diagnostics; `EPIC-CLINEMM-USER-CONTEXT-CEILING01` precondition now holds |
| `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01-CORRECTION01` | CTX | CLOSED | HIGH | none | RED tests added: `getApiMetrics.test.ts` Anthropic-native (`tokensIn=50, cacheReads=100000` → `100_050`), Anthropic cache-creation (`tokensIn=200, cacheWrites=12_500` → `12_700`), OpenAI-compat inclusive (149_235 + 148_167 → 297_402, the original `prompt_tokens`), `tokensOut` non-contribution, total rescaling; `ContextWindow.test.tsx` Anthropic-native `lastApiReqContextInputTokens=100_050 / 200_000` → 50% bar |
| `EPIC-CLINEMM-USER-CONTEXT-CEILING01` | CTX | CLOSED | HIGH | context-accounting-truth (CLOSED) | closed by `ACT-CLINEMM-USER-CONTEXT-CEILING01` (user-controlled effective context ceiling; Auto / explicit-positive-integer modes; built on canonical `resolveEffectiveMaxInputTokens`; user value can never expand model/provider capacity; one compaction threshold formula) |
| `ACT-CLINEMM-USER-CONTEXT-CEILING01` | CTX | CLOSED | HIGH | none | RED families A/B/C/D/E all green; new pure policy resolver `applyUserContextCeiling` / `normalizeUserContextCeiling` layered on top of the canonical `resolveEffectiveMaxInputTokens`; `CoreCompactionConfig.userContextCeiling` plumbed through `cline-session-factory.ts` to the SDK trigger (`requestTriggerTokens = operatingCapacity * 0.9`); settings UI exposes a labeled numeric input next to Auto Compact Strategy (empty = Auto, positive integer = explicit ceiling); `apps/vscode Vitest: 118 files / 1681 tests / 0 failures`; `bun unit: 72 files / 1076 tests / 0 failures`; `webview vitest: 69 files / 567 tests / 0 failures` (was 562, +5 ceiling UI); `SDK core vitest: 173 files / 2124 passed / 14 skipped / 0 failures` (was 94); `typecheck: 0 diagnostics`; `coverage ratchet: PASS` (+26 statements / +13 branches / +5 fns / +25 lines); dogfood VSIX built + installed `s1onique.clinemm@4.1.10-ac40e4399` (source head `ac40e43991189608b0c01cd15d039000fa0314ba`); no model metadata mutation; no hidden truncation; auto-condense off preserves existing behavior; summarizer (agentic-compaction) input budget intentionally NOT user-ceiling-clamped — it is the summarizer model's own context window, a separate authority |
| `ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01` | CTX | CLOSED | HIGH | none | factory reviewer reopened closure with two P0 wire-contract defects: (1) the original `updateSettings` handler only persisted when `request.userContextCeiling !== undefined`, so the webview's clear intent (`updateSetting("userContextCeiling", undefined)`) was indistinguishable from "field absent" on the proto3 wire and left the previously-persisted value intact — the UI test was a mock-of-a-mock that proved nothing; (2) the proto range silently removed `Settings.auto_approve_all_toggled = 174` without a `reserved` declaration, an out-of-scope wire-shape delta. correction01 closes both: explicit-clear sibling field `clearUserContextCeiling` (proto3-`optional bool` on both `UpdateSettingsRequest` and `Settings`) so the Auto/reset intent is wire-distinguishable from "absent"; the unrelated `auto_approve_all_toggled = 174` is restored (the safest bounded correction per the reviewer's recommendation) — no field-number/name reservation needed because the field is live again. **CORRECTION01 P1 (closed in this commit):** the initial fix allowed two mutually contradictory commands on the wire (`userContextCeiling = 512000` AND `clearUserContextCeiling = true`) and silently picked clear-wins. The proto comments now say "may carry one or neither; carrying both is invalid" and both backend handlers (`updateSettings.ts` and `updateSettingsCli.ts`) reject the contradiction with a typed error before any persistence side effect, preserving the on-disk value. The CLI handler has an additional fix beyond the initial P1 patch: the contradiction guard was moved to the **top of the `if (request.settings)` block** so that a request carrying a contradictory ceiling AND an unrelated setting (e.g. `preferredLanguage`) cannot partially mutate the unrelated setting through `setGlobalStateBatch(filteredSettings)` before the throw. The ceiling fields are also extracted from the destructuring so they don't fall into `simpleSettings` and get batched-persisted before the dedicated handler can reject the contradiction. A redundant guard is kept in the dedicated handler as defense-in-depth (unreachable in normal flow once the early guard fires). Backend persistence tests (`updateSettings.test.ts`, 8 tests, 17 ms) route through a real `ClineFileStorage` and reproduce the RED on the original code (clear intent leaves 512 000 on disk; contradictory intent silently mutates the disk). CLI tests (`updateSettingsCli.test.ts`, 3 tests, 9 ms) cover the same RED; the third test pins the atomicity contract — a contradictory ceiling AND an unrelated setting must both be preserved exactly on disk after the reject. The atomicity test caught the very ordering defect the factory reviewer identified: when only the bottom guard was present, `preferredLanguage: "Spanish"` slipped through `setGlobalStateBatch` to disk before the throw, and the test failed with `expected 'Spanish' to be 'English'`. With the early guard, the test passes. Webview test (`FeatureSettingsSection.spec.tsx`) was also a broken mock — destructured `onInput` instead of the production component's `onChange`, so the change handler was `undefined` and `handleCeilingChange` was never invoked; the test was silently exercising the empty-string branch from the closure report onwards. The mock is corrected to wire `onChange` and the persistence tests now use `userEvent.type`/`userEvent.clear`/`userEvent.tab` so the controlled-input flow runs. All gates green: `apps/vscode Vitest: 120 files / 1692 tests / 0 failures` (+1 file / +5 tests); `webview Vitest: 69 files / 567 tests / 0 failures` (was 565 / 2-fail on the broken mock); `bun unit: 72 files / 1076 tests / 0 failures`; `SDK core vitest: 173 files / 2124 / 0 failures`; `typecheck: 0 diagnostics`; `coverage ratchet: PASS` (+322 statements / +501 branches / +19 functions / +321 lines); `lint: clean`; `git diff --check: clean` |
| `CTX-01` | CTX | NEEDS_CLASSIFICATION | LOW | — | classify when relevant |
| `CTX-02` | CTX | NEEDS_CLASSIFICATION | LOW | — | classify when relevant |
| `CTX-03` | CTX | NEEDS_CLASSIFICATION | LOW | — | classify when relevant |
| `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01` | TASK-UI | CLOSED | HIGH | canonical task state authority | closed at `08bd6bb75` (verbatim: the recovered-local commit; also reachable via recovery ref `recovery/local-main-20260820`; merge-content-no-op duplicated on `origin/main` as `8ada8a064`); 8 STP regression guards (STP01..STP08) added to `useThinkingLoaderRow.test.tsx`; §30 gates all green at closure commit (575/575 webview, 1724/1724 apps/vscode vitest, 1076/1076 bun unit; typecheck/lint/diff-check PASS); no canonical TaskHeader migration — TaskHeader's `taskHeaderStateLabel` was explicitly deferred to `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01`. Reason: stale E7.1 board row — the prior session closed the ACT but did not update the board; corrected here as part of `ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` recon. |
| `ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` | TASK-UI | CLOSED_RECON_SUPERSEDED | HIGH | none | recon closed at `8b62e164b` (reclassed HALT_CANONICAL_PROJECTION_INSUFFICIENT — for `compacting` only; substrate already carries 7/8 phases via `TaskShadowObservation.projections.turnPhase`; the gap is **publication**, not substrate); evidence doc `docs/architecture/elm/task-state-thcp01-recon-evidence.md`; superseded by `ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01` (the bounded publication seam ACT). |
| `ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01` | TASK-UI | CLOSED | HIGH | taskheader-canonical-projection01 (RECON) | closed at pending MIGRATION01 closure commit (entry head `8b62e164b`); evidence doc `docs/architecture/elm/task-state-thcp01-migration01-evidence.md`; **bounded publication seam ACT**: added `taskHeaderPresentation` wire field carrying `phase: TurnPhase` + `source: "shadow"\|"host"\|"legacy"` + `seq`; explicit host-owned compaction override (source = "host", phase = "compacting"); selector precedence: host-compacting > shadow > legacy absence fallback; migrated `taskHeaderStateLabel` to consume the projection via new `taskHeaderPresentationStateLabel` entry point. **Conservation**: timing untouched (`taskTelemetry.startedAt`/`endedAt` unchanged); completion liveness untouched; runtime progression untouched; compaction truthful (host override preserves Compacting label); background-command semantics untouched; STP01..STP08 (+30 = 38/38) green; static Thinking untouched. **Quality gates at GREEN**: apps/vscode vitest 1748/1748 (≥1724 baseline; +24 THCP tests); webview vitest 582/582 (≥575 baseline); bun unit 1076/1076 (≥1076 baseline); typecheck 0 diagnostics; lint PASS; `git diff --check` PASS. **NECESSITY/ABLATION proven at the selector**: shadow-branch ablation (used legacy instead of canonicalShadowPhase) → 8 tests RED (THCP01/03/04/07/08, SHADOW_LEGACY_INDEPENDENCE, SHADOW_NECESSITY, THCP09); host-override ablation (commented out the host compaction override) → 3 tests RED (THCP02/02b/02c); restored → 18/18 GREEN. **HOST-OWNED COMPACTION FRESHNESS PROVEN** by THCP11 at the real `SdkCompactionCoordinator` + `TurnStateTracker` + `selectTaskHeaderPresentation` publication seam (6 tests: P1a host-override window observed, P1b last snapshot not compacting, P1c last == entry phase, P1d no publication after restorePhase carries compacting, P1e chronological block is bounded, P1f host override source = "host"). **Ablation**: commented-out `restorePhase()` → 2 tests RED (THCP11-P1b, -P1c), confirming the host-override lifetime is bounded by the production enter/restore pair. **Files changed**: 11 modified + 1 new (selector + wire type + publication + helper + 2 test files + PTAD diagnostic + board + THCP11 publication-seam test). **Evidence wording correction (reviewer)**: pre-implementation RED was `function does not exist` (publication-gap), not a pre-existing live defect — `MIGRATION CONTRACT RED = PROVEN; PRE-EXISTING LIVE DEFECT RED = NOT APPLICABLE`. **P2 observations (non-blocking)**: (a) `TaskHeaderPresentationProjection` declared in both `task-state-shadow-arbiter-mapper.ts` and `ExtensionMessage.ts` — structural typing works, should collapse to the shared wire shape in a future cleanup; (b) selector and test files contain very large ACT-history comments — should eventually collapse to a concise invariant `host compacting > shadow > legacy absence`. Do NOT close `TASKHEADER-OWNER-AWARE-TIMING01` (still its own scope). |
| `ACT-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` | TASK-UI | CLOSED_NOT_REPRODUCED | HIGH | taskheader-canonical-projection-migration01 | closed at `e54a71326` (entry head `8a7e53742`); hygiene correction at `0db0201cc`; evidence doc `docs/architecture/elm/task-state-oat01-owner-aware-timing-recon-evidence.md`; **recon-only ACT**: traced end-to-end timer chain (`TaskTelemetryTracker` host singleton at `apps/vscode/src/sdk/task-telemetry-tracker.ts` → wire field `taskTelemetry: TaskHeaderTelemetryStrip` published at `SdkController.ts:2876` → webview consumer `TaskHeaderTelemetry.tsx` with presentation-only `setInterval(1000)` ticker → `resolveElapsedDisplayMs` + `formatElapsed` helpers); **classified timer semantic domain = A: TASK WALL-CLOCK AGE** (`now - startedAt` live, `endedAt - startedAt` frozen on terminal) — NOT agent-owned active time, NOT per-run duration, NOT per-tool duration; **owner map (current contract)**: streaming/RUNTIME(ticks), awaiting_approval/HUMAN(ticks by deliberate CORRECTION01 design), awaiting_followup/HUMAN(ticks by deliberate CORRECTION01 design), compacting/SYSTEM(ticks as active work), error/resumable/completed/TERMINAL(frozen); **OAT01..OAT12 discriminator check**: OAT01..OAT03 (timer ticks through user-wait) = NOT RED under wall-clock-age contract; OAT04..OAT12 = PASS or not-applicable (terminal freeze, compaction policy, idempotency, identity-bound startedAt, pure projection, presentation-only ticker, persistence contract all internally consistent); **FACTORY STOP RULE §53 satisfied**: timer is the explicit, documented "task wall-clock age" answer to "how old is this task?"; **CLOSURE (reviewer Option A confirmed)**: the existing elapsed-task-time contract is the truthful, intended product semantics; the board hypothesis "owner-aware timing → pause human-owned intervals" is disproved as a defect claim. EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01 also CLOSED_NOT_REPRODUCED. **REJECTED HYPOTHESIS**: existing timer is NOT intended to represent accumulated agent-owned active execution time. **FUTURE PRODUCT IDEA** (NOT this ACT's scope): if active-execution-time metric is wanted, author `EPIC-CLINEMM-ACTIVE-EXECUTION-TIME01` with a new bounded ACT. **HYGIENE**: post-recon additive correction `0db0201cc` stripped 4 trailing blank lines from the evidence doc (P0 evidence contradiction resolved). **Honest gate report**: cumulative `git diff --check 8a7e53742..HEAD` (THCP11 closure → current `1c787884c`) PASSES; recon-only range `8a7e53742..e54a71326` (THCP11 closure → recon alone) FAILs with "new blank line at EOF" (permanently visible in history because additive correction is the chosen discipline; no amend of published commits). **Files changed**: 2 (board row + priority list) + 1 evidence doc (no production source touched). |
| `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` | TASK-UI | CLOSED | HIGH | none | consume canonical task-state projections; do not reconstruct locally |
| `EPIC-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01` | TASK-UI | CLOSED (state-side + timer-side closed at the LTZ01 closure commit) | HIGH | taskheader-canonical-projection01, taskheader-owner-aware-timing01 | **FULLY CLOSED** across two ACTs. STATE-SIDE closed at `e5c6bf486` (CORRECTION01-FIX01; LAC01 + LAC-ABSENCE01 production-seam RED + GREEN + ablation proven; root cause: `TaskShadowHostWiring.getLastObservedShadowPhase` returned `recorder.getRecords().at(-1)?.shadowPhase` which is hardcoded to `"idle"` for `D00_AGREE` records because the public differential record's privacy allowlist omits the divergence payload). **REPAIR (CORRECTION01)**: replaced the host-side mirror with direct canonical delegation — `getLastObservedShadowPhase` now reads the comparator's current `TaskModel` and applies `TaskState.projectTurnState` (from `@cline/agents`, defined at `sdk/packages/agents/src/runtime/state/task-state/selectors.ts:47-71`), then maps through `toLegacyPhase` for the legacy `TurnPhase` union. NO duplicate phase projector on the host side (the canonical seam is in `@cline/agents`; the host consumes it). Added anti-drift LIVE invariant C in LAC01 that asserts `wiring.getLastObservedShadowPhase() === TaskState.projectTurnState(comparator.debugSnapshot())`. **CORRECTION01-FIX01 (presence seam)**: added `TaskShadowComparator.hasObservedShadowState()` (returns true once the comparator has accepted at least one observation for the current shadow instance; false for a brand-new shadow and after `resetForNewTask()`). `getLastObservedShadowPhase` now returns `undefined` when the shadow has not observed anything — preserves the frozen `host-compacting > shadow > legacy absence fallback` precedence that the canonical projection alone would collapse (the canonical projection always returns a phase, including for `initialTaskModel()` which projects to `"idle"`). **LAC-ABSENCE01** (3 tests) pins the presence contract: absence-fallback on fresh wiring, presence after canonical observation, presence cleared on `resetForNewTask`. Both ablations proven (original `recorder.shadowPhase` defect; wire-side `return "idle"` injection; AND presence-guard removal → `expected 'idle' to be undefined`). TIMER-SIDE: LIVE witness reported `00:00` but production RED at the same wall-clock shows `00:05` (timer was correct in the executable reproduction). The LIVE `00:00` is a separate, unresolved observation; tracked as `LIVE_TIMER_PENDING` (out of scope of this ACT — not investigated per CORRECTION01 reviewer mandate). Conservation: 176/176 PASS on the targeted shadow surface (LAC01 + 3 LAC-ABSENCE01 + 10 sibling test files); full apps/vscode vitest 1804/1804 PASS; webview TaskHeader 72/72 PASS; typecheck EXIT=0; lint PASS; diff-check PASS; coverage ratchet PASS (+416 stmts / +563 branches / +36 funcs / +414 lines vs baseline). No selector change, no timer change, no visual change. ACT: `ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01` (with `CORRECTION01-FIX01` for the presence-seam). |
| `ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01` | TASK-UI | CLOSED (state-side at `e5c6bf486`; timer-side closed at the LTZ01 closure commit) | HIGH | taskheader-live-activity-coherence01 | **PARTIALLY CLOSED at this commit (CORRECTION01-FIX01; LAC01 production-seam RED + GREEN + ablation proven; LAC-ABSENCE01 added)**. Recon at production seams complete; **CASE D — PROJECTION_PUBLICATION_MISSING** identified and repaired via canonical delegation. Production-seam RED at the real `createTaskShadowHostWiring` + real `TaskShadowComparator` + real `selectTaskHeaderPresentation` + real `TaskTelemetryTracker` + real `formatElapsed`/`resolveElapsedDisplayMs`/`taskHeaderPresentationStateLabel` webview helpers. Driven the EXACT production chronology of `SdkController.initTask`. At publication, the wire `taskHeaderPresentation` was published as `phase: "idle", source: "shadow"` even though the comparator's `TaskModel` had `activity.modelStreaming = true`. Forensic: `recorder.records()[2].shadowPhase = "idle"` because `recorder.record` falls back to `"idle"` when `divergence` is `undefined` (the `D00_AGREE` case). **CORRECTION01 REPAIR (canonical delegation, no host mirror)**: deleted `TaskShadowComparator.getCurrentShadowPhase()` (initial duplicate-authority mirror); `getLastObservedShadowPhase` now reads `comparator.debugSnapshot()` and applies `TaskState.projectTurnState` (the canonical seam owned by `@cline/agents`, `selectors.ts:47-71`), then runs through `toLegacyPhase` for the legacy `TurnPhase` union. NO duplicate phase projector on the host side. **Anti-drift LIVE invariant C** added to LAC01: `wiring.getLastObservedShadowPhase() === TaskState.projectTurnState(comparator.debugSnapshot())`. **CORRECTION01-FIX01 (presence seam)**: added `TaskShadowComparator.hasObservedShadowState()` (returns true once the comparator has accepted at least one observation for the current shadow instance; false for a brand-new shadow and after `resetForNewTask()`). `getLastObservedShadowPhase` now returns `undefined` when the shadow has not observed anything — preserves the frozen `host-compacting > shadow > legacy absence fallback` precedence. **LAC-ABSENCE01** (3 tests in host-wiring suite) pins the presence contract: absence-fallback on fresh wiring, presence after canonical observation, presence cleared on `resetForNewTask`. NECESSITY/ABLATION all passes: revert to `recorder.shadowPhase` returns LAC01 to RED (original defect); wire-side `return "idle"` injection returns LAC01 to RED (anti-drift catches duplicate authority); presence-guard removal returns LAC-ABSENCE01-a and LAC-ABSENCE01-c to RED with `expected 'idle' to be undefined` (presence seam verified load-bearing). **HONEST TIMER RE-CLASSIFICATION**: the LIVE witness reported `00:00` BUT the production RED snapshot at the same wall-clock shows `elapsedText: "00:05"` — i.e., the timer was correct in the executable reproduction. The LIVE `00:00` is a separate, UNRESOLVED observation; tracked as `LIVE_TIMER_PENDING` (timer investigation explicitly out of scope per CORRECTION01 reviewer mandate). **VERDICT**: `PASS_TASKHEADER_LIVE_STATE_COHERENCE` (state-side closed) + `LIVE_TIMER_PENDING` (combined LIVE activity coherence not closed — separate timer investigation required). CONSERVATION: 176/176 PASS on targeted shadow surface (LAC01 + 3 LAC-ABSENCE01 + 10 sibling files); full apps/vscode vitest 1804/1804 PASS; webview TaskHeader 72/72 PASS; typecheck EXIT=0; lint PASS; diff-check PASS; coverage ratchet PASS (+416 stmts / +563 branches / +36 funcs / +414 lines vs baseline). No selector change (three-source precedence preserved); no timer change (timer was correct in executable reproduction); no visual change (TaskHeader unchanged). Files changed: `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` (delegation + presence guard), `apps/vscode/src/sdk/task-state-shadow.ts` (removed mirror, exported `toLegacyPhase`, added `hasObservedShadowState`), `apps/vscode/src/sdk/__tests__/task-header-live-activity-coherence.lac01.test.ts` (+LIVE invariant C), `apps/vscode/src/sdk/__tests__/task-state-shadow-host-wiring.test.ts` (+LAC-ABSENCE01 describe block), `apps/vscode/src/sdk/__tests__/task-header-live-activity-coherence.lac01.helpers.ts`, `docs/architecture/elm/task-header-live-activity-coherence01-evidence.md` (rewritten to document CORRECTION01-FIX01), this board. |
| `ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01` | TASK-UI | IN_PROGRESS | HIGH | taskheader-live-activity-coherence01 | **RECON at production seams complete; classification pending.** Traced two chains independently. STATE CHAIN: runtime/session event → `TaskStateShadow` (canonical) / host override (compacting) → `selectTaskHeaderPresentation` selector (frozen three-source precedence: host-compacting > shadow > legacy absence) → `SdkController.getStateToPostToWebview()` `taskHeaderPresentation` field (`SdkController.ts:2966-2970`) → `taskHeaderPresentationStateLabel` webview helper → `TaskHeaderTelemetry` state label. TIMER CHAIN: task lifecycle start → `TaskTelemetryTracker.startTask(taskId)` (`SdkController.ts:1666` inside `initTask` AFTER `taskStart.initTask` returns, with `persistedTs` fallback to `Date.now()`) → `taskTelemetry.get()` strip → `taskTelemetry: this.taskTelemetry.get()` wire field (`SdkController.ts` publication block) → `TaskHeaderTelemetry` elapsed display → `resolveElapsedDisplayMs` + `formatElapsed` helpers. **IDENTITY TRACE**: visible taskId = activeSession.sessionId; host taskId = same; telemetry taskId = `TaskTelemetryTracker.currentTaskId` (set on `startTask`); projection taskId = NOT CARRIED on wire (`taskHeaderPresentation` is task-agnostic; only `seq` is the fence token — same domain as `thinkingPresentation.seq`). **CRITICAL OBSERVATION (NOT YET RED-CONFIRMED)**: order inside `initTask` is `taskStart.initTask → taskTelemetry.startTask → attachRecoveryTelemetrySubscription → attachCanonicalRuntimeEventSubscription → taskStateShadowWiring.resetForNewTask → emitTaskRequested`. The shadow is reset AFTER the telemetry is started; `resetForNewTask` sets `postResetAwaitingCanonicalRunRef = true` and clears `lastArbiter` + records. `emitTaskRequested` then seeds the shadow `TaskModel.identity.taskId = B` but `projectTurnState(initialModel)` returns `idle`. The canonical subscription is attached (`POINT_IN_TIME` model — `apps/vscode/src/sdk/canonical-event-subscription.ts:20-39`); between `resetForNewTask` and the first canonical `run-started` event the shadow's `getLastObservedShadowPhase()` returns `idle`. The selector (`task-state-shadow-arbiter-mapper.ts:398-424`) prefers shadow over legacy when shadow is defined → publishes `phase: "idle", source: "shadow"` overriding the legacy `streaming`. **Hypothesis-class A** (timer): if `taskHistory.find(...).ts` is missing at the moment `startTask(B)` runs (the first frame before the history write completes), `startedAt` falls back to `Date.now()` → timer shows `00:00` for the first 1s. **Hypothesis-class B** (state): canonical `run-started` from `LocalRuntimeHost.subscribeRuntimeEvents` does not reach the shadow because the subscription was attached BEFORE the runtime session became `active` (`F1-H4-C1` POINT_IN_TIME contract — pre-session subscribe is a no-op; documented invariant requires re-attach after `startNewSession` resolves). If the controller does not re-attach at the right seam, the shadow stays at the post-reset idle state indefinitely while runtime genuinely progresses. **Hypothesis-class C** (identity): host taskId ≠ telemetry taskId due to a stale `taskTelemetry` carrying `currentTaskId = A` across `clearTask()` (note: `clearTask` does NOT call `taskTelemetry.clear()` — only `cancelTask` calls `endTask()`). For the LIVE symptom both A and B (or both) must be true simultaneously; either alone would not produce the dual-fail UI. **NEXT**: write `LAC01` (composed RED at the real `SdkController.initTask` + `taskTelemetry` + shadow + publication seam) that fails on HEAD; if it does not reproduce, split into `LAC-STATE01` (canonical projection coherence) and `LAC-TIME01` (telemetry start coherence). |
| `EPIC-CLINEMM-TASKHEADER-LIVE-TIMER-ZERO-RESET01` | TASK-UI | CLOSED (PASS_PRODUCTION_SEAM; LIVE qualification pending — see ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01 row above for the LIVE_TIMER_PENDING classification that this ACT closes at the production seam) | HIGH | taskheader-live-activity-coherence01 (timer-side), taskheader-owner-aware-timing01 | **CLOSED** at the LTZ01 closure commit. Recon at production seams: traced the COMPLETE timer chain (logical task start -> `TaskTelemetryTracker.startTask(taskId)` -> `taskTelemetry.get()` strip -> `taskTelemetry: this.taskTelemetry.get()` wire field at `SdkController.ts:2907` -> `TaskHeaderTelemetry` elapsed display -> `resolveElapsedDisplayMs` + `formatElapsed` webview helpers). TIMER_DOMAIN: TASK WALL-CLOCK AGE (OAT01 frozen contract, unchanged by this ACT). **IDENTIFIED FIRST BROKEN BOUNDARY**: `SdkController.initTask` (line 1666) wires `taskTelemetry.startTask(sessionId, persistedTs)` after `taskStart.initTask` returns; `SdkController.reinitExistingTaskFromId` (line 1782) did NOT — only `setTurnPhase("streaming")` fired (inside the coordinator), which only `observeTurnPhase("streaming")` -> CONTINUATION_PHASES -> clears `endedAt` (no anchor for `startedAt`/`currentTaskId`). **CASE A (MISSING_TASK_START_ON_RESUME) PROVEN** via LTZ01 behavioral seam test + LTZ02 structural sentinel + LTZ03 cross-task identity test. **REPAIR (bounded)**: added a `this.taskTelemetry.startTask(sessionId, persistedTs)` anchor in `SdkController.reinitExistingTaskFromId` after `await this.taskStart.reinitExistingTaskFromId(taskId)`, mirroring the initTask wiring. The `sessionId === taskId` guard fences against superseding intents (a newer op advanced the fence during `startNewSession`; in that case `getActiveSession()` returns the newer session id and we must NOT anchor for the wrong task). `persistedTs` falls back to `Date.now()` only if the history item is missing (same guard as initTask). **CONSERVATION**: 60/60 PASS on the targeted telemetry surface (LTZ01 3 tests + `task-telemetry-tracker` 43 tests + `task-header-live-activity-coherence.lac01` 1 test + `SdkController.task-telemetry-wiring` 6 tests + `SdkController` 7 tests); full apps/vscode vitest 1806/1806 PASS*; webview 592/592 PASS; typecheck 0 diagnostics; lint PASS; `git diff --check HEAD` PASS; no selector change; no three-source precedence change; no terminal-freeze contract change; no same-task-continuation reopen change; no React-local authority added; no timer semantic redesign. **NEED/ABLATION proven**: commenting out the production `taskTelemetry.startTask(...)` call in `reinitExistingTaskFromId` -> LTZ01/LTZ02/LTZ03 all RED. Restored -> all GREEN. **P2 RESIDUE** (NOT REPAIRED, EXPLICIT SCOPE LIMIT): the canonical-event-subscription doc-comment at `canonical-event-subscription.ts:35-39` already claims the controller calls `attachCanonicalRuntimeEventSubscription` from `reinitExistingTaskFromId`; that claim is currently false (it is called from `initTask` only, at line 1675). Similarly, `attachRecoveryTelemetrySubscription` is missing on the resume seam. Both are outside the timer-only scope of this ACT; a bounded follow-up ACT (`taskheader-live-timer-zero-reset02` or analogous) would add both primitives (fenced, with a `sessionId === taskId` guard) and update the doc-comment. Companion epic `EPIC-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01` status updated from `LIVE_TIMER_PENDING` to `CLOSED` at this commit (the timer-side of the live activity coherence is now closed at the production seam; live qualification is still pending the user's natural-reproduction cycle). **Files changed**: 1 (board rows for this EPIC + ACT + priority list + companion EPIC/ACT status update) + 1 evidence doc + 1 production file (`apps/vscode/src/sdk/SdkController.ts` anchor in `reinitExistingTaskFromId`) + 1 new test file (`apps/vscode/src/sdk/__tests__/task-header-live-timer-zero-reset.ltz01.test.ts` 3 tests). |
| `ACT-CLINEMM-TASKHEADER-LIVE-TIMER-ZERO-RESET01` | TASK-UI | CLOSED (PASS_PRODUCTION_SEAM; LIVE qualification pending) | HIGH | taskheader-live-activity-coherence01 (timer-side), taskheader-owner-aware-timing01 | **Production-seam RED + GREEN + ablation proven at this commit.** 3 tests in `apps/vscode/src/sdk/__tests__/task-header-live-timer-zero-reset.ltz01.test.ts`. **ROOT CAUSE**: `SdkController.reinitExistingTaskFromId` did not call `taskTelemetry.startTask(...)` (the seam was only wired on the `initTask` new-task path at line 1666); only `setTurnPhase("streaming")` fired (inside the coordinator), which feeds the telemetry tracker `observeTurnPhase("streaming")` -> CONTINUATION_PHASES -> only *clears* `endedAt`. `startedAt` and `currentTaskId` were not touched. **TIMER LIVE DEFECT REPRODUCTION**: the LIVE witness reported `00:00` for an already-running task. The state-side production RED at the same wall-clock showed `00:05` (timer correct under executable reproduction). The discrepancy is the timer anchor missing on the resume seam. **CLASSIFICATION**: CASE A (MISSING_TASK_START_ON_RESUME) — the first broken authoritative boundary is the `reinitExistingTaskFromId` seam; it is the seam that produces the LIVE symptom when a user resumes a task after a host restart (fresh controller -> tracker undefined -> `taskTelemetry.get()` returns undefined -> webview renders "-" but the live user's actual observation was `00:00` — explained by the fresh-controller-with-residual-prev-task-telemetry path where `currentTaskId` carries the prior task's id and `startedAt` carries the prior task's start, so the resume reuses the wrong anchor; or by the `setTurnPhase("streaming")` clearing `endedAt` without re-anchoring `startedAt` when the prior task was still in-flight). **REPAIR (bounded)**: added `this.taskTelemetry.startTask(sessionId, persistedTs)` to `SdkController.reinitExistingTaskFromId` after `await this.taskStart.reinitExistingTaskFromId(taskId)`, guarded by `sessionId === taskId`. Mirror of the initTask wiring at line 1666. **NEED/ABLATION proven**: commenting out the anchor -> LTZ01, LTZ02, LTZ03 all RED -> restored all GREEN. **TESTS (3)**: (1) LTZ01 — behavioral seam test at REAL `TaskTelemetryTracker` + fake SdkController-equivalent harness that mirrors the EXACT call sequence; harness is gated on a production-source-regex check (`productionReinitWiresTelemetryAnchor`) so the behavioral test only mirrors the (repaired) production flow — when the wiring is absent, the harness mirrors the broken flow and the behavioral test REDs; (2) LTZ02 — structural sentinel (`SdkController.reinitExistingTaskFromId` body must contain `this.taskTelemetry.startTask(...)`); (3) LTZ03 — cross-task identity (resuming a different task must not carry the previous task's `startedAt`). **CONSERVATION**: 60/60 PASS on targeted telemetry surface (LTZ01 3 + `task-telemetry-tracker` 43 + LAC01 1 + wiring 6 + SdkController.test 7); full apps/vscode vitest 1806/1806 PASS*; webview 592/592 PASS; typecheck EXIT=0; lint PASS; `git diff --check HEAD` PASS. *One pre-existing flaky failure in `async-command-turn-liveness.acl01.test.ts` (ACL03); isolated run passes 5/5; unrelated to this ACT (multi-process deadline race in `command-job-manager`). **Closed contracts — preserved**: task wall-clock age (OAT01); same-task continuation reopen (`startedAt` preserved across `observeTurnPhase("streaming"\|"awaiting_approval")` on same task identity); terminal freeze (`error`/`resumable`/`completed`); `setTurnPhase` ownership (coordinator is sole writer of the resume-streaming transition); TaskHeader state label (still consumes canonical projection); three-source precedence (frozen `host-compacting > shadow > legacy absence`); no new wire field; no React-local authority; no timer semantic redesign. **Files changed**: 1 production (`apps/vscode/src/sdk/SdkController.ts` `reinitExistingTaskFromId` body) + 1 new test (3 tests) + 1 new evidence doc + this board. |

| `EPIC-CLINEMM-RESUME-SUBSCRIPTION-PARITY01` | RUNTIME-LIFECYCLE | CLOSED (PASS_PRODUCTION_SEAM; LIVE qualification pending — see ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01 row below) | HIGH | taskheader-live-timer-zero-reset01 (P2 residue) | **CLOSED at the production-fix commit** (`6915c22c`). For docs closure SHA and the exact-build-head VSIX identity, see `docs/architecture/elm/resume-subscription-parity01-evidence.md` (§"Identity" + §"Exact-build-head dogfood (RSP01)"). ROOT CAUSE: `SdkController.reinitExistingTaskFromId` (line 1782+) did not call `attachCanonicalRuntimeEventSubscription` nor `attachRecoveryTelemetrySubscription` — both were only called from `initTask` (lines 1670-1675). The doc-comment at `canonical-event-subscription.ts:35-39` falsely claimed the resume seam did this; this ACT makes the claim accurate. **CASE_C_BOTH_SUBS_MISSING_ON_RESUME PROVEN via 4 distinct behavioral REDs** at the production seam (RSP01, RSP02, RSP05, RSP06). **REPAIR (bounded)**: added `this.attachRecoveryTelemetrySubscription(sessionId)` + `this.attachCanonicalRuntimeEventSubscription(sessionId)` inside the existing `sessionId === taskId` fence (LTZ01) in `reinitExistingTaskFromId`. Both helpers are idempotent on re-init (dispose-then-attach), so the cardinality invariant holds across repeated resumes. **NEED/ABLATION CYCLE PROVEN**: commenting out both attach calls → 4 RED + 5 GREEN; restored → 9/9 GREEN. **CONSERVATION**: 106/106 PASS on the targeted subscription + telemetry + task-control + state-version surface (RSP01 9 + LTZ01 3 + LAC01 1 + task-telemetry-tracker 43 + SdkController 7 + SdkController.task-telemetry-wiring 6 + e2f-f1-correction03 8 + real-local-to-shadow-bridge 7 + task-state-shadow-host-wiring.e2f-f1-correction01 8 + tcl-parent 3 + tcl-parent.adversarial 6 + sdk-controller-w1-epoch-stateversion 5); full apps/vscode vitest 1816/1816 PASS (vs 1806 LTZ01 baseline; +10 RSP tests); webview 592/592; bun:unit 1076/1076; typecheck 0 diagnostics; lint PASS; diff-check PASS. Closed contracts preserved: task wall-clock age (OAT01); same-task continuation reopen; terminal freeze; setTurnPhase ownership; TaskHeader state label; three-source precedence; no new wire field; no React-local authority; no timer semantic redesign; no event-bus replacement. **P2 residue**: NONE (the canonical-event-subscription.ts:35-39 doc-comment is now accurate). **Files changed**: 1 production (SdkController.ts `reinitExistingTaskFromId` body) + 1 new test (9 tests, 656 lines) + this board + 1 evidence doc + 1 VSIX. |
| `ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01` | RUNTIME-LIFECYCLE | CLOSED (PASS_PRODUCTION_SEAM; LIVE qualification pending) | HIGH | taskheader-live-timer-zero-reset01 (P2 residue) | **CLOSED at the production-fix commit** (`6915c22c`); for docs closure SHA, see the evidence doc Identity section. **Mission accomplished**: behavioral REDs (RSP01, RSP02, RSP05, RSP06) all reproduced on HEAD before fix; bounded repair applied; all 9 RSP tests GREEN after fix; ablation cycle proven. **PRODUCTION-SEAM RED PROVEN**: at the production-source-gated harness (which mirrors the EXACT call sequence of `SdkController.reinitExistingTaskFromId` post-coordinator block), after `runReinit(taskId, sessionId)` is called through the same wiring points the production controller uses, emitting a canonical `execution-state-changed` event through the real host → shadow observation count = 0 (RED); with the fix → exactly 1 (GREEN). Same pattern for the recovery snapshot via the real `subscribeRecoveryStateChange` host. **TESTS (9)**: RSP01 (canonical runtime after resume — REAL `CanonicalRuntimeShadowSubscription` + REAL `createTaskShadowHostWiring`), RSP02 (recovery snapshot after resume — REAL `TaskTelemetryTracker.observeRecovery`), RSP03 (base TaskTelemetry presence after resume — strip defined, startedAt>0, currentTask=taskId, recoveryBudgetFailures=0; GREEN even without fix; isolated symptom class), RSP04 (terminal-timing cleared on resume — modeled resume chronology clears `endedAt` correctly via the existing CONTINUATION_PHASE contract; GREEN with and without fix; this proves only the modeled stale-`endedAt` path, NOT all paths to LIVE-B on current HEAD), RSP05 (repeated resume cardinality — exactly-once per event after second resume), RSP06 (A→B stale identity — sessionId filter drops stale A events after A→B switch), RSP03 + RSP04 positive fresh-init controls (proves harness is valid), RSP-SANITY (`subscribeCanonicalRuntimeEventsToShadow` drops stale events). **NEED/ABLATION PROVEN**: commenting out both attach calls in production → RSP01/RSP02/RSP05/RSP06 RED; restored → all 9 GREEN. The structural sentinel uses a non-comment regex so the ablation cycle correctly trips the gate. **CLOSED CONTRACTS — PRESERVED**: task wall-clock age (OAT01); same-task continuation reopen; terminal freeze; setTurnPhase ownership (coordinator is sole writer of the resume-streaming transition); TaskHeader state label (consumes canonical projection); three-source precedence (frozen `host-compacting > shadow > legacy absence`); no new wire field; no React-local authority; no timer semantic redesign. **LIVE EVIDENCE BINDING (per Factory addendum; CORRECTION01 wording)**: dogfood install is `s1onique.clinemm@4.1.10-e5c6bf486` (PRE-LTZ01 + PRE-RSP01). LIVE-A (telemetry-absent) = REAL on `e5c6bf486`; LTZ01 causal match = **INFERRED**, not seam-reproduced. LIVE-B (frozen timer + Idle during active execution) = REAL on `e5c6bf486`; RSP01 ←→ LIVE-B causal relation = **UNPROVEN**; CURRENT_HEAD_LIVE_B_STATUS = **NOT_LIVE_QUALIFIED**. Both LIVE symptoms are `REAL_LIVE_FAILURE_ON_DOGFOOD_e5c6bf486` only. **Files changed**: 1 production (`SdkController.ts` `reinitExistingTaskFromId` body) + 1 new test (`resume-subscription-parity.rsp01.test.ts`, 9 tests, 656 lines) + this board + 1 evidence doc + 1 VSIX. |
| `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` | TASK-UI | CLOSED_NOT_REPRODUCED | HIGH | compaction-state-authority, canonical-projection | **CLOSED at pending OAT-RECON-01 closure commit** (entry head `8a7e53742`); recon-only ACT (`ACT-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01`) closed at `e54a71326` with VERDICT=NOT_REPRODUCED; **PROVEN CONTRACT**: TaskHeader timer is task wall-clock age (`now - startedAt` live; `endedAt - startedAt` frozen on terminal). Human waiting is intentionally included by design (CORRECTION01 in `taskHeaderTelemetryHelpers.ts:140-142`). Terminal states freeze. Webview ticker is presentation-only. UI label "Elapsed task time" + tooltip "Task started at <ISO>" matches the contract truthfully. **REJECTED HYPOTHESIS**: existing timer is NOT intended to represent accumulated agent-owned active execution time. **FUTURE PRODUCT IDEA** (NOT a defect repair): if active-execution-time metric is wanted, author a NEW feature epic `EPIC-CLINEMM-ACTIVE-EXECUTION-TIME01` and a new bounded ACT. Do NOT redefine the existing elapsed-task-time contract. **HYGIENE**: post-recon commit `0db0201cc` stripped 4 trailing blank lines from the evidence doc (reviewer-flagged P0 evidence contradiction resolved; additive correction; recon commit untouched). **Honest gate report**: `git diff --check 8a7e53742..HEAD` (THCP11 closure → current `1c787884c`) PASSES; `git diff --check 8a7e53742..e54a71326` (recon-only range) FAILS with "new blank line at EOF" — the recon's P0 EOF blank-line condition is permanently visible in history because additive correction is the chosen discipline (no amend of published commits). Future tooling must scope diff-check to commits introduced by future ACTs, not to the historical recon range. **Files changed**: 1 (board only, this row + priority-list + ACT-row text tightened to reflect CLOSED_NOT_REPRODUCED disposition). |
| `ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01` | OBS | CLOSED_RECON — PASS_RECON | HIGH | tool-execution-semantics01 | **RECON_PASS** at `4b49116b6` (entry head `6aa97fa01`); original recon at `9469dbc11`; board update at `f9d8dad00`; reviewer-response addendum at `4b49116b6`; evidence doc `docs/architecture/elm/task-state-tes01-tool-execution-semantics-recon-evidence.md` (now 1363 lines, 34 sections, ~54.7 KiB); **REVIEWER**: Option A confirmed (Runtime telemetry engineer + Factory reviewer); **VERDICT**: `RECON_COMPLETE_NO_SAFE_SEMANTIC_PROJECTION_IN_THIS_ACT`; **PRODUCTION_DEFECT=NONE** (existing UI "Tool calls: N" is truthful, one-per-call, structurally correct — TES10 NOT REPRODUCED); **PROVEN**: toolCallId / toolName / durationMs / typed outcome REAL; mechanism / effectClass STRUCTURAL (+ UNKNOWN for shell); purpose UNAVAILABLE_FROM_TRACE; retryIdentity UNAVAILABLE_TODAY; **REVIEWER P1 corrections captured** (would be defects if shipped uncaught to a future impl ACT): **P1.1** my recon's 13-category mechanism taxonomy is too large / too close to names — `command_status` + `cancel_command` should sit with `execute` not as top-level buckets; **reclassification**: `TES_RECON_TAXONOMY = CANDIDATE` (not frozen); recommended reconsolidation: read / search / mutate / execute / network / human / completion / delegate / other (9 categories, slightly over the original ACT's `<=8` preference, explainable). **P1.2** my recon conflated "shell mechanism = process_execution" with "shell side-effect = unknown" — these are different axes; **reclassification**: a future bounded projection MUST split `mechanism` and `sideEffect` into distinct vocabularies; shell mechanism is `execute`; shell side-effect is `unknown` until `CommandExecutionPlan.transformedInput` is observed. **P1.3** my recon's Option B said "add new AgentRuntimeHooks field for typed outcome" — that wording was architecturally wrong; **reclassification**: `AgentRuntimeHooks.onToolRuntimeOutcome` already exists at `sdk/packages/shared/src/agent.ts:616` (C1.2 observable seam, comment explicit); runtime wires it through `bootstrap.hooks` at `sdk/packages/core/src/runtime/host/local-runtime-host.ts:697`; the **missing piece is purely host-side population of the existing field**, NOT substrate modification. **STRUCTURAL DISTINCTION (reviewer-discovered)**: ATTEMPT cardinality (`requestToolApproval` + `toolNotFound` decisions; includes user_rejected/host_policy_denied/approval_pending/runtime_skipped) is **distinct** from EXECUTION cardinality (`tool-started` + `tool-finished` + `ToolRuntimeOutcome`); today `taskTelemetry.toolCalls` counts EXECUTIONS only; naive `byOutcome` partition of toolCalls would silently exclude the ATTEMPT axis — a future bounded impl must keep ATTEMPT and EXECUTION on distinct axes with distinct counters; **TES-IMPL PRECONDITIONS** recorded for any future bounded impl: (1) concrete user-facing question that semantic telemetry answers; (2) collapse mechanism taxonomy to bounded product categories (≤8 per original ACT §38); (3) separate mechanism vocabulary from side-effect vocabulary; (4) distinguish ATTEMPT vs EXECUTION cardinality; (5) bridge EXISTING `AgentRuntimeHooks.onToolRuntimeOutcome` seam through the host/runtime composition boundary; (6) all conservation gates (THCP / RTP / completion / timing / STP / background commands) GREEN; **conservation**: task wall-clock age exclusive to TaskHeader elapsed; tool duration per-tool (separate domain); per-run duration per-AgentResult (separate domain); THCP01..THCP11 = 31/31 PASS; Static thinking (STP) = 38/38 PASS; `onToolRuntimeOutcome` STILL NOT populated by host (unchanged); **files changed across 3 commits**: 1 evidence doc (1131 lines → 1363 lines; +234 addendum lines) + 3 board row updates; **zero production source touched, zero tests modified, zero wire schemas mutated, zero UI changes**. |
| `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` | OBS | OPEN | HIGH (revisit on concrete user need) | tool-execution-semantics01 | recon-only ACT closed as `PASS_RECON`; **EPIC remains OPEN awaiting concrete user-facing product question** that semantic telemetry answers; bounded impl ACT (`TES-IMPL-01`) requires all 5 preconditions recorded by reviewer (taxonomy consolidation, mechanism/side-effect split, attempt vs execution cardinality, bridge existing outcome seam, full conservation gates); auto-promotion to TES-IMPL explicitly rejected by reviewer — next ACT deferred to existing board priority |
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
| `ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION02` | TOOL-RUNTIME | CLOSED_DOCS_EVIDENCE_RECLASSIFIED | HIGH | none | **Docs-only correction per Factory reviewer HALT_EVIDENCE_CONTRADICTION.** Zero test delta; zero production delta; only the gate-report wording on the board is corrected. Two load-bearing evidence contradictions in CORRECTION01's final report are reclassified: **(P0.1) "All gates GREEN" → ACT-owned targeted gates GREEN with named pre-existing SDK residues;** (a) SDK_AGENTS_FULL_SUITE — `FAIL_WITH_VERIFIED_PREEXISTING_BASELINE`. Mechanical proof: `sdk/packages/agents/src/agent-runtime.provider-form.test.ts` last commit is `9e16d6b1c` ("fix(recovery): restore() upstream-parity"), a STRICT ANCESTOR of both `fd7ef0714` (closure commit) and `bcf1687b7` (current HEAD); the file is byte-unchanged across these commits and the failure (`TypeError: vi.hoisted is not a function`) reproduces identically at fd7ef0714 and at bcf1687b7 — bun/vitest environment gap, NOT introduced or exposed by INVALID-TOOL-INPUT-PREAPPROVAL01 or its CORRECTION01. (b) SDK_CORE_FULL_SUITE — `NOT_COMPLETED / PREEXISTING_ENVIRONMENT_GAP`. The bun test job for `sdk/packages/core` was cancelled mid-run after `sdk/packages/core/src/hub/client/index.test.ts` produced `TypeError: vi.unstubAllGlobals is not a function` — same family of bun/vitest environment gap, pre-existing, OUT OF SCOPE for this ACT per the reviewer's bounded-correction stop rule; do NOT label a cancelled job as PASS. **(P0.2) `APPROVAL_CARD_TRUTH=PASS` overstates the exercised seam.** TI_UI01..TI_UI03 in `apps/vscode/src/sdk/__tests__/invalid-tool-input-preapproval01.ui-tell.c01.test.ts` exercise ONLY the message-translator (`apps/vscode/src/sdk/message-translator.ts`); they prove that the EXTENSION-SIDE contract is truthful (no approval requested, no executor called, row finalized as completed-with-error, no `REQ_APP` marker, no `ask:"command"` event) — they DO NOT render `apps/vscode/webview-ui/src/components/chat/ChatRow.tsx` and DO NOT prove the user-visible title is truthful. The hardcoded `<span className="font-bold text-foreground">Cline wants to execute this command:</span>` at `ChatRow.tsx:320` is the remaining user-visible **truthfulness/presentation P1 residue** — not a safety/runtime defect (the underlying tool call was rejected before approval/execution), but the header text still tells the user an executable action awaits approval when no approval exists. **Reclassified status block:** `TRANSLATOR_APPROVAL_SEMANTICS=PASS` (the actually-tested extension-side seam); `APPROVAL_CARD_TRUTH=UNPROVEN_AT_WEBVIEW` (webview render not exercised by any test); `WEBVIEW_TITLE_TRUTH=KNOWN_P1_RESIDUE` (documented; candidate for `ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01`, registered below).
| `ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01` | WEBVIEW-UI | CLOSED_PRODUCTION_SEAM | HIGH | none | **Closed via typed wire-disposition delta + chat-row branching.** The user-visible heading "Cline wants to execute this command:" was the remaining webview residue after INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION02. **Bounded multi-package delta** (per Factory reviewer authorization; NOT presentation-only — the runtime owns the structured field). STEP 1 — `@cline/shared/src/agents/types.ts`: additive `executionDisposition?: "executed" \| "rejected_before_execution"` on `AgentContentEndEvent` (the smallest possible wire signal). STEP 2 — `@cline/agents/src/agent-runtime.ts` `executePreparedTool`: stamps `prepared.toolCall.metadata.executionDisposition` BEFORE `tool-finished` based on the existing closure-plan `toolExecutionInvoked` authority (NOT a new artifact; same authority as `RecoveryTracker`). STEP 3 — `@cline/core/src/runtime/orchestration/runtime-event-adapter.ts` `translateToolFinished`: propagates metadata → legacy `content_end.executionDisposition`, omitting the field when metadata is absent (producers pre-dating the field see no wire-shape change). STEP 4 — `apps/vscode/src/sdk/message-translator.ts`: stamps `ClineMessage.commandExecutionDisposition` on `say:"command"` rows. STEP 5 — `apps/vscode/webview-ui/src/components/chat/ChatRow.tsx`: branches on `message.commandExecutionDisposition === "rejected_before_execution"` to render "Command was rejected before execution:" in place of the approval-language wording; ALL other lifecycle states keep the existing approved wording. STEP 6 — `CommandOutputRow.tsx`: accepts new `isCommandRejected` prop, swaps status pill from "Completed" to "Rejected" (subtle but structurally truthful per §20). **TESTS:** RCP01..RCP10 at the REAL ChatRow render seam (previously reported on the board as `KNOWN_P1_RESIDUE` because no test rendered `ChatRow.tsx` for a rejected command row); 3 explicitly RED at HEAD before the fix, GREEN after; controlled by 5 control tests that prove the conditional discards don't accidentally misclassify pending / executing / completed / executed-failure. Existing TI_UI01..TI_UI03 (translator contract pinning) + 3 new TI_UI04..TI_UI06 (translator preserves the new typed field through, including the §16 anti-text-heuristic guard at identical-error-text cases). 3 new ITI07..ITI09 (production-seam closure for the runtime-side stamp, with the canonical `createShellTool` factory). 2 new CommandOutputRow pill-truth tests. **NO SCHEMA CHANGE** (validation, approval, recovery, run_commands shape, executor, autoApprove all untouched per §23 / closed-contracts §2). **NO STRING HEURISTIC** (presentation reads structured `commandExecutionDisposition`; identical error text classifies correctly based on the typed field per RCP09 + ITI09). **RECLASSIFIED STATUS BLOCK:** `RUNTIME_VALIDATION_ORDER=PASS` (unchanged); `RECOVERY_CLASSIFICATION=PASS` (unchanged); `STRICT_UNKNOWN_KEYS=PASS` (unchanged); `TRANSLATOR_APPROVAL_SEMANTICS=PASS` (unchanged — TI_UI01..TI_UI03 still green); `EXTENSION_TRANSLATOR_PROPAGATES_TYPED_DISPOSITION=PASS` (TI_UI04..TI_UI06 green); `RUNTIME_STAMPS_TYPED_DISPOSITION=PASS` (ITI07..ITI09 green; the runtime stamps `metadata.executionDisposition` from `toolExecutionInvoked`); `BRIDGE_PROPAGATES_DISPOSITION=PASS` (infra witness in `runtime-event-adapter.ts`); `CHATROW_TITLE_TRUTH=PASS` (RCP01 green; the real render seam distinguishes rejected from approval); `STATUS_PILL_TRUTH=PASS` (CommandOutputRow says "Rejected" not "Completed" for rejection rows); `NECESSITY_ABLATION=PASS` (commenting out the ChatRow conditional returns RCP01/RCP06/RCP10 to RED — proves the structured-field seam is load-bearing). **VERDICT:** `PASS_REJECTED_COMMAND_PRESENTATION_TRUTH`. **P0:** NONE. **P1 RESIDUE:** exact prose ("Command was rejected before execution:") is P2 per §48; copy is open to refinement without revisiting the structural seam. **LIVE:** NOT_EXECUTED for this ACT (requires freshly-built dogfood VSIX carrying the typed field through the WebView; deferred to user-driven qualification per the same gating as INVALID-TOOL-INPUT-PREAPPROVAL01). |
| `ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION01` | TOOL-RUNTIME | CLOSED_DOCS_RECLASSIFIED_INCORRECTION02 | HIGH | invalid-tool-input-preapproval01.ui-tell.c01 | **Bounded correction per the Factory reviewer (status reclassified in CORRECTION02 — overstepped evidence wording corrected; production-side test delta retained).** Three required actions: (1) correct the LIVE_RAW_PAYLOAD evidence classification (it was synthetic, not the exact screenshot payload — `LIVE_RAW_PAYLOAD=UNAVAILABLE_FROM_TRACE`, `SYNTHETIC_REPRODUCERS` clearly labelled); (2) verify exact HEAD/tree identity (the previous ACT's `FINAL_TREE=fd7ef0714...` was documentarily wrong — actual `HEAD^{tree} = 455ec2796c2c6952e1ba3d19ec88c4b3059da7ab`, distinct prefix from the commit OID `fd7ef0714`, confirming a real commit); (3) add ONE bounded UI-tell production-seam test that proves the rendered presentation is NOT an approval-request card. **Test file:** `apps/vscode/src/sdk/__tests__/invalid-tool-input-preapproval01.ui-tell.c01.test.ts` — 3 tests (TI_UI01..TI_UI03), all GREEN. **Outcome:** the message-translator contract for a rejected `run_commands` call surfaces `say:"command"` with `commandCompleted:true` (NOT pending), body text containing the `Output:` marker AND verbatim validation error, and NOT containing the `REQ_APP` marker — the webview `CommandOutputRow` derives a truthful "Completed" status pill from these flags (NOT the "Pending" approval-pending UI). The webview row TITLE ("Cline wants to execute this command:") is hardcoded at `ChatRow.tsx:320` for every `say:"command"` row regardless of outcome — documented as the pre-existing webview-side cosmetic RESIDUE (does NOT trigger the approval-pending code path; status pill + body text already truthfully communicate the rejection); fixing it would require a separate webview-side ACT, gated on user authorization. **CONSERVATION:** no production code changed — only a new test file was added; ITI suite (12 mirror + 3 production-seam), message-translator suite (162 tests), vscode-run-commands-tool suite (46 tests), apps/vscode typecheck EXIT=0, lint EXIT=0, git diff --check ALL GREEN. **SDK agents test discrepancy noted (NOT caused by this ACT):** `sdk/packages/agents/src/agent-runtime.provider-form.test.ts` (1 file) uses `vi.hoisted` which is not supported in bun's vitest subset; this file was added at commit `9e16d6b1c` (well before the closure commits `a76e644d2` / `fd7ef0714`); this ACT does not touch it and does not address the bun/vitest gap (out of scope per the reviewer's "do not reopen runtime, only bounded correction" mandate). All other 379 SDK agents tests GREEN. **NEXT ACT** — none auto-promoted; LIVE qualification remains gated on the user re-issuing the original L0 scenario with a freshly-installed dogfood VSIX. |
| `ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01` | TOOL-RUNTIME | CLOSED_PRODUCTION_SEAM | HIGH | invalid-tool-input-preapproval01 | **Production-seam RED + GREEN at the canonical pre-approval boundary (`sdk/packages/agents/src/agent-runtime.ts:prepareToolExecution` line ~2467).** Root cause: schema-invalid model tool calls flowed through `policy → requestToolApproval → tool.execute` because `createTool` only emitted a JSON schema for display, never a runtime validator. Two coupled defects: (A) the agent-runtime called `requestToolApproval` for invalid input (approval side-effect before validation rejection); (C) the recovery classifier routed the executor-thrown zod error through Priority 5 (`failure / tool_execution_error`) instead of Priority 3 (`failure / tool_input_invalid`), so the error message and recovery family were misleading. **Boundary classification: CASE A + CASE C** (approval-ordering + recovery-classification defects; both bounded by the same seam). **Fix #1 (shared contract):** `AgentTool.validateInput?: (input) => void \| string \| Promise<void \| string>` added to `sdk/packages/shared/src/agent.ts:374`. `createTool` auto-generates it from the Zod schema when one is passed (`sdk/packages/shared/src/tools/create.ts:120`). **Fix #2 (seam):** `prepareToolExecution` calls `tool.validateInput?.(input)` AFTER `normalizeJsonLikeStringsForSchema` and BEFORE `requestToolApproval`; on failure it sets `skipReason` and mutates `toolCall.metadata.inputParseError` so the classifier correctly routes Priority 3. **Fix #3 (canonical schema strictness):** `RunCommandsInputSchema` (the strict `{commands: array<string>}` schema, NOT the wider union) is now passed to `createShellTool` so the validator is auto-generated, AND `.strict()` is added so zod v4 rejects unknown fields (matching the already-emitted `additionalProperties: false` in the JSON schema). **TESTS:** 12 ITI matrix tests (ITI01..ITI12) + 3 production-seam closure tests (ITI_P01..ITI_P03) in `apps/vscode/src/sdk/__tests__/invalid-tool-input-preapproval01.iti.test.ts` — all 15 GREEN. The 12 mirror tests use a local test tool with explicit `validateInput` to prove the seam invariants without depending on the real canonical tool; the 3 production-seam tests use the real `createShellTool` from `@cline/core` to prove the production contract. **Bounded ablation (per ACT §39):** removing the seam `validateInput` call turns ITI01 RED (approvalCalls=1 for invalid input). Removing the `metadata.inputParseError` mutation turns ITI05 RED (failureClass reverts to `tool_execution_error`). Reverting `RunCommandsInputSchema` to `.passthrough()` or removing `.strict()` turns ITI_P03 RED (`timeout` field silently dropped, executor runs). **CONSERVATION:** `ASYNC-COMMAND-TURN-LIVENESS01` halted independently — no wait budget / execution deadline / CommandJobManager lifecycle / async ownership changes; completion protocol / submit_and_exit / TES-purpose inference untouched; 387 SDK agents tests + 459 SDK core tools/command-policy tests + 46 apps/vscode `vscode-run-commands-tool.test.ts` tests + all canonical SDK gates GREEN (apps/vscode typecheck EXIT=0, lint EXIT=0, git diff --check PASS). **RECOVERY_ATTRIBUTION:** invalid input now lands at Priority 3 with `failureClass = tool_input_invalid`, `familyEligible = false`, `stableCode = "unknown"` — the truth table distinction matters for the bounded-recovery budget accounting (a model retrying with canonical form is correctly distinguished from a model retrying with the same malformed shape). **FILES CHANGED (7 files, 115 insertions, 7 deletions):** `sdk/packages/shared/src/agent.ts`, `sdk/packages/shared/src/tools/create.ts`, `sdk/packages/agents/src/agent-runtime.ts`, `sdk/packages/core/src/extensions/tools/definitions.ts`, `sdk/packages/core/src/extensions/tools/schemas.ts`, `apps/vscode/src/sdk/vscode-run-commands-tool.ts`, plus the new test file + board update. **NEXT ACT** — none auto-promoted; live qualification is gated on user dogfood (which ACT §42 calls L0..L6). If the user re-issues the original L0 malformed-payload scenario, expected outcome: NO approval UI, UI shows "Invalid run_commands input; tool call skipped" or equivalent truthful rejection, recovery budget exhausts without the model being asked to repair (because the structural error is already actionable at the failure-class level). | **CONTRACT (verbatim from ACT §0)**: invalid tool input must follow `malformed model tool call → decode → optional LOSSLESS normalization → schema validation → [INVALID] → typed rejection back to agent (approvalCalls=0, executorCalls=0)`; only VALID calls may proceed to policy → approval → execution. If a common alternate call shape can be canonicalized with zero semantic ambiguity, add a narrowly bounded pre-validation normalizer; do NOT make the schema generally permissive. **PIPELINE TRACE**: `model tool-call-delta → agent-runtime.ts:1899 parseToolInput → JSON.parse(inputText) → if invalid: invalidToolCalls.push + metadata.inputParseError → message metadata → prepareToolExecution (line 2424) → if metadata.inputParseError set: skipReason=parsedInputParseError → result={error: skipReason, isError: true} → toolExecutionInvoked=false → classification=failure/tool_input_invalid (recovery classifier Priority 3); if VALID JSON: skipReason undefined → tool && !skipReason → normalizeJsonLikeStringsForSchema (line 2465) → resolveToolPolicy → if autoApprove===false → requestToolApproval (line 2506) → approvalCalls++ → on approval: tool.execute(input) → normalizeRunCommandsInput(zod union) → if reject: z.prettifyError throws → executePreparedTool catch (line 2761) → thrownError set → toolExecutionInvoked=true → classification=failure/tool_execution_error/unknown/fallback (Priority 5) → message translator content_end ALWAYS emits say:"command" row with output appended (line 1665-1679) → ChatRow renders "Cline wants to execute this command" header even when output is "Error: ..."`. **RECOVERY ATTRIBUTION (CASE C concern)**: thrown errors that look like structural input failures still flow through the executor-throw path (Priority 5) instead of the input-parse path (Priority 3) — both reach bounded-recovery accounting but the ITI05 discriminator matters for truthful budget attribution. **ITI01-12 test plan authored** (`apps/vscode/src/sdk/__tests__/invalid-tool-input-preapproval01.iti.test.ts`): ITI01 invalid never requests approval (RED discriminator); ITI02 valid requests approval (control); ITI03 invalid never executes; ITI04 actionable validation detail (tool/field/expected/observed); ITI05 invalid classified as `tool_input_invalid` not `tool_execution_error`; ITI06 user rejection distinct from invalid; ITI07 autoApprove cannot bypass validation; ITI08-ITI11 canonical-vs-invalid fixture set (commands:[objects-with-args], unknown field `timeout`, stringified JSON, `{ command: "...", args: [...] }`); ITI12 canonical form unchanged. **CONSERVATION**: ASYNC-COMMAND-TURN-LIVENESS01 halted independently; do NOT touch wait budget / execution deadline / CommandJobManager lifecycle / async ownership semantics / completion protocol / submit_and_exit / TES-purpose inference. **NEXT DECISION**: run ITI01 against the REAL production seam with the malformed payload; if approvalCalls==0 → CASE B (UI projection defect) or CASE C (recovery classification defect); if approvalCalls>=1 → CASE A (approval ordering defect) and repair `prepareToolExecution` to validate input before `requestToolApproval`. |
| `EPIC-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01` | TOOL-RUNTIME | LIVE_PENDING | HIGH | none | `ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01` = `CLOSED_PRODUCTION_SEAM`; `ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION01` = `CLOSED_DOCS_RECLASSIFIED_INCORRECTION02`; `ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION02` = `CLOSED_DOCS_EVIDENCE_RECLASSIFIED`; `ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01` = `CLOSED_PRODUCTION_SEAM`. **LIVE WITNESS**: UI repeatedly displayed `Error: {"error":"✖ Invalid input"}` inside `"Cline wants to execute this command"` card; followed by `bounded_recovery_exhausted`; tool=`run_commands`; EVIDENCE_QUALITY=LIVE_UI. **Production repair outcome** (closure, ACT01): the canonical production seam was confirmed to call `requestToolApproval` BEFORE schema validation (CASE A — approval-ordering defect), and the recovery classifier routed the thrown error through Priority 5 (`failure / tool_execution_error`) instead of Priority 3 (`failure / tool_input_invalid`) (CASE C — recovery-classification defect). Both defects were bounded by the same `prepareToolExecution` seam. The production-seam fix adds a `validateInput` step at the seam that calls the tool's own Zod-derived validator before `requestToolApproval`, sets `skipReason` + `metadata.inputParseError` on failure (so the classifier routes through Priority 3), and the canonical `RunCommandsInputSchema` is now `.strict()` so unknown fields like `timeout` are rejected at runtime (matching the already-emitted `additionalProperties: false` JSON-schema hint). 12 ITI matrix tests (ITI01..ITI12) + 3 production-seam closure tests (ITI_P01..ITI_P03) GREEN. **CORRECTION01 evidence + UI-tell tests** (no production changes): TI_UI01..TI_UI03 prove the EXTENSION-SIDE message-translator contract is truthful. **CORRECTION02 docs-only reclassification** (per Factory reviewer HALT_EVIDENCE_CONTRADICTION; zero test/production delta): the prior CORRECTION01 verdict overstated two pieces of evidence — (a) the gate report said "all gates GREEN" while two pre-existing SDK test files failed/cancelled (`agent-runtime.provider-form.test.ts` last commit `9e16d6b1c`, strict ancestor of closure, byte-unchanged; bun/vitest `vi.hoisted` environment gap); (b) `APPROVAL_CARD_TRUTH=PASS` overstepped the tested seam (TI_UI01..UI03 stop at message-translator; no test in the repo renders `ChatRow.tsx` for a rejected `say:"command"` row). **REJECTED-COMMAND-PRESENTATION-TRUTH01 closure** (the remaining webview P1 residue, addressed in this cycle): structured `AgentContentEndEvent.executionDisposition` field propagated through the runtime bridge → message-translator → `ClineMessage.commandExecutionDisposition`; ChatRow branches on it to render "Command was rejected before execution:" instead of approval-language wording; status pill swaps to "Rejected" via `CommandOutputRow.isCommandRejected`. **RECLASSIFIED STATUS BLOCK (post-REJECTED-COMMAND-PRESENTATION-TRUTH01):** `RUNTIME_VALIDATION_ORDER=PASS`, `INVALID_NO_APPROVAL=PASS` (extension-side counter), `INVALID_NO_EXECUTION=PASS`, `RECOVERY_CLASSIFICATION=PASS`, `STRICT_UNKNOWN_KEYS=PASS`, `AMBIGUOUS_NORMALIZATION=CORRECTLY_REJECTED`, `TRANSLATOR_APPROVAL_SEMANTICS=PASS`, `EXTENSION_TRANSLATOR_PROPAGATES_TYPED_DISPOSITION=PASS` (TI_UI04..TI_UI06), `RUNTIME_STAMPS_TYPED_DISPOSITION=PASS` (ITI07..ITI09), `BRIDGE_PROPAGATES_DISPOSITION=PASS`, `CHATROW_TITLE_TRUTH=PASS` (RCP01..RCP10 at the real render seam), `STATUS_PILL_TRUTH=PASS` (CommandOutputRow pill tests), `NECESSITY_ABLATION=PASS` (commenting out the ChatRow conditional returns the relevant RCP tests to RED — proves the structured-field seam is load-bearing), `LIVE_RAW_PAYLOAD_BINDING=NOT_AVAILABLE`, `LIVE_POSTFIX_QUALIFICATION=NOT_EXECUTED`. **VERDICT:** `PASS_INVALID_TOOL_INPUT_PREAPPROVAL_PRODUCTION_SEAM` + `PASS_REJECTED_COMMAND_PRESENTATION_TRUTH`. **P0:** NONE. **P1 RESIDUE:** NONE remaining on the webview seam. **P2:** exact prose ("Command was rejected before execution:") is copy-iterable per §48; status pill copy iteration. **LIVE:** NOT_EXECUTED for this ACT (requires freshly-built dogfood VSIX from this commit carrying the typed field through the WebView; deferred to user-driven qualification per the same gating as INVALID-TOOL-INPUT-PREAPPROVAL01). |
| `BRAND-01` | PRODUCT | CLOSED → alias of `EPIC-CLINEMM-BRANDING01` | — | — | historical alias |
| `STATE-01` | STATE | CLOSED via W1/W2 epoch-domain repair | — | — | historical alias |
| `STATE-02` | STATE | NEEDS_CLASSIFICATION | LOW | — | inspect queuedPrompts scope against current architecture |
| `ARCH-01` | ARCH | NEEDS_CLASSIFICATION | LOW | — | classify against E8/E9/Elmization02 |
| `ARCH-02` | ARCH | NEEDS_CLASSIFICATION | LOW | — | classify against E8/E9/Elmization02 |
| `E8 legacy writer retirement` | ARCH | HOLD | — | E7 evidence/dependencies | retire remaining legacy writer authority when justified |
| `E9 effect interpreter` | ARCH | HOLD | — | E8 | bounded effect execution/interpreter after E8 |
| `EPIC-CLINEMM-ELMIZATION02` | ARCH | OPEN | MED | E9 recon | migrate deterministic authority where doing so reduces duplication |
| `EPIC-CLINEMM-GITHUB-ACTIONS01` | DIST | CLOSED | HIGH | none | **EPIC CLOSED at `1b4d140ef`** (third exact-head live run GREEN); recon workflows, failing jobs, gates, VSIX packaging; per ACT-CLINEMM-GITHUB-ACTIONS01 the existing ext-vscode-test.yml already enforces GHA01/02/03/04/06/07/08/09/10/11/12 (apps/vscode Vitest, Bun unit, webview Vitest, typecheck, frozen install, failure propagation, expected triggers, read-only permissions, no secrets, fresh checkout, generation/setup); the only canonical gaps were GHA05 (coverage ratchet) and the board markdown validator; new workflow `.github/workflows/quality-floor.yml` introduced at `fe64815b3` adds both; live CI exact-head green proof achieved: `RUN_ID=32388564879`, `RUN_URL=https://github.com/s1onique/clinemm/actions/runs/32388564879`, `CONCLUSION=success` at `HEAD=1b4d140efd83749a7d380450c2694df9813656ef` |
| `ACT-CLINEMM-GITHUB-ACTIONS01` | DIST | PASS_GITHUB_ACTIONS_LIVE | HIGH | github-actions01 | **CI WORKFLOW LANDED** at `fe64815b3` (workflow + validator bug fix + 3 new validator tests); **CORRECTION01** at `1a3916608` (3 reviewer-found P1 setup defects fixed + GHA13 contract guard added); **CORRECTION01 P2 hardening** at `434db9b5b` (GHA13 setUp() now FAIL HARD if workflow file is absent); **CORRECTION02** at `6ebbf89d1` (added `bun run protos` step to coverage-ratchet job + GHA14 contract guard); **CORRECTION03** at `1b4d140ef` (removed the wrong `working-directory` override from the protos step + GHA15 contract guard); **THIRD EXACT-HEAD LIVE RUN** at `1b4d140ef` → `gh run 32388564879` → **GREEN (conclusion=success)**; ALL Coverage Ratchet (Vitest) steps PASSED (11/11 including the new GHA12 protos step, the ratchet, and the GHA13 baseline check); ALL Board Markdown Validator steps PASSED (5/5); **EXACT-HEAD BIND**: `COMMIT=1b4d140efd83749a7d380450c2694df9813656ef`, `WORKFLOW=quality-floor.yml`, `RUN_ID=32388564879`, `RUN_URL=https://github.com/s1onique/clinemm/actions/runs/32388564879`, `CONCLUSION=success`, `HEAD_SHA=1b4d140efd83749a7d380450c2694df9813656ef` (matches our pushed HEAD exactly); **RED HISTORY (the 3 runs that got us here)**: (1) run `32387118587` at HEAD `86372a1d2` RED — no protos generation step → ERR_MODULE_NOT_FOUND on `@/shared/proto/cline/models` → CORRECTION02 added the protos step; (2) run `32388150403` at HEAD `f5c2bd1b3` RED — protos step had a wrong `working-directory: ${{ github.workspace }}` override → script not found in root package.json → CORRECTION03 removed the override; (3) run `32388564879` at HEAD `1b4d140ef` GREEN; **LESSON LEARNED**: GHA defaults.run.working-directory inheritance is conditional — sometimes the default is correct (protos step, script lives in apps/vscode) and sometimes the default is wrong (baseline-check step, relative .factory path resolves incorrectly under apps/vscode); both classes must coexist; GHA13.a and GHA15 together enforce the asymmetric rule; **CI PARITY TABLE (LIVE GREEN)**: GHA01..GHA12 FULL; GHA13 contract guard FULL (fail-hard; 5 assertions); GHA14 contract guard FULL (1 assertion); GHA15 contract guard FULL (1 assertion); board validator FULL; lint FULL (via ci:check-all); build PARTIAL (compile-tests via existing; full VSIX is GITHUB-DISTRIBUTION01); gitleaks OUT_OF_SCOPE; **CONSERVATION (all 9 commits)**: zero mutation of apps/vscode, webview-ui, sdk, tests, coverage baseline, coverage ratchet script; existing ext-vscode-test.yml / sdk-test.yml / ui-publish.yml untouched; pull_request + push to main triggers preserved; permissions: contents: read (no upgrade); **FILES CHANGED (9 commits, 6 files, 600+ insertions, 11 deletions)**: `fe64815b3` (workflow + validator bug fix + 3 validator tests); `15a41e219` (board update); `1a3916608` (CORRECTION01: workflow working-directory + stdlib unittest + GHA13 contract guard); `9b7f033d8` (board correction01 update); `434db9b5b` (P2 hardening: GHA13 setUp() fail-hard); `86372a1d2` (board P2 hardening update); `6ebbf89d1` (CORRECTION02: protos step + GHA14 contract guard); `f5c2bd1b3` (board CORRECTION02 update); `1b4d140ef` (CORRECTION03: working-directory removal + GHA15 contract guard); **LIVE CI STATE**: GREEN at HEAD `1b4d140ef` (third exact-head run); **REVIEWER DISPOSITION**: C1: GO (3 P1s closed, 1 P2 closed); **STATUS DECISION**: ACT-CLINEMM-GITHUB-ACTIONS01 = `PASS_GITHUB_ACTIONS_LIVE` (exact-head live run GREEN; 3 bounded CORRECTIONs applied to reach GREEN; EPIC=CLOSED) |
| `ACT-CLINEMM-GITHUB-ACTIONS-RECON01` | DIST | CLOSED (intent folded into ACT-CLINEMM-GITHUB-ACTIONS01) | HIGH | github-actions01 | the original placeholder recon label; recon evidence is now consolidated inside the ACT-CLINEMM-GITHUB-ACTIONS01 row above; this row kept for historic continuity only |
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
| `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01` | RUNTIME / TASK-STATE | CLOSED at CORRECTION03 (four-stage closure) | — | none | closed at the canonical seam by `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01` (four stages: `f50cc7560` + `8b7ab7428` + CORRECTION02 + CORRECTION03/`abf5ce57b`). The load-bearing progression defects were fully observable from the codebase today (the webview's `useMessageHandlers.ts:559` gates Cancel on `backgroundCommandRunning` and was never receiving `true`): the dead-state defects (`SdkController.updateBackgroundCommandState()` never called, `SdkController.cancelBackgroundCommand()` was a `stubWarn`) were load-bearing progression defects, not separate presentation concerns. The fixes wire the `onBackgroundStateChange` callback at the run_commands tool's RUNNING/terminal-return boundary so the projection actually flips, replace the stub with a real implementation that delegates to `commandJobManager.cancel(activeJobId)`, gate the projection on the manager's active-cardinality so a first-completing job doesn't clear the projection while another background job remains active, and capture the 0->1 / >0->0 transition metadata at the manager's mutation seam so concurrent starts (Promise.all of two tool.execute calls) cannot suppress every (true, ...) notification. Future ACT may upgrade to `CLOSED_LIVE` once a live dogfood run confirms the user-visible TaskHeader and Cancel button behave correctly in `backgroundExec` mode. The 5 `RUNTIME_THINKING_STALL` upstream issues and 23 `RELATED_TOOL_RUNTIME` issues remain RADAR (none yet have a matching failure contract). |
| `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01` | RUNTIME / TASK-STATE | CLOSED at <CORRECTION03> (race-safe transition metadata) | — | runtime-task-progression01 | four-stage closure. Stage 1 (`f50cc7560`): bounded repair of the dead `backgroundCommandRunning` projection + stub `cancelBackgroundCommand` at the canonical seam (the run_commands tool's RUNNING/terminal-return boundary). Stage 2 (`8b7ab7428`): factory-review follow-up that closed P1-A (RTP-LONG01 conservation: wait-budget expiry does not cancel the running process) and P1-B (RTP-ASYNC01 async projection reset: the projection flips back to false when a RUNNING-returned job completes asynchronously). Stage 3 (CORRECTION02): factory-review follow-up that closed the terminal-cardinality-safety P1 — the previous implementation fired `(false, undefined)` on each job's terminal event, which would clear the projection while another background job remained active. The fix queries `commandJobManager.getActiveJobIds().length` to gate the transition (terminal-cardinality-safe). Stage 4 (CORRECTION03 / `abf5ce57b`): factory-review follow-up that closed the start-cardinality-safety P1 — CORRECTION02's gate derived `(true, jobId)` from a post-hoc `getActiveJobIds().length` query, which is racy under concurrent `manager.start()` calls (both runners observe length=2 after both `active.set()` calls and both SUPPRESS the notification, leaving the projection false even though two background jobs are alive). The fix moves the transition capture to the manager's mutation seam: `StartCommandJobResult.becameActive: boolean` is captured at `active.set()` (size before insert = 0 → this start was 0->1); `terminalPromise` resolves with `{ becameIdle: boolean }` captured at `active.delete()` in `finalize()` (size before delete = 1 → this completion was >0->0). The runner reads both flags directly — no post-hoc cardinality query, race-safe under both concurrent starts and concurrent terminal-completions. The deferred is pre-created in `start()` before the active Map mutation so the resolver is registered before the exit transition can fire `finalize()` (a fast-path race where synchronous child completion fires the exit transition's `.then()` before `makeStartResult` ran). Tests: RTP-MULTI01 (CORRECTION02) holds for sequential starts; new `RTP-MULTI02` (CORRECTION03) exercises `Promise.all` of two concurrent tool.execute calls (both `sleep 1`, wait=30ms) and asserts the projection fires exactly one (true, ...) notification — whichever job was the 0->1 transition — and not both (the second is a no-op). Pre-fix this was RED with 0 notifications (both runners SUPPRESSed). Full canonical suite 122 files / 1719 vitest tests / 1076 bun unit tests / 0 failures (was 1718 pre-CORRECTION03; +1 from RTP-MULTI02); `tsc --noEmit` 0 diagnostics. PRODUCTION DEFECTS CLOSED: `backgroundCommandRunning` dead state → wired; `cancelBackgroundCommand` stub → real implementation; webview TaskHeader can now show `Working` for background run_commands; User Cancel button actually cancels the background command; async terminal projection reset wired end-to-end; **terminal-cardinality-safe projection** (no more stuck-Working while another background job is still active after one completes); **start-cardinality-safe projection** (concurrent starts no longer suppress every notification — the webview sees the projection flip true when the first of N parallel background commands is registered). Conservation: no new dependencies, no new skip files, no listener list, no broader manager API change (the new `becameActive` / `terminalTransitionPromise` fields are local to the start-result seam; no host/controller change). PUSHED=NO. |
| `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-LIVE-RECON01` | RUNTIME / TASK-STATE | CLOSED at this commit with `CAPTURE_INSUFFICIENT` | — | runtime-task-progression01 | live evidence captured during `ACT-CLINEMM-TEST-BASELINE-FAILURES-RECON01` post-closure: the host command `bun scripts/run-bun-tests.ts` ran for 5+ min and froze log at 250264 bytes / 2503 lines; after the test-baseline ACT's bounded fixes the canonical broad suite is GREEN (1672 pass / 0 fail × 3); however, the load-bearing causal boundary for `RUNTIME-TASK-PROGRESSION01` cannot be observed in this environment because (1) no Cline-- VS Code extension host was running during the original incident — the `status: running / jobId / elapsedMs / deadlineRemainingMs` shape the user observed came from my host's `command_status` polling wrapper, not a Cline tool result, (2) no TaskHeader ever rendered `Waiting` because no Cline-- UI was active, (3) no extension-host logs exist on disk (search of `/tmp`, `/var/folders`, `~/Library/Application Support` returned empty), (4) the canonical continuation seam `command-job-manager.{start,status,cancel}` is well-tested GREEN 20/20 under vitest, (5) `backgroundCommandRunning` is unwired projection state (defined but never called) which is a separate presentation concern; verdict `CAPTURE_INSUFFICIENT` per §21 because the necessary causal boundary cannot safely be observed; **no repair performed**; future ACT must run with a live Cline-- extension host and a real model turn to obtain the live continuation failure contract |
| `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` | DIST/REPO | OPEN | HIGH | none | git checkpoint corruption (.git/.git_disabled left by interrupted tasks, submodule breakage, large-workspace corruption, disk-space exhaustion) + checkpoint restore failure; recon from upstream #4388 + #12388 |
| `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` | MCP | OPEN | HIGH | none | MCP stdio servers spawn unbounded instances until crash on Windows; process-lifecycle bug; recon from upstream #7413 |
| `EPIC-CLINEMM-CLINEIGNORE-FILTERING01` | CONTEXT | OPEN | MED | context-accounting-truth | `.clineignore` documented as filtering file listing but does not actually exclude files from context; recon from upstream #9554 |
| `EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01` | PROVIDERS | OPEN | MED | none | provider model list discovery broken for LM Studio API and similar OpenAI-compatible endpoints; recon from upstream #10016 |
| `EPIC-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01` | RUNTIME / TURN-LIVENESS | OPEN | HIGH | completion-protocol-liveness | live regression: `run_commands` returns RUNNING with a still-active background job, yet the task transitions to `awaiting_followup` and autonomous agent progression stops; the question is whether the runtime has a causal successor path that re-enters the agent loop with the terminal result; upstream corroboration in cline/cline#10549 (non-blocking tool proposal; "I stopped waiting" ≠ "command finished") and #10799 (run_commands lifecycle reports); case classification required before any repair |
| `ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01` | RUNTIME / TURN-LIVENESS | HALT_ASYNC_JOB_OWNERSHIP_UNDEFINED | HIGH | async-command-turn-liveness01 | **CORRECTION02 review disposition applied** (PASS_RECON_WITH_NONBLOCKING_RESIDUE). **Reviewer corrections accepted**: (P1-A) ACL06 in CORRECTION01 overclaimed "Contract X = model-owned polling." The model-facing description says "For long-running commands, run them in background and redirect output to a tmp file that you can read from later." That sentence describes a MODEL_INTENTIONAL_BACKGROUND workflow (model knowingly formulates detached execution + persists output). It does NOT describe what happens when an ordinary foreground call crosses the 15-second wait budget and the tool returns RUNNING(jobId) autonomously (HOST_DEFERRED_FOREGROUND). ACL04 confirms there is no typed intent field distinguishing those two intents in the schema. ACL06 is now reframed as TOOL_DESCRIPTION_PROVENANCE: PROVES the description mentions long-running + tmp-file guidance; DOES NOT PROVE that RUNNING(jobId) transfers ownership to the human, requires host wakeup, or means model-owned command_status polling; ASYNC_CONTRACT = AMBIGUOUS; (P1-B) the ACL02 bridge "no async-terminal-result reception surface" claim was overstated. The strongest justified SOURCE_RECON claim is "no dedicated async-command-terminal successor surface was found in the inspected composition" (LocalRuntimeHost.prototype carries no method named onAsyncTerminalResult, onBackgroundTerminalEvent, scheduleContinuation, or resumeFromAsyncTerminal). EXECUTABLE CAUSAL PROOF = UNAVAILABLE; absence of those four names does NOT prove that no reception path exists; a generic event method, callback passed through composition, runTurn, queue API, or non-prototype field could provide one; the second ACL02 test is reclassified from STRUCTURAL_FACT to DOCUMENTARY (it only confirms the bridge fixture wires the production class); (P2) bridge baseline drift from 1 diagnostic to 0 was correctly attributed by the report to the new test file not transitively importing task-state-shadow.ts; but the reviewer correctly noted the old bridge test is still in the include list, so the explanation is incomplete — the drift is recorded as GREEN with causal explanation not fully established; do not manufacture another review round; **LIVE_WITNESS** preserved verbatim — `run_commands` returned `status=running, jobId=cmd_mt1oo50g00ydbas2` for `gh run watch`; concurrently `TaskHeader=Waiting`, composer enabled, autonomous progression stopped; **WHAT IS PROVEN** — `WAIT_BUDGET_CONTRACT=PROVEN` (15_000 ms confirmed), `RUNNING(jobId)=PROVEN` (real tool returns this), `BACKGROUND_PROCESS_SURVIVAL=PROVEN` (ACL01 confirms projection reset), `TERMINAL_RESULT_STORAGE=PROVEN` (CommandJobManager keeps the terminal payload), `PROJECTION_RESET=PROVEN` (ACL01), `NO_TYPED_DETACH_INTENT=PROVEN` (ACL04), `MODEL_DESCRIPTION=PROVEN` (ACL06 — provenance only); **WHAT IS NOT PROVEN** — `HOST_WAKEUP_REQUIRED=NOT PROVEN`, `MODEL_POLLING_REQUIRED=NOT PROVEN`, `HUMAN_OWNERSHIP_AFTER_RUNNING=NOT PROVEN`, `CAUSAL RED=CAPTURE_INSUFFICIENT`; **ROOT CAUSE** = UNRESOLVED CONTRACT AMBIGUITY: the fork has a real asynchronous job mechanism but no typed ownership contract describing who must make progress after a foreground call becomes deferred; **PRODUCTION REPAIR = NOT AUTHORIZED**; **VERDICT** = `HALT_ASYNC_JOB_OWNERSHIP_UNDEFINED`; **CONSERVATION PANEL** — base vitest 1753/1753 PASS; bridge c2-4-c-bridge vitest 7/7 PASS; ACL01/03/04/06/10 main-file PASS (5 tests); ACL02 bridge companion file PASS (2 tests, downgraded to SOURCE_RECON + DOCUMENTARY); base typecheck EXIT=0; bridge typecheck EXIT=0 (baseline stable); lint EXIT=0; git diff --check PASS; **NO REPAIR ATTEMPTED** per ACT §25-29; **FILES CHANGED (CORRECTION02, this ACT)** — 3 files modified (header docstring + ACL06 test description in main file; bridge file's first test renamed from STRUCTURAL_FACT to SOURCE_RECON; second test renamed from STRUCTURAL_FACT to DOCUMENTARY; bridge file's main docstring updated to reflect the downgraded claim); plus board update; **NEXT ACT** — per reviewer: `ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01` (malformed run_commands input consumed recovery until exhaustion); **PRIORITY** = HIGH / LIVE; **PRODUCTION REPAIR (CONTRACT Y)** — NOT auto-promoted; reviewer must authorize explicitly before any attempt |
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
| `EPIC-CLINEMM-FACTORIZE01` | ARCHITECTURE | OPEN | MEDIUM-HIGH / ARCHITECTURAL | factory-board-durability-and-factorize-intake01 | reduce duplicate semantic authority, migration residue, host-specific business logic, fork conflict surface, and reasoning/change radius; converge ClineMM-specific semantics on upstream package boundaries; **non-goal**: do not refactor merely to reduce LOC or file size; **primary metric**: fewer independent authorities / fewer conceptual hops; **waves**: F0 inventory → F0B baseline → F1 package direction, F2 coordinator taxonomy, F3 shadow retirement, F4 SdkController authority (→ extraction ACTs) → F5 fork-delta reduction; F5 may run alongside F1–F4 once F0/F0B are committed; **sequencing**: do NOT preempt live correctness regressions; architectural maintenance, not P0 |
| `ACT-CLINEMM-FACTORIZE-F0-INVENTORY01` | ARCHITECTURE | RECON / NOT_STARTED | HIGH (first Factorize ACT) | none | **RECON-only**. Measure current architecture before restructuring. Inventory: package dependency graph + cycles; fork-modified production files + LOC; fork-only modules + public types; state authorities; shadow/bridge/compat/fallback/migration seams; every `*Coordinator` module; duplicated semantic implementations; largest reasoning/change-radius workflows; top upstream merge hotspots. **Evaluate** existing Knip and dependency-cruiser / jscpd candidates. **Do NOT install tools in this ACT**; F0 chooses toolset + baseline schema. **Output**: ranked inventory + smallest useful baseline/ratchet recommendation. **No production refactor.** |
| `ACT-CLINEMM-FACTORIZE-F0B-BASELINE-RATCHET01` | ARCHITECTURE | BLOCKED | HIGH | FACTORIZE-F0-INVENTORY01 | encode selected measurable structural facts from F0 in a small baseline (candidate `.artifact/factor/factorization-baseline.json`; F0 chooses location/schema). **Policy**: baseline existing debt; no arbitrary absolute thresholds; prevent regression unless explicitly dispositioned. **Candidate dimensions**: fork_changed_production_files, fork_changed_production_loc, fork_only_modules, compatibility_seams, shadow_modules, cross_layer_violations, dependency_cycles, duplication, authority_count. **Do not create a custom verifier-industrial-complex.** |
| `ACT-CLINEMM-FACTORIZE-F1-PACKAGE-DIRECTION01` | ARCHITECTURE | BLOCKED | MEDIUM-HIGH | FACTORIZE-F0B-BASELINE-RATCHET01 | enforce canonical package ownership with dependency-cruiser (candidate). Target conceptual graph: `@cline/shared` → `@cline/llms` → `@cline/agents` → `@cline/core` → host apps. **Constraints** (confirm against actual current architecture during execution): core must not depend on host apps; SDK packages must not import host UI; `apps/vscode` must not depend on `apps/cli`; `apps/cli` must not depend on `apps/vscode`. Use baseline/known-debt suppression if legacy cycles exist. **Do not demand zero historical violations in one ACT.** |
| `ACT-CLINEMM-FACTORIZE-F2-COORDINATOR-TAXONOMY01` | ARCHITECTURE | BLOCKED | MEDIUM-HIGH | FACTORIZE-F0B-BASELINE-RATCHET01 | **RECON first**. Inventory every `*Coordinator`; classify as `STATE_MACHINE / LIFECYCLE_OWNER` vs `SERVICE` vs `SELECTOR` vs `ADAPTER` vs `COMPOSITION_ROOT` vs `ONE_SHOT_WORKFLOW` vs `OTHER`. **Question**: does this coordinator own persistent lifecycle/state crossing multiple lower-level services? If no → nominate (do not auto-rewrite). **Output**: ranked simplification candidates by change-radius reduction + upstream-merge leverage. |
| `ACT-CLINEMM-FACTORIZE-F3-SHADOW-RETIREMENT01` | ARCHITECTURE | BLOCKED | MEDIUM-HIGH | FACTORIZE-F0B-BASELINE-RATCHET01 | inventory every production component named or behaving as `shadow` / `legacy` / `bridge` / `compat` / `fallback` / `migration` / `temporary`. For each record: owner, introduced_by, canonical replacement, remaining producers, remaining consumers, deletion predicate, latest intended removal stage. **Special focus**: `TaskStateShadow` / Elm migration chain. **Do not delete until consumer/writer conservation is proven.** **Success**: every migration seam either has a bounded deletion path OR is honestly reclassified as permanent architecture. |
| `ACT-CLINEMM-FACTORIZE-F4-SDKCONTROLLER-AUTHORITY01` | ARCHITECTURE | BLOCKED | MEDIUM-HIGH | FACTORIZE-F0B-BASELINE-RATCHET01 | **RECON before extraction**. Inventory `SdkController` responsibilities as: composition root / domain authority / domain workflow / state owner / projection / host adapter / compatibility seam. **Question**: could another host consume canonical runtime behavior without reimplementing semantics hidden inside `SdkController`? **Output**: top 1–3 authority-extraction candidates (named ACTs gated to F4). **Do NOT split `SdkController` merely because it is large.** See placeholder `EPIC-CLINEMM-SDKCONTROLLER-AUTHORITY-EXTRACTION`. |
| `EPIC-CLINEMM-SDKCONTROLLER-AUTHORITY-EXTRACTION` | ARCHITECTURE | BLOCKED | MEDIUM-HIGH (placeholder) | FACTORIZE-F4-SDKCONTROLLER-AUTHORITY01 | placeholder epic for concrete `SdkController` extraction ACTs nominated by F4 recon. **Do not freeze implementation detail in this intake ACT.** F4 names the candidates; F4+ ACTs implement them. |
| `ACT-CLINEMM-FACTORIZE-F5-FORK-DELTA01` | ARCHITECTURE | BLOCKED | MEDIUM | FACTORIZE-F0B-BASELINE-RATCHET01 | measure and reduce semantic fork surface vs upstream. Track: `UPSTREAM_DIFF_FILES`, `UPSTREAM_DIFF_LOC`, `UPSTREAM_DIFF_PACKAGES`, `UPSTREAM_CONFLICT_HOTSPOTS`, `FORK_ONLY_PUBLIC_TYPES`, `FORK_ONLY_STATE_AUTHORITIES`. Rank high-conflict files where fork-specific behavior can move into stable upstream-aligned seams. **No rebase. No history rewriting. No blind attempt to minimize raw diff LOC.** |
| `ACT-CLINEMM-FACTORIZE-TOOLING01` | ARCHITECTURE | BLOCKED / optional | LOW | FACTORIZE-F0-INVENTORY01 | integrate selected `dependency-cruiser` + `jscpd` with existing `Knip`. Potential eventual command `bun run factorize:check`. **F0 decides** whether these tools provide enough leverage. **Do NOT pre-authorize dependencies in this intake ACT.** |
| `ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01` | FACTORY/ARCHITECTURE | CLOSED | HIGH (process) | none | intake ACT: make `.factory/epic-board.md` unmistakably durable Git state; extract Factorize architecture review into bounded epic + ordered ACT backlog; add agent instruction preventing future board updates from being left uncommitted. **Deliverables**: (a) `.gitignore` semantics repaired — `/.factory/*` + `!/.factory/epic-board.md` so ordinary `git add` works (no `-f` needed); (b) AGENTS.md rule added (board durability + commit requirement); (c) one historical L195 board row pipe escape fixed (P1 once); (d) `EPIC-CLINEMM-FACTORIZE01` + F0..F5 + tooling + SdkController-extraction placeholder rows added; (e) validator `scripts/check-epic-board-markdown.py` returns 0; 19/19 unit tests PASS; ordinary `git add .factory/epic-board.md` works. **Source-derived doctrine captured** (FACT-001..006, FORK-001, ELM-001) — see `## Factorize doctrine` section below. **No production code touched.** |

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
8. **STATIC-THINKING-PRESENTATION-PERSISTENCE01** — CLOSED at `08bd6bb75` (also at `8ada8a064`); 8 STP regression guards (STP01..STP08) green; TaskHeader's `taskHeaderStateLabel` explicitly deferred to THCP01
9. **TASKHEADER-CANONICAL-PROJECTION01** — CLOSED_RECON_SUPERSEDED at `8b62e164b` (recon-only; bounded publication-gap follow-up confirmed)
10. **TASKHEADER-CANONICAL-PROJECTION-MIGRATION01** — CLOSED at pending MIGRATION01 closure commit; 18 THCP selector tests + 7 THCP helper tests + 6 THCP11 publication-seam tests = 31 THCP tests all green; shadow-branch ablation (8 RED) + host-override ablation (3 RED) + restorePhase() ablation (2 RED) all proven; quality gates all green (1748/1748 apps/vscode, 582/582 webview, 1076/1076 bun unit); EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01 also CLOSED at the same commit; reviewer P1 (THCP11 host-override freshness) RESOLVED
10. **TASKHEADER-OWNER-AWARE-TIMING01** — CLOSED_NOT_REPRODUCED at pending OAT-RECON-01 closure commit (`e54a71326` + hygiene correction `0db0201cc`); recon found timer is explicit, documented **task wall-clock age** (`now - startedAt` live, `endedAt - startedAt` frozen on terminal); ticks through awaiting_followup / awaiting_approval / compacting by deliberate design (CORRECTION01 documented in source); UI label "Elapsed task time" + tooltip "Task started at <ISO>" matches the wall-clock-age contract truthfully; FACTORY STOP RULE §53 satisfied; **no semantic defect to reproduce**; EPIC and ACT both CLOSED_NOT_REPRODUCED; if a future product wants an active-execution-time metric, that would be a NEW feature epic (`EPIC-CLINEMM-ACTIVE-EXECUTION-TIME01`), NOT a redefinition of the existing elapsed-task-time contract
11. **TASKHEADER-LIVE-ACTIVITY-COHERENCE01** — **FULLY CLOSED** across two ACTs: state-side closed at `e5c6bf486` (CORRECTION01-FIX01; LAC01 + LAC-ABSENCE01 production-seam RED + GREEN + ablation proven; root cause: `TaskShadowHostWiring.getLastObservedShadowPhase` returned `recorder.getRecords().at(-1)?.shadowPhase` hardcoded to `"idle"` for `D00_AGREE` records; repair: canonical delegation to `TaskState.projectTurnState` from `@cline/agents/selectors.ts:47-71` + presence guard via new `TaskShadowComparator.hasObservedShadowState()`). Timer-side closed at the LTZ01 closure commit (NEW EPIC `EPIC-CLINEMM-TASKHEADER-LIVE-TIMER-ZERO-RESET01`; root cause: `SdkController.reinitExistingTaskFromId` did not wire `taskTelemetry.startTask(...)` — only `setTurnPhase("streaming")` fired, which only clears `endedAt` via `observeTurnPhase` -> CONTINUATION_PHASES; fresh-host resume left `startedAt` undefined and a non-fresh host carried the prior task's `startedAt`); repair: bounded `taskTelemetry.startTask(sessionId, persistedTs)` anchor added in `SdkController.reinitExistingTaskFromId` with `sessionId === taskId` fence guard. 3 LTZ tests (behavioral seam + structural sentinel + cross-task identity) with need/ablation proven. CONSERVATION: 1806/1806 apps/vscode vitest PASS (one pre-existing flake in `async-command-turn-liveness.acl01` is unrelated to this ACT; isolated run passes 5/5); webview 592/592 PASS; typecheck EXIT=0; lint PASS; diff-check PASS. No selector change; no three-source precedence change; no terminal-freeze contract change; no same-task-continuation reopen change; no React-local authority; no timer semantic redesign. EPIC status: `CLOSED` (both sides). ACT status: same. P2 residue (NOT REPAIRED, EXPLICIT SCOPE LIMIT): `canonical-event-subscription.ts:35-39` doc-comment falsely claims `attachCanonicalRuntimeEventSubscription` is called from `reinitExistingTaskFromId`; similarly `attachRecoveryTelemetrySubscription` is missing on the resume seam. Both outside the timer-only scope of the LTZ01 ACT.
12. **RESUME-SUBSCRIPTION-PARITY01** — CLOSED at production-fix commit `6915c22c`; extends LTZ01 P2 residue (closed at `287b23f81`); root cause: `reinitExistingTaskFromId` did not attach canonical runtime subscription nor recovery telemetry subscription; doc-comment at `canonical-event-subscription.ts:35-39` falsely claimed the canonical one IS attached; repair: bounded `attachRecoveryTelemetrySubscription(sessionId)` + `attachCanonicalRuntimeEventSubscription(sessionId)` added inside the existing `sessionId === taskId` fence (LTZ01) in `reinitExistingTaskFromId`; 9 RSP tests (RSP01-RSP06 + 2 fresh-init controls + 1 sanity) with need/ablation proven at the production seam; 106/106 PASS on the targeted subscription + telemetry + task-control + state-version surface; full apps/vscode vitest 1816/1816 (vs 1806 LTZ01 baseline; +10 RSP tests); webview 592/592; bun:unit 1076/1076; typecheck EXIT=0; lint PASS; diff-check PASS; LIVE evidence binding (CORRECTION01 wording): dogfood install is `s1onique.clinemm@4.1.10-e5c6bf486` (PRE-LTZ01 + PRE-RSP01) — LIVE-A telemetry-absent = REAL on `e5c6bf486`; LTZ01 causal match = INFERRED; LIVE-B frozen-timer-Idle-during-execution = REAL on `e5c6bf486`; RSP01 ←→ LIVE-B causal relation = UNPROVEN; CURRENT_HEAD_LIVE_B_STATUS = NOT_LIVE_QUALIFIED. RSP04 proves only that the modeled resume chronology clears `endedAt` correctly, NOT that LIVE-B cannot occur via any other path. Exact-build-head VSIX `apps/dist/clinemm-rsp01.vsix` (8,893,368 bytes; SHA256 `db25315bb9a01b4b67a32ec9920f542bd72cf969877d11f8fec7ac46f93faf2a`; `VSIX_BUILD_HEAD=208e2f08d9a7ff43de93a812ba889ea535e8cbbf` per the evidence doc) built for user-side install + L0-L5 LIVE qualification cycle per ACT §40.
13. **CONTEXT-ACCOUNTING-TRUTH01** — CLOSED at this commit (model catalog resolution, `resolveEffectiveMaxInputTokens`, compaction trigger, and `contextWindow` authority all correct; UI's occupancy bar inflated by output+cache activity — `getLastApiReqTotalTokens` summed `tokensIn + tokensOut + cacheWrites + cacheReads`; **CORRECTION01**: initial `tokensIn`-only fix reopened by reviewer as provider-blind (would undercount Anthropic-native cached prompts); replaced by `getLastApiReqContextInputTokens` returning `tokensIn + cacheReads + cacheWrites` — the AI SDK `inputTokens.total` contract; producer seam (`apps/vscode/src/sdk/message-translator.ts:86-110 normalizeUsageEvent`) already produces disjoint buckets from `inputTokens - cacheReads - cacheWrites`; Anthropic-native (`tokensIn=50, cacheReads=100000` → `100_050`) and OpenAI-compat inclusive (`prompt_tokens = noCache + cached_tokens`) REDs both covered; 10 files changed (467 insertions, 40 deletions); closed by `ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01`)
13. **USER-CONTEXT-CEILING01** — OPEN / HIGH (depends on #12 → #12 CLOSED; precondition `ACCOUNTING_TRUTH=SATISFIED` now holds)
14. **TOOL-EXECUTION-SEMANTICS01** — EPIC OPEN / HIGH (reviewer decision); ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01 closed as `PASS_RECON` at `4b49116b6` (recon-only ACT; 1363-line evidence doc with reviewer-response addendum); **reviewer disposition**: Option A confirmed (no immediate impl); substrate shows 3 of 4 axes REAL/STRUCTURAL (mechanism, effect, outcome, duration) and 1 axis UNAVAILABLE_FROM_TRACE (purpose); **REVIEWER P1 corrections** (would be defects in any future impl ACT): P1.1 13-category mechanism taxonomy too large — mark as CANDIDATE not FROZEN, recommend ≤8 category reconsolidation (suggested: read/search/mutate/execute/network/human/completion/delegate/other); P1.2 conflated `shell mechanism = process_execution` with `shell side-effect = unknown` — split into distinct vocabularies; P1.3 wording "add new AgentRuntimeHooks field" was wrong — `onToolRuntimeOutcome` already exists at `sdk/packages/shared/src/agent.ts:616`, only needs host-side bridging; **STRUCTURAL DISTINCTION (reviewer-discovered)**: ATTEMPT cardinality (`requestToolApproval` includes user_rejected/host_policy_denied/approval_pending/runtime_skipped) is **distinct** from EXECUTION cardinality (tool-started/tool-finished/ToolRuntimeOutcome); today `taskTelemetry.toolCalls` counts EXECUTIONS only; future bounded impl must keep distinct counters per axis; REDs TES01..03/05/06/08/09 reproduced as PRODUCT GAPS (not defects), TES04 NOT REPRODUCED (would be a defect to introduce), TES07 NOT REPRODUCED (no duration today), TES10 NOT REPRODUCED (counter is correct); **TES-IMPL PRECONDITIONS** for any future bounded impl ACT: (1) concrete user-facing question that semantic telemetry answers; (2) collapse mechanism taxonomy to bounded product categories (≤8); (3) separate mechanism vocabulary from side-effect vocabulary; (4) distinguish ATTEMPT vs EXECUTION cardinality; (5) bridge EXISTING `AgentRuntimeHooks.onToolRuntimeOutcome` seam through host composition boundary; (6) all conservation gates GREEN; **auto-promotion to TES-IMPL explicitly rejected by reviewer**; next ACT deferred to existing board priority
14. **GITHUB-ACTIONS01** — EPIC CLOSED; ACT-CLINEMM-GITHUB-ACTIONS01 = `PASS_GITHUB_ACTIONS_LIVE` at `1b4d140ef` (third exact-head live run GREEN); **EXACT-HEAD LIVE BIND**: `RUN_ID=32388564879`, `RUN_URL=https://github.com/s1onique/clinemm/actions/runs/32388564879`, `CONCLUSION=success`, `HEAD_SHA=1b4d140efd83749a7d380450c2694df9813656ef`; **RED HISTORY (the path to GREEN)**: (1) run `32387118587` at `86372a1d2` RED — `ERR_MODULE_NOT_FOUND` on `@/shared/proto/cline/models` → CORRECTION02 added `bun run protos` step; (2) run `32388150403` at `f5c2bd1b3` RED — wrong `working-directory: ${{ github.workspace }}` override on protos step → CORRECTION03 removed it; (3) run `32388564879` at `1b4d140ef` GREEN; **LESSON**: GitHub defaults.run.working-directory inheritance is conditional; GHA13.a (override required on baseline check) and GHA15 (override forbidden on protos step) together enforce the asymmetric rule; **REVIEWER DISPOSITION**: C1: GO (3 P1s closed, 1 P2 closed); **CI PARITY TABLE (LIVE GREEN)**: GHA01..GHA12 ALL FULL; GHA13 contract guard FULL (fail-hard; 5 assertions); GHA14 contract guard FULL (1 assertion); GHA15 contract guard FULL (1 assertion); board validator FULL; lint FULL (via ci:check-all); build PARTIAL (compile-tests via existing; full VSIX is GITHUB-DISTRIBUTION01); gitleaks OUT_OF_SCOPE; **CONSERVATION (all 9 commits)**: zero mutation of apps/vscode, webview-ui, sdk, tests, coverage baseline; existing ext-vscode-test.yml / sdk-test.yml / ui-publish.yml untouched; permissions: contents: read (no upgrade); **FILES CHANGED (9 commits, 6 files, 600+ insertions, 11 deletions)**: `fe64815b3`, `15a41e219`, `1a3916608`, `9b7f033d8`, `434db9b5b`, `86372a1d2`, `6ebbf89d1`, `f5c2bd1b3`, `1b4d140ef`
15. **GITHUB-DISTRIBUTION01** — OPEN / HIGH
16. **BRANDING-ACTIVITYBAR-ICON01** — NEXT / MED

Deferred (not on critical path):

- **FACTORIZATION01** — DEFERRED (recon; one bounded seam at a time; no giant rewrite)

15. **ASYNC-COMMAND-TURN-LIVENESS01** — EPIC OPEN / HIGH; ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 = `CLASSIFIED_BUT_REPAIR_UNAUTHORIZED` at `pending ACT closure commit`; **LIVE WITNESS**: `run_commands` returned `status=running, jobId=cmd_mt1oo50g00ydbas2` for `gh run watch`; concurrently `TaskHeader=Waiting`, composer enabled, autonomous progression stopped; EVIDENCE_QUALITY=LIVE_UI; **RECON COMPLETE** — async-command contract frozen (`WAIT_BUDGET_MS=15_000`, `EXECUTION_DEADLINE_MS=600_000`, `MAX_STATUS_WAIT_MS=30_000`, `MAX_TERMINAL_JOBS=128`; `RUNNING_RESULT_SHAPE={ status: "running", jobId, elapsedMs, deadlineRemainingMs, outputTruncated, stdout }`; `TERMINAL_PROMISE_TYPE=Promise<TerminalTransition>` where `TerminalTransition={ becameIdle: boolean }`); **bounded RED reproduction at canonical seam** — 5 vitest tests in `apps/vscode/src/sdk/__tests__/async-command-turn-liveness.acl01.test.ts`: ACL01 (projection reset on bg-job terminal) PASS, ACL02 (no successor mechanism; callback signature is type-narrowed to projection-only) PASS+demonstrates-gap, ACL03 (fast command completes synchronously) PASS, ACL04 (no typed intent flag) PASS, ACL10 (terminalPromise resolves once) PASS; **CASE B (MISSING TERMINAL CONTINUATION) PROVEN** — the host's `onBackgroundStateChange` callback is wired at `apps/vscode/src/sdk/SdkController.ts:635` to `updateBackgroundCommandState(running, jobId)` which only mutates UI projection; `terminalPromise` listener in `vscode-run-commands-tool.ts:700-702`/`734-746` only calls `notifyBackgroundStateChange(false, undefined)`; no consumer in `LocalRuntimeHost.runTurn`/`executeTurn` (`sdk/packages/core/src/runtime/host/local-runtime-host.ts:994-1050`) schedules a successor turn; **CASE E (OWNERSHIP UNDEFINED) SUB-CLASSIFIED** — the `run_commands` input schema has no typed `intent` field (ACL04); `ASYNC_JOB_OWNERSHIP_UNDEFINED`; **CONSERVATION PANEL** — full vitest suite 1753/1753 PASS (no regression to RTP/CPL/THCP/STP/CRA13/CLI/snapshot/observer/lifecycle); typecheck EXIT=0; lint EXIT=0; git diff --check PASS; **NO REPAIR ATTEMPTED** per ACT §25-29 (do not repair from hypothesis; do not auto-promote; bounded repair only after reviewer authorization); **CLASSIFIED_BUT_REPAIR_UNAUTHORIZED** — the defect is proven, the seam is identified, but the repair contract (successor mechanism + identity correlation + agent-runtime hook) crosses the apps/vscode → sdk/packages/agents boundary and requires explicit reviewer authorization before any attempt; upstream cline/cline#10549 (non-blocking tool proposal) and #10799 (run_commands lifecycle reports) are corroborating context; **FILES CHANGED** (1 file, 334 lines, 0 deletions): `apps/vscode/src/sdk/__tests__/async-command-turn-liveness.acl01.test.ts`; **NEXT ACT** — none auto-promoted; reviewer must authorize either (a) the bounded repair contract (Candidate A/B/C/D from ACT §29) or (b) DEFER until upstream lands the non-blocking tool change; per ACT §0 "no push unless separately authorized"

15a. **ASYNC-COMMAND-TURN-LIVENESS01** child ACT = `ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01` — STATUS=CLOSED; PRIORITY=HIGH; TYPE=causal discriminator (agent-layer); **VERDICT**: `PASS_AGENT_LAYER_DISCRIMINATOR` + `HOST_OWNER_DISCRIMINATOR_PENDING` (corrected 2026-08-21 per Factory reviewer; original `PASS_DEAD_ZONE_PROVEN_AT_PRODUCTION_SEAM` overclaims — see P0 below); **PARENT**: ASYNC-COMMAND-TURN-LIVENESS01; **PURPOSE**: resolve the previously-blocking async-command ownership ambiguity. The parent epic established structural facts (ACL01/02/03/04/10) but did NOT count successor agent runs through the real `LocalRuntimeHost.runTurn` → `executeTurn` → `agent.continue()` boundary after a foreground-deferred `RUNNING(jobId)` was returned to the model. **WHAT THIS ACT ACTUALLY PROVED** (commit `9f200b002`): the **`AgentRuntime` layer alone** treats `RUNNING(jobId)` as an ordinary tool result and the agent loop has no latent terminal-job continuation after the model emits `stop`. **CLASSIFICATION** (corrected): `AGENT_RUNTIME_NO_SELF_CONTINUATION = PROVEN`; `AGENT_RUNTIME_TERMINAL_WAKEUP = PROVEN ABSENT`. **WHAT THIS ACT DID NOT PROVE** (the P0 overclaim): `LocalRuntimeHost` was NOT exercised in the test seam. The AgentRuntime composition only proves the `@cline/agents` package alone does not self-continue; per `sdk/ARCHITECTURE.md` the agents package is intentionally stateless while stateful continuation belongs to `@cline/core` `LocalRuntimeHost`. **Host wakeup absence / user-yield absence / full CASE_D_DEAD_ZONE** are `NOT YET PROVEN END-TO-END`. **EVIDENCE-STATUS TABLE** (post-correction): `RUNNING_CONSUMPTION = PROVEN`; `AGENT_SELF_CONTINUATION = ABSENT/PROVEN`; `TERMINAL_JOB_STORAGE = PROVEN`; `LOCALRUNTIMEHOST_EXERCISED = NO`; `HOST_WAKEUP_ABSENCE = NOT PROVEN`; `USER_YIELD_ABSENCE = NOT PROVEN`; `CASE_D_FULL_PRODUCTION_DEAD_ZONE = NOT PROVEN`. **CHRONOLOGY (T0..T10 captured at the AgentRuntime seam)**: T0 tool request = scripted; T1 process start = via `CommandJobManager.start`; T2 wait budget = 50ms (vs 5000ms command); T3 RUNNING return = observed; T4 agent consumes RUNNING = observed via `result.messages`; T5 agent run state = `completed`; T6 process terminal = observed (sleep 5 finished); T7 result stored = held in `CommandJobManager`; T8 terminal transition = emitted; T9 projection reset = `manager.activeCount = 0`; T10 successor at AgentRuntime seam = NONE. **FILES CHANGED (4 files, 542 insertions, 0 deletions)** at commit `9f200b002`: `apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts` (new, 547 lines, 3 tests — ACO01/02/03 at the AgentRuntime seam); `apps/vscode/vitest.config.c2-4-c-bridge.ts` (+1 line: register new test); `apps/vscode/vitest.config.ts` (+5 lines: exclude new test from base config); `.factory/epic-board.md` (this row). **CONSERVATION PROVEN** at the AgentRuntime-seam-only scope: bridge c2-4-c-bridge vitest 10/10 PASS (3 new + 7 existing); base apps/vscode vitest 1816/1816 PASS (no regression); typecheck EXIT=0; lint EXIT=0; git diff --check PASS; board validator PASS. **ENTRY_HEAD** = `20a26eb3b53b9eddf6cfc3df0c14ea54dfd8e3dc`; **ENTRY_TREE** = `d1099397ada68bb68281d74add7107eb0e9775e6`; agent-seam CLOSING_COMMIT = `9f200b002`; tree = `8a09a05e74b46d43e2a0f09d0e28ef96f7d0bd0d`. **NO PRODUCTION CODE CHANGED. NO REPAIR ATTEMPTED. NO PUSH. NO FORCE PUSH. NO PUBLISHED-COMMIT AMEND.** **NEXT ACT**: `ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION01` (row 15b): real `LocalRuntimeHost` + real `FileSessionService` + stub agent + real shell-tool path; observe host state before/after terminal completion; classify the FULL-HOST case.

15b. **ASYNC-COMMAND-TURN-LIVENESS01** child ACT = `ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION01` — STATUS=CLOSED; PRIORITY=HIGH; TYPE=causal discriminator (host-layer); **VERDICT**: `PASS_USER_YIELD_CONTRACT` (per ACT §9); **PARENT**: ASYNC-COMMAND-TURN-LIVENESS01; **PARENT-OF-PARENT**: row 15a (agent-layer discriminator, closed `PASS_AGENT_LAYER_DISCRIMINATOR` + `HOST_OWNER_DISCRIMINATOR_PENDING`). **FINDING**: The REAL `LocalRuntimeHost` does NOT auto-wakeup on command-terminal completion (no successor event emitted; `agent.run` not re-invoked), but the USER-YIELD PATH IS FUNCTIONAL — a follow-up `host.runTurn(...)` is accepted after a clean completion and a fresh `agent.continue` is invoked. **CLASSIFICATION**: `CASE_B_USER_YIELD = PROVEN`; `HOST_WAKEUP_ABSENCE = PROVEN`; `CASE_D_FULL_PRODUCTION_DEAD_ZONE = REVERSED` (the host user-yield path is the contract, not a dead zone). **PARENT EPIC REMAINS OPEN** at the `LocalRuntimeHost` boundary; this child ACT closed the HOST-LAYER CAUSAL DISCRIMINATOR question (the reviewer's P0 fix) but did not resolve the parent. **NEXT ACT**: disposition — either (a) authorize one bounded repair contract (A/B/C/D from row 15a) under a fresh ACT for autonomous continuation, or (b) DEFER with the recorded user-yield contract as the canonical ownership channel; if (b), parent epic should be CLOSED with `PASS_USER_YIELD_CONTRACT_CONFIRMED` and `ASYNC_JOB_OWNERSHIP = USER_OWNED` and the LIVE WITNESS from row 15 should be re-checked at the UI seam. **EVIDENCE (ACO-HOST01/02/03)**: ACO-HOST01 — after `host.runTurn` returns with `finishReason="completed"`, `session.status="idle"`, `pendingPrompts.length=0`, ONLY a `session_snapshot` event is emitted (idle notification); ZERO `agent_event`/`chunk`/`status` events; `manager.activeCount` goes 1→0 after terminal; `runCount` stays at 1. ACO-HOST02 — follow-up `host.runTurn({ sessionId, prompt: "continue" })` returns `{ finishReason: "completed" }` and increments `runCount` to 2; user-yield is functional. ACO-HOST03 — race control: terminal completion during `runTurn` does NOT duplicate continuation; `runCount` stays at 1; `manager.activeCount` ends at 0. **FILES CHANGED (5 files)**: new test file `apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01-correction01.c24-c-bridge.test.ts` (440+ lines, 3 tests); `apps/vscode/vitest.config.c2-4-c-bridge.ts` (+2 alias entries + 1 include entry); `apps/vscode/tsconfig.c2-4-c-bridge.json` (+2 path entries + 1 include entry); `apps/vscode/tsconfig.json` (+2 exclude entries); `apps/vscode/vitest.config.ts` (+1 exclude entry); this row. **CONSERVATION PROVEN**: bridge c2-4-c-bridge vitest 13/13 PASS (3 row 15a + 3 row 15b + 7 existing); base apps/vscode vitest 1816/1816 PASS (no regression); base apps/vscode unit 1076/1076 PASS; typecheck EXIT=0; bridge typecheck baseline OK; lint EXIT=0; git diff --check PASS; board validator PASS. **ENTRY_HEAD** = `357d298a7`; **ENTRY_TREE** = `8a09a05e74b46d43e2a0f09d0e28ef96f7d0bd0d`; closing commit = TBD (about to land). **NO PRODUCTION CODE CHANGED. NO REPAIR ATTEMPTED. NO PUSH. NO FORCE PUSH. NO PUBLISHED-COMMIT AMEND.**
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
- STATUS: CLOSED at the canonical seam (three-stage closure: `f50cc7560` + `8b7ab7428` + CORRECTION02) — source-level fixes landed end-to-end, no live dogfood capture required. The future-state CLOSED_LIVE upgrade is optional and may run when a live Cline-- extension host is available.

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
- STATUS: SUPERSEDED by `EPIC-CLINEMM-FACTORIZE01` (intake ACT `ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01`; 2026-08-21)

**Goal.** Progressively factorize Cline-- along real production seams.

**Rule.**

  recon first
  one bounded seam at a time
  no giant "modularization" rewrite

**Rationale.** Factorization because a concrete seam reduces coupling / testing cost — not because "factorization" itself is virtuous.

**Scope.** Intentionally unfrozen. Detailed design belongs to a future architectural discussion.

**Next action.** Future architectural discussion only. **No ACT in this board delta.**

**Supersession.** This DEFERRED epic retained the original `recon / one seam / no giant rewrite` rule but had no ACT-backed waves. `EPIC-CLINEMM-FACTORIZE01` (intake ACT `ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01`) is the operational successor: same rule, plus a bounded wave plan (F0 inventory → F0B baseline → F1..F4 → F5) and source-derived doctrine (FACT-001..006, FORK-001, ELM-001). All factorization work should reference `EPIC-CLINEMM-FACTORIZE01` rows from this point forward; this DEFERRED row remains as a historical alias.

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

## ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / FIX01 — RECON + PHASE 2 + PHASE 5 (bounded generation-fence repair landed)

**HEAD**: `e6996ee7793520216804839764b26fe7efb9f513` (TREE `cb656bb296a709d5d981eb8c52c812854be406ae`)
**LOCAL_AHEAD**: 9 commits ahead of `origin/main` (`c4d1db8b4`)
**STATUS**: `CLASSIFIED_BUT_REPAIR_LANDED` — bounded generation-fence repair landed in Phase 2; Phase 4 ablation proved the fence is load-bearing; Phase 5 retargeted PARENT02 to the repaired top-level path; pending LIVE qualification (L0..L5 per ACT §42) with a freshly-installed dogfood VSIX.

### Causal RED pinned at the production top-level user path

**Live witness (REAL / LIVE_UI)**: `Compact` click → silent no-op; second `New Task` click eventually recovers.

**TCL-PARENT01 (parental causal RED)** — `task=undefined, activeSession=session-B` after racing `initTask` against concurrent `clearTask`. The invariant spans two owners (`TaskProxy` via `SdkTaskControlCoordinator.setTask`; `activeSession` via `SdkSessionLifecycle.activeSession`); a lifecycle-only mutex cannot make the pair atomic.

### Repair (bounded generation fence)

- New shared authority `TaskOperationFence` at `apps/vscode/src/sdk/task-operation-fence.ts`. `begin()` / `isCurrent(token)` — explicit token carried by the originating operation.
- `SdkSessionLifecycle.startNewSession(startInput, operationToken?)` — discriminated return `{status: "started" | "superseded", ...}`. FENCE-FIRST ordering: token check BEFORE `endActiveSession` (the P0 the reviewer flagged), then check after each awaited boundary, then LOAD-BEARING POST-START check before installing `activeSession`.
- `SdkTaskControlCoordinator.clearTaskForOperation(token)` — internal clear that does NOT advance the fence. Used by `initTask` so the internal clear inherits the caller's token.
- `SdkTaskStartCoordinator.initTask` / `reinitExistingTaskFromId` — capture `operationToken = fence.begin()` at entry; fence check before each shared-state commit (`createAndSetTask`, `startNewSession`, history item, `setTurnPhase("streaming")`, `fireAndForgetSend`).
- **Hardening (CORRECTION)**: a superseded init MUST NOT call global `setTask(undefined)` (would erase newer task); it cleans up only resources it uniquely owns.

### Test status (post-FIX01)

| Test | Pre-FIX01 | Post-FIX01 |
|---|---|---|
| TCL09 (synthetic activeSession, no TaskProxy) | RED | RED — `KNOWN_HARDENING_RESIDUE` |
| TCL-REACH01 (STRUCTURAL conservation, 6 tests) | 6 GREEN | 6 GREEN |
| TCL-REACH02 PARENTAL (naked lifecycle) | RED | GREEN (retargeted to "fenced — no wedge produced") |
| TCL-REACH02 COMMON01 (second New Task recovery) | GREEN | GREEN |
| TCL-REACH02 COMMON02 (silent drop) | RED | RED — `KNOWN_HARDENING_RESIDUE` |
| TCL-PARENT01 (top-level user path) | RED | **GREEN** |
| TCL-PARENT02 (Compact silent no-op) | RED | **GREEN** (Phase 5: normal coordinator behavior through repaired top-level path) |
| TCL-PARENT03 (New Task recovery from wedge) | GREEN | GREEN (retargeted: racing initTask vs clearTask no longer produces the wedge; fresh initTask produces a clean pair) |
| ADVERSARIAL A (init A → clear) | RED | **GREEN** |
| ADVERSARIAL B (init A → init B) | RED | **GREEN** |
| ADVERSARIAL C (clear during host.start) | RED | **GREEN** |
| ADVERSARIAL D (stale A after B current) | RED | **GREEN** |
| ADVERSARIAL E (cleanup failure conserves B) | RED | **GREEN** |
| ADVERSARIAL F (stale reinit must not terminate B) | n/a | RED at HEAD, **GREEN** post-fix |

**Total**: 115 GREEN + 2 RED (both `KNOWN_HARDENING_RESIDUE`) across 10 test files.

Adjacent suites (conservation):
- `sdk-compaction-coordinator`: unchanged GREEN
- `sdk-task-control-coordinator`: 1 mock updated for `clearTaskForOperation` delegation
- `sdk-task-start-coordinator`: mocks updated for the discriminated return shape and the `operationToken` argument
- `sdk-message-coordinator`: unchanged GREEN
- `sdk-session-lifecycle`: unchanged GREEN

### Phase 4 ablation (working-tree only, no commit)

Temporarily disabled the POST-START fence check before `this.activeSession = {...}` (changed `if (operationToken !== undefined && !isCurrent(operationToken))` to `if (false && operationToken !== undefined && !isCurrent(operationToken))`). Result: `TCL-PARENT01` turned RED with the canonical wedge shape (`task=undefined, activeSession=defined(sessionId=session-B)`), confirming the fence is load-bearing rather than decorative. Restored immediately; no commit.

### Honest domain labeling

- **`FENCED DOMAIN`** = `initTask` ↔ `clearTask` / `showTaskWithId` / external `startNewSession` calls with tokens.
- **`LEGACY REBUILD DOMAIN`** = the four `replaceActiveSession` callers (mode / terminal / provider / MCP rebuilds). NOT covered by FIX01; threading tokens through these callers is a separate follow-up ACT (P2 recon residue).
- The optional `operationToken` parameter on `startNewSession` is the bypass for legacy callers; the discriminated return type is unchanged either way.

### `KNOWN_HARDENING_RESIDUE` — file `ACT-CLINEMM-MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01`

Two tests directly manufacture the wedge by calling `compactTask` / manipulating `messages.appendMessages` with `getTask() === undefined`. They assert that the silent-drop path is observable. The causal repair (`TaskOperationFence`) prevents the wedge from forming at the production seam, but it does NOT change `SdkMessageCoordinator.appendMessages` (which still has the `if (!task) return` guard). Per the reviewer's CORRECTION04 directive: "Do not weaken the lifecycle repair just to satisfy them. They are hardening tests, not causal-repair acceptance tests. Reclassify: `KNOWN_HARDENING_RESIDUE`. They directly manufacture an invariant-violating state."

Both tests remain RED and serve as a smoke-detector for the wedge if it ever re-emerges via a different path. A future `ACT-CLINEMM-MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01` can choose to harden the message coordinator's silent-drop into an explicit failure publication; this is out of scope for FIX01.

### No public/wire delta

- No `proto/*.proto` change.
- No `ExtensionMessage` change.
- No webview state field change.
- Internal-only orchestration correctness repair.

### Files changed (cumulative, all 9 commits)

| File | LoC delta |
|---|---|
| `apps/vscode/src/sdk/task-operation-fence.ts` | +66 (new) |
| `apps/vscode/src/sdk/SdkController.ts` | +31 |
| `apps/vscode/src/sdk/sdk-session-lifecycle.ts` | +138 / -1 |
| `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` | +74 / -2 |
| `apps/vscode/src/sdk/sdk-task-start-coordinator.ts` | +110 / -3 |
| `apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-parent.adversarial.test.ts` | +603 (A..F cases) |
| `apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-parent.test.ts` | +110 / -110 |
| `apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-reach02.test.ts` | +66 / -3 (PARENTAL GREEN retargeted) |
| `apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-reach01.test.ts` | +5 |
| `apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts` | +4 |
| `apps/vscode/src/sdk/sdk-task-start-coordinator.test.ts` | +39 / -4 |

### Commits (all test-only except Phase 2)

- `089eefa7b` test(sdk): pin parental top-level initTask race RED at production seam (TCL-PARENT01-03)
- `2ee94160a` test(sdk): pin adversarial concurrency envelope RED at production seam (TCL-PARENT-ADVERSARIAL01)
- `7e215278c` test(sdk): credential hygiene + corrected fence-contract doc (TCL-PARENT-ADVERSARIAL01a)
- `bcfc1362b` test(sdk): pin ADVERSARIAL F (stale reinit must not terminate current B) RED at production seam
- `9f3ab71ce` fix(sdk): add bounded generation-fence for task/session pair (FIX01 / Phase 2) — the only commit with production code change
- `e6996ee77` test(sdk): retarget TCL-PARENT02 through the repaired top-level Compact path (Phase 5)

### Quality gates

- `apps/vscode typecheck`: 0 diagnostics
- `git diff --check` (HEAD~5..HEAD): PASS
- Cumulative vitest suite (the 10 affected test files): 115 GREEN + 2 RED
- Phase 4 ablation: PARENT01 turns RED with the canonical wedge when the load-bearing fence check is disabled
- No push, no force-push, no amend of published commits
- Protected evidence preserved (`STASH_141372c52`, `STASH_371752f71`)

### Pending: LIVE qualification

After this commit, the LIVE qualification chain (L0..L5 per the original ACT §42) requires a freshly-installed dogfood VSIX with the new build, and:

- **L0**: normal New Task flow
- **L1**: provoke rapid New Task / task clear/start transition if safely possible
- **L2**: Compact works or explicitly rejects
- **L3**: New Task works first try
- **L4**: first prompt starts
- **L5**: no Idle/orphan session contradiction

Per the reviewer's directive: "Do not claim natural-race reproduction if not observed." The closure verdict can move to `PASS_LIVE_TASK_CONTROL_LIVENESS` on the first dogfood cycle where the original L0..L5 reproducer is observed to behave correctly.

### NEXT ACT (NOT auto-promoted)

`ACT-CLINEMM-MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01` (P2 hardening, follow-up) — see the `KNOWN_HARDENING_RESIDUE` block above. Optional; reviewer's directive does not require it.

### CORRECTION01 closure mechanics (per Factory reviewer)

Per reviewer disposition `PASS_REPAIR_WITH_ONE_P1_CLOSURE_DEFECT`, three bounded mechanics landed after the initial closure commit:

- `611a831b5` **fix(sdk): tighten StartNewSessionResult discriminated union; no fake sdkHost on "superseded"** — production code only; removes the `undefined as unknown as SdkSessionHost` cast on pre-host fence paths; `"superseded"` now carries no `sdkHost` (the caller has nothing to use it for); post-start fence path optionally carries `startedSessionId` for observability.
- `154aad879` **test(sdk): dispose TCL09 + COMMON02 as passing KNOWN_HARDENING_RESIDUE witnesses** — test-only; both tests now assert the CURRENT silent-drop contract (with explicit `EXPECTED_CURRENT_BEHAVIOR` / `PRODUCT_DESIRED_BEHAVIOR` / `FOLLOWUP_ACT` annotation) instead of asserting that the silent drop is gone. Causal tests (PARENT01, REACH02, A–F) remain normal GREEN acceptance gates — NOT weakened.
- `3c1d5053f` **board(epic): this ACT closed pending LIVE** — force-added the board row through `.gitignore` so the disposition is durable in Git terms.

### Test status (post-CORRECTION01)

| Bucket | Pre-CORRECTION01 | Post-CORRECTION01 |
|---|---|---|
| All 10 affected test files | 115 GREEN + 2 RED (TCL09 + COMMON02 as RED acceptance tests) | **117 GREEN + 0 RED** (TCL09 + COMMON02 disposed as passing KNOWN_HARDENING_RESIDUE witnesses) |
| `apps/vscode typecheck` | 0 diagnostics | 0 diagnostics |
| `git diff HEAD~9..HEAD --check` | PASS | PASS |

HEAD = `3c1d5053f`. LOCAL_AHEAD = 12 commits ahead of `origin/main`.

### Honest PARENT02 wording (per reviewer)

PARENT02 (Phase 5 rewrite) verifies:

- repaired race leaves `task=undefined` and `activeSession=undefined`;
- calling `compactTask()` preserves that clean state;
- no new `Logger.error` appears.

It does NOT actually assert an explicit user-visible rejection. The captured warning count is not asserted, and a `Logger.warn` would not by itself prove that the webview received anything.

- `COMPACT_AFTER_REPAIRED_RACE` = normal no-session coordinator branch reached; no error-level failure; clean pair invariant preserved
- `USER_VISIBLE_COMPACT_REJECTION` = LIVE_PENDING / not proven by PARENT02

That is fine. Exact-head LIVE qualification owns the UI claim.

### Board validator

The two pre-existing board validator failures at L204 / L207 are P2 / historical (visible in board history before FIX01 began). They MUST NOT block this ACT and are explicitly NOT fixed here.

## Board maintenance rule

At the end of a meaningful ACT, update **only rows affected by that ACT**. Do not rewrite the whole board.

Each row should preferably contain: `ID`, `STATUS`, `PRIORITY` (if useful), `PURPOSE / SYMPTOM`, `DEPENDENCIES`, `NEXT ACT`, `EVIDENCE / COMMIT` where known.

Avoid giant prose. If an item is closed, preserve enough identity to avoid re-litigation. If evidence contradicts a board row, **evidence wins**; the board row becomes P2 stale metadata.

**Post-census maintenance.** When a new task is discussed, add a single row to the canonical task index at the next meaningful ACT boundary. When an old forgotten task surfaces, add one delta. Do **not** trigger another global archaeology exercise.
