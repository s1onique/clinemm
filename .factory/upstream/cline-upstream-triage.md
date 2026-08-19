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

Triage date: **2026-08-19** (initial) → **2026-08-19** (correction 01) → **2026-08-19** (correction 02) → **2026-08-19** (correction 03).

## Why this document was revised

Three distinct defects were found in the upstream-triage board-evidence mappings, each addressed in its own bounded correction:

1. **Correction 01 (`b4d7ed795` initial → `88f1e10c6` correction 01).** The initial triage used **lexical/keyword overlap** as mapping authority. Token collision became semantic authority, producing systematic false mappings (e.g. "JetBrains multi-project" → `CONTEXT-ACCOUNTING-TRUTH01`, "Custom HTTP headers" → `TASKHEADER-CANONICAL-PROJECTION01`, "macOS AMFI code-signing" → `BRANDING01`). Correction 01 replaced keyword overlap with three semantic classes — `EXACT_MAP` / `ADJACENT` / `UNRELATED` — and only `EXACT_MAP` was allowed to become a `MAP_EXISTING` row on the board. 17 false mappings were removed.

2. **Correction 02 (`88f1e10c6` → `4909884a6` correction 02).** Correction 01's `EXACT_MAP` definition was "same defect/domain" — still too loose. Review found three surviving candidates where the destination epic's *failure contract* was not the same as the issue's; e.g. `#9333` (CLI provider-routing defect) was mapped to `TEST-BASELINE-ZERO-FAILURES01` (Vitest baseline failures) — same *category* (provider bugs) but completely different failure contract. Correction 02 applied the stricter test:

  - `EXACT_MAP` — same user-visible failure contract **OR** same causal production seam **OR** direct upstream reproduction of the canonical epic.
  - `RELATED_DOMAIN` — same subsystem, different failure contract → RADAR.
  - `UNRELATED` — no semantic relation → RADAR.

  3 false EXACT_MAPs were removed (`#9333`, `#12947`, `#12079`).

3. **Correction 03 (`4909884a6` → this commit).** Correction 02 left `TOOL-EXECUTION-SEMANTICS01` with 23 mapped candidates under the justification that they "share the execution signal production seam." Review found that the epic's *canonical contract* is **telemetry classification** — mechanism, purpose, effect class, duration accounting, success/failure classification, retry/recovery accounting, classification confidence/source — whereas the 23 issues describe **runtime tool correctness** defects (terminal hangs, parser failures, MCP routing, approval UX). Same production seam is not the same failure contract. The strict destination test:

  - `EXACT_TELEMETRY_MAP` — the issue materially changes or validates one of the canonical outputs (mechanism classification, purpose classification, effect class, duration accounting, success/failure classification, retry/recovery accounting, classification confidence/source).
  - `RELATED_TOOL_RUNTIME` — terminal reliability, output capture, command timeout, file-edit reliability, tool routing, approval correctness, parser correctness. Not telemetry classification.
  - `UNRELATED` — no semantic relation.

  All 23 candidates failed the strict test and were reclassified `RELATED_TOOL_RUNTIME → RADAR`. They are not destroyed; they are **recorded with coherent cluster assignments** so a future `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01` can be proposed with a clear evidence table.

## Correction-03 destination-contract audit (TOOL-EXECUTION-SEMANTICS01)

| # | Issue | Cluster | Verdict | Reason |
| --- | --- | --- | --- | --- |
| [#4356](https://github.com/cline/cline/issues/4356) | Improve Terminal Integration Reliability Across Platforms and Shell Configuratio | Shell/terminal integration configuration | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#4384](https://github.com/cline/cline/issues/4384) | Fix File Editing Tool Reliability - replace_in_file, write_to_file, and Diff Fai | File-edit reliability | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#7355](https://github.com/cline/cline/issues/7355) | Cline does not wait for terminal command to finish | Terminal timeout/wait lifecycle | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#8087](https://github.com/cline/cline/issues/8087) | MCP tool IDs use ephemeral server keys, breaking routing after reconnect/restart | MCP tool routing/approval/validation | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#8130](https://github.com/cline/cline/issues/8130) | Poor support for DeepSeek v3.2's integration of thinking into tool-use | Tool-call parsing | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#8446](https://github.com/cline/cline/issues/8446) | Tool not specified in CLI tool approval request | Tool-approval UX | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#9143](https://github.com/cline/cline/issues/9143) | The command's output could not be captured | Terminal timeout/wait lifecycle | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#9848](https://github.com/cline/cline/issues/9848) | Cline prints raw tool invocation XML in responses and gets stuck in a loop unabl | Tool-call parsing | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#10413](https://github.com/cline/cline/issues/10413) | Invalid API Response: The provider returned an empty or unparsable response. Thi | Tool-call parsing | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#10444](https://github.com/cline/cline/issues/10444) | Configurable Shell Path for Background Exec on Windows (to support Git Bash / MS | Shell/terminal integration configuration | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#10499](https://github.com/cline/cline/issues/10499) | MCP tool calls execute without user approval when Auto-approve is OFF | MCP tool routing/approval/validation | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#10549](https://github.com/cline/cline/issues/10549) | 'run_commands' tool silently times out at 30s with misleading error — causes age | Terminal timeout/wait lifecycle | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#10656](https://github.com/cline/cline/issues/10656) | Latest Cline still hits OpenAI Native gpt-5.3-codex, gpt-5.4 and gpt-5.5 reasoni | Tool-call parsing | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#10709](https://github.com/cline/cline/issues/10709) | OpenAI-compatible DeepSeek V4 Pro/Flash stuck after command status becomes "Skip | Terminal timeout/wait lifecycle | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#10843](https://github.com/cline/cline/issues/10843) | [Bug]: Local Ollama models (Qwen 2.5 Coder) trapped in infinite loop emitting ra | Tool-call parsing | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#10931](https://github.com/cline/cline/issues/10931) | Cline hangs indefinitely when interactive CLI commands (like default "git diff") | Terminal timeout/wait lifecycle | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#11295](https://github.com/cline/cline/issues/11295) | Deadlock on remote-SSH after terminal commands | Terminal timeout/wait lifecycle | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#11542](https://github.com/cline/cline/issues/11542) | Cline enters a high-volume request loop under repeated tool-use completions | Tool loop control / retry | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#12198](https://github.com/cline/cline/issues/12198) | Cline hangs completely after skipping a command execution, requires VS Code rest | Terminal timeout/wait lifecycle | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#12431](https://github.com/cline/cline/issues/12431) | Cline hit repeated tool call failures. Try guiding it with a new prompt. | Tool loop control / retry | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#12977](https://github.com/cline/cline/issues/12977) | Unknown MCP tool name is forwarded to the server and returns an opaque error ins | MCP tool routing/approval/validation | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#13246](https://github.com/cline/cline/issues/13246) | Background Console `run_commands` has a hard-coded 30-second timeout | Terminal timeout/wait lifecycle | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |
| [#13253](https://github.com/cline/cline/issues/13253) | cline is stuck in running 1 command for 10 minutes , happened twice | Terminal timeout/wait lifecycle | RELATED_TOOL_RUNTIME | runtime tool correctness, not telemetry-classification |

## Tool-runtime cluster histogram (23 candidates)

| Cluster | Count | Members |
| --- | --- | --- |
| Terminal timeout/wait lifecycle | 9 | #13253, #13246, #12198, #11295, #10931, #10709, #10549, #9143, #7355 |
| Tool-call parsing | 5 | #10843, #10656, #10413, #9848, #8130 |
| MCP tool routing/approval/validation | 3 | #12977, #10499, #8087 |
| Shell/terminal integration configuration | 2 | #10444, #4356 |
| Tool loop control / retry | 2 | #12431, #11542 |
| File-edit reliability | 1 | #4384 |
| Tool-approval UX | 1 | #8446 |

The dominant cluster is **terminal timeout/wait lifecycle** (9 issues). All 23 together form a coherent body of evidence for a hypothetical `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01` that would address runtime tool correctness, **separate from** the telemetry-classification epic. This ACT does not create that epic; it only records the cluster so a future ACT can propose it.

## Disposition counts (correction 03 vs earlier cycles)

| Disposition | Initial `b4d7ed795` | Corr 01 `88f1e10c6` | Corr 02 `4909884a6` | Corr 03 (this commit) | Δ corr 03 |
| --- | --- | --- | --- | --- | --- |
| `IMPORT` | 5 | 5 | 5 | 5 | 0 |
| `MAP_EXISTING` | 60 | 43 | 40 | 17 | -23 (over-broad TOOL-EXECUTION-SEMANTICS01 mappings removed) |
| `RADAR` | 15 | 32 | 35 | 58 | +23 (over-broad mappings downgraded) |
| `REJECT` | 0 | 0 | 0 | 0 | 0 |
| `CLOSED_UPSTREAM` | 0 | 0 | 0 | 0 | 0 |

## Semantic-class breakdown (correction 03)

| Class | Count | Notes |
| --- | --- | --- |
| `EXACT_MAP` | 22 | 17 → MAP_EXISTING on board; 5 → IMPORT |
| `RELATED_TOOL_RUNTIME` | 23 | All → RADAR; cluster assignments recorded for future `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01` proposal |
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

## Mapped to existing epics (EXACT_MAP only; strict destination-contract test)

Every retained entry satisfies: same user-visible failure contract **OR** same causal production seam **OR** direct upstream reproduction of the canonical epic, **AND** if the destination epic is a telemetry/classification epic (e.g. `TOOL-EXECUTION-SEMANTICS01`), the issue must materially change or validate one of the canonical outputs.

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

Includes all `RELATED_TOOL_RUNTIME` candidates (with cluster assignments), `ADJACENT` candidates, and `UNRELATED` candidates whose problem statement is at least interesting. None of these appear on the active board as upstream evidence for any canonical epic.

### Related tool-runtime (downgraded in correction 03)

**Terminal timeout/wait lifecycle** (9):

- [#13253](https://github.com/cline/cline/issues/13253) — Cline stuck running 1 command 10 minutes. Runtime reliability; not telemetry.
- [#13246](https://github.com/cline/cline/issues/13246) — Background Console run_commands 30s hard-coded timeout. Duration/runtime; not telemetry duration accounting.
- [#12198](https://github.com/cline/cline/issues/12198) — Skip command → UI hangs, restart required. Runtime state-machine; not telemetry.
- [#11295](https://github.com/cline/cline/issues/11295) — Remote-SSH deadlock after terminal commands. Runtime reliability; not telemetry.
- [#10931](https://github.com/cline/cline/issues/10931) — Interactive CLI pager (git diff) hangs Cline. Runtime wait lifecycle; not telemetry.
- [#10709](https://github.com/cline/cline/issues/10709) — DeepSeek command becomes "skip" → UI stuck. Runtime state-machine; not telemetry.
- [#10549](https://github.com/cline/cline/issues/10549) — run_commands 30s silent timeout. Duration/runtime; not telemetry duration accounting.
- [#9143](https://github.com/cline/cline/issues/9143) — Command output cannot be captured (executed but telemetry reports failure). Borderline: this directly causes a wrong success/failure classification. Conservative verdict: runtime output capture; epic would name this as a known gap but does not fix it.
- [#7355](https://github.com/cline/cline/issues/7355) — Terminal command timeout/wait regression. Runtime wait lifecycle; not telemetry duration accounting.

**Tool-call parsing** (5):

- [#10843](https://github.com/cline/cline/issues/10843) — Ollama Qwen raw JSON → parser ignores. Parser correctness; not telemetry.
- [#10656](https://github.com/cline/cline/issues/10656) — OpenAI Native gpt-5.x reasoning/function_call pairing error. Parser correctness; not telemetry.
- [#10413](https://github.com/cline/cline/issues/10413) — Qwen thinking-tag → invalid tool-call parse. Parser correctness; not telemetry.
- [#9848](https://github.com/cline/cline/issues/9848) — Cline prints raw tool invocation XML instead of executing. Parser correctness; not telemetry.
- [#8130](https://github.com/cline/cline/issues/8130) — DeepSeek v3.2 thinking-mode tool-call detection. Parser correctness; not telemetry.

**MCP tool routing/approval/validation** (3):

- [#12977](https://github.com/cline/cline/issues/12977) — Unknown MCP tool name forwarded → opaque error. Validation correctness; not telemetry.
- [#10499](https://github.com/cline/cline/issues/10499) — MCP tools run without approval when Auto-approve is OFF. Approval correctness; borderline classification-confidence/source.
- [#8087](https://github.com/cline/cline/issues/8087) — MCP tool IDs use ephemeral server keys → routing breaks after reconnect/restart. Runtime routing correctness; not telemetry.

**Shell/terminal integration configuration** (2):

- [#10444](https://github.com/cline/cline/issues/10444) — Background Exec hardcodes cmd.exe on Windows (UTF-8 broken). Configuration/runtime; not telemetry.
- [#4356](https://github.com/cline/cline/issues/4356) — Terminal integration reliability (output capture, shell integration, WSL/SSH). Runtime reliability; not telemetry-classification.

**Tool loop control / retry** (2):

- [#12431](https://github.com/cline/cline/issues/12431) — Repeated tool call failures → "stopped" (low-info). Runtime reliability; not telemetry.
- [#11542](https://github.com/cline/cline/issues/11542) — High-volume request loop under repeated tool-use. Runtime loop control; borderline retry/recovery accounting.

**File-edit reliability** (1):

- [#4384](https://github.com/cline/cline/issues/4384) — File-editing reliability (diff mismatch, truncation, retry loops). Runtime reliability; not telemetry-classification.

**Tool-approval UX** (1):

- [#8446](https://github.com/cline/cline/issues/8446) — CLI tool approval does not display which tool is being approved. Approval UX; not telemetry success/failure source.

### Other radar (adjacent + unrelated)

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

### Removed in correction 01 (lexical-overlap remediation, 17 candidates)

See correction 01 artifact for the full list; 17 candidates removed from `b4d7ed795`'s 60 `MAP_EXISTING`s.

### Removed in correction 02 (EXACT_MAP contract tightening, 3 candidates)

- [#9333](https://github.com/cline/cline/issues/9333) — previous epic: `n/a` — CLI: displayed model ≠ actual request model sent to Requesty. Provider routing correctness defect, NOT a Vitest baseline failure. No current canonical epic covers provider-routing correctness; downgraded to RADAR.
- [#12079](https://github.com/cline/cline/issues/12079) — previous epic: `n/a` — Command executes but Cline marks it "skipped" and hangs on "thinking"; restart recovers. Task-state machine transition defect (skipped → pending → skipped), NOT static "Thinking" presentation residue. The presentation-layer epic is about UI cache, not runtime state; this is a runtime state-machine bug. No current canonical epic; downgraded to RADAR.
- [#12947](https://github.com/cline/cline/issues/12947) — previous epic: `n/a` — Reasoning Effort dropdown missing "max" option even though models.dev/DeepSeek advertise it. Reasoning-effort capability propagation, NOT context-token ceiling. Downgraded to RADAR.

### Removed in correction 03 (over-broad TOOL-EXECUTION-SEMANTICS01 destination contract, 23 candidates)

All 23 issues previously mapped to `TOOL-EXECUTION-SEMANTICS01` were reclassified `RELATED_TOOL_RUNTIME → RADAR` because their failure contract (runtime tool correctness) is not the same as the epic's contract (telemetry classification). They are not lost; they are recorded in § "Related tool-runtime" above with cluster assignments for a future `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01` proposal.

## Method (correction 03)

1. The corrected 40-EXACT_MAP artifact from `4909884a6` (correction 02) was consumed unchanged.
2. Each of the 23 surviving `MAP_EXISTING → TOOL-EXECUTION-SEMANTICS01` candidates was re-audited against the epic's *canonical outputs* (mechanism, purpose, effect class, duration, success/failure, retry/recovery, classification confidence/source) — not just against the same-subsystem criterion.
3. The strict destination test: the issue must materially change or validate one of the canonical outputs. Runtime reliability, output capture, command timeout, file-edit reliability, tool routing, approval correctness, parser correctness do not satisfy this test.
4. All 23 candidates failed the strict test and were reclassified `RELATED_TOOL_RUNTIME → RADAR`.
5. Cluster assignments were recorded for each candidate so a future ACT can propose `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01` with a clear evidence table. This ACT does **not** create that epic.
6. The 17 surviving `MAP_EXISTING`s and the 5 `IMPORT`s are unchanged from correction 02.
7. All 80 candidates classified; substrate SHA256 unchanged (`878eb241...`).

## What this artifact is NOT

- Not a re-rank of all 573 upstream rows (substrate unchanged).
- Not a re-enrichment of the 80-issue shortlist (all enrichment data is the same).
- Not an implementation commitment (no IMPORT here is auto-promoted into the immediate critical path).
- Not a substitute for `scripts/dump-cline-issues.py` (the substrate remains the canonical JSON).
- Not a creation of `EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01` (the 23 tool-runtime candidates are recorded with cluster assignments, but the epic itself is not created in this ACT).
