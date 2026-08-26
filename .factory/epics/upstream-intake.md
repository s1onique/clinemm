# EPIC-UPSTREAM-INTAKE

> Upstream Cline-- issue intake + triage: trustworthy metadata acquisition (substrate), bounded triage cycle, and the lexical-overlap remediation that closed 48 false-mapping rows. See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: CLOSED (the closed-substrate / first-triage / four-corrections cycle is complete and the cumulative invariant holds: 12 surviving EXACT_MAPs and 5 IMPORTs satisfy the binding rule)
- Priority: P2 (upstream-facing, not directly user-facing)
- Current frontier: n/a — the upstream-intake triage cycle is closed at this scope. New upstream issues can be re-templated through the substrate (see Open-work reopen conditions).
- Blocked by: n/a

## Contract / durable conclusions

The upstream-intake substrate and the four-correction triage cycle establish these durable rules:

- **Snapshot contract.** Stored fields per issue: `number`, `title`, `url`, `created_at`, `updated_at`, `comments`, `reactions`, `interactions`, `labels`. **Excluded:** `body`, comment bodies, reactions breakdown, avatar URLs, assignee objects, milestone description, user profile metadata, API payload copies.
- **Deterministic ordering.** `interactions` DESC, `updated_at` DESC, `number` DESC.
- **Size policy.** Preferred ≤ 1 MiB; acceptable ≤ 2 MiB. When exceeded, a bounded selection policy applies: top-N by interactions PLUS every issue matching high-value Cline-- keyword/label families (`context`, `compact`, `token`, `prompt`, `checkpoint`, `retry`, `recovery`, `terminal`, `tool`, `provider`, `model`, `performance`, `memory`, `mcp`, `state`, `waiting`, `task`, `install`, `release`, `vscode`). Truncation is **never silent** — `total_open_issue_count`, `committed_issue_count`, `truncated`, `selection_policy` are always recorded.
- **Four dispositions for triage.**
  - `IMPORT` — promote into a Cline-- epic/ACT
  - `MAP_EXISTING` — already covered by an existing Cline-- epic
  - `RADAR` — worth watching but not importing yet
  - `REJECT` — out of scope or value-not-worth-effort

- **Selection dimensions for triage.** popularity; recency/activity; correctness impact (label family, title keyword); Cline-- product value mapping against the current critical path; architectural fit (Elm/state/quality-substrate seams); implementation ROI; existing-board overlap against canonical rows; upstream momentum (active maintainer response signals). Rule: popularity ≠ automatic priority.
- **Binding invariant (post-Correction-04).** An upstream issue cannot be cited as evidence for a canonical epic whose failure contract it does not reproduce. The lexical-overlap remediation removed 48 false-mapping rows cumulatively (`60 → 43 → 40 → 17 → 12`) across corrections 01–04.
- **Substrate (committed in this repo).** `scripts/dump-cline-issues.py` (Link-header pagination, PR exclusion, retry contract, checkpoint/resume, atomic write, bounded selection policy); `scripts/tests/test_dump_cline_issues.py` (stdlib unittest, 29 network-free tests); `.factory/upstream/cline-open-issues-index.json` (compact machine-readable snapshot).


## ACT ledger

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `EPIC-CLINEMM-UPSTREAM-ISSUE-INTAKE01` (umbrella epic) | CLOSED_INITIAL_TRIAGE at `162192610` | L3896-3939 | Trustworthy upstream issue metadata for offline triage; substrate + 4-disposition triage rules |
| `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE01` | CLOSED (superseded by Corr 01) at `b4d7ed795` | L3941-3943 | First triage cycle; lexical/keyword overlap (later identified as systematically defective) |
| `…TRIAGE-CORRECTION01` | CLOSED (superseded by Corr 02) at `88f1e10c6` | L3945+ | Red-witness audit of lexical-overlap mappings (`#6416`, `#11018`, `#12042`, `#9181`) |
| `…TRIAGE-CORRECTION02` | CLOSED (superseded by Corr 03) at `4909884a6` | (audit) | Surviving false EXACT_MAPs (`#9333`, `#12947`, `#12079`) |
| `…TRIAGE-CORRECTION03` | CLOSED (superseded by Corr 04) at `a87ef52e6` | (audit) | Over-broad TOOL-EXECUTION-SEMANTICS01 destination; 23 mappings reclassified `RELATED_TOOL_RUNTIME → RADAR` with cluster assignments |
| `…TRIAGE-CORRECTION04` | CLOSED at this commit | L3973-3995 | Strict-test final cycle; 5 of 6 candidates failed; `#8636` is the only surviving `EXACT_PRESENTATION_MAP`. Cumulative removal: 48 false-mapping rows (`60 → 43 → 40 → 17 → 12`) |

## Open work

None directly in this epic. The cumulative disposition table after Correction 04 is the terminal state:

| Disposition | Initial `b4d7ed795` | Corr 01 | Corr 02 | Corr 03 | Corr 04 | Δ corr 04 |
|---|---|---|---|---|---|---|
| `IMPORT` | 5 | 5 | 5 | 5 | 5 | 0 |
| `MAP_EXISTING` | 60 | 43 | 40 | 17 | 12 | -5 (over-broad STATIC-THINKING mappings removed) |
| `RADAR` | 15 | 32 | 35 | 58 | 63 | +5 (over-broad mappings downgraded; cluster-assigned) |
| `REJECT` | 0 | 0 | 0 | 0 | 0 | 0 |
| `CLOSED_UPSTREAM` | 0 | 0 | 0 | 0 | 0 | 0 |

| Semantic class (corr 04) | Count | Disposition |
|---|---|---|
| `EXACT_MAP` | 17 (12 → MAP_EXISTING on board; 5 → IMPORT) | as above |
| `RELATED_TOOL_RUNTIME` | 23 | all → RADAR; cluster-assigned |
| `RUNTIME_THINKING_STALL` | 5 | all → RADAR; cluster-assigned |
| `ADJACENT` | 14 | all → RADAR |
| `UNRELATED` | 21 | all → RADAR |

The dominant cluster is *skipped-command-stall* (2 issues; `#10015`, `#10031`).

Reopen / new-work conditions:

- A new upstream intake cycle is needed (substrate is re-runnable; this is normal and not a defect).
- A new lexical-overlap defect class is identified in a future triage cycle.
- The binding invariant is violated by a future cycle (an upstream issue is cited as evidence for a canonical epic whose failure contract it does not reproduce).

## Deferred work

None.

## Historical detail

### Upstream intake — L3896-4094 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L3896-4094 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

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
````
