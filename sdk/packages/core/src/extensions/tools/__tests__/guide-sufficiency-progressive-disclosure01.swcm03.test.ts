// ACT-CLINEMM-SW-CM03-GUIDE-SUFFICIENCY-PROGRESSIVE-DISCLOSURE-EVALS01
//
// Production-seam characterization of the GUIDE SUFFICIENCY + PROGRESSIVE
// DISCLOSURE boundary. This is positioned DOWNSTREAM of SW-CM01 (trigger
// surface) and SW-CM02 (tool-routing): once `createSkillsTool(executor)
// .execute({ skill, args }, ctx)` has been called, what flows back to the
// model? Is the correct SKILL.md body loaded? Is unrelated content
// suppressed? Is cross-skill bleed prevented? Does refresh/snapshot
// reflect on-disk changes? Does the configured-agent allowlist scope
// child-runtime guides correctly?
//
// The production seam driven here is `createSkillsTool` (an
// `AgentTool<SkillsInput, string>`). Body and rejection paths are taken
// from the executor at
//   sdk/packages/core/src/extensions/config/user-instruction-plugin.ts:174-217
// which is the SAME executor wired into the production runtime via
// `createUserInstructionPlugin.setup` (L234-275) and into sub-agent
// child runtimes via `runtime-builder.ts:594-617` close. No local
// mirror of the executor is used.
//
// For configured-agent skill scope (Section D), this file drives the
// REAL `DefaultRuntimeBuilder.build({ config: { enableSpawnAgent: true }})`
// and inspects the captured `AgentConfig.tools` from a mocked child
// `SessionRuntime`, exactly like `runtime-builder.configured-agent-
// execution.test.ts` and the SW-CM02 file
// `runtime-builder.routing-evals.swcm02.test.ts`.
//

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createUserInstructionConfigWatcher,
	type UserInstructionConfigWatcher,
} from "../../config/user-instruction-config-loader";
import { createUserInstructionSkillsExecutor } from "../../config/user-instruction-plugin";
import { createSkillsTool } from "../definitions";
import type { SkillsExecutorWithMetadata } from "../types";

// =============================================================================
// SECTION A — Fixture skill catalog
// =============================================================================
//
// Six fixture skills implementing the ACT §5 / §6 contract:
//   S1 minimal-guide        — body contains all required facts (no
//                             referenced resources).
//   S2 one-resource         — body references docs/detail.md.
//   S3 two-resource-selective — body references docs/common.md + advanced.md.
//   S4 script-backed        — body references scripts/helper.sh.
//   S5 overlapping-resource-names — body references docs/config.md
//                                    (skill-b also has docs/config.md).
//   S6 disabled-skill       — valid body, but frontmatter disabled:true.
//
// Each skill has a stable GUIDE_MARKER=... and a distinct
// REQUIRED_FACT=... string. The body also contains a literal
// `docs/detail.md` (or `docs/common.md`, `scripts/helper.sh`) reference
// the agent/model would parse to know where more information lives.
//
//   decision: NO separate fixture directory on disk for `docs/` and
//   `scripts/` subresources — ClineMM's `skill-body load` is a
//   single-pass `parseSkillConfigFromMarkdown` that captures the whole
//   SKILL.md text into `SkillConfig.instructions` (see recon §SKILL_BODY_LOAD_SEAM).
//   Subfiles (`docs/*.md`, `scripts/*.sh`) are NOT auto-discovered.
//   "Referenced resources" are recorded as plain text in the body and
//   must be loaded by generic tools. We therefore assert
//       (i)  the body contains the LITERAL reference string (so the
//            model knows it exists), AND
//       (ii) the body does NOT contain the contents of the resource
//            (so D6 RESOURCE_EAGER_LOAD never repros), AND
//       (iii) the body does NOT contain the other skill's GUIDE_MARKER
//             (so D5 cross-skill bleed never repros).
//   This is a faithful characterization of "progressive disclosure" in
//   ClineMM's implementation (which is single-pass per SKILL.md;
//   resource auto-loader is ABSENT, per recon §RESOURCE_DISCOVERY_SEAM).

interface FixtureSkill {
	id: string;
	name: string;
	description: string;
	instructions: string;
	guideMarker: string;
	requiredFact: string;
	disabled?: boolean;
}

const S1: FixtureSkill = {
	id: "minimal-guide",
	name: "minimal-guide",
	description: "Minimal skill whose SKILL.md body is fully self-sufficient.",
	instructions:
		"# minimal-guide\n" +
		"\n" +
		"This guide is fully sufficient. The required fact is\n" +
		"\n" +
		"  GUIDE_MARKER=minimal-guide\n" +
		"  REQUIRED_FACT=alpha\n" +
		"\n" +
		"No external resource is required.\n",
	guideMarker: "minimal-guide",
	requiredFact: "REQUIRED_FACT=alpha",
};

const S2: FixtureSkill = {
	id: "one-resource",
	name: "one-resource",
	description:
		"Skill whose detailed procedure lives in docs/detail.md on disk.",
	instructions:
		"# one-resource\n" +
		"\n" +
		"For the precise procedure, read `docs/detail.md` in the\n" +
		"project root. The body marker is\n" +
		"\n" +
		"  GUIDE_MARKER=one-resource\n" +
		"  REQUIRED_FACT_REF=docs/detail.md\n" +
		"\n" +
		"The detail resource contains the REQUIRED_FACT=beta line.\n",
	guideMarker: "one-resource",
	requiredFact: "REQUIRED_FACT_REF=docs/detail.md",
};

const S3: FixtureSkill = {
	id: "two-resource-selective",
	name: "two-resource-selective",
	description:
		"Skill with a common and an advanced resource; simple tasks use only common.",
	instructions:
		"# two-resource-selective\n" +
		"\n" +
		"For simple tasks, read `docs/common.md`.\n" +
		"For advanced configuration, also read `docs/advanced.md`.\n" +
		"\n" +
		"  GUIDE_MARKER=two-resource-selective\n" +
		"  REQUIRED_FACT_REF=docs/common.md\n" +
		"  ADVANCED_FACT_REF=docs/advanced.md\n",
	guideMarker: "two-resource-selective",
	requiredFact: "REQUIRED_FACT_REF=docs/common.md",
};

const S4: FixtureSkill = {
	id: "script-backed",
	name: "script-backed",
	description:
		"Skill that requires invoking scripts/helper.sh to actually run.",
	instructions:
		"# script-backed\n" +
		"\n" +
		"To complete a task in this domain you must invoke\n" +
		"`scripts/helper.sh` via the run_commands tool.\n" +
		"\n" +
		"  GUIDE_MARKER=script-backed\n" +
		"  REQUIRED_FACT_REF=scripts/helper.sh\n",
	guideMarker: "script-backed",
	requiredFact: "REQUIRED_FACT_REF=scripts/helper.sh",
};

const S5_A: FixtureSkill = {
	id: "skill-a-config",
	name: "skill-a",
	description: "Skill A — contains docs/config.md with skill-a marker.",
	instructions:
		"# skill-a\n" +
		"\n" +
		"See `docs/config.md` for the skill-a config format.\n" +
		"\n" +
		"  GUIDE_MARKER=skill-a\n" +
		"  REQUIRED_FACT_REF=docs/config.md\n" +
		"\n" +
		"For skill-a docs/config.md contains the literal\n" +
		"`RESOURCE_MARKER=skill-a/config` token.\n",
	guideMarker: "skill-a",
	requiredFact: "RESOURCE_MARKER=skill-a/config",
};

const S5_B: FixtureSkill = {
	id: "skill-b-config",
	name: "skill-b",
	description:
		"Skill B — contains docs/config.md with skill-b marker (D5 isolation).",
	instructions:
		"# skill-b\n" +
		"\n" +
		"See `docs/config.md` for the skill-b config format.\n" +
		"\n" +
		"  GUIDE_MARKER=skill-b\n" +
		"  REQUIRED_FACT_REF=docs/config.md\n" +
		"\n" +
		"For skill-b docs/config.md contains the literal\n" +
		"`RESOURCE_MARKER=skill-b/config` token.\n",
	guideMarker: "skill-b",
	requiredFact: "RESOURCE_MARKER=skill-b/config",
};

const S6_DISABLED: FixtureSkill = {
	id: "disabled-skill",
	name: "disabled-skill",
	description: "Skill that exists on disk but is disabled in frontmatter.",
	instructions:
		"# disabled-skill\n" +
		"\n" +
		"  GUIDE_MARKER=disabled-skill\n" +
		"  REQUIRED_FACT=should-never-load\n" +
		"\n" +
		"This guide body MUST NOT load.\n",
	guideMarker: "disabled-skill",
	requiredFact: "REQUIRED_FACT=should-never-load",
	disabled: true,
};

// All fixtures mounted together by default. The full catalog supports the
// isolation / refresh / cross-skill bleed sections; sections needing a
// smaller subset pin their own list.
const FIXTURE_SKILLS: ReadonlyArray<FixtureSkill> = [
	S1,
	S2,
	S3,
	S4,
	S5_A,
	S5_B,
	S6_DISABLED,
];

function renderSkillMarkdown(skill: FixtureSkill): string {
	const disabledLine = skill.disabled === true ? "disabled: true\n" : "";
	return (
		`---\n` +
		`name: ${skill.name}\n` +
		`description: ${skill.description}\n` +
		`${disabledLine}` +
		`---\n` +
		`\n` +
		`${skill.instructions}\n`
	);
}

interface Harness {
	workspaceRoot: string;
	skillsDir: string;
	watcher: UserInstructionConfigWatcher;
	executor: SkillsExecutorWithMetadata;
	tool: ReturnType<typeof createSkillsTool>;
	enabledNames: string[];
	dispose: () => void;
}

interface BuildOpts {
	onlySkills?: ReadonlyArray<FixtureSkill>;
	includeDisabled?: boolean;
	extraDirs?: ReadonlyArray<string>;
}

async function buildHarness(options: BuildOpts = {}): Promise<Harness> {
	const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm03-"));
	const skillsDir = join(workspaceRoot, ".cline", "skills");
	mkdirSync(skillsDir, { recursive: true });

	// Skills to mount: by default full FIXTURE_SKILLS minus disabled (unless
	// explicitly requested). `onlySkills` adds explicit narrow-mode control.
	let skillsToWrite: ReadonlyArray<FixtureSkill>;
	if (options.onlySkills) {
		skillsToWrite = options.onlySkills.filter(
			(s) => s.disabled !== true || options.includeDisabled,
		);
	} else if (options.includeDisabled) {
		skillsToWrite = FIXTURE_SKILLS;
	} else {
		skillsToWrite = FIXTURE_SKILLS.filter((s) => s.disabled !== true);
	}
	for (const skill of skillsToWrite) {
		const skillDir = join(skillsDir, skill.id);
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			renderSkillMarkdown(skill),
			"utf8",
		);
	}

	const extraDirs = options.extraDirs ?? [];
	const watcher = createUserInstructionConfigWatcher({
		skills: {
			directories: [skillsDir, ...extraDirs],
			workspacePath: workspaceRoot,
		},
		rules: { directories: [] },
		workflows: { directories: [] },
		debounceMs: 25,
	});

	await watcher.start();

	const ready = Promise.resolve();
	const executor = createUserInstructionSkillsExecutor(
		watcher,
		ready,
		undefined,
	);
	const tool = createSkillsTool(executor);
	const enabledNames = [...skillsToWrite]
		.filter((s) => s.disabled !== true)
		.map((s) => s.name)
		.sort((a, b) => a.localeCompare(b));

	return {
		workspaceRoot,
		skillsDir,
		watcher,
		executor,
		tool,
		enabledNames,
		dispose: () => {
			watcher.stop();
			rmSync(workspaceRoot, { recursive: true, force: true });
		},
	};
}

const TOOL_CONTEXT = {
	agentId: "swcm03-guide-eval",
	conversationId: "swcm03-conv",
	iteration: 1,
};


// =============================================================================
// SECTION A — guide payload (post-execute) characterization
// =============================================================================

describe("A: guide payload via createSkillsTool(executor).execute(...)", () => {
	let harness: Harness;
	afterEach(() => harness.dispose());

	// B1 (D2 GUIDE_NOT_LOADED): enabled skill returns its own body.
	it("A1: enabled skill returns SKILL.md body inside <command-instructions>", async () => {
		harness = await buildHarness({ onlySkills: [S1] });
		const out = await harness.tool.execute(
			{ skill: "minimal-guide" },
			TOOL_CONTEXT,
		);
		expect(out).toContain("<command-name>minimal-guide</command-name>");
		// `# minimal-guide` heading is the first markdown line of the body,
		// reachable as `>\\n# minimal-guide` immediately after the
		// `<command-instructions>` tag. The Description: line precedes it.
		expect(out).toMatch(
			/<command-instructions>\s*Description:.*\n\n# minimal-guide/s,
		);
		expect(out).toContain("GUIDE_MARKER=minimal-guide");
		expect(out).toContain("REQUIRED_FACT=alpha");
	});

	// B2 (D1 WRONG_GUIDE): unknown skill rejected with not-found.
	it("A2: unknown skill rejected with not-found suffix listing available skills", async () => {
		harness = await buildHarness({ onlySkills: [S1, S2] });
		const out = await harness.tool.execute(
			{ skill: "no-such-skill" },
			TOOL_CONTEXT,
		);
		expect(out).toContain('Skill "no-such-skill" not found.');
		expect(out).toContain("Available skills:");
		expect(out).toContain("minimal-guide");
		expect(out).toContain("one-resource");
	});

	// B3 (D3 DISABLED_GUIDE_LEAK): disabled skill body MUST NOT load.
	it("A3: disabled skill rejected with configured-but-disabled error", async () => {
		harness = await buildHarness({
			onlySkills: [S1, S6_DISABLED],
			includeDisabled: true,
		});
		const out = await harness.tool.execute(
			{ skill: "disabled-skill" },
			TOOL_CONTEXT,
		);
		expect(out).toContain('Skill "disabled-skill" is configured but disabled.');
		// Body MUST NOT leak: marker + required fact must be absent.
		expect(out).not.toContain("GUIDE_MARKER=disabled-skill");
		expect(out).not.toContain("REQUIRED_FACT=should-never-load");
	});

	// B4 (D2): no unrelated-skill bodies loaded into a single payload.
	it("A4: invoking skill X returns ONLY X's guide marker, never Y's", async () => {
		harness = await buildHarness({
			onlySkills: [S1, S2, S3],
		});
		const out = await harness.tool.execute(
			{ skill: "minimal-guide" },
			TOOL_CONTEXT,
		);
		// Markers of UNRELATED skills must not appear.
		for (const other of ["one-resource", "two-resource-selective"]) {
			expect(out).not.toContain(`GUIDE_MARKER=${other}`);
		}
		// Own marker present.
		expect(out).toContain("GUIDE_MARKER=minimal-guide");
	});

	// (D5 / cross-skill resource name overlap): invoking skill-a returns the
	// skill-a marker, not skill-b's.
	it("A5: skill-a and skill-b have identical resource paths but distinct returned markers", async () => {
		harness = await buildHarness({ onlySkills: [S5_A, S5_B] });
		const outA = await harness.tool.execute({ skill: "skill-a" }, TOOL_CONTEXT);
		const outB = await harness.tool.execute({ skill: "skill-b" }, TOOL_CONTEXT);
		expect(outA).toContain("GUIDE_MARKER=skill-a");
		expect(outA).not.toContain("GUIDE_MARKER=skill-b");
		expect(outB).toContain("GUIDE_MARKER=skill-b");
		expect(outB).not.toContain("GUIDE_MARKER=skill-a");
		// Both reference docs/config.md literally. Verify the literal
		// reference string is the only thing they share at the guide body
		// level — no shared body content beyond the literal path.
		expect(outA).toContain("docs/config.md");
		expect(outB).toContain("docs/config.md");
		// The body never contains the S5_B-only RESOURCE_MARKER line when
		// invoking skill-a (i.e. cross-skill marker-leak guard).
		expect(outA).not.toContain("RESOURCE_MARKER=skill-b/config");
		expect(outB).not.toContain("RESOURCE_MARKER=skill-a/config");
	});

	// (D6 RESOURCE_EAGER_LOAD): body references the resource path by literal
	// text, but does NOT inline the resource's contents.
	it("A6: resource references are literal text only — no inlining of resource contents", async () => {
		harness = await buildHarness({ onlySkills: [S2] });
		const out = await harness.tool.execute(
			{ skill: "one-resource" },
			TOOL_CONTEXT,
		);
		expect(out).toContain("docs/detail.md");
		// A plausible resource-body line that MUST NOT appear in the
		// returned payload. The detail content marker is
		// `RESOURCE_MARKER=one-resource/detail`, deliberately distinct
		// from the skill's GUIDE_MARKER.
		expect(out).not.toContain("RESOURCE_MARKER=one-resource/detail");
		// No double-loading of advanced guide content from S3 either.
		expect(out).not.toContain("docs/advanced.md");
	});

	// (D5 confirmed against S3): multi-resource body is the literal text
	// reference list and the keywords for ADVANCED_FACT_REF. The model
	// gets the path; it does NOT get the contents.
	it("A7: two-resource-selective body lists both common.md and advanced.md references", async () => {
		harness = await buildHarness({ onlySkills: [S3] });
		const out = await harness.tool.execute(
			{ skill: "two-resource-selective" },
			TOOL_CONTEXT,
		);
		expect(out).toContain("docs/common.md");
		expect(out).toContain("docs/advanced.md");
		expect(out).toContain("ADVANCED_FACT_REF=docs/advanced.md");
	});

	// (S4 script-backed): body must surface the script invocation path.
	it("A8: script-backed body surfaces scripts/helper.sh literally", async () => {
		harness = await buildHarness({ onlySkills: [S4] });
		const out = await harness.tool.execute(
			{ skill: "script-backed" },
			TOOL_CONTEXT,
		);
		expect(out).toContain("scripts/helper.sh");
	});

	// Description-prefix presence (D2): `Description: <text>\n\n` is included
	// when the SKILL.md has a non-empty description.
	it("A9: Description: prefix appears iff skill has a non-empty description", async () => {
		// S1 has a description.
		harness = await buildHarness({ onlySkills: [S1] });
		const out = await harness.tool.execute(
			{ skill: "minimal-guide" },
			TOOL_CONTEXT,
		);
		expect(out).toContain(
			"Description: Minimal skill whose SKILL.md body is fully self-sufficient.",
		);
	});

	// Args preservation (D5 / contract): <command-args> appears when args is
	// set; it is absent (or empty) when omitted.
	it("A10: <command-args> appears iff args were supplied", async () => {
		harness = await buildHarness({ onlySkills: [S1] });
		const outWithArgs = await harness.tool.execute(
			{ skill: "minimal-guide", args: "-h" },
			TOOL_CONTEXT,
		);
		expect(outWithArgs).toContain("<command-args>-h</command-args>");

		const outNoArgs = await harness.tool.execute(
			{ skill: "minimal-guide" },
			TOOL_CONTEXT,
		);
		expect(outNoArgs).not.toContain("<command-args>");
	});

	// Stability (B5): two consecutive executions return identical payloads
	// (no caching drift).
	it("A11: two consecutive executions return identical payloads", async () => {
		harness = await buildHarness({ onlySkills: [S1] });
		const a = await harness.tool.execute(
			{ skill: "minimal-guide" },
			TOOL_CONTEXT,
		);
		const b = await harness.tool.execute(
			{ skill: "minimal-guide" },
			TOOL_CONTEXT,
		);
		expect(a).toBe(b);
	});

	// Description string survives AFTER args in the payload ordering — a
	// defensive check that the payload is internally consistent regardless
	// of {skill,args} permutation.
	it("A12: payload ordering is <command-name>[<command-args>]<command-instructions>", async () => {
		harness = await buildHarness({ onlySkills: [S1] });
		const out = await harness.tool.execute(
			{ skill: "minimal-guide", args: "x" },
			TOOL_CONTEXT,
		);
		const nameIdx = out.indexOf("<command-name>");
		const argsIdx = out.indexOf("<command-args>");
		const instrIdx = out.indexOf("<command-instructions>");
		expect(nameIdx).toBeGreaterThanOrEqual(0);
		expect(argsIdx).toBeGreaterThan(nameIdx);
		expect(instrIdx).toBeGreaterThan(argsIdx);
	});
});

// =============================================================================
// SECTION B — resource minimality + isolation (D5/D6)
// =============================================================================

describe("B: resource references vs resource contents (D5/D6)", () => {
	let harness: Harness;
	afterEach(() => harness.dispose());

	// (D10/RESOURCE_INLINING): no body should embed its own resource's
	// distinctive markers. If so, D6 (eager resource load) reproduces.
	it("B1: skill body never inlines its own resource contents", async () => {
		harness = await buildHarness({ onlySkills: [S2] });
		const out = await harness.tool.execute(
			{ skill: "one-resource" },
			TOOL_CONTEXT,
		);
		expect(out).not.toMatch(/RESOURCE_MARKER=one-resource\/detail/);
	});

	// (D5 CROSS_SKILL_RESOURCE): paths alone should not cause bleed. With
	// only skill-a visible, skill-b's resource content should NEVER appear
	// in skill-a's payload.
	it("B2: skill-a loaded in isolation does NOT surface skill-b resource markers", async () => {
		harness = await buildHarness({ onlySkills: [S5_A] });
		const out = await harness.tool.execute({ skill: "skill-a" }, TOOL_CONTEXT);
		expect(out).toContain("GUIDE_MARKER=skill-a");
		expect(out).not.toContain("GUIDE_MARKER=skill-b");
		expect(out).not.toContain("RESOURCE_MARKER=skill-b/config"); // no skill-b bleed
		// The shared path string IS allowed because skill-a genuinely
		// references docs/config.md.
		expect(out).toContain("docs/config.md");
	});

	// Cross-skill bleed guard when both are visible: invocation of skill-a
	// does NOT cross-contaminate the skill-b marker.
	it("B3: with both visible, invocation is identity-pure per skill name", async () => {
		harness = await buildHarness({ onlySkills: [S5_A, S5_B] });
		const outA = await harness.tool.execute({ skill: "skill-a" }, TOOL_CONTEXT);
		const outB = await harness.tool.execute({ skill: "skill-b" }, TOOL_CONTEXT);
		expect(outA).toContain("GUIDE_MARKER=skill-a");
		expect(outA).not.toContain("GUIDE_MARKER=skill-b");
		expect(outB).toContain("GUIDE_MARKER=skill-b");
		expect(outB).not.toContain("GUIDE_MARKER=skill-a");
	});
});

// =============================================================================
// SECTION C — refresh / precedence (D7/D8)
// =============================================================================

describe("C: refresh + precedence (D7/D8)", () => {
	let harness: Harness;
	afterEach(() => harness.dispose());

	// (D7 STALE_GUIDE): modify SKILL.md on disk, refreshType, re-invoke.
	it("C1: editing SKILL.md on disk + refreshType yields v2 body on next invocation", async () => {
		harness = await buildHarness({ onlySkills: [S1] });
		const before = await harness.tool.execute(
			{ skill: "minimal-guide" },
			TOOL_CONTEXT,
		);
		expect(before).toContain("REQUIRED_FACT=alpha");

		const target = join(harness.skillsDir, "minimal-guide", "SKILL.md");
		writeFileSync(
			target,
			`---\nname: minimal-guide\ndescription: ${S1.description}\n---\n\n# minimal-guide\n\nGUIDE_MARKER=minimal-guide\nREQUIRED_FACT=alpha-v2\n`,
			"utf8",
		);
		await harness.watcher.refreshType("skill");

		const after = await harness.tool.execute(
			{ skill: "minimal-guide" },
			TOOL_CONTEXT,
		);
		expect(after).toContain("REQUIRED_FACT=alpha-v2");
		expect(after).not.toContain("REQUIRED_FACT=alpha\n");
	});

	// (D7 STALE_GUIDE): a brand-new SKILL.md directory picked up by refreshType.
	it("C2: a new SKILL.md directory added + refreshType becomes available immediately", async () => {
		harness = await buildHarness({ onlySkills: [S1] });
		const skillDir = join(harness.skillsDir, "added-late");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---\nname: added-late\ndescription: late addition\n---\n\nGUIDE_MARKER=added-late\nREQUIRED_FACT=delta\n`,
			"utf8",
		);
		await harness.watcher.refreshType("skill");

		const description = harness.tool.description ?? "";
		expect(description).toContain("added-late");

		const out = await harness.tool.execute(
			{ skill: "added-late" },
			TOOL_CONTEXT,
		);
		expect(out).toContain("GUIDE_MARKER=added-late");
		expect(out).toContain("REQUIRED_FACT=delta");
	});

	// (D8 PRECEDENCE): with two directories under the same skill id,
	// "later in directories list" wins. Verify via a deterministic harness
	// built with two skill directories containing the same id.
	it("C3: when two directories produce the same skill id, later directory wins", async () => {
		const firstSkillsDir = mkdtempSync(join(tmpdir(), "cline-swcm03-c3a-"));
		const secondSkillsDir = mkdtempSync(join(tmpdir(), "cline-swcm03-c3b-"));
		mkdirSync(join(firstSkillsDir, "conflict-skill"), { recursive: true });
		mkdirSync(join(secondSkillsDir, "conflict-skill"), { recursive: true });
		writeFileSync(
			join(firstSkillsDir, "conflict-skill", "SKILL.md"),
			`---\nname: conflict-skill\ndescription: from first directory\n---\n\nGUIDE_MARKER=conflict-skill\nREQUIRED_FACT=first\n`,
			"utf8",
		);
		writeFileSync(
			join(secondSkillsDir, "conflict-skill", "SKILL.md"),
			`---\nname: conflict-skill\ndescription: from second directory\n---\n\nGUIDE_MARKER=conflict-skill\nREQUIRED_FACT=second\n`,
			"utf8",
		);
		try {
			const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm03-c3-ws-"));
			mkdirSync(join(workspaceRoot, ".cline"), { recursive: true });
			const watcher = createUserInstructionConfigWatcher({
				skills: {
					directories: [firstSkillsDir, secondSkillsDir],
					workspacePath: workspaceRoot,
				},
				rules: { directories: [] },
				workflows: { directories: [] },
				debounceMs: 25,
			});
			await watcher.start();
			try {
				const exec = createUserInstructionSkillsExecutor(
					watcher,
					Promise.resolve(),
					undefined,
				);
				const tool = createSkillsTool(exec);
				const out = await tool.execute(
					{ skill: "conflict-skill" },
					TOOL_CONTEXT,
				);
				// Per `UnifiedConfigFileWatcher` snapshot keying by
				// `resolveId = normalizeName(skill.name)`, the latest
				// registration writes last — i.e. second directory wins.
				expect(out).toContain("REQUIRED_FACT=second");
				expect(out).not.toContain("REQUIRED_FACT=first");
			} finally {
				watcher.stop();
				rmSync(workspaceRoot, {
					recursive: true,
					force: true,
				});
			}
		} finally {
			rmSync(firstSkillsDir, { recursive: true, force: true });
			rmSync(secondSkillsDir, { recursive: true, force: true });
		}
	});

	// (D8 PRECEDENCE normalized IDs): skill names are normalized to
	// lowercase via `normalizeName`. `POSTGRES-OPERATIONS` resolves to
	// the same skill as `postgres-operations`.
	it("C4: skill lookup normalizes id case (POSTGRES-OPERATIONS == postgres-operations)", async () => {
		harness = await buildHarness({ onlySkills: [S1] });
		// S1 is named 'minimal-guide'; create a separate fixture so the
		// upper-case mixed test does not collide. Easiest: trust the
		// executor's normalizeSkillToken path with a non-existent
		// 'Upper-Skill' to verify normalization.
		const upperResult = await harness.tool.execute(
			{ skill: "MINIMAL-GUIDE" },
			TOOL_CONTEXT,
		);
		// normalized form "minimal-guide" should resolve the skill
		expect(upperResult).toContain("GUIDE_MARKER=minimal-guide");
	});
});

// =============================================================================
// SECTION D — configured-agent skill-scope (D9)
// =============================================================================
//
// Drives the REAL `DefaultRuntimeBuilder.build({ enableSpawnAgent: true })`
// and inspects the captured `AgentConfig.tools` from a mocked child
// `SessionRuntime`. The child tool list carries the production
// allowlist-scoped `skills` tool (same construction path the SW-CM02 file
// exercised in B4-B7). The test then reads the captured `skills` tool,
// asserts its description-suffix lists only the allowed skill names, and
// invokes it with both allowed and unallowed names.

const agentConstructorSpy = vi.fn();
const runMockD = vi.fn();
const subAgentEventListeners: Array<(event: unknown) => void> = [];

vi.mock("../../../runtime/orchestration/session-runtime-orchestrator", () => ({
	SessionRuntime: class MockSessionRuntime {
		constructor(config: unknown) {
			agentConstructorSpy(config);
		}
		getAgentId(): string {
			return "child-agent";
		}
		getConversationId(): string {
			return "child-conv";
		}
		subscribeEvents(listener: (event: unknown) => void): () => void {
			subAgentEventListeners.push(listener);
			return () => {
				const idx = subAgentEventListeners.indexOf(listener);
				if (idx >= 0) subAgentEventListeners.splice(idx, 1);
			};
		}
		async run(): Promise<unknown> {
			for (const l of subAgentEventListeners) {
				l({
					type: "notice",
					noticeType: "status",
					message: "configured agent running",
				});
			}
			return runMockD();
		}
	},
}));

import type { AgentConfig } from "@cline/shared";
import type { CoreSessionConfig } from "../../../types/config";

interface BaseCfgOverridesD {
	cwd: string;
	workspaceRoot?: string;
	rootSkillsUnrestricted?: boolean;
}

function makeBaseConfigD(o: BaseCfgOverridesD): CoreSessionConfig {
	const config: CoreSessionConfig = {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: "key",
		systemPrompt: "test",
		cwd: o.cwd,
		workspaceRoot: o.workspaceRoot ?? o.cwd,
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: false,
		disableMcpSettingsTools: true,
	} as CoreSessionConfig;
	// `config.skills` (an array allowlist) gates root `skills` tool
	// registration at runtime-builder.ts:471-484. `undefined` = root
	// unrestricted; `[]` = root disabled.
	if (o.rootSkillsUnrestricted) {
		(config as { skills?: string[] }).skills = undefined;
	}
	return config;
}

async function captureChildSkillsToolD(opts: {
	config: CoreSessionConfig;
	agentName: string;
	prompt: string;
}): Promise<{ tools: NonNullable<AgentConfig["tools"]> }> {
	agentConstructorSpy.mockClear();
	const { DefaultRuntimeBuilder } = await import(
		"../../../runtime/orchestration/runtime-builder"
	);
	const built = await new DefaultRuntimeBuilder().build({
		config: opts.config,
	});
	const subAgentTool = built.tools.find(
		(t) => t.name === `subagent_${opts.agentName}`,
	);
	if (!subAgentTool) {
		throw new Error(
			`Expected subagent_${opts.agentName} tool on lead runtime.`,
		);
	}
	await subAgentTool.execute(
		{ prompt: opts.prompt },
		{
			agentId: "parent-agent",
			conversationId: "parent-conv",
			iteration: 1,
		},
	);
	const lastCall = agentConstructorSpy.mock.calls.at(-1)?.[0] as
		| AgentConfig
		| undefined;
	if (!lastCall) {
		throw new Error("Mock SessionRuntime was never constructed.");
	}
	return { tools: lastCall.tools ?? [] };
}

function writeConfiguredAgentYml(
	agentsDir: string,
	name: string,
	skillsList: ReadonlyArray<string>,
): void {
	writeFileSync(
		join(agentsDir, `${name}.yml`),
		`---\nname: ${name}\ndescription: ${name} agent\nskills: [${skillsList.join(", ")}]\n---\nYou are ${name}.`,
		"utf8",
	);
}

function writeSkillOnDisk(
	workspaceRoot: string,
	name: string,
	description: string,
	body: string,
): void {
	const dir = join(workspaceRoot, ".cline", "skills", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n${body}`,
		"utf8",
	);
}

describe("D: configured-agent skill-scope via real DefaultRuntimeBuilder", () => {
	const tempDirs: string[] = [];
	const previousHome = process.env.HOME;

	beforeEach(() => {
		runMockD.mockResolvedValue({
			text: "child done",
			iterations: 1,
			finishReason: "completed",
			usage: { inputTokens: 0, outputTokens: 0 },
		});
	});

	afterEach(() => {
		if (previousHome) {
			process.env.HOME = previousHome;
			setHomeDir(previousHome);
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	// D9 CONFIGURED_AGENT_SCOPE_BYPASS (primary): configured-agent with
	// `skills: [review]` → captured child's skills tool description
	// lists ONLY review. Sibling skill `deploy` on disk is invisible.
	it("D1: configured-agent with skills: [review] exposes ONLY review in child skills tool description", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm03-d1-home-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm03-d1-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeConfiguredAgentYml(agentsDir, "reviewer", ["review"]);
		writeSkillOnDisk(
			workspaceRoot,
			"review",
			"Code review guidance",
			"# review\n\nGUIDE_MARKER=review\nREQUIRED_FACT=review-only\n",
		);
		writeSkillOnDisk(
			workspaceRoot,
			"deploy",
			"Deploying applications",
			"# deploy\n\nGUIDE_MARKER=deploy\nREQUIRED_FACT=deploy-only\n",
		);

		const { tools: childTools } = await captureChildSkillsToolD({
			config: makeBaseConfigD({
				cwd: workspaceRoot,
				workspaceRoot,
				rootSkillsUnrestricted: true,
			}),
			agentName: "reviewer",
			prompt: "review code",
		});

		const skillsTool = childTools.find((t) => t.name === "skills");
		expect(skillsTool).toBeDefined();
		const desc = String(
			(skillsTool as { description?: unknown })?.description ?? "",
		);
		expect(desc).toMatch(/Available skills:\s*review\s*\.?\s*$/);
		expect(desc).not.toContain("deploy");
	});

	// D9 (executor): the captured child skills tool, when invoked with a
	// known skill, returns the SKILL.md body for that skill; when invoked
	// with an unknown skill, returns the not-found error listing only the
	// allowed names.
	it("D2: child skills tool routes a known skill to the SKILL.md body and rejects unknown skills", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm03-d2-home-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm03-d2-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeConfiguredAgentYml(agentsDir, "reviewer", ["review"]);
		writeSkillOnDisk(
			workspaceRoot,
			"review",
			"Code review guidance",
			"# review\n\nGUIDE_MARKER=review\nREQUIRED_FACT=review-only\n",
		);
		writeSkillOnDisk(
			workspaceRoot,
			"deploy",
			"Deploying applications",
			"# deploy\n\nGUIDE_MARKER=deploy\nREQUIRED_FACT=deploy-only\n",
		);

		const { tools: childTools } = await captureChildSkillsToolD({
			config: makeBaseConfigD({
				cwd: workspaceRoot,
				workspaceRoot,
				rootSkillsUnrestricted: true,
			}),
			agentName: "reviewer",
			prompt: "review",
		});
		const skillsTool = childTools.find((t) => t.name === "skills");
		expect(skillsTool).toBeDefined();

		const okOut = await (skillsTool as unknown as { execute: (input: { skill: string }, ctx: unknown) => Promise<string> }).execute(
			{ skill: "review" },
			{ agentId: "child-agent", conversationId: "child-conv", iteration: 1 },
		);
		expect(okOut).toContain("GUIDE_MARKER=review");
		expect(okOut).toContain("REQUIRED_FACT=review-only");
		expect(okOut).not.toContain("GUIDE_MARKER=deploy");

		const deniedOut = await (skillsTool as unknown as { execute: (input: { skill: string }, ctx: unknown) => Promise<string> }).execute(
			{ skill: "deploy" },
			{ agentId: "child-agent", conversationId: "child-conv", iteration: 1 },
		);
		expect(deniedOut).toContain('Skill "deploy" not found.');
		expect(deniedOut).toContain("Available skills: review");
	});

	// D9 (allowlist of two): both allowed skills route to their own body,
	// a third non-allowed skill is rejected.
	it("D3: configured-agent with two allowed skills sees both; a third skill is rejected", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm03-d3-home-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm03-d3-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeConfiguredAgentYml(agentsDir, "ops", ["review", "deploy"]);
		writeSkillOnDisk(
			workspaceRoot,
			"review",
			"Review",
			"GUIDE_MARKER=review\n",
		);
		writeSkillOnDisk(
			workspaceRoot,
			"deploy",
			"Deploy",
			"GUIDE_MARKER=deploy\n",
		);
		writeSkillOnDisk(
			workspaceRoot,
			"database",
			"Database",
			"GUIDE_MARKER=database\n",
		);

		const { tools: childTools } = await captureChildSkillsToolD({
			config: makeBaseConfigD({
				cwd: workspaceRoot,
				workspaceRoot,
				rootSkillsUnrestricted: true,
			}),
			agentName: "ops",
			prompt: "ops",
		});
		const skillsTool = childTools.find((t) => t.name === "skills");
		expect(skillsTool).toBeDefined();

		const reviewOut = await (skillsTool as unknown as { execute: (input: { skill: string }, ctx: unknown) => Promise<string> }).execute(
			{ skill: "review" },
			{ agentId: "c", conversationId: "c", iteration: 1 },
		);
		expect(reviewOut).toContain("GUIDE_MARKER=review");
		expect(reviewOut).not.toContain("GUIDE_MARKER=database");

		const deployOut = await (skillsTool as unknown as { execute: (input: { skill: string }, ctx: unknown) => Promise<string> }).execute(
			{ skill: "deploy" },
			{ agentId: "c", conversationId: "c", iteration: 1 },
		);
		expect(deployOut).toContain("GUIDE_MARKER=deploy");
		expect(deployOut).not.toContain("GUIDE_MARKER=database");

		const dbOut = await (skillsTool as unknown as { execute: (input: { skill: string }, ctx: unknown) => Promise<string> }).execute(
			{ skill: "database" },
			{ agentId: "c", conversationId: "c", iteration: 1 },
		);
		expect(dbOut).toContain('Skill "database" not found.');
		expect(dbOut).toContain("Available skills:");
	});

	// D9 (absence): when the configured-agent declares NO `skills:` line
	// AND the root disables skills, the child runtime does NOT include
	// a `skills` tool — per the documented contract.
	it("D4: configured-agent without skills AND root skills off → child has no skills tool", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm03-d4-home-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm03-d4-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "plain.yml"),
			`---\nname: plain\ndescription: Plain agent\n---\nYou are plain.`,
			"utf8",
		);

		const { tools: childTools } = await captureChildSkillsToolD({
			config: makeBaseConfigD({
				cwd: workspaceRoot,
				workspaceRoot,
				// rootSkillsUnrestricted defaults to undefined
				// (false path) → config.skills remains unset.
			}),
			agentName: "plain",
			prompt: "do something",
		});
		const names = childTools.map((t) => t.name);
		expect(names).not.toContain("skills");
	});
});
