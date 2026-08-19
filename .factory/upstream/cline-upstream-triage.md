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

Triage date: **2026-08-19** (initial) → **2026-08-19** (corrected at this commit).

## Why this document was revised

Initial triage (commit `b4d7ed795`) used lexical/keyword overlap to map candidates to existing epics. Review found that keyword overlap is not semantic authority — for example "JetBrains multi-project" was lexically mapped to `CONTEXT-ACCOUNTING-TRUTH01` despite the issue being a Windows process file-lock; "Custom HTTP headers" was mapped to `TASKHEADER-CANONICAL-PROJECTION01` despite HTTP headers having nothing to do with the TaskHeader component; "macOS AMFI code signing" was mapped to `BRANDING01`. These were false mappings caused by token collision, not semantic review.

Correction (this commit) applies three semantic classes:

- **EXACT_MAP** — the issue is the same defect/domain as an existing epic. These become `MAP_EXISTING` rows on the board.
- **ADJACENT** — the issue is related evidence but not the epic's core claim. These are downgraded to `RADAR` and never appear on the board as upstream evidence for that epic.
- **UNRELATED** — keyword/token overlap was misleading; no semantic relationship. Removed from the board entirely and recorded here only for the audit trail.

The test for every `MAP_EXISTING` row:

> If I removed the issue title and read only its actual problem statement, would I still choose this epic?

## Red-witness audit (corrected)

| # | Initial mapping | Issue summary | Corrected class | Corrected action |
| --- | --- | --- | --- | --- |
| #6416 | `CONTEXT-ACCOUNTING-TRUTH01` | JetBrains multi-project, bundled `node.exe` file lock on Windows | UNRELATED | Removed from board; downgraded to RADAR |
| #11018 | `TASKHEADER-CANONICAL-PROJECTION01` | Custom HTTP headers in OpenAI-compatible provider (HTTP headers ≠ TaskHeader) | UNRELATED | Removed from board; downgraded to RADAR |
| #12042 | `BRANDING01` | macOS 27 AMFI kills CLI binary (code-signing, not branding) | UNRELATED | Removed from board; downgraded to RADAR |
| #9181 | `COMPACTION-STATE-AUTHORITY01` + `GITHUB-ACTIONS01` | Opus-4.6:1M auto-compacts mid-execution at <200K | EXACT_MAP → `COMPACTION-STATE-AUTHORITY01` only | Removed the spurious GITHUB-ACTIONS01 mapping |

## Disposition counts

| Disposition | Initial (`b4d7ed795`) | Corrected (this commit) | Δ |
| --- | --- | --- | --- |
| `IMPORT` | 5 | 5 | 0 |
| `IMPORT_FIX` | 0 | 0 | 0 |
| `MAP_EXISTING` | 60 | 43 | -17 (false mappings removed) |
| `RADAR` | 15 | 32 | +17 (false mappings downgraded) |
| `REJECT` | 0 | 0 | 0 |
| `CLOSED_UPSTREAM` | 0 | 0 | 0 |

## Semantic-class breakdown

| Class | Count | Notes |
| --- | --- | --- |
| `EXACT_MAP` | 48 | 43 → MAP_EXISTING on board; 5 → IMPORT (become their own canonical epic) |
| `ADJACENT` | 14 | All → RADAR; not used as board evidence |
| `UNRELATED` | 18 | All → RADAR; recorded for audit only |

## Imported

Each IMPORT is a new canonical Cline-- epic or — for #12388 — an upstream evidence bullet under an already-IMPORTed epic. Each has a one-sentence semantic justification.

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

## Mapped to existing epics (EXACT_MAP only)

Top evidence per epic, sorted by issue number. Each entry passes the test: "If I removed the issue title and read only its actual problem statement, would I still choose this epic?"

### TOOL-EXECUTION-SEMANTICS01 (23 mapped)

- [#13253](https://github.com/cline/cline/issues/13253) — Stuck running one command for 10 minutes — terminal execution state.
- [#13246](https://github.com/cline/cline/issues/13246) — Background Console run_commands has hard-coded 30s timeout — terminal tool semantics.
- [#12977](https://github.com/cline/cline/issues/12977) — Unknown MCP tool name forwarded to server instead of validated against catalog — tool-routing semantics.
- *(+20 more — see JSON for full list)*

### STATIC-THINKING-PRESENTATION-PERSISTENCE01 (7 mapped)

- [#12079](https://github.com/cline/cline/issues/12079) — Command status "skipped" in terminal + hangs on "thinking" — same family as #10015/#10537; thinking-presentation persistence.
- [#10537](https://github.com/cline/cline/issues/10537) — Hangs at "Thinking..." indefinitely after terminal command — thinking-section-presentation persistence.
- [#10208](https://github.com/cline/cline/issues/10208) — Stuck thinking forever in both Plan and Act modes — same thinking-persistence defect class.
- *(+4 more — see JSON for full list)*

### USER-CONTEXT-CEILING01 (6 mapped)

- [#12947](https://github.com/cline/cline/issues/12947) — Reasoning Effort dropdown caps at xhigh, missing "max" advertised by DeepSeek V4 — model-capability ceiling.
- [#12520](https://github.com/cline/cline/issues/12520) — openai-compatible provider ignores models.json contextWindow; auto-compaction fires too early — ceiling misapplied.
- [#10980](https://github.com/cline/cline/issues/10980) — Configured 400K context for DeepSeek V4 capped at 128K — provider ceiling misapplied is a context-ceiling concern.
- *(+3 more — see JSON for full list)*

### CONTEXT-ACCOUNTING-TRUTH01 (2 mapped)

- [#10148](https://github.com/cline/cline/issues/10148) — Impossible token count displayed in context window UI — token accounting literally broken.
- [#4389](https://github.com/cline/cline/issues/4389) — Files >300KB blocked, prompt-too-long unrecovery, full-file API sends — exactly the canonical context-accounting failures the epic targets.

### COMPACTION-STATE-AUTHORITY01 (2 mapped)

- [#10637](https://github.com/cline/cline/issues/10637) — Auto-compacts silently even with auto-compact setting disabled — silent compaction is a state-authority violation.
- [#9181](https://github.com/cline/cline/issues/9181) — Opus-4.6:1M aggressively auto-compacts mid-execution despite ample headroom — a compaction-state-authority problem.

### COST-DISPLAY-TRUTH01 (2 mapped)

- [#11494](https://github.com/cline/cline/issues/11494) — CLI 3 does not show cost — direct cost-display defect.
- [#10596](https://github.com/cline/cline/issues/10596) — OpenRouter provider pinning missing; requests fan out inflating cost 3-5x — cost/billing presentation.

### TEST-BASELINE-ZERO-FAILURES01 (1 mapped)

- [#9333](https://github.com/cline/cline/issues/9333) — CLI ignores configured model and always uses anthropic/claude-3-7-sonnet — provider routing correctness.

## Radar (top 20)

Useful upstream signal but not on the active board. Includes all `ADJACENT` candidates plus `UNRELATED` candidates whose problem statement is at least interesting.

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
- [#9668](https://github.com/cline/cline/issues/9668) — `UNRELATED` — Add API Key field to LM Studio — provider-config UI gap.
- [#9786](https://github.com/cline/cline/issues/9786) — `UNRELATED` — Suggestion: MCP server security scanning — feature request, not current canonical work.

## Removed-from-board audit (previously MAP_EXISTING, now RADAR)

These candidates were previously presented as evidence for an existing Cline-- epic. They are listed here only so the audit trail is complete; **none of them appears on the board**.

- [#5915](https://github.com/cline/cline/issues/5915) — `ADJACENT` — Cline recommends Claude 4 Sonnet in error message — model-recommendation UX.
- [#6416](https://github.com/cline/cline/issues/6416) — `UNRELATED` — JetBrains multi-project: bundled node.exe file lock. NOT context accounting.
- [#6759](https://github.com/cline/cline/issues/6759) — `UNRELATED` — [BUG] GCP vertex ai global missing claude sonnet — provider-catalog gap.
- [#7262](https://github.com/cline/cline/issues/7262) — `ADJACENT` — Invalid API Response on large files/PDFs — provider response parsing quality.
- [#7403](https://github.com/cline/cline/issues/7403) — `ADJACENT` — Cline does not save config in WebStorm/VSCode — config-persistence bug, ADJACENT.
- [#7414](https://github.com/cline/cline/issues/7414) — `ADJACENT` — Upstream labels this "Model Quality"; cannot distinguish rules-omitted vs rules-ignored without recon. Downgrade to RADAR pending recon.
- [#7476](https://github.com/cline/cline/issues/7476) — `UNRELATED` — JetBrains plugin fails on Windows/ARM64 with Unsupported platform — JetBrains-specific portability.
- [#8074](https://github.com/cline/cline/issues/8074) — `UNRELATED` — devstral-2512 labeled FREE but consumes credits — provider catalog accuracy.
- [#8838](https://github.com/cline/cline/issues/8838) — `ADJACENT` — Plan-mode cannot answer question without Cancel — UI/UX interaction bug.
- [#8920](https://github.com/cline/cline/issues/8920) — `ADJACENT` — [Windows specific] "Error loading webview: Error: Could not register service worker" — webview lifecycle.
- [#9201](https://github.com/cline/cline/issues/9201) — `ADJACENT` — No chat window scrollbar after 3.49.0→3.49.1 — UI regression, NOT context accounting.
- [#9668](https://github.com/cline/cline/issues/9668) — `UNRELATED` — Add API Key field to LM Studio — provider-config UI gap.
- [#9786](https://github.com/cline/cline/issues/9786) — `UNRELATED` — Suggestion: MCP server security scanning — feature request, not current canonical work.
- [#9788](https://github.com/cline/cline/issues/9788) — `ADJACENT` — [Windows only] 消息丢失, AI prompt sees empty message — webview message-pipeline bug, NOT context accounting.
- [#10246](https://github.com/cline/cline/issues/10246) — `ADJACENT` — CLI startup npm 404 for @clinebot/agents — npm distribution packaging.
- [#10307](https://github.com/cline/cline/issues/10307) — `UNRELATED` — 403 Kimi For Coding — provider auth/policy.
- [#10469](https://github.com/cline/cline/issues/10469) — `UNRELATED` — Newer models for DeepSeek not listed — provider-catalog gap.
- [#10500](https://github.com/cline/cline/issues/10500) — `UNRELATED` — Cline keeps suggesting use Claude 4.5 Sonnet — model-recommendation UX.
- [#10741](https://github.com/cline/cline/issues/10741) — `UNRELATED` — Disable auto-update in CLI; v2.18.0 issues — UX/distribution.
- [#11018](https://github.com/cline/cline/issues/11018) — `UNRELATED` — Custom HTTP headers in OpenAI-compatible provider. "Header" ≠ TaskHeader.
- [#11263](https://github.com/cline/cline/issues/11263) — `ADJACENT` — Ollama infinite JSON tool loop + HTTP 4xx/5xx — tool-call parsing on local models.
- [#11785](https://github.com/cline/cline/issues/11785) — `UNRELATED` — "Global Dirs differ severely, docs dont convey" — docs/UX concern, NOT GitHub Actions.
- [#11793](https://github.com/cline/cline/issues/11793) — `ADJACENT` — apply_patch fuzzy matcher O(n²) — tool performance bug.
- [#11879](https://github.com/cline/cline/issues/11879) — `UNRELATED` — CI/CD test coverage gaps in SDK packages — orthogonal to coverage-baseline epic.
- [#12042](https://github.com/cline/cline/issues/12042) — `UNRELATED` — macOS 27 AMFI kills CLI binary for code-signing violation. NOT branding; distribution/signing.
- [#12133](https://github.com/cline/cline/issues/12133) — `UNRELATED` — Git commit --amend should not be "safe command" — tool-allowlist policy.
- [#12385](https://github.com/cline/cline/issues/12385) — `ADJACENT` — Kimi K3 repeated Invalid API Response errors — provider response parsing.
- [#12474](https://github.com/cline/cline/issues/12474) — `ADJACENT` — Add latest Gemini models — provider-catalog update; ADJACENT only.
- [#12863](https://github.com/cline/cline/issues/12863) — `ADJACENT` — replace_in_file targets directory / EISDIR — tool path-validation bug; ADJACENT.
- [#13008](https://github.com/cline/cline/issues/13008) — `UNRELATED` — CLINE 4.1.x removed compact context toggle, breaking local Ollama+Qwen — UX regression.
- [#13160](https://github.com/cline/cline/issues/13160) — `UNRELATED` — [Windows] Claude Code API Provider strictly binds working directory — working-directory config bug.
- [#13296](https://github.com/cline/cline/issues/13296) — `UNRELATED` — Could not consistently trigger Cline diff edit view — UI trigger bug.

## Method (corrected)

1. The fixed 80-candidate enriched triage artifact from `b4d7ed795` was consumed unchanged.
2. Each candidate was re-classified semantically — meaning the actual problem statement in the body, not the keywords in the title.
3. Each candidate received one of `EXACT_MAP` / `ADJACENT` / `UNRELATED` per the test above.
4. Only `EXACT_MAP` produces a `MAP_EXISTING` row visible on the board.
5. `ADJACENT` and `UNRELATED` produce `RADAR` entries in this artifact only; the board no longer cites them.
6. Five IMPORTs were re-confirmed as genuinely distinct canonical work.
7. `#7414` (`Clinerules are completely ignored`) was demoted from IMPORT to ADJACENT/RADAR pending a recon that distinguishes rules-omitted-from-request from rules-present-but-model-ignored. The previously-created `EPIC-CLINEMM-CUSTOM-INSTRUCTIONS-HONORING01` row on the board is removed because it no longer has a backing issue.
8. `#12388` (checkpoint restore fails) was promoted from RADAR to IMPORT as additional evidence under `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` (same family as `#4388`).

## What this artifact is NOT

- Not a re-rank of all 573 upstream rows (substrate unchanged).
- Not a re-enrichment of the 80-issue shortlist (all enrichment data is the same).
- Not an implementation commitment (no IMPORT here is auto-promoted into the immediate critical path).
- Not a substitute for `scripts/dump-cline-issues.py` (the substrate remains the canonical JSON).
