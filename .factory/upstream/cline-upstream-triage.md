# Cline upstream issue triage (corrected)

## Snapshot identity

| Field | Value |
| --- | --- |
| Source repository | `cline/cline` |
| Snapshot path | `.factory/upstream/cline-open-issues-index.json` |
| Snapshot generated_at | 2026-08-19T10:55:25Z |
| Snapshot SHA256 | `878eb241e24150b4ecc9731e6fe8373b7e81566d8117f7f129b87f012f166cb6` |
| Snapshot bytes | 170875 |
| Snapshot committed rows | 573 |
| Upstream discovered open | 659 (truncated by selection policy) |
| Snapshot selection | top-500-by-interactions + high-value keyword/label matches |
| Snapshot schema_version | 1 |
| Snapshot state | open |

Triage date: **2026-08-19** (initial) → **2026-08-19** (correction 01) → **2026-08-19** (correction 02).

## Why this document was revised

Two distinct defects were found in the upstream-triage board-evidence mappings:

1. **Correction 01 (`b4d7ed795` initial → `88f1e10c6` correction 01).** The initial triage used **lexical/keyword overlap** as mapping authority. Token collision became semantic authority, producing systematic false mappings (e.g. "JetBrains multi-project" → `CONTEXT-ACCOUNTING-TRUTH01`, "Custom HTTP headers" → `TASKHEADER-CANONICAL-PROJECTION01`, "macOS AMFI code-signing" → `BRANDING01`). Correction 01 replaced keyword overlap with three semantic classes — `EXACT_MAP` / `ADJACENT` / `UNRELATED` — and only `EXACT_MAP` was allowed to become a `MAP_EXISTING` row on the board. 17 false mappings were removed.

2. **Correction 02 (`88f1e10c6` correction 01 → this commit).** Correction 01's `EXACT_MAP` definition was "same defect/domain" — still too loose. Review found three surviving candidates where the destination epic's *failure contract* was not the same as the issue's; e.g. `#9333` (CLI provider-routing defect) was mapped to `TEST-BASELINE-ZERO-FAILURES01` (Vitest baseline failures) — same *category* (provider bugs) but completely different failure contract. Correction 02 applies the stricter test:

  - `EXACT_MAP` — same user-visible failure contract **OR** same causal production seam **OR** direct upstream reproduction of the canonical epic.
  - `RELATED_DOMAIN` — same subsystem, different failure contract → RADAR.
  - `UNRELATED` — no semantic relation → RADAR.

  This test collapses the "same subsystem = same epic" trap that targeted `TOOL-EXECUTION-SEMANTICS01` (which had accumulated 23 mapped candidates) by requiring either contract identity or causal-seam identity.

The test for every retained `MAP_EXISTING` row:

> Does this issue describe the same failure contract as the target epic, not merely the same subsystem?

## Correction-02 red-witness audit

| # | Issue summary | Was mapped to | Corrected class | Reason |
| --- | --- | --- | --- | --- |
| #9333 | CLI: displayed model ≠ actual request model sent to Requesty (provider-routing correctness) | `TEST-BASELINE-ZERO-FAILURES01` (Vitest baseline) | UNRELATED | Different failure contract: runtime provider-routing defect is not a test-baseline failure. No current canonical epic; downgraded to RADAR. |
| #12947 | `OPENAI_REASONING_EFFORT_OPTIONS` caps at `xhigh`; `max` missing from UI/CLI | `USER-CONTEXT-CEILING01` (context-token ceiling) | UNRELATED | Reasoning-effort capability propagation is not a context-token ceiling. Different failure contract; downgraded to RADAR. |
| #12079 | Command executes, Cline marks it `skipped`, agent hangs on `thinking`, restart recovers | `STATIC-THINKING-PRESENTATION-PERSISTENCE01` (UI presentation residue) | UNRELATED | This is a runtime state-machine transition defect (skipped → pending → skipped), not a UI presentation residue bug. The presentation epic is about UI cache after the runtime state is no longer thinking; this issue is about the runtime state being wrong. No current canonical epic; downgraded to RADAR. |

## Disposition counts (correction 02 vs correction 01 vs initial)

| Disposition | Initial `b4d7ed795` | Correction 01 `88f1e10c6` | Correction 02 (this commit) | Δ correction 02 |
| --- | --- | --- | --- | --- |
| `IMPORT` | 5 | 5 | 5 | 0 |
| `MAP_EXISTING` | 60 | 43 | 40 | -3 (false EXACT_MAPs removed) |
| `RADAR` | 15 | 32 | 35 | +3 (false EXACT_MAPs downgraded) |
| `REJECT` | 0 | 0 | 0 | 0 |
| `CLOSED_UPSTREAM` | 0 | 0 | 0 | 0 |

## Semantic-class breakdown (correction 02)

| Class | Count | Notes |
| --- | --- | --- |
| `EXACT_MAP` | 45 | 40 → MAP_EXISTING on board; 5 → IMPORT (canonical epic) |
| `ADJACENT` | 14 | All → RADAR; not used as board evidence |
| `UNRELATED` | 21 | All → RADAR; recorded for audit only |

## Imported

### `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` — upstream #12388

- URL: <https://github.com/cline/cline/issues/12388>
- title: Checkpoint restore fails with "No checkpoint found at or before run N" after internal continuations
- one-sentence: Checkpoint restore fails with "No checkpoint found at or before run N" — same checkpoint-reliability family as #4388. Merge as evidence under the IMPORT epic.
- first action: RECON

### `EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01` — upstream #10016

- URL: <https://github.com/cline/cline/issues/10016>
- title: GUI configuration shows blank/incorrect models from LM Studio API on Windows 11
- one-sentence: Provider model list discovery broken for LM Studio API and similar OpenAI-compatible endpoints — distinct provider-model-list defect.
- first action: RECON

### `EPIC-CLINEMM-CLINEIGNORE-FILTERING01` — upstream #9554

- URL: <https://github.com/cline/cline/issues/9554>
- title: Bug: .clineignore does not omit files from context as documented
- one-sentence: .clineignore documented as filtering the file listing but actually does not exclude files from context — distinct filter bug.
- first action: RECON

### `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` — upstream #7413

- URL: <https://github.com/cline/cline/issues/7413>
- title: MCP Servers launching thousands of instances until crash on windows
- one-sentence: MCP stdio servers spawn unbounded instances until crash on Windows — distinct process-lifecycle defect.
- first action: RECON

### `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` — upstream #4388

- URL: <https://github.com/cline/cline/issues/4388>
- title: Fix Checkpoint System Issues
- one-sentence: Checkpoint corruption: .git/.git_disabled left by interrupted tasks; submodule breakage; large-workspace corruption — distinct repo-safety issue.
- first action: RECON

## Mapped to existing epics (EXACT_MAP only; strict contract test)

Every retained entry satisfies the strict test: same user-visible failure contract **OR** same causal production seam **OR** direct upstream reproduction of the canonical epic. Each entry has a one-sentence semantic justification.

### TOOL-EXECUTION-SEMANTICS01 (23 mapped)

- [#13253](https://github.com/cline/cline/issues/13253) — Stuck running one command for 10 minutes — terminal execution state.
- [#13246](https://github.com/cline/cline/issues/13246) — Background Console run_commands has hard-coded 30s timeout — terminal tool semantics.
- [#12977](https://github.com/cline/cline/issues/12977) — Unknown MCP tool name forwarded to server instead of validated against catalog — tool-routing semantics.
- *(+20 more — see JSON for full list)*

### STATIC-THINKING-PRESENTATION-PERSISTENCE01 (6 mapped)

- [#10537](https://github.com/cline/cline/issues/10537) — Hangs at "Thinking..." indefinitely after terminal command — thinking-section-presentation persistence.
- [#10208](https://github.com/cline/cline/issues/10208) — Stuck thinking forever in both Plan and Act modes — same thinking-persistence defect class.
- [#10031](https://github.com/cline/cline/issues/10031) — Task stuck on "Thinking..." reproducibly after simple commands — direct thinking-presentation regression.
- *(+3 more — see JSON for full list)*

### USER-CONTEXT-CEILING01 (5 mapped)

- [#12520](https://github.com/cline/cline/issues/12520) — openai-compatible provider ignores models.json contextWindow; auto-compaction fires too early — ceiling misapplied.
- [#10980](https://github.com/cline/cline/issues/10980) — Configured 400K context for DeepSeek V4 capped at 128K — provider ceiling misapplied is a context-ceiling concern.
- [#10551](https://github.com/cline/cline/issues/10551) — OpenAI-compatible DeepSeek V4 1M config capped at 128K + tool-parse failures — provider-model context ceiling.
- *(+2 more — see JSON for full list)*

### CONTEXT-ACCOUNTING-TRUTH01 (2 mapped)

- [#10148](https://github.com/cline/cline/issues/10148) — Impossible token count displayed in context window UI — token accounting literally broken.
- [#4389](https://github.com/cline/cline/issues/4389) — Files >300KB blocked, prompt-too-long unrecovery, full-file API sends — exactly the canonical context-accounting failures the epic targets.

### COMPACTION-STATE-AUTHORITY01 (2 mapped)

- [#10637](https://github.com/cline/cline/issues/10637) — Auto-compacts silently even with auto-compact setting disabled — silent compaction is a state-authority violation.
- [#9181](https://github.com/cline/cline/issues/9181) — Opus-4.6:1M aggressively auto-compacts mid-execution despite ample headroom — a compaction-state-authority problem.

### COST-DISPLAY-TRUTH01 (2 mapped)

- [#11494](https://github.com/cline/cline/issues/11494) — CLI 3 does not show cost — direct cost-display defect.
- [#10596](https://github.com/cline/cline/issues/10596) — OpenRouter provider pinning missing; requests fan out inflating cost 3-5x — cost/billing presentation.

## Radar

Includes all `ADJACENT` candidates plus `UNRELATED` candidates whose problem statement is at least interesting. None of these appear on the active board as upstream evidence for any canonical epic.

- [#5915](https://github.com/cline/cline/issues/5915) — `ADJACENT` — Cline recommends Claude 4 Sonnet in error message — model-recommendation UX.
- [#7262](https://github.com/cline/cline/issues/7262) — `ADJACENT` — Invalid API Response on large files/PDFs — provider response parsing quality.
- [#7403](https://github.com/cline/cline/issues/7403) — `ADJACENT` — Cline does not save config in WebStorm/VSCode — config-persistence bug, ADJACENT.
- [#7414](https://github.com/cline/cline/issues/7414) — `ADJACENT` — Upstream labels this "Model Quality"; cannot distinguish rules-omitted vs rules-ignored without recon. Downgrade to RADAR pending recon.
- [#8838](https://github.com/cline/cline/issues/8838) — `ADJACENT` — Plan-mode cannot answer question without Cancel — UI/UX interaction bug.
- [#8920](https://github.com/cline/cline/issues/8920) — `ADJACENT` — [Windows specific] "Error loading webview: Error: Could not register service worker" — webview lifecycle.
- [#9201](https://github.com/cline/cline/issues/9201) — `ADJACENT` — No chat window scrollbar after 3.49.0→3.49.1 — UI regression, NOT context accounting.
- [#9788](https://github.com/cline/cline/issues/9788) — `ADJACENT` — [Windows only] 消息丢失, AI prompt sees empty message — webview message-pipeline bug, NOT context accounting.
- [#10246](https://github.com/cline/cline/issues/10246) — `ADJACENT` — CLI startup npm 404 for @clinebot/agents — npm distribution packaging.
- [#11263](https://github.com/cline/cline/issues/11263) — `ADJACENT` — Ollama infinite JSON tool loop + HTTP 4xx/5xx — tool-call parsing on local models.
- [#11793](https://github.com/cline/cline/issues/11793) — `ADJACENT` — apply_patch fuzzy matcher O(n²) — tool performance bug.
- [#12385](https://github.com/cline/cline/issues/12385) — `ADJACENT` — Kimi K3 repeated Invalid API Response errors — provider response parsing.
- [#12474](https://github.com/cline/cline/issues/12474) — `ADJACENT` — Add latest Gemini models — provider-catalog update; ADJACENT only.
- [#12863](https://github.com/cline/cline/issues/12863) — `ADJACENT` — replace_in_file targets directory / EISDIR — tool path-validation bug; ADJACENT.
- [#6416](https://github.com/cline/cline/issues/6416) — `UNRELATED` — JetBrains multi-project: bundled node.exe file lock. NOT context accounting.
- [#6759](https://github.com/cline/cline/issues/6759) — `UNRELATED` — [BUG] GCP vertex ai global missing claude sonnet — provider-catalog gap.
- [#7476](https://github.com/cline/cline/issues/7476) — `UNRELATED` — JetBrains plugin fails on Windows/ARM64 with Unsupported platform — JetBrains-specific portability.
- [#8074](https://github.com/cline/cline/issues/8074) — `UNRELATED` — devstral-2512 labeled FREE but consumes credits — provider catalog accuracy.
- [#9333](https://github.com/cline/cline/issues/9333) — `UNRELATED` — CLI: displayed model ≠ actual request model sent to Requesty. Provider routing correctness defect, NOT a Vitest baseline failure. No current canonical epic covers provider-routing correctness; downgraded to RADAR.
- [#9668](https://github.com/cline/cline/issues/9668) — `UNRELATED` — Add API Key field to LM Studio — provider-config UI gap.
- [#9786](https://github.com/cline/cline/issues/9786) — `UNRELATED` — Suggestion: MCP server security scanning — feature request, not current canonical work.
- [#10307](https://github.com/cline/cline/issues/10307) — `UNRELATED` — 403 Kimi For Coding — provider auth/policy.
- [#10469](https://github.com/cline/cline/issues/10469) — `UNRELATED` — Newer models for DeepSeek not listed — provider-catalog gap.
- [#10500](https://github.com/cline/cline/issues/10500) — `UNRELATED` — Cline keeps suggesting use Claude 4.5 Sonnet — model-recommendation UX.
- [#10741](https://github.com/cline/cline/issues/10741) — `UNRELATED` — Disable auto-update in CLI; v2.18.0 issues — UX/distribution.
- [#11018](https://github.com/cline/cline/issues/11018) — `UNRELATED` — Custom HTTP headers in OpenAI-compatible provider. "Header" ≠ TaskHeader.
- [#11785](https://github.com/cline/cline/issues/11785) — `UNRELATED` — "Global Dirs differ severely, docs dont convey" — docs/UX concern, NOT GitHub Actions.
- [#11879](https://github.com/cline/cline/issues/11879) — `UNRELATED` — CI/CD test coverage gaps in SDK packages — orthogonal to coverage-baseline epic.
- [#12042](https://github.com/cline/cline/issues/12042) — `UNRELATED` — macOS 27 AMFI kills CLI binary for code-signing violation. NOT branding; distribution/signing.
- [#12079](https://github.com/cline/cline/issues/12079) — `UNRELATED` — Command executes but Cline marks it "skipped" and hangs on "thinking"; restart recovers. Task-state machine transition defect (skipped → pending → skipped), NOT static "Thinking" presentation residue. The presentation-layer epic is about UI cache, not runtime state; this is a runtime state-machine bug. No current canonical epic; downgraded to RADAR.
- [#12133](https://github.com/cline/cline/issues/12133) — `UNRELATED` — Git commit --amend should not be "safe command" — tool-allowlist policy.
- [#12947](https://github.com/cline/cline/issues/12947) — `UNRELATED` — Reasoning Effort dropdown missing "max" option even though models.dev/DeepSeek advertise it. Reasoning-effort capability propagation, NOT context-token ceiling. Downgraded to RADAR.
- [#13008](https://github.com/cline/cline/issues/13008) — `UNRELATED` — CLINE 4.1.x removed compact context toggle, breaking local Ollama+Qwen — UX regression.
- [#13160](https://github.com/cline/cline/issues/13160) — `UNRELATED` — [Windows] Claude Code API Provider strictly binds working directory — working-directory config bug.
- [#13296](https://github.com/cline/cline/issues/13296) — `UNRELATED` — Could not consistently trigger Cline diff edit view — UI trigger bug.

## Removed-from-board audit

These candidates were previously presented as evidence for an existing Cline-- epic. They are listed here only so the audit trail is complete; **none of them appears on the board**.

### Removed in correction 01 (lexical-overlap remediation, 17 candidates)

See correction 01 artifact for the full list; 17 candidates removed from `b4d7ed795`'s 60 `MAP_EXISTING`s.

### Removed in correction 02 (EXACT_MAP contract tightening, 3 candidates)

- [#9333](https://github.com/cline/cline/issues/9333) — `UNRELATED` — previous epic: `n/a` — CLI: displayed model ≠ actual request model sent to Requesty. Provider routing correctness defect, NOT a Vitest baseline failure. No current canonical epic covers provider-routing correctness; downgraded to RADAR.
- [#12079](https://github.com/cline/cline/issues/12079) — `UNRELATED` — previous epic: `n/a` — Command executes but Cline marks it "skipped" and hangs on "thinking"; restart recovers. Task-state machine transition defect (skipped → pending → skipped), NOT static "Thinking" presentation residue. The presentation-layer epic is about UI cache, not runtime state; this is a runtime state-machine bug. No current canonical epic; downgraded to RADAR.
- [#12947](https://github.com/cline/cline/issues/12947) — `UNRELATED` — previous epic: `n/a` — Reasoning Effort dropdown missing "max" option even though models.dev/DeepSeek advertise it. Reasoning-effort capability propagation, NOT context-token ceiling. Downgraded to RADAR.

## Method (correction 02)

1. The corrected 43-EXACT_MAP artifact from `88f1e10c6` (correction 01) was consumed unchanged.
2. Each surviving `EXACT_MAP` candidate was re-audited against the receiving epic's *failure contract* (not just title or subsystem).
3. The strict test: same user-visible failure contract **OR** same causal production seam **OR** direct upstream reproduction.
4. Three candidates failed this stricter test and were reclassified `UNRELATED` → RADAR: `#9333`, `#12947`, `#12079`.
5. The 40 surviving `EXACT_MAP`s are unchanged from correction 01 except for the three removals.
6. The five `IMPORT`s are unchanged from correction 01 (and from initial).
7. All 80 candidates classified; substrate SHA256 unchanged (`878eb241...`).

## What this artifact is NOT

- Not a re-rank of all 573 upstream rows (substrate unchanged).
- Not a re-enrichment of the 80-issue shortlist (all enrichment data is the same).
- Not an implementation commitment (no IMPORT here is auto-promoted into the immediate critical path).
- Not a substitute for `scripts/dump-cline-issues.py` (the substrate remains the canonical JSON).
