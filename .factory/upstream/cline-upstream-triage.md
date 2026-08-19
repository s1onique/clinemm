# Cline upstream issue triage

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

Triage date: **2026-08-19**

Triage produced by `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE01`.

## Shortlist construction

80 candidates selected as union of:

- **A.** top 30 by raw interactions
- **B.** top 10 most recently active issues with interactions >= 2
- **C.** top 5 per high-value family (CORRECTNESS, CONTEXT, TOOLS/TERMINAL, PROVIDERS, PERFORMANCE, MCP, UX, DISTRIBUTION)
- **D.** titles semantically overlapping existing canonical Cline-- epics

After dedup by issue number the union was 279; trimmed to hard cap of **80** while preserving family diversity.

All 80 shortlisted candidates were enriched via `gh issue view --repo cline/cline --json ...`.
All 80 were still OPEN upstream at enrichment time.

## Scoring dimensions (recorded per candidate)

| Dimension | Range | Definition |
| --- | --- | --- |
| `CORRECTNESS_IMPACT` | 0..5 | data loss / state corruption / broken execution / security / severe reliability |
| `PRODUCT_VALUE` | 0..5 | expected usefulness to a real Cline-- workflow |
| `CLINEMM_RELEVANCE` | 0..5 | direct overlap with fork goals and current board |
| `IMPLEMENTATION_ROI` | 0..5 | expected value vs likely bounded effort |
| `ARCHITECTURAL_FIT` | 0..5 | fits canonical state / Elmization / Factory direction without architecture debt |
| `UPSTREAM_MOMENTUM` | 0..3 | recent maintainer / community activity |

Popularity (raw interactions + percentile band) is kept separate from value.

## Disposition counts

| Disposition | Count |
| --- | --- |
| `IMPORT` | 5 |
| `IMPORT_FIX` | 0 (no upstream issue in shortlist was closed with an actionable merged fix that we should port) |
| `MAP_EXISTING` | 60 |
| `RADAR` | 15 |
| `REJECT` | 0 |
| `CLOSED_UPSTREAM` | 0 |

## Imported

Each IMPORT becomes a new canonical Cline-- epic. The board rows below are the authoritative form; this section is the triage rationale.

### `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` (upstream #4388)

- area: `DIST/REPO`
- status: OPEN
- priority: HIGH
- upstream: [#4388](https://github.com/cline/cline/issues/4388)
- title: Fix Checkpoint System Issues
- popularity snapshot: comments=12 reactions=5 interactions=17
- labels: P1, VS Code, Bot Responded
- rationale: Git checkpoint corruption (.git -> .git_disabled left by interrupted tasks, submodule breakage, large-workspace corruption, disk-space exhaustion). Distinct from existing canonical work.
- first action: RECON (reproduce + identify root cause; do not port upstream fix until recon completes)

### `EPIC-CLINEMM-CUSTOM-INSTRUCTIONS-HONORING01` (upstream #7414)

- area: `UX/PRODUCT`
- status: OPEN
- priority: MED
- upstream: [#7414](https://github.com/cline/cline/issues/7414)
- title: Clinerules are completely ignored
- popularity snapshot: comments=10 reactions=3 interactions=13
- labels: Model Quality, VS Code, Bot Responded
- rationale: `.clinerules` (custom instructions) silently ignored by the model. Distinct correctness issue with no existing epic.
- first action: RECON (reproduce + identify root cause; do not port upstream fix until recon completes)

### `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` (upstream #7413)

- area: `MCP`
- status: OPEN
- priority: HIGH
- upstream: [#7413](https://github.com/cline/cline/issues/7413)
- title: MCP Servers launching thousands of instances until crash on windows
- popularity snapshot: comments=7 reactions=0 interactions=7
- labels: Investigation Needed, VS Code, Bot Responded
- rationale: MCP stdio servers spawn unbounded instances until crash on Windows. Genuine process-lifecycle bug with bounded fix surface.
- first action: RECON (reproduce + identify root cause; do not port upstream fix until recon completes)

### `EPIC-CLINEMM-CLINEIGNORE-FILTERING01` (upstream #9554)

- area: `CONTEXT`
- status: OPEN
- priority: MED
- upstream: [#9554](https://github.com/cline/cline/issues/9554)
- title: Bug: .clineignore does not omit files from context as documented
- popularity snapshot: comments=6 reactions=1 interactions=7
- labels: VS Code
- rationale: `.clineignore` documented as filtering the file listing but does not actually exclude files from context. Bounded fix surface; aligns with CONTEXT-ACCOUNTING concerns but the bug itself is distinct.
- first action: RECON (reproduce + identify root cause; do not port upstream fix until recon completes)

### `EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01` (upstream #10016)

- area: `PROVIDERS`
- status: OPEN
- priority: MED
- upstream: [#10016](https://github.com/cline/cline/issues/10016)
- title: GUI configuration shows blank/incorrect models from LM Studio API on Windows 11
- popularity snapshot: comments=4 reactions=3 interactions=7
- labels: stale, CLI
- rationale: Provider model list discovery broken for LM Studio API and similar OpenAI-compatible endpoints. Distinct from any existing epic.
- first action: RECON (reproduce + identify root cause; do not port upstream fix until recon completes)

## Mapped to existing epics

Each mapping is attached to the existing Cline-- epic via the board's `Upstream evidence` bullets.

### TOOL-EXECUTION-SEMANTICS01

- [#5915](https://github.com/cline/cline/issues/5915) (int=114, corr=0, updated 14d ago) — "Cline uses complex prompts and iterative task execution that may be challenging
- [#4356](https://github.com/cline/cline/issues/4356) (int=94, corr=3, updated 19d ago) — Improve Terminal Integration Reliability Across Platforms and Shell Configuratio
- [#4384](https://github.com/cline/cline/issues/4384) (int=58, corr=4, updated 31d ago) — Fix File Editing Tool Reliability - replace_in_file, write_to_file, and Diff Fai

### CONTEXT-ACCOUNTING-TRUTH01

- [#4389](https://github.com/cline/cline/issues/4389) (int=33, corr=4, updated 80d ago) — Improve Context Window Management and Large File Handling
- [#6416](https://github.com/cline/cline/issues/6416) (int=31, corr=4, updated 13d ago) — Cline JetBrains plugin is unable to work with two or more open IDEA projects (Wi
- [#9788](https://github.com/cline/cline/issues/9788) (int=16, corr=0, updated 86d ago) — 在windows环境下，vscode  或者cli 都出现了消息丢失，发送消息读取不到。ai提示说发送的是空消息。直接导致用不了了

### STATIC-THINKING-PRESENTATION-PERSISTENCE01

- [#8636](https://github.com/cline/cline/issues/8636) (int=51, corr=0, updated 20d ago) — Thinking section not displayed in v3.50.0
- [#10015](https://github.com/cline/cline/issues/10015) (int=19, corr=0, updated 59d ago) — Cline wants to execute this command:  Skipped, thinking
- [#12079](https://github.com/cline/cline/issues/12079) (int=17, corr=2, updated 9d ago) — Command execution shows "skipped" in Cline terminal and hangs on "thinking" — re

### USER-CONTEXT-CEILING01

- [#5915](https://github.com/cline/cline/issues/5915) (int=114, corr=0, updated 14d ago) — "Cline uses complex prompts and iterative task execution that may be challenging
- [#10551](https://github.com/cline/cline/issues/10551) (int=14, corr=4, updated 29d ago) — OpenAI-compatible DeepSeek V4 Pro: configured 1M context capped at 128K, tool pa
- [#10980](https://github.com/cline/cline/issues/10980) (int=6, corr=2, updated 23d ago) — Deepseek V4 context window is limited in 128K

### TEST-BASELINE-ZERO-FAILURES01

- [#4384](https://github.com/cline/cline/issues/4384) (int=58, corr=4, updated 31d ago) — Fix File Editing Tool Reliability - replace_in_file, write_to_file, and Diff Fai
- [#12474](https://github.com/cline/cline/issues/12474) (int=15, corr=0, updated 0d ago) — Add latest Gemini models: `gemini-3.6-flash` and `gemini-3.5-flash-lite` (blocke
- [#12431](https://github.com/cline/cline/issues/12431) (int=14, corr=0, updated 2d ago) — Cline hit repeated tool call failures. Try guiding it with a new prompt.

### GITHUB-ACTIONS01

- [#9181](https://github.com/cline/cline/issues/9181) (int=10, corr=2, updated 43d ago) — Agressive context compaction with opus-4.6:1m
- [#12520](https://github.com/cline/cline/issues/12520) (int=7, corr=2, updated 20d ago) — fix(cli): openai-compatible provider ignores models.json contextWindow — resolve
- [#11785](https://github.com/cline/cline/issues/11785) (int=7, corr=0, updated 25d ago) — Global Dirs differ severely, docs dont convey information efficiently

### COMPACTION-STATE-AUTHORITY01

- [#10637](https://github.com/cline/cline/issues/10637) (int=12, corr=0, updated 2d ago) — Cline auto compacts context silently even with autocompacting setting disabled
- [#9181](https://github.com/cline/cline/issues/9181) (int=10, corr=2, updated 43d ago) — Agressive context compaction with opus-4.6:1m

### GITHUB-DISTRIBUTION01

- [#10246](https://github.com/cline/cline/issues/10246) (int=7, corr=3, updated 121d ago) — CLI: `cline` fails on startup with npm 404 for `@clinebot/agents` (missing packa
- [#11879](https://github.com/cline/cline/issues/11879) (int=5, corr=0, updated 31d ago) — # CI/CD test coverage gaps in SDK packages — two untested code paths

### COST-DISPLAY-TRUTH01

- [#11494](https://github.com/cline/cline/issues/11494) (int=6, corr=0, updated 15d ago) — Cline cli 3 does not show cost
- [#10596](https://github.com/cline/cline/issues/10596) (int=5, corr=2, updated 18d ago) — Cline's OpenRouter integration lacks provider pinning, inflating costs by 3-5x

### TASKHEADER-CANONICAL-PROJECTION01

- [#11018](https://github.com/cline/cline/issues/11018) (int=10, corr=3, updated 68d ago) — Unable to set custom headers anymore in OpenAi compatible (Kimi for coding setup

### BRANDING01

- [#12042](https://github.com/cline/cline/issues/12042) (int=9, corr=0, updated 0d ago) — macOS 27 Golden Gate Developer Beta (Apple Silicon): CLI binary is killed by AMF

### CODE-COVERAGE-BASELINE01

- [#11879](https://github.com/cline/cline/issues/11879) (int=5, corr=0, updated 31d ago) — # CI/CD test coverage gaps in SDK packages — two untested code paths

### CODE-COVERAGE-RATCHET01

- [#11879](https://github.com/cline/cline/issues/11879) (int=5, corr=0, updated 31d ago) — # CI/CD test coverage gaps in SDK packages — two untested code paths

## Radar (top 15)

Useful upstream signal but not added to active board. Tracked in this artifact only.

- [#7262](https://github.com/cline/cline/issues/7262) (int=47, corr=2, prod=4) — Cline returning over and over again: Invalid API Response: The provider returned
- [#8074](https://github.com/cline/cline/issues/8074) (int=27, corr=0, prod=3) — devstral-2512 is labeled FREE in Cline provider, but still consumes credits
- [#10500](https://github.com/cline/cline/issues/10500) (int=22, corr=0, prod=3) — Cline asking to use Claude 4.5 Sonnet
- [#12385](https://github.com/cline/cline/issues/12385) (int=21, corr=3, prod=3) — Kimi K3 model returns repeated Invalid API Response errors after first message
- [#10469](https://github.com/cline/cline/issues/10469) (int=20, corr=0, prod=3) — Newer models for deepseek are not listed.
- [#8838](https://github.com/cline/cline/issues/8838) (int=17, corr=0, prod=3) — In plan mode I can't answer a question unless I hit the Cancel button
- [#10307](https://github.com/cline/cline/issues/10307) (int=17, corr=2, prod=3) — 403 Kimi For Coding is currently only available for Coding Agents such as Kimi C
- [#9668](https://github.com/cline/cline/issues/9668) (int=15, corr=2, prod=3) — Add API Key field to LM Studio provider for authenticated servers
- [#12863](https://github.com/cline/cline/issues/12863) (int=14, corr=3, prod=3) — replace_in_file targets directory or malformed path and fails with EISDIR
- [#6759](https://github.com/cline/cline/issues/6759) (int=14, corr=0, prod=3) — [BUG] GCP vertex ai global does not have claude sonnet model
- [#13296](https://github.com/cline/cline/issues/13296) (int=8, corr=2, prod=3) — Could not consistently trigger Cline diff edit view
- [#11793](https://github.com/cline/cline/issues/11793) (int=8, corr=2, prod=3) — apply_patch fuzzy matcher is O(n²) per hunk — pegs CPU, spikes RAM, times out on
- [#9786](https://github.com/cline/cline/issues/9786) (int=8, corr=0, prod=3) — 💡 Suggestion: MCP server security scanning before connection
- [#12388](https://github.com/cline/cline/issues/12388) (int=7, corr=3, prod=3) — Checkpoint restore fails with "No checkpoint found at or before run N" after int
- [#10741](https://github.com/cline/cline/issues/10741) (int=7, corr=2, prod=3) — How to disable auto-update in Cline CLI? Multiple issues with v2.18.0

## Method

1. Substrate validated against schema_version=1, repository=cline/cline, state=open, no forbidden fields, interactions=comments+reactions, deterministic ordering verified.
2. All 573 rows ranked offline by raw interactions, comments, reactions, age, days-since-update, label families.
3. Popularity 0..5 bands assigned by rank percentile (5 = top 1%, 4 = top 5%, 3 = top 15%, 2 = top 40%, 1 = top 70%, 0 = bottom 30%).
4. Shortlist assembled as union of A (top 30 interactions) + B (top 10 recent with interactions >= 2) + C (top 5 per family) + D (titles overlapping existing canonical epics), deduped by number, trimmed to 80.
5. Each shortlisted issue enriched via `gh issue view --repo cline/cline --json ...` to retrieve current state, body, labels, comments. All 80 still OPEN at enrichment.
6. Six independent scores assigned per candidate (CORRECTNESS_IMPACT, PRODUCT_VALUE, CLINEMM_RELEVANCE, IMPLEMENTATION_ROI, ARCHITECTURAL_FIT, UPSTREAM_MOMENTUM).
7. Disposition assigned by rules:
   - `ARCHITECTURAL_FIT == 0` -> `REJECT` (architecture-fight: rejects Cline-- direction)
   - `CLINEMM_RELEVANCE >= 5` (strong title overlap) -> `MAP_EXISTING`
   - `CLINEMM_RELEVANCE >= 4` and `CORRECTNESS_IMPACT < 4` -> `MAP_EXISTING`
   - `CLINEMM_RELEVANCE >= 4` and (`CORRECTNESS_IMPACT >= 4` or `PRODUCT_VALUE >= 4`) and `IMPLEMENTATION_ROI >= 3` -> `IMPORT`
   - `CLINEMM_RELEVANCE == 0` and high-impact correctness -> `IMPORT`
   - moderate value -> `RADAR`
   - no clear value -> `REJECT`
8. Manual overrides applied for `MAP_EXISTING` (e.g. #6416 JetBrains multi-project, #10410 gpt-5.5 500k context) where title-vs-body keyword matching over-classified as IMPORT.

## What this artifact is NOT

- Not a mirror of all 659 upstream issues (573 retained in substrate).
- Not a body/comment dump (each enriched issue retains only the short title, URL, body excerpt, and counts).
- Not an implementation commitment (no IMPORT here is auto-promoted into the immediate critical path).
- Not a substitute for `scripts/dump-cline-issues.py` (the substrate remains the canonical JSON).
