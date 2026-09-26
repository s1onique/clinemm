# 01 — Recon (ACT-CLINEMM-SW-CM01-SKILL-TRIGGER-EVALS01)

Entry head: `8b8ece1c8` (terminal of ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01).
ACT stage: SW-CM01, next in sequence after SW-CM04 (SW-CM04 → SW-CM01 → SW-CM02 → SW-CM03).

Upstream docs cited (NOT assumed-parity; authority is ClineMM source):

- `docs/customization/skills.mdx` — progressive disclosure model: only `name` +
  `description` frontmatter at startup; full `SKILL.md` loaded when the skill is
  triggered via the `use_skill` tool (`skill` is the model's input; the tool is
  internally named `skills`); explicit slash-command invocation documented.
- `docs/core-workflows/using-commands.mdx` — `/<skill-name>` slash command path.

ClineMM source findings (the **authoritative** trigger surface):

## SKILL_DISCOVERY_SEAM

`apps/vscode/src/core/context/instructions/user-instructions/skills.ts`

- `discoverSkills(cwd, remoteSkillEntries?)` (L220–251)
  - Reads `getSkillsDirectoriesForScan(cwd)` → walks project, disk-global, and
    remote skill directories; precedence remote > disk-global > project.
- `getAvailableSkills(skills)` (L256–270)
  - Iterates backwards to dedupe by `name`; later (remote/global) wins on
    collision.
- `getSkillContent(skillName, availableSkills, remoteSkillEntries?)` (L276–312)
  - Loads the SKILL.md body on demand (`parseFrontmatter(fileContent)` for disk
    skills, remote entries for `remote:<name>` skills).

This is the **VSCode-extension** discovery seam (legacy). It is NOT what the
runtime-builder uses; the runtime-builder uses the SDK seam below.

## SKILL_ENABLEMENT_SEAM

- `setSkillDisabledInFrontmatter(skillMdPath, enabled)` in `skills.ts` (L67–82)
  writes a `disabled: true` flag into the SKILL.md frontmatter on disk for
  non-remote paths. ENG-1995 fix: the SDK reads the frontmatter `disabled` flag,
  not the sidebar toggle, so both writes must agree.
- `sdk/packages/core/src/extensions/config/user-instruction-config-loader.ts`
  parses `disabled` on `SkillConfig` (L42–48) into the runtime snapshot.
- `sdk/packages/core/src/extensions/config/user-instruction-plugin.ts`
  `getConfiguredSkillsFromWatcher` (L75–93) and `listAvailableSkillNames`
  (L95–104) filter by `disabled === true` before exposing to the tool.

## SKILL_METADATA_SEAM

This is the load-bearing observation for SW-CM01.

- `sdk/packages/core/src/extensions/tools/definitions.ts:1027-1039` —
  `createSkillsTool()` defines the tool's `description` via
  `Object.defineProperty(tool, "description", { get })`. The getter pulls
  `executor.configuredSkills` and concatenates **NAMES ONLY**:

  ```ts
  get() {
      const skills = executor.configuredSkills
          ?.filter((s) => !s.disabled)
          .map((s) => s.name);
      if (skills && skills.length > 0) {
          return `${baseDescription} Available skills: ${skills.join(", ")}.`;
      }
      return baseDescription;
  }
  ```

- **CONFIRMED**: at the trigger boundary the model sees only the list of skill
  names, not the descriptions. The descriptions are inside `SKILL.md` and only
  become available to the model AFTER it invokes the `skills` tool.

- `sdk/packages/core/src/extensions/tools/types.ts:159-180` —
## EXPLICIT_INVOCATION_SEAM

- `sdk/packages/core/src/extensions/config/runtime-commands.ts:115-144`
  `resolveRuntimeSlashCommandFromWatcher(input, watcher, options?)`.
  - Matches `/(\S+)` at start of input.
  - Normalizes the command name via `normalizeRuntimeCommandName`
    (L23–35) — lowercase, whitespace→`-`, symbols→`-`, collapses runs.
  - Looks up the first command whose `name === normalized` from
    `listAvailableRuntimeCommandsFromWatcher` (which combines `skill` and
    `workflow` kinds, with skills owning collisions).
  - **Branching** by `options.expandSkillCommands`:
    - `false` (default when `skills` tool is available — see
      `apps/examples/desktop-app/sidecar/chat-session.ts:136` and
      `apps/cli/src/runtime/prompt.ts:117`) → returns input unchanged (the
      slash command stays as typed text; the model invokes the `skills`
      tool with the parsed name).
    - `true` (default when the `skills` tool is NOT available — workflow-only
      path or unhosted CLI) → returns
      `${matched.instructions}${remainder}` (the slash command is
      textually expanded into the prompt).
  - **Workflows ALWAYS expand** (`matched.kind === "workflow"`); only skills
    honor `expandSkillCommands=false`. See L140-142.

- VSCode-side expansion: `apps/vscode/src/sdk/slash-command-expansion.ts` —
  textually expands commands anywhere in a message (webview lets users
  insert slash commands after whitespace).
- VSCode-side runtime commands list: `apps/vscode/src/sdk/builtin-slash-commands.ts`.

## MODEL_SELECTION_BOUNDARY

This is the **trigger boundary** ACT-CLINEMM-SW-CM01 must measure.

- The model only sees the `skills` tool's `description` string at request
  build time. That string is composed of:
  1. A static base description (instructions to "check if any available
     skills match", to invoke when matched, etc. — see
     `definitions.ts:998-1004`).
  2. A dynamic suffix ` Available skills: <sorted name list>.` if any
     enabled skills are configured.
- **The model has no view of skill descriptions at trigger time.** It must
  choose based on the *request text vs. skill name* (and possibly the static
  base instruction prose, which is generic).
- Therefore the load-bearing model decision is: which skill NAME (if any) to
  pass as `input.skill` to the `skills` tool when the user request arrives.

## Existing test coverage (concepts)

- `sdk/packages/core/src/extensions/tools/definitions.test.ts:39-122` —
  tests `createSkillsTool`: includes/excludes based on enable flag;
  description includes enabled names and excludes disabled names; omits
  the `Available skills` suffix when no skills are configured; input
  validation via Zod; executor receives parsed `(skill, args, context)`.
- `sdk/packages/core/src/extensions/config/user-instruction-plugin.ts` —
  no dedicated test file. The runtime-commands.ts file has
  `runtime-commands.test.ts` for slash command normalization.
- `sdk/packages/core/src/runtime/orchestration/runtime-builder.configured-agent-execution.test.ts`
  end-to-end exercises `DefaultRuntimeBuilder.build` with a
  configured-agent that lists `skills: commit`, and asserts the delegated
  agent's `skills` tool resolves to `<command-name>commit</command-name>` and
  rejects unknown skills with `Skill "review" not found.`
- `apps/vscode/src/core/context/instructions/user-instructions/__tests__/skills.test.ts`
  — disk-side discovery tests for the legacy VSCode extension path.

## Model/provider dependencies

- The runtime-builder calls `supportsModelTool({providerId, modelId}, ...)` to
  filter tools (`web_search` / `image_generation` / etc.), but **not** for
  `skills`. The skills tool is gated solely on
  `enableSkills && hasConfiguredSkills() && isSkillsToolEnabledForSession()`.
- Tool routing rules (`DEFAULT_MODEL_TOOL_ROUTING_RULES`) apply generic
  filter rules but do not affect `skills` directly.
- **No live provider execution is available in this sandbox.** No
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `CLINE_API_KEY` env vars present.
  Live model evaluation per Section 13 of the ACT is therefore
  `CAPTURE_INSUFFICIENT` for this run.

## Discovered ClineMM peculiarity (capture honestly)

The ACT Section 2 references the upstream "name + description" progressive-
disclosure contract. ClineMM's actual implementation narrows the trigger
surface further: only the **name** is forwarded to the model's tool
description; the **description** is loaded only after the tool is invoked.
This means:

- The model's trigger decision is driven by `name` strings + the user's
  request text + the generic base tool description.
- This is a stronger progressive-disclosure than upstream documents, and it
  is the real surface SW-CM01 measures.
- For the production-seam characterization, the load-bearing assertion is:
  "the metadata that does reach the tool description reaches it intact,
  with the disabled filter applied" — NOT "descriptions are visible at
  trigger time" (they are not, in ClineMM).

This recon is bounded to TRIGGER SELECTION. Routing / handler correctness
belongs to SW-CM02; guide sufficiency belongs to SW-CM03.
  `SkillsExecutorWithMetadata` interface; metadata entries carry
  `id / name / description? / disabled` but the `createSkillsTool` getter
  deliberately projects only `name` to the description (with `!disabled`
  filter). The `description` field IS present on the metadata but the trigger
  surface does NOT forward it.

This is a stronger progressive-disclosure than upstream docs suggest: the
upstream docs say "`name` and `description`" are exposed; ClineMM actually
exposes only `name` at the trigger surface, with description deferred to
post-trigger SKILL.md body load.

## SKILL_TRIGGER_TOOL

- Tool name: `skills` (the runtime name).
- Upstream alias: `use_skill` → `skills` (see
  `sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:105` in
  `CONFIGURED_AGENT_TOOL_NAME_ALIASES`).
- Schema: `SkillsInputSchema` — `{ skill: string, args?: string }` (validated
  via Zod at `definitions.ts:1014`).
- Tool description: see SKILL_METADATA_SEAM above; appended dynamic suffix
  `Available skills: <sorted names>.` sorted alphabetically by
  `listAvailableSkillNames` (`user-instruction-plugin.ts:103`).

## SKILL_TRIGGER_EXECUTION_SEAM

- `sdk/packages/core/src/extensions/config/user-instruction-plugin.ts:174-217`
  `createUserInstructionSkillsExecutor(watcher, watcherReady?, allowedSkillNames?)`
  returns a `SkillsExecutorWithMetadata`. The call signature is
  `(skillName, args, context) => Promise<string>`. On invocation it:
  1. Awaits `watcherReady` (race-safe init).
  2. `resolveSkillRecord(watcher, skillName, allowedSkillNames)` (L106-172).
     - Exact-id match → success.
     - Otherwise `bareName` suffix match (`plugin:skill` form): if exactly one
       enabled match → success; if multiple → ambiguity error; if all disabled
       → disabled error.
     - Otherwise → `Skill "<name>" not found. Available skills: ...` error
       OR `No skills are currently available.` if list is empty.
  3. Idempotency guard: `runningSkills: Set<string>` rejects concurrent
     re-entry of the same skill id (L188-189).
  4. Returns an XML payload:
     `<command-name>{name}</command-name>[<command-args>{args}</command-args>]
      <command-instructions>
      [Description: {description}\n\n]{instructions}
      </command-instructions>`
     This is the loader payload the runtime hands back to the model.
- `executor.configuredSkills` getter (L208-215) projects
  `getConfiguredSkillsFromWatcher(watcher, allowedSkillNames)` into the
  metadata shape `{ id, name, description?, disabled }`.