// ACT-CLINEMM-SW-CM01-SKILL-TRIGGER-EVALS01
// Production-seam characterization of the SKILL TRIGGER boundary.
//
// The trigger surface in ClineMM is the `skills` tool description string,
// constructed by `createSkillsTool` in
// src/extensions/tools/definitions.ts:1027-1039. The dynamic suffix is
// `Available skills: <sorted enabled names>.` — only NAMES are projected;
// descriptions live inside SKILL.md and load only AFTER the model invokes
// the tool. No live provider is required for these assertions; live model
// metrics are reported CAPTURE_INSUFFICIENT in this sandbox.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createSkillsTool,
} from "../definitions";
import type { SkillsExecutorWithMetadata } from "../types";
import {
	createUserInstructionConfigWatcher,
	type UserInstructionConfigWatcher,
} from "../../config/user-instruction-config-loader";
import { createUserInstructionSkillsExecutor } from "../../config/user-instruction-plugin";
import { resolveRuntimeSlashCommandFromWatcher } from "../../config/runtime-commands";

interface FixtureSkill {
	id: string;
	name: string;
	description: string;
	instructions: string;
	disabled?: boolean;
}

const FIXTURE_SKILLS: ReadonlyArray<FixtureSkill> = [
	{
		id: "postgres-operations",
		name: "postgres-operations",
		description:
			"PostgreSQL administration, SQL diagnostics, table/index sizing, query performance, vacuum, locks and database operations.",
		instructions: "# postgres-operations\nRun pg_stat queries; recommend VACUUM.",
	},
	{
		id: "kubernetes-operations",
		name: "kubernetes-operations",
		description:
			"Kubernetes workloads, pods, deployments, StatefulSets, Services, PVCs, events, kubectl diagnostics and cluster operations.",
		instructions: "# kubernetes-operations\nkubectl describe/get/events.",
	},
	{
		id: "kubernetes-postgres",
		name: "kubernetes-postgres",
		description:
			"PostgreSQL running on Kubernetes, including StatefulSets, persistent volumes, failover and operator-managed database clusters.",
		instructions: "# kubernetes-postgres\nPostgres operator patterns; PVC sizing.",
	},
	{
		id: "release-notes",
		name: "release-notes",
		description:
			"Generate release notes and changelogs from commits or pull requests.",
		instructions: "# release-notes\nGroup commits; emit semver-tagged changelog.",
	},
	{
		id: "spreadsheet-analysis",
		name: "spreadsheet-analysis",
		description:
			"Analyze CSV/XLSX tabular data, statistics and spreadsheet transformations.",
		instructions: "# spreadsheet-analysis\npandas/csvkit; pivot, summarise, transform.",
	},
	{
		id: "aws-deployment",
		name: "aws-deployment",
		description: "Deploy or update applications and infrastructure on AWS.",
		instructions: "# aws-deployment\nCDK/CloudFormation/SAM; ECS/EKS/Lambda.",
	},
];

function renderSkillMarkdown(skill: FixtureSkill): string {
	const disabledLine = skill.disabled === true ? "disabled: true\n" : "";
	return `---\nname: ${skill.name}\ndescription: ${skill.description}\n${disabledLine}---\n\n${skill.instructions}\n`;
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

async function buildHarness(options: {
	extraDisabled?: ReadonlyArray<FixtureSkill>;
}): Promise<Harness> {
	const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-skill-trigger-"));
	const skillsDir = join(workspaceRoot, ".cline", "skills");
	const fs = await import("node:fs/promises");
	await fs.mkdir(skillsDir, { recursive: true });

	const skillsToWrite = [...FIXTURE_SKILLS, ...(options.extraDisabled ?? [])];
	for (const skill of skillsToWrite) {
		const skillDir = join(skillsDir, skill.id);
		await fs.mkdir(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			renderSkillMarkdown(skill),
			"utf8",
		);
	}

	const watcher = createUserInstructionConfigWatcher({
		skills: {
			directories: [skillsDir],
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

	const enabledNames = [...FIXTURE_SKILLS]
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
	agentId: "swcm01-trigger-eval",
	conversationId: "swcm01-conv",
	iteration: 1,
};

describe("D1 — enabled skill metadata reaches the trigger surface", () => {
	let harness: Harness;
	beforeEach(async () => {
		harness = await buildHarness({});
	});
	afterEach(() => harness.dispose());

	it("tool.description contains every enabled skill name", () => {
		const description = harness.tool.description;
		expect(description).toBeDefined();
		for (const name of harness.enabledNames) {
			expect(description).toContain(name);
		}
	});

	it("tool.description contains the 'Available skills: ...' suffix", () => {
		expect(harness.tool.description).toContain("Available skills:");
	});

	it("enabled names appear sorted alphabetically in the suffix", () => {
		const description = harness.tool.description ?? "";
		const match = description.match(/Available skills:\s*(.+?)\.$/);
		expect(match).not.toBeNull();
		if (!match) throw new Error("Available skills suffix missing");
		const listed = (match[1] as string).split(",").map((s: string) => s.trim());
		expect(listed).toEqual(harness.enabledNames);
	});

	it("executor.configuredSkills carries id/name/disabled for every fixture skill", () => {
		const configured = harness.executor.configuredSkills ?? [];
		expect(configured.length).toBe(FIXTURE_SKILLS.length);
		for (const entry of configured) {
			expect(entry).toHaveProperty("id");
			expect(entry).toHaveProperty("name");
			expect(entry).toHaveProperty("disabled");
			expect(typeof entry.disabled).toBe("boolean");
		}
	});
});

describe("D2 — disabled skills are excluded from the trigger surface", () => {
	let harness: Harness;
	beforeEach(async () => {
		harness = await buildHarness({});
	});
	afterEach(() => harness.dispose());

	it("a disabled sibling skill does not appear in tool.description", async () => {
		// Add a disabled skill on disk after start; refresh; verify it does
		// NOT leak into the tool description.
		const fs = await import("node:fs/promises");
		const disabledDir = join(harness.skillsDir, "fallback-disabled-skill");
		await fs.mkdir(disabledDir, { recursive: true });
		writeFileSync(
			join(disabledDir, "SKILL.md"),
			`---\nname: fallback-disabled-skill\ndescription: never invoked\ndisabled: true\n---\n\nnever invoked.\n`,
			"utf8",
		);
		await harness.watcher.refreshType("skill");

		const description = harness.tool.description ?? "";
		expect(description).not.toContain("fallback-disabled-skill");
		// Enabled names still present.
		for (const name of harness.enabledNames) {
			expect(description).toContain(name);
		}
	});

	it("executor.configuredSkills marks the disabled entry as disabled=true", async () => {
		const fs = await import("node:fs/promises");
		const disabledDir = join(harness.skillsDir, "fallback-disabled-skill");
		await fs.mkdir(disabledDir, { recursive: true });
		writeFileSync(
			join(disabledDir, "SKILL.md"),
			`---\nname: fallback-disabled-skill\ndescription: never invoked\ndisabled: true\n---\n\nnever invoked.\n`,
			"utf8",
		);
		await harness.watcher.refreshType("skill");

		const configured = harness.executor.configuredSkills ?? [];
		const disabled = configured.find((s) => s.name === "fallback-disabled-skill");
		expect(disabled).toBeDefined();
		expect(disabled?.disabled).toBe(true);
	});
});

describe("D3 — skill descriptions do NOT leak into the trigger surface", () => {
	let harness: Harness;
	beforeEach(async () => {
		harness = await buildHarness({});
	});
	afterEach(() => harness.dispose());

	it("no fixture skill description string appears in tool.description", () => {
		const description = harness.tool.description ?? "";
		for (const skill of FIXTURE_SKILLS) {
			// Assert the FULL description string is absent. Also assert a
			// distinctive substring (first ~25 chars) is absent as a
			// belt-and-braces check.
			const head = skill.description.slice(0, 25);
			expect(description.includes(skill.description)).toBe(false);
			expect(description.includes(head)).toBe(false);
		}
	});

	it("the static base description is preserved verbatim", () => {
		const description = harness.tool.description ?? "";
		// Base description snippets from definitions.ts:998-1004.
		expect(description).toContain("Execute a skill within the main conversation.");
		expect(description).toContain("When a skill matches the user's request");
	});
});

describe("D5 — tool call accepts/rejects by runtime contract", () => {
	let harness: Harness;
	beforeEach(async () => {
		harness = await buildHarness({});
	});
	afterEach(() => harness.dispose());

	it("known enabled skill returns <command-name> payload with description + instructions", async () => {
		const result = await harness.tool.execute(
			{ skill: "postgres-operations", args: "-h" },
			TOOL_CONTEXT,
		);
		expect(typeof result).toBe("string");
		expect(result).toContain("<command-name>postgres-operations</command-name>");
		expect(result).toContain("<command-args>-h</command-args>");
		expect(result).toContain("<command-instructions>");
		expect(result).toContain("Run pg_stat queries");
		// Description IS exposed to the model AFTER trigger.
		expect(result).toContain("Description:");
	});

	it("unknown skill name returns the 'not found' error and lists available skills", async () => {
		const result = await harness.tool.execute(
			{ skill: "does-not-exist" },
			TOOL_CONTEXT,
		);
		expect(result).toContain('Skill "does-not-exist" not found.');
		expect(result).toContain("Available skills:");
		for (const name of harness.enabledNames) {
			expect(result).toContain(name);
		}
	});

	it("disabled skill returns the 'configured but disabled' error", async () => {
		// First add a disabled skill, then try to invoke it.
		const fs = await import("node:fs/promises");
		const disabledDir = join(harness.skillsDir, "fallback-disabled-skill");
		await fs.mkdir(disabledDir, { recursive: true });
		writeFileSync(
			join(disabledDir, "SKILL.md"),
			`---\nname: fallback-disabled-skill\ndescription: never invoked\ndisabled: true\n---\n\nnever invoked.\n`,
			"utf8",
		);
		await harness.watcher.refreshType("skill");

		const result = await harness.tool.execute(
			{ skill: "fallback-disabled-skill" },
			TOOL_CONTEXT,
		);
		expect(result).toContain(
			'Skill "fallback-disabled-skill" is configured but disabled.',
		);
	});

	it("schema validation rejects empty skill name", async () => {
		await expect(
			harness.tool.execute({ skill: "" }, TOOL_CONTEXT),
		).rejects.toThrow();
	});
});

describe("D6 — snapshot freshness after watcher refresh", () => {
	let harness: Harness;
	beforeEach(async () => {
		harness = await buildHarness({});
	});
	afterEach(() => harness.dispose());

	it("renaming an SKILL.md file on disk updates the description after refreshType", async () => {
		// Remove the release-notes directory; refresh; verify the name is gone.
		const fs = await import("node:fs/promises");
		await fs.rm(join(harness.skillsDir, "release-notes"), {
			recursive: true,
			force: true,
		});
		await harness.watcher.refreshType("skill");

		const description = harness.tool.description ?? "";
		expect(description).not.toContain("release-notes");

		// And tool execution of the removed skill returns 'not found'.
		const result = await harness.tool.execute(
			{ skill: "release-notes" },
			TOOL_CONTEXT,
		);
		expect(result).toContain('Skill "release-notes" not found.');
	});

	it("adding a new SKILL.md file on disk extends the description after refreshType", async () => {
		const fs = await import("node:fs/promises");
		const newDir = join(harness.skillsDir, "added-late");
		await fs.mkdir(newDir, { recursive: true });
		writeFileSync(
			join(newDir, "SKILL.md"),
			`---\nname: added-late\ndescription: late addition\n---\n\nlate instructions.\n`,
			"utf8",
		);
		await harness.watcher.refreshType("skill");

		const description = harness.tool.description ?? "";
		expect(description).toContain("added-late");
	});

	it("toggling a SKILL.md frontmatter disabled flag updates availability", async () => {
		const fs = await import("node:fs/promises");
		const target = join(harness.skillsDir, "kubernetes-operations", "SKILL.md");
		const original = await fs.readFile(target, "utf8");
		const toggled = original.replace(/^---$/m, "---\ndisabled: true");
		writeFileSync(target, toggled, "utf8");
		await harness.watcher.refreshType("skill");

		const description = harness.tool.description ?? "";
		expect(description).not.toContain("kubernetes-operations");

		const result = await harness.tool.execute(
			{ skill: "kubernetes-operations" },
			TOOL_CONTEXT,
		);
		expect(result).toContain(
			'Skill "kubernetes-operations" is configured but disabled.',
		);

		// Restore so dispose() does not produce noisy logs.
		writeFileSync(target, original, "utf8");
	});
});

describe("D7 — explicit slash-command parsing (resolveRuntimeSlashCommandFromWatcher)", () => {
	let harness: Harness;
	beforeEach(async () => {
		harness = await buildHarness({});
	});
	afterEach(() => harness.dispose());

	it("expandsSkillCommands=false (skills-tool-available path) returns the typed input unchanged", () => {
		const input = "/postgres-operations vacuum analyze recommendations";
		const out = resolveRuntimeSlashCommandFromWatcher(
			input,
			harness.watcher,
			{ expandSkillCommands: false },
		);
		// Skills-tool-available path: keep typed text, model will invoke the tool.
		expect(out).toBe(input);
	});

	it("expandSkillCommands=true (no-skills-tool path) textually expands matched skills", () => {
		const input = "/postgres-operations vacuum recommendations";
		const out = resolveRuntimeSlashCommandFromWatcher(
			input,
			harness.watcher,
			{ expandSkillCommands: true },
		);
		expect(out).not.toBe(input);
		expect(out).toContain("Run pg_stat queries");
		// Remainder after the matched token is appended.
		expect(out.endsWith(" recommendations")).toBe(true);
	});

	it("non-skill prefix leaves input unchanged", () => {
		const input = "/aws-deploy production";
		const out = resolveRuntimeSlashCommandFromWatcher(
			input,
			harness.watcher,
			{ expandSkillCommands: true },
		);
		// 'aws-deploy' is NOT a canonical skill name (canonical is 'aws-deployment').
		// So no match; input passes through unchanged.
		expect(out).toBe(input);
	});

	it("unknown slash command passes through unchanged", () => {
		const input = "/does-not-exist anything";
		const out = resolveRuntimeSlashCommandFromWatcher(
			input,
			harness.watcher,
			{ expandSkillCommands: true },
		);
		expect(out).toBe(input);
	});

	it("input without leading slash passes through unchanged", () => {
		const input = "postgres-operations vacuum";
		const out = resolveRuntimeSlashCommandFromWatcher(
			input,
			harness.watcher,
			{ expandSkillCommands: true },
		);
		expect(out).toBe(input);
	});

	it("collapses leading // to / then tries to match", () => {
		// normalizeSkillToken strips leading slashes via the plugin's normalize,
		// but resolveRuntimeSlashCommandFromWatcher's normalize keeps the first
		// slash. With input '//postgres-operations ...', the regex /^/(\S+)/
		// captures 'postgres-operations' (the run of \S+ is greedy across the
		// second slash), then normalization lowercases it and matches. Confirm
		// the deterministic behaviour.
		const input = "//postgres-operations analyze";
		const out = resolveRuntimeSlashCommandFromWatcher(
			input,
			harness.watcher,
			{ expandSkillCommands: true },
		);
		expect(out).toContain("Run pg_stat queries");
		expect(out.endsWith("analyze")).toBe(true);
	});
});

describe("D7+ — explicit slash command resolves to the named skill via the `skills` tool", () => {
	let harness: Harness;
	beforeEach(async () => {
		harness = await buildHarness({});
	});
	afterEach(() => harness.dispose());

	it("invoking the skill tool with a slash-parsed name returns its payload", async () => {
		const input = "/postgres-operations vacuum recommendations";
		const normalizedName = (input.match(/^\/(\S+)/)?.[1] ?? "").trim();
		expect(normalizedName).toBe("postgres-operations");

		const result = await harness.tool.execute(
			{ skill: normalizedName },
			TOOL_CONTEXT,
		);
		expect(result).toContain("<command-name>postgres-operations</command-name>");
	});

	it("invoking the skill tool with the unmatched name returns 'not found'", async () => {
		const input = "/aws-deploy production";
		const normalizedName = (input.match(/^\/(\S+)/)?.[1] ?? "").trim();
		expect(normalizedName).toBe("aws-deploy");

		const result = await harness.tool.execute(
			{ skill: normalizedName },
			TOOL_CONTEXT,
		);
		// The canonical name in the fixture is 'aws-deployment', not 'aws-deploy'.
		expect(result).toContain('Skill "aws-deploy" not found.');
	});
});
