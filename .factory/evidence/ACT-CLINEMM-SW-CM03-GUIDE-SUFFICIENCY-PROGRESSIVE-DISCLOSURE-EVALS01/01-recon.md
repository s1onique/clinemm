# 01 — Recon (ACT-CLINEMM-SW-CM03-GUIDE-SUFFICIENCY-PROGRESSIVE-DISCLOSURE-EVALS01)

## Predecessor entry state

- **ACT-CLINEMM-SW-CM02-HANDLER-TOOL-ROUTING-EVALS01** closed PASS at entry head `2ede285e2`.
- **ACT-CLINEMM-SW-CM01-SKILL-TRIGGER-EVALS01** closed PASS at the same entry head.
- **ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01** closed PASS_RUNTIME_SEAM_REPLAY_FAITHFUL (bounded correction round 2).
- **C10 / BNCA** closed PASS/LOAD-BEARING earlier in the SW-CM sequence.
- DO NOT re-litigate any closed ACT unless new evidence contradicts.

This ACT is positioned **downstream of dispatch** (SW-CM02). SW-CM03 must
NOT re-evaluate:
  - which skill NAME the model picks (SW-CM01)
  - whether `skills(<name>)` routes to the correct runtime handler (SW-CM02)
  - whether tool names must be exact, whether aliases canonicalize, etc.

SW-CM03 measures what happens **after** the `skills` tool handler has
resolved a concrete enabled skill S and returns the SKILL.md body to the
agent/model: identity, sufficiency, minimality, isolation, refresh,
precedence, configured-agent skill-scope.

## ClineMM production seams (authoritative — current source)

### SKILL_DISCOVERY_SEAM
`sdk/packages/core/src/extensions/config/user-instruction-config-loader.ts`
  - `createSkillsConfigDefinition` (L527-552) returns a `UnifiedConfigDefinition<"skill", SkillConfig>`.
    - `directories`: opts.config + managed workspace root (`<workspace>/.cline`).
    - `discoverFiles: discoverSkillFiles` walks directories for SKILL.md.
    - `includeFile: fileName === "SKILL.md"`.
    - `parseFile: parseSkillConfigFromMarkdown` parses frontmatter; the
      skill id is `normalizeName(skill.name)` (trim + lower).
  - `parseSkillConfigFromMarkdown` (L285-315) reads frontmatter → YAML,
    falls back to `markdown` body text as instructions; `name` is required,
    `description?` / `disabled?` are optional.
  - **Skill metadata surface (lifetime)**: `SkillConfig = { name, description?,
    disabled?, instructions, frontmatter }`. There is **no `resources`
    field**, **no `path` field**, **no skill-root URI** — resources are
    treated as ordinary workspace files accessible via the generic file
    tools. ClineMM does NOT maintain the upstream three-level progressive
    disclosure model (L1 metadata / L2 SKILL.md body / L3 resources); it
    collapses L2 + L3 into the `instructions` string. **This is a recorded
    production peculiarity for SW-CM03 and the guide-sufficiency metric
    must account for it.**

### SKILL_PARSE_SEAM
  - `parseMarkdownFrontmatter` (L196-220): strict `^---\\r?\\n(.*?)\\r?\\n---...` regex; on
    no-match returns `data={}, body=normalized, hadFrontmatter=false`.
  - `parseSkillConfigFromMarkdown` (L285-315): YAML-parses frontmatter;
    `instructions` is `body.trim()`; missing `name` throws.
  - BOM is stripped via `stripUtf8Bom` from `@cline/shared` (per workspace
    rule — DO NOT strip user-side BOM differently from production).

### SKILL_BODY_LOAD_SEAM
  - Discovery happens at watcher startup (`UnifiedConfigFileWatcher` in
    `unified-config-file-watcher.ts`) via `discoverFiles` walking each
    directory in `directories`. SKILL.md contents are read once via
    `parseFile: (context) => parseSkillConfigFromMarkdown(context.content, ...)`.
  - Body is captured entirely into the `SkillConfig.instructions` field —
    there is **no lazy re-read** at skill invocation time.

### SKILL_RESULT_INJECTION_SEAM
  - `createUserInstructionSkillsExecutor`
    (`sdk/packages/core/src/extensions/config/user-instruction-plugin.ts:174-217`)
    returns a `SkillsExecutorWithMetadata` whose call returns:
    ```xml
    <command-name>{skill.name}</command-name>
    [\\n<command-args>{trimmedArgs}</command-args>]
    <command-instructions>
    [Description: {skill.description}\\n\\n]
    {skill.instructions}
    </command-instructions>
    ```
    This is the **entire payload** the model receives. There is no
    separate resource enumeration / loading step inside the executor.

### ENABLEMENT_SEAM
  - `getConfiguredSkillsFromWatcher`
    (`user-instruction-plugin.ts:75-93`): the `disabled === true` filter
    is applied **before** the snapshot is exposed to the executor. Disabled
    skills are still in the watcher's snapshot but NOT in the list returned
    by `getConfiguredSkillsFromWatcher`, so they cannot be triggered via
    the `skills` tool.
  - When invoked, a disabled skill triggers the resolution error path
    which returns `Skill "<name>" is configured but disabled.` (see
    `resolveSkillRecord`).
  - `setSkillDisabledInFrontmatter` (legacy `apps/vscode/src/...`) writes
    the frontmatter flag; runtime reads from frontmatter.

### WORKSPACE_GLOBAL_PRECEDENCE_SEAM
  - Search path resolution in
    `sdk/packages/shared/src/storage/paths/skills.ts` → `resolveSkillsConfigSearchPaths`.
    The ClineMM watcher walks every directory in `directories` and
    **last-loaded id wins** (per `UnifiedConfigFileWatcher` snapshot keying
    by `resolveId = normalizeName(skill.name)`). This means **later in
    the directory list = higher precedence** (later snapshots overwrite
    earlier ones). The exact ordering must be re-confirmed by reading
    the shared storage helper at test design time.

### CACHE_REFRESH_SEAM
  - `UnifiedConfigFileWatcher` listens to filesystem events (chokidar or
    fs.watch depending on capability); `watcher.refreshType("skill")`
    forces an immediate rescan.
  - The executor's `configuredSkills` getter is **lazy** (Object.defineProperty
    getter) and reads from the watcher's snapshot on every access. After
    `refreshType`, the next invocation sees the new SKILL.md body.

### RESOURCE_DISCOVERY_SEAM
  - **ABSENT** in ClineMM. There is no bundled-resource auto-discovery, no
    `docs/` enumeration, no skill-root reference path. Resources, if any,
    exist as ordinary workspace files and must be accessed via generic
    tools (`read_file`, etc.). This is recorded as **D10 territory only**
    (content insufficiency), not D4-D6 (resource plumbing defects).

### RESOURCE_LOAD_SEAM
  - **ABSENT** as a dedicated seam. Resources load via the normal file
    tool path; the skill executor never references them. SW-CM03 will
    therefore exercise (a) the SKILL.md body returns the full body, and
    (b) that the body does NOT inline/embed arbitrary workspace content.

### CONFIGURED_AGENT_SKILL_SCOPE_SEAM
  - Configured-agent entry-point: `agent.skills?: string[]` on
    `ConfiguredAgentConfig` (used by `DefaultRuntimeBuilder.build`).
  - Runtime-builder passes `agent.skills` as `allowedSkillNames` to
    `userInstructionService.createSkillsExecutor(agent.skills)` which
    calls `createUserInstructionSkillsExecutor(watcher, ready, allowedSkillNames)`.
  - `getConfiguredSkillsFromWatcher(watcher, allowedSkillNames)` (L75-93
    + `isSkillAllowed` L51-73) filters by:
      - `normalizeSkillToken(skillId)` matches an entry in the allowlist
      - `normalizeSkillToken(skillName)` matches an entry in the allowlist
      - the **bare** (post-`:`) suffix matches an entry
    Plugins are namespaced as `plugin:skill` and stripped of the prefix
    for matching.
  - **Effect**: a configured-agent with `skills: [review]` only sees the
    `review` skill in its `configuredSkills` projection AND any request
    outside the allowlist returns
    `Skill "<name>" not found. Available skills: review`.
  - **Guide-level scope** is therefore an emergent property of the same
    `allowedSkillNames` allowlist applied uniformly: the SKILL.md body,
    the description suffix, and the rejection error are all derived from
    the filtered snapshot.

### EXISTING_TEST_COVERAGE
- `apps/vscode/src/core/context/instructions/user-instructions/__tests__/skills.test.ts`:
  legacy VSCode-side skill discovery tests.
- `sdk/packages/core/src/extensions/tools/definitions.test.ts:39-122`:
  `createSkillsTool` include/exclude enable flag and description suffix.
- `sdk/packages/core/src/extensions/tools/__tests__/skill-trigger-evals01.swcm01.test.ts`:
  SW-CM01 — **trigger boundary** (descriptions do NOT leak, name gating,
  resolveSkillRecord error paths, snapshot freshness). This is the model
  inputs to the tool, NOT the tool output to the model.
- `sdk/packages/core/src/runtime/orchestration/runtime-builder.configured-agent-execution.test.ts`:
  configured-agent end-to-end; uses `DefaultRuntimeBuilder.build({...})`.
- `sdk/packages/core/src/runtime/orchestration/runtime-builder.routing-evals.swcm02.test.ts`:
  SW-CM02 — routing boundary, with one Section B skill-scope test (B5).
- `sdk/packages/core/src/extensions/config/user-instruction-config-loader.test.ts`:
  YAML/frontmatter loading for skills and rules.

None of the above exercise:
  - **the loaded SKILL.md body delivered to the executor's return string**,
  - **content-derived sufficiency of the guide**,
  - **same-named resource paths across skills** (D5),
  - **configured-agent skill-scope from a child's eye** (D9).

SW-CM03 fills those four gaps using the production `createSkillsTool`
executor as the seam.

## Production child construction seam (for Section B — configured-agent scope)

For SW-CM03 Section B (configured-agent skill scope), the pattern from
SW-CM02 Section B applies: drive the real `DefaultRuntimeBuilder.build(
{ config: { enableSpawnAgent: true, ..., userInstructionService }})`
with the SAME `vi.mock("./session-runtime-orchestrator", ...)` to capture
the `AgentConfig` passed to the SUB-AGENT's `SessionRuntime`. The
relevant property is `config.skillsExecutor.configuredSkills` —
the visible skill inventory available inside the sub-agent — verified via
the executor the sub-agent receives.

The configured-agent yml schema lists `skills: [name1, name2]`. The
builder passes that array to `createSkillsExecutor(agent.skills)` which
applies `isSkillAllowed` per skill. The sub-agent's
`executor.configuredSkills` getter then reflects the filter, and the
sub-agent's `skills` tool has both the filtered description suffix AND
the same `resolveSkillRecord` rejection behaviour for unlisted names.

For Section A (root / single-runtime), the production seam is
`createSkillsTool(executor).execute({skill,args}, context)`. We do NOT
reimplement the executor or the resolver.

## What this ACT must do

1. Pin baseline behavior of the SKILL.md body delivery (B1-B8).
2. Build a deterministic fixture skill set exercising:
   - minimal guide sufficient on its own (S1)
   - guide that references an external resource (S2)
   - multiple resources, only one needed for a simple task (S3)
   - script-backed skill (S4)
   - same-named resource paths across skills (S5)
   - disabled skill leakage probe (S6)
3. Drive the production seam (createSkillsTool + createUserInstructionSkillsExecutor)
   for each fixture.
4. For configured-agent skill scope, drive `DefaultRuntimeBuilder.build({ enableSpawnAgent: true })`
   and capture child-executor projection (same pattern as SW-CM02).
5. Compute guide-identity, refresh, precedence, and configured-agent-scope
   metrics. Guide-content sufficiency is recorded but is NOT a runtime
   defect (D10) — bounded repair ACTs (ACT-CLINEMM-SKILL-GUIDE-CONTENT-QUALITY01)
   are downstream of this ACT if needed.
