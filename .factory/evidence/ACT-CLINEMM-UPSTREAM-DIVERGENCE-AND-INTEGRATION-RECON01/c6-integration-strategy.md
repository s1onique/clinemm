# C6 — Integration strategy decision (no integration performed in this ACT)

## Decision: PREFERRED — single long-lived upstream integration worktree/branch, full upstream merge

**Chosen strategy (defensible on the captured evidence):**

1. Create ONE long-lived isolated integration worktree/branch based on the captured fork head `6bdc07c8d2651bfb93331552342f2912697dc406` (U02 owns the creation — this ACT creates nothing).
2. Perform a FULL upstream merge of `a6507a62a147db4a35e27f4294589742ccac5060` into that branch, preserving BOTH histories (`git merge --no-ff upstream/main` from the fork head; the merge commit keeps the fork's 1858 commits AND upstream's 558 commits reachable).
3. Resolve the 67 textual conflicts SEMANTICALLY, using the explicit fork invariants in `fork-authority-conservation-map.tsv` — NOT by `ours`/`theirs` blanket resolution and NOT by taking upstream's version of any fork-authority file.
4. Regenerate the two generated/conflicted artifacts rather than hand-merging them: `sdk/packages/llms/src/catalog/catalog.generated.ts` (run the upstream catalog generator, then re-apply the fork MiniMax M3.1 entries) and `bun.lock` (run `bun install` in the worktree, then verify the undici >= 7.x and js-yaml >= 4.3.2 CVE floors from upstream `7e8063857b` and `bb203d435c`).

### Why this strategy and not the fallback

| Evidence | Finding | Consequence |
|---|---|---|
| `merge-tree --write-tree HEAD FETCH_HEAD` | EXIT=1, **67 conflicts**, tree oid `51294a8dc6c197167a6d9373faafb62354204147`, stderr 0 bytes | The conflict count is bounded and enumerable (67 files), NOT unmanageable. |
| Conflict distribution | apps/vscode 40, sdk/packages/core 16, sdk/packages/llms 6, sdk/packages/shared 2, sdk/packages/agents 1, apps/cli 1, bun.lock 1 | 60 of 67 conflicts (90%) sit in TWO domains with known, documented fork authority. |
| Upstream-only file count | **1661 upstream files are untouched by the fork** | Most of the upstream delta (1661/1803 = 92%) lands CLEAN with zero semantic risk — including the whole `sdk/packages/core/src/artifacts/` subtree that the MCP `get_artifacts` surface needs. |
| Fork-only file count | **1067 fork-only files** (782 apps/vscode, 144 core, 54 agents, 14 llms, 8 shared, 8 cli) | A cherry-pick/import strategy would have to re-derive 1067 files per upstream commit and would silently drop the fork's authority unless every one were manually re-listed. Full merge keeps them automatically. |
| Conflict-count proportionality | 67 conflicts / 558 upstream commits | A domain-batched cherry-pick would need ~558 cherry-picks with 67 semantic resolutions and 1661 clean file landings — strictly MORE work than one merge, with MORE risk of omitted dependencies. |
| Generated-artifact handling | Only 2 generated files conflict (catalog.generated.ts, bun.lock) | Both are REGENERABLE. That removes the main argument for cherry-picks (which cannot cleanly carry regenerations). |
| Export surface | `sdk/packages/core/src/index.ts` export count identical (148 = 148) and export-NAME diff is EMPTY | The SDK public surface reconciles cleanly — no API-shape migration needed for the MCP server. |
| Hub server | The fork's `apps/cline-hub/src/server/` file set is IDENTICAL to upstream (28 files, same names) and ZERO hub files conflict | The Hub — the durable owner of running sessions — merges with no conflict at all. |

**Rejected fallback rationale:** the fallback (domain-batched dependency-closed cherry-picks) would be appropriate only if the conflict scope were unmanageable. It is not: 67 conflicts is bounded and each one has a documented resolution rule. Attempting the fallback would produce an INCOMPLETE sync (explicitly forbidden to market as full parity) and would risk dropping upstream commits whose dependency closure cannot be closed in a cherry-pick batch.

**The one safety exception, stated plainly:** this is a deliberate safety exception to the "no branch per ACT" preference, justified by the measured 67-conflict / 1661-clean-file / 1067-fork-file shape. It is ONE long-lived integration branch/worktree for the whole reconciliation, NOT a new branch per wave.

## Conflict resolution rules (the actual integration contract)

Every conflict is resolved by ONE of these five rules, and each resolution MUST cite the rule:

- **R1 — FORK_AUTHORITY_WINS (fork file stands, upstream change re-applied inside it).** Applies to all 13 fork-authority rows in `fork-authority-conservation-map.tsv`. Concretely: `sdk-session-event-coordinator.ts` (fork 5115 lines vs upstream 316 — upstream-wins is a P0 REJECT), `sdk-terminal-execution-mode-coordinator.test.ts` (modify/delete — upstream deleted it in `29d66f6fbcd`; the fork's terminal-mode authority MUST be re-hosted, not silently dropped), `editor.ts`, `minimax-thinking.ts`, `portable-reasoning.ts`, `shared/agent.ts`, `pending-prompt-service.ts`, `local-runtime-host.ts`, `task-header-elm-authority.ts` consumers, `vscode-run-commands-tool.ts`, `message-translator.ts`, `state-keys.ts`, `getStateToPostToWebview.ts`.
- **R2 — UPSTREAM_ADDSITIVE.** Upstream change is a NEW file or a pure addition with no fork counterpart: e.g. `sdk/packages/core/src/artifacts/**`, `sdk/packages/core/src/cloud/**`, `sdk/packages/core/src/cron/**`, `helpers.run-commands.test.ts`, `langfuse-stream-telemetry.ts`, `plugin-commands.ts`, hub TLS/proxy fixtures. Take upstream.
- **R3 — UPSTREAM_REWRITES, FORK_ADAPTS.** Upstream rewrote a shared file to a different semantic. Adapt upstream's intent INTO the fork structure; never substitute wholesale. Concretely: `portable-reasoning.ts` (upstream model-facts model vs fork native-option guard), `error-classification.ts` (fork 294 -> upstream 462 lines, additive), `compaction.ts` (fork working-context authority + upstream actual-input-token trigger), `agent-runtime.ts` (fork 5036-line trace subsystem + upstream reasoning-only retry predicate), `ai-sdk.ts` (fork provider-request-capture + upstream stream-error retry / Langfuse terminal failure).
- **R4 — REGENERATE.** `sdk/packages/llms/src/catalog/catalog.generated.ts`, `bun.lock`, `sdk/packages/llms/src/provider-ids.generated.ts` (if touched). Never hand-merge; run the generator / `bun install`, then re-apply fork-local entries (MiniMax M3.1) and re-verify the CVE floors.
- **R5 — OUT_OF_SCOPE.** `apps/examples/desktop-app/**` (441 upstream files, 0 fork files), `apps/examples/menubar/**`, `apps/examples/vscode/**`, `sdk/packages/ui/**` (new package with no ClineMM consumer). These are excluded from the merge CONTENT review but their commits still remain in the merged history (a full merge keeps them reachable).

## First implementation wave (U02) — executable evidence in 1–2 meaningful commits

**Wave 1 goal: land the merge with ZERO semantic regressions, then prove the highest-risk conflict resolutions are correct.** No MCP server, no new internal subsystem, no Factory infrastructure rebuild (explicitly out of U01/U02 scope).

**Files in scope for wave 1** (the 67 conflicted files + the regenerations):
- `apps/vscode/**` (40 conflicts)
- `sdk/packages/core/**` (16 conflicts)
- `sdk/packages/llms/**` (6 conflicts)
- `sdk/packages/shared/**` (2), `sdk/packages/agents/**` (1), `apps/cli/src/main.ts` (1), `bun.lock` (1)

**Upstream SHAs that MUST be present (the wave's upstream anchor, by SHA — not by subject):**
- `2f0f78bb8e642e2920fda23c3c2f502ff412d035` — editor `old_text` null recovery (R3 into the fork error path)
- `03ffa9ec3ecd6d691a698c0859eb68afa6e107b8` — editor schema null preprocess (R3, keep fork nullable contract)
- `e9dafbb764d0cb9acb4ef93a956ae72c350b3952` — empty run_commands rejection (R3)
- `59f219fad961dfc0602d4d8fc59f08a029ef600f` — ask_question reframe (R3 into shared/agent.ts)
- `5e854953783d791395c55929629b5a1d2418ef11` — reasoning-only disconnect retry (R3 into agent-runtime.ts)
- `722b640c281f52e713e2ce88d05af1a3993af8d2` — transient provider retry + yolo prompt split (R3)
- `9969b675f3d0a0f077bd24a52c48b6a6fe946b76` + `f8a201abb7a7a543eb0ecaffda2529331d54c0d1` — max-tokens recovery (R3)
- `ee7f4f5c669bac81cbf5745087930adf29765c9e` — stream-error retry + Langfuse terminal failure (R3 into ai-sdk.ts)
- `cb0092e3430282280ed046fa2cb83b55c40fe4e8` + `43a976d93` + `d4d3d9f31f3` + `005ad4f6d` — compaction token accuracy (R3 into the fork working-context authority)
- `29d66f6fbcdb44d0dc5627caab61035256e837f2` — Reset-Code gating + terminal-coordinator deletion (R1: re-host the fork terminal-mode authority)
- `8a520150f8bc5f6f3758e876b80b8cdd94d3efcd` + `4d28d82efaf907a2e591c708812347054d08da80` + `636de8b2afce3b2837eba26f6cc68fe6f949555d` — hub lifecycle / drain-and-replace / session-error persistence (R2)
- `07ce8b83248ea38dd53a94fbbf167b8ea8b8e8eb` + `46996c9992d91e57c268091c971cfda52b0da399` — artifact publishing + cloud download URLs (R2 — this is the upstream substrate for the future MCP `get_artifacts`)
- `7e8063857bee520f1f15ceaa743e1e3f9f7900ef` + `bb203d435c357cc9cc072aa46ffed5ae5966fd56` — CVE floors (R4 via `bun install`)
- `afabc824d88ebd0c779ab06f0cfb14c5483dc50f` — preserve `--json` when delegating (R2)
- `d630fa8f24fb225b07a0c98be04fa52bf49c4dc5` — **DEFER** (removes the fork-used CLI schedule/history options; needs an explicit product decision) — see the DEFER list below.

**Dependency closure for wave 1:**
- `sdk/packages/shared` -> `sdk/packages/agents` -> `sdk/packages/llms` -> `sdk/packages/core` -> `apps/cline-hub` -> `apps/cli` -> `apps/vscode`.
- Build order MUST be: `bun install` (regenerate `bun.lock`) -> `bun run build:sdk` -> `bun run build:apps` -> per-package typecheck -> focused witnesses -> broad suites.

**Wave 1 gate (RED/Green or equivalent baseline-delta checks) — all must hold:**
1. `sdk/packages/agents` typecheck: 0 errors (baseline 0).
2. `sdk/packages/llms` typecheck: 0 errors (baseline 0).
3. `sdk/packages/core` typecheck: <= 55 errors AND 0 errors outside `*.test.ts` (baseline 55, all in `*.test.ts`).
4. `apps/cli` typecheck: 0 errors (baseline 0).
5. `minimax-m31-exact-id-wire01.test.ts`: 8/8 GREEN (baseline 8/8).
6. `editor.realpath-authority.test.ts`: EXACTLY 3 failed / 4 passed (baseline 3/4 — the RED matrix must NOT change).
7. `apps/vscode` `test:vitest:b2po01`: 9/9 GREEN (baseline 9/9).
8. `apps/vscode` `check-types:b2po01`: GREEN.
9. `apps/vscode` `check-types:c2-4-c-bridge` + `test:vitest:c2-4-c-bridge`: GREEN (baseline-frozen diagnostic gate).
10. `apps/vscode` `bun run build:webview` + `bun esbuild.mjs` + `bun run package`: succeed.
11. `bun run build:sdk` succeeds (the SDK packages resolve each other through compiled `dist/`, so this is mandatory before any SDK test).
12. CLI `--json` one-shot emits the SAME event-type vocabulary as the fork baseline.
13. No conflict resolution may delete any of the 1067 fork-only files; the file count MUST be >= the fork baseline.

**Wave 1 expected commit shape (1–2 meaningful commits):**
- Commit 1: `merge(upstream): integrate upstream main a6507a62a147db4a35e27f4294589742ccac5060` — the full merge with all 67 conflicts resolved by R1–R5 and each resolution citing its rule.
- Commit 2 (optional): `fix(clinemm): re-apply fork authority after upstream merge` — only the residual R3 adaptations that are cleaner as a separate, independently revertable commit.

**Explicitly NOT in wave 1:** the MCP server, any new internal subsystem, Factory infrastructure, the desktop app, the menubar app, and the `sdk/packages/ui` package.

## DEFER / OUT_OF_SCOPE register (every omitted upstream change is recorded)

| Upstream SHA | Subject | Disposition | Reason |
|---|---|---|---|
| `d630fa8f24fb225b07a0c98be04fa52bf49c4dc5` | fix(cli): reject schedule and history options that do nothing (#14931) | DEFER | REMOVES a fork-used CLI surface (`apps/cli/src/commands/schedule/`, `history-command.ts`). The fork must first decide whether those commands stay. |
| `0322bc5d510000a33ef5eadc3b4c84df7fcef285` | chore(cli): note removed schedule and history options in v3.0.70 changelog | DEFER | Depends on the DEFER above. |
| `51f63e4fd63aeeb74d708b9c3d1f8b800aff9b3e` | feat(cli): start Cline Cloud sessions from the interactive TUI (#15317) | DEFER | Cloud sessions are outside the ClineMM production seam. |
| `1932d5dc37ae14b050073e3a3444f71e34ea0309` | feat(vscode): Cline Cloud sessions (#13799) | DEFER | Cloud sessions require cloud infrastructure + auth; not a ClineMM local seam. |
| `a776ce57e411be9a61259ceb7781dfe181489e93` / `55adef16321086793ce64e2eacb1f9c22d6bab4d` / `e369614d1a62f4e3d2f9de7de1d6699f9385423` | cloud Hub runtime / integrate cloud agents / shared cloud handoff | DEFER | Cloud. |
| `d39a149d1ed1570361f5068a7acfd43a7ba49325` | chore(sdk): publish @cline/ui with the SDK packages (#15311) | DEFER | `sdk/packages/ui` has no ClineMM consumer; publishing it changes the SDK package set. |
| `17529c8cb1dbbdd07b263a7a54be504c7fcf7a27` | feat(core): add SSH remote environments (#14116) | DEFER | SSH remote environments change the execution substrate; the fork has its own seatbelt/sandbox authority that must not be bypassed silently. |
| `8a520150f8bc5f6f3758e876b80b8cdd94d3efcd` (cloud half) | feat(desktop): attribute lifecycle telemetry across the shared Hub (#13820) | INTEGRATE hub half / DEFER desktop half | Split by file. |
| `94980446c99f24040e9ed7a03e7726be4aea9198` | fix(hub): stop forwarding per-chunk stream events to remote onEvent hooks (#14120) | DEFER | Changes event granularity; must be checked against the fork's event-trace cardinality contract BEFORE it lands, because the portable-trace provenance depends on per-chunk events. |
| `b46cf77ed18c92fa62c28aac825a4ba523653059` / `12a4c6bfe263bcbd25f5ac56de6481e759ea2522` / `789f79e46d3ba579717e8dc8be35fe28af935b06` | Hub-managed Agent Plugins / load plugins in the hub process / run plugins only in workers | DEFER to wave 2 | Additive, but `789f79e46d` DROPS the in-process plugin mode — a behaviour removal that needs its own gate. |
| all `apps/examples/desktop-app/**` commits (237) | desktop marketplace/cloud/sidecar/mermaid/UX/Linux | OUT_OF_SCOPE | 441 upstream files, 0 fork files; not a ClineMM production seam. |
| all `apps/examples/menubar/**` commits (3) | logo assets / lifecycle telemetry | OUT_OF_SCOPE | 52 upstream files, 0 fork files; not a ClineMM production seam. |
| all `sdk/packages/ui/**` commits (31) | new UI package | OUT_OF_SCOPE | No ClineMM consumer. |

## Live limitations (honest scope statement)

- The installed-extension dogfood qualification is LIVE_UNOBSERVABLE in this environment (the Electron/VS Code host cannot launch here — documented in prior ClineMM ACTs). The currently installed bundle is `s1onique.clinemm-4.1.16-5a1c485cb`, bound to the PRE-integration head `5a1c485cb`. A fresh VSIX build+install+qualification is REQUIRED before the integration can be called qualified. This MUST NOT be fabricated.
- The `sdk/packages/core` typecheck is RED at ENTRY_HEAD (55 errors, all in `*.test.ts`). This is a BASELINE failure, independently observed; it must not be misreported as an integration regression, and it must not be silently "fixed" to manufacture a green.
- The `editor.realpath-authority.test.ts` witness is INTENTIONALLY RED at cases C/D/E. This is a documented defect observation, not an integration defect.
- `apps/cli` e2e, Hub cross-client attach/reconnect, and any live-provider test require a running hub daemon and provider credentials that are not available in this RECON environment. They are NOT_EXECUTED here, not "passing".
- The upstream `sdk/packages/core` bundle minifier name-collision hazard (`SqliteSessionStore` / `SqliteTeamStore` both mangle to `w4`) is a KNOWN upstream packaging risk that the integration must observe when the SDK is consumed from the built `dist/`.
