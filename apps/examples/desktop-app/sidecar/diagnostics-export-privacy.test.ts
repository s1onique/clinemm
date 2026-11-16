/**
 * ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01
 *
 * The shareable diagnostic export MUST NOT disclose secret-bearing canonical
 * conversation content.
 *
 * WHAT THIS PINS
 * --------------
 * The desktop app's `export_diagnostics` command produces a TEXT artifact the
 * user is expected to hand to a support engineer. That artifact is a
 * SHAREABLE surface: the whole point of the command is that the user sends
 * the file away. It therefore has to be safe BY CONSTRUCTION, not by
 * post-hoc regex redaction of whatever happened to be in the manifest.
 *
 * The canonical session records (`<id>.messages.json`, `<id>.compaction.json`)
 * are PRIVATE runtime persistence. They hold the full conversation — prompts,
 * command arguments, tool output, and whatever credentials the user happened
 * to have on screen. The export never reads them, and it must never carry a
 * pointer that invites a reader to treat them as part of the bundle.
 *
 * The manifest itself is ALSO private: its `prompt` and `metadata.title` are
 * the user's raw prompt, and `metadata.git.url` is a credential-bearing Git
 * remote. The export may carry a SCHEMA-DRIVEN, ALLOWLISTED projection of
 * the manifest; it may not carry the manifest itself.
 *
 * THE FIXTURES ARE ADVERSARIAL
 * ----------------------------
 * Each fixture below is a secret class that has actually appeared in a real
 * Cline session: Keycloak bootstrap-admin credentials, messaging-provider API
 * keys, JSON/YAML secret blocks, URL-embedded credentials, Authorization
 * headers, and connection strings. The test asserts on the ABSENCE of the
 * literal secret values in the exported artifact — not on the behaviour of a
 * regex helper.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDiagnosticsReport, writeDiagnosticsReport } from "./diagnostics";

let dataDir: string;
const savedEnv: Record<string, string | undefined> = {};

/**
 * The adversarial secret fixtures.
 *
 * Every entry is a REAL value that must never appear in a shareable
 * artifact. The values are synthetic (they are not live credentials) but they
 * are shaped exactly like the production ones.
 */
const SECRETS = {
	/** Keycloak bootstrap-admin credentials. */
	keycloakAdminPassword: "kc-Bootstrap-Admin-Pw-9f3c1d",
	keycloakAdminUsername: "kc-admin",
	/** A messaging-provider API key (the REDSMS/Megafon shape). */
	messagingApiKey: "puihgxkifQSIaZKkENtQzVTs",
	/** A JSON secret block. */
	jsonClientSecret: "js-client-secret-3a91f0c7b2",
	/** A YAML secret block. */
	yamlPassword: "yaml-kc-db-password-71c4e9",
	/** Credentials embedded in a URL. */
	urlEmbeddedCredential: "url-embedded-user-pw-5b2d8e",
	/** An Authorization header value. */
	authorizationToken: "authz-bearer-token-8f41c0a2d5",
	/** A database connection string. */
	connectionString: "jdbc:postgresql://kc-db-host:6432/keycloak-prod",
	/** A command argument that carries a credential. */
	commandArgumentSecret: "cmd-arg-secret-token-4e6f1a",
} as const;

/**
 * A command line that carries a credential in its ARGUMENTS.
 *
 * The export must not carry the command itself: the command is canonical
 * conversation content (a tool call's input), and it carries the secret.
 */
const CREDENTIAL_BEARING_COMMAND = `kubectl --token=${SECRETS.commandArgumentSecret} -n keycloak get secret/keycloak-bootstrap-admin -o yaml`;

/**
 * A raw tool result that carries credentials.
 *
 * The export must not carry tool output either.
 */
const CREDENTIAL_BEARING_TOOL_OUTPUT = [
	`${SECRETS.keycloakAdminUsername}: ${SECRETS.keycloakAdminPassword}`,
	`REDSMS_API_KEY: ${SECRETS.messagingApiKey}`,
	`Authorization: Bearer ${SECRETS.authorizationToken}`,
	`KC_DB_URL: ${SECRETS.connectionString}`,
].join("\n");

/** The adversarial manifest: every leak class the export must not carry. */
function adversarialManifest(sessionId: string): Record<string, unknown> {
	return {
		version: 1,
		session_id: sessionId,
		source: "vscode",
		pid: 4242,
		started_at: "2026-11-16T00:34:26.874Z",
		status: "idle",
		interactive: true,
		provider: "openai-compatible",
		model: "qwen3.8-flash-next-iq3_s",
		cwd: "/home/tester/projects/keycloak",
		workspace_root: "/home/tester/projects/keycloak",
		enable_tools: true,
		enable_spawn: false,
		enable_teams: false,
		// The raw prompt.
		prompt: `bootstrap admin password is ${SECRETS.keycloakAdminPassword}`,
		metadata: {
			// The raw prompt AGAIN, under a different key. This is the
			// production shape: `metadata.title` is the prompt.
			title: `# ACT-KEYCLOAK-ROUND-C-01\nbootstrap admin password is ${SECRETS.keycloakAdminPassword}`,
			prompt: `bootstrap admin password is ${SECRETS.keycloakAdminPassword}`,
			systemPrompt: `You are Cline. The admin password is ${SECRETS.keycloakAdminPassword}.`,
			// A credential-bearing Git remote URL.
			git: {
				url: `https://${SECRETS.urlEmbeddedCredential}@gitlab.example.invalid/backend/keycloak.git`,
				branch: "optimize-ftls",
			},
			// A JSON secret block.
			providerConfig: JSON.stringify({
				client_id: "keycloak-prod",
				client_secret: SECRETS.jsonClientSecret,
			}),
			// A YAML secret block.
			helmValues: [
				"kc:",
				"  db:",
				`    password: ${SECRETS.yamlPassword}`,
				`    url: ${SECRETS.connectionString}`,
			].join("\n"),
			// A messaging-provider API key.
			provider: {
				apiKey: SECRETS.messagingApiKey,
				baseUrl: `https://api.example.invalid/v1?token=${SECRETS.urlEmbeddedCredential}`,
			},
			// Useful, non-sensitive evidence the export SHOULD keep.
			modelId: "qwen3.8-flash-next-iq3_s",
			totalCost: 0,
			tokensIn: 368300,
			tokensOut: 81385,
			cacheReads: 4193916,
			usage: {
				inputTokens: 4562216,
				outputTokens: 81385,
				cacheReadTokens: 4193916,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			aggregateUsage: {
				inputTokens: 4562216,
				outputTokens: 81385,
				cacheReadTokens: 4193916,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			checkpoint: {
				latest: {
					ref: "42de653b59708e712d694aeb9732f822b7f8fe5b",
					createdAt: 1794789267028,
					runCount: 1,
					kind: "commit",
				},
			},
		},
		messages_path: "PLACEHOLDER_MESSAGES_PATH",
		compaction_path: "PLACEHOLDER_COMPACTION_PATH",
	};
}

/**
 * Build a canonical session on disk: the manifest plus the private
 * conversation artifacts.
 *
 * The messages/compaction files are written so the test can prove the export
 * does not read them AND that they are not mutated by the export.
 */
function writeCanonicalSession(
	sessionId: string,
	manifest: Record<string, unknown>,
): { manifestPath: string; messagesPath: string; compactionPath: string } {
	const dir = join(dataDir, "sessions", sessionId);
	mkdirSync(dir, { recursive: true });
	const manifestPath = join(dir, `${sessionId}.json`);
	const messagesPath = join(dir, `${sessionId}.messages.json`);
	const compactionPath = join(dir, `${sessionId}.compaction.json`);
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	// The canonical conversation: prompts, command arguments and tool output,
	// including every credential class.
	writeFileSync(
		messagesPath,
		`${JSON.stringify(
			{
				version: 1,
				messages: [
					{
						role: "user",
						content: `bootstrap admin is ${SECRETS.keycloakAdminUsername} / ${SECRETS.keycloakAdminPassword}`,
					},
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "call-1",
								name: "run_commands",
								input: { commands: [CREDENTIAL_BEARING_COMMAND] },
							},
						],
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "call-1",
								content: CREDENTIAL_BEARING_TOOL_OUTPUT,
							},
						],
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(
		compactionPath,
		`${JSON.stringify(
			{
				version: 1,
				conversation_id: sessionId,
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: `summary carries ${SECRETS.messagingApiKey} and ${SECRETS.urlEmbeddedCredential}`,
							},
						],
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	return { manifestPath, messagesPath, compactionPath };
}

/**
 * Write a canonical session whose manifest points at its own private
 * conversation artifacts, exactly as production does.
 */
function writeSessionWithArtifacts(sessionId: string): {
	manifestPath: string;
	messagesPath: string;
	compactionPath: string;
} {
	const manifest = adversarialManifest(sessionId);
	const paths = writeCanonicalSession(sessionId, manifest);
	manifest.messages_path = paths.messagesPath;
	manifest.compaction_path = paths.compactionPath;
	writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return paths;
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-diag-privacy-"));
	for (const key of [
		"CLINE_DATA_DIR",
		"CLINE_SESSION_DATA_DIR",
		"CLINE_LOG_PATH",
	]) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
	process.env.CLINE_DATA_DIR = dataDir;
	process.env.CLINE_SESSION_DATA_DIR = join(dataDir, "sessions");
	mkdirSync(join(dataDir, "logs"), { recursive: true });
});

afterEach(() => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(dataDir, { recursive: true, force: true });
});

describe("shareable diagnostic export — credential safety", () => {
	it("does not disclose any secret class in the exported artifact", () => {
		const sessionId = "session_privacy";
		writeSessionWithArtifacts(sessionId);

		const { text } = buildDiagnosticsReport([sessionId]);

		for (const [name, value] of Object.entries(SECRETS)) {
			expect(
				text.includes(value),
				`shareable export disclosed ${name}: ${value}`,
			).toBe(false);
		}
		// The credential-bearing command and the raw tool output must not
		// appear either — they are canonical conversation content.
		expect(text.includes(CREDENTIAL_BEARING_COMMAND)).toBe(false);
		expect(text.includes(CREDENTIAL_BEARING_TOOL_OUTPUT)).toBe(false);
		expect(text.includes("kubectl --token=")).toBe(false);
	});

	it("does not carry the raw prompt under any metadata key", () => {
		const sessionId = "session_prompt";
		writeCanonicalSession(sessionId, adversarialManifest(sessionId));

		const { text } = buildDiagnosticsReport([sessionId]);

		expect(text).not.toContain("bootstrap admin password is");
		expect(text).not.toContain("ACT-KEYCLOAK-ROUND-C-01");
		expect(text).not.toContain("You are Cline");
	});

	it("does not carry credential-bearing or private-persistence URLs and paths", () => {
		const sessionId = "session_urls";
		const { messagesPath, compactionPath } =
			writeSessionWithArtifacts(sessionId);

		const { text } = buildDiagnosticsReport([sessionId]);

		// The Git remote (which carries an embedded credential here).
		expect(text).not.toContain("gitlab.example.invalid");
		// The canonical private-persistence artifacts must not be advertised:
		// neither by PATH VALUE nor by the `*.messages.json` /
		// `*.compaction.json` file names.
		expect(text).not.toContain(messagesPath);
		expect(text).not.toContain(compactionPath);
		expect(text).not.toContain(".messages.json");
		expect(text).not.toContain(".compaction.json");
	});

	it("keeps the useful non-sensitive evidence", () => {
		const sessionId = "session_useful";
		writeCanonicalSession(sessionId, adversarialManifest(sessionId));

		const { text } = buildDiagnosticsReport([sessionId]);

		// Session identity and run metadata.
		expect(text).toContain(sessionId);
		expect(text).toContain("qwen3.8-flash-next-iq3_s");
		expect(text).toContain("openai-compatible");
		// Token accounting.
		expect(text).toContain("4562216");
		expect(text).toContain("4193916");
		// Checkpoint identity and the git branch label.
		expect(text).toContain("42de653b59708e712d694aeb9732f822b7f8fe5b");
		expect(text).toContain("optimize-ftls");
	});

	it("records the fields it omitted instead of dropping them silently", () => {
		const sessionId = "session_omissions";
		writeCanonicalSession(sessionId, adversarialManifest(sessionId));

		const { text } = buildDiagnosticsReport([sessionId]);

		expect(text).toContain("omittedFields");
		expect(text).toContain("metadata.title");
		expect(text).toContain("metadata.prompt");
		expect(text).toContain("metadata.systemPrompt");
		expect(text).toContain("manifest.messages_path");
		expect(text).toContain("manifest.compaction_path");
	});

	it("CORRECTION02: does not publish the NAME of an unknown manifest key", () => {
		// A manifest key is USER-CONTROLLED CONTENT. Publishing it would
		// turn the omission record into a disclosure channel: a synthetic
		// key such as `PRIVATE_ACCESS_VALUE_123` would appear verbatim in
		// the shareable artifact.
		const sessionId = "session_unknown_key";
		const manifest = adversarialManifest(sessionId);
		(manifest.metadata as Record<string, unknown>).PRIVATE_ACCESS_VALUE_123 =
			"UNKNOWN_METADATA_KEY_MARKER";
		writeCanonicalSession(sessionId, manifest);

		const { text } = buildDiagnosticsReport([sessionId]);

		expect(text).not.toContain("PRIVATE_ACCESS_VALUE_123");
		expect(text).not.toContain("UNKNOWN_METADATA_KEY_MARKER");
		expect(text).not.toContain("metadata.PRIVATE_ACCESS_VALUE_123");
		// The omission is still RECORDED — as a COUNT, which is safe.
		expect(text).toContain("unknownOmittedFieldCount");
		expect(text).toMatch(/"unknownOmittedFieldCount":\s*1/);
	});

	it("CORRECTION02: does not publish the NAME of an unknown top-level manifest key", () => {
		const sessionId = "session_unknown_manifest_key";
		const manifest = adversarialManifest(sessionId);
		manifest.PRIVATE_MANIFEST_KEY_456 = "UNKNOWN_MANIFEST_KEY_MARKER";
		writeCanonicalSession(sessionId, manifest);

		const { text } = buildDiagnosticsReport([sessionId]);

		expect(text).not.toContain("PRIVATE_MANIFEST_KEY_456");
		expect(text).not.toContain("UNKNOWN_MANIFEST_KEY_MARKER");
		expect(text).not.toContain("manifest.PRIVATE_MANIFEST_KEY_456");
		expect(text).toMatch(/"unknownOmittedFieldCount":\s*1/);
	});

	it("does not mutate the canonical conversation records", () => {
		const sessionId = "session_immutable";
		const { manifestPath, messagesPath, compactionPath } =
			writeSessionWithArtifacts(sessionId);

		const before = {
			manifest: readFileSync(manifestPath, "utf8"),
			messages: readFileSync(messagesPath, "utf8"),
			compaction: readFileSync(compactionPath, "utf8"),
		};

		buildDiagnosticsReport([sessionId]);
		writeDiagnosticsReport([sessionId], join(dataDir, "out"));

		expect(readFileSync(manifestPath, "utf8")).toBe(before.manifest);
		expect(readFileSync(messagesPath, "utf8")).toBe(before.messages);
		expect(readFileSync(compactionPath, "utf8")).toBe(before.compaction);
	});

	it("writes an artifact that a support engineer can still read", () => {
		const sessionId = "session_artifact";
		writeCanonicalSession(sessionId, adversarialManifest(sessionId));

		const outputDir = join(dataDir, "out");
		const result = writeDiagnosticsReport([sessionId], outputDir);

		expect(existsSync(result.path)).toBe(true);
		const written = readFileSync(result.path, "utf8");
		expect(written.length).toBeGreaterThan(0);
		expect(written).toContain(sessionId);
	});
});

describe("shareable diagnostic export — bounded output", () => {
	it("bounds the exported artifact size", () => {
		const sessionId = "session_bounded";
		const manifest = adversarialManifest(sessionId);
		// A pathological manifest: a huge title and a huge nested blob.
		(manifest.metadata as Record<string, unknown>).title = "x".repeat(200_000);
		(manifest.metadata as Record<string, unknown>).blob = {
			nested: { deeper: "y".repeat(200_000) },
		};
		writeCanonicalSession(sessionId, manifest);

		const { text } = buildDiagnosticsReport([sessionId]);

		expect(text.length).toBeLessThan(1_000_000);
	});

	it("keeps the home directory out of the artifact", () => {
		const sessionId = "session_home";
		const manifest = adversarialManifest(sessionId);
		manifest.cwd = join(homedir(), "projects", "keycloak");
		writeCanonicalSession(sessionId, manifest);

		const { text } = buildDiagnosticsReport([sessionId]);

		expect(text).not.toContain(homedir());
	});
});

describe("shareable diagnostic export — log tails", () => {
	it("omits raw log bodies, including adversarial free-form credentials", () => {
		writeFileSync(
			join(dataDir, "logs", "code.log"),
			[
				`{"authorizationHeader":"SYNTHETIC_HEADER_VALUE_41"}`,
				`{"aws_access_key_id":"SYNTHETIC_AWS_ID_ABC"}`,
				"opaque access material: ZZZ_UNSTRUCTURED_ACCESS_MATERIAL_91",
				`{"client_secret":"${SECRETS.jsonClientSecret}"}`,
				`    password: ${SECRETS.yamlPassword}`,
				`https://${SECRETS.urlEmbeddedCredential}@gitlab.example.invalid/backend/keycloak.git`,
				`Authorization: Bearer ${SECRETS.authorizationToken}`,
				`KC_DB_URL: jdbc:postgresql://kc-db-host:6432/keycloak-prod`,
				`REDSMS_API_KEY: ${SECRETS.messagingApiKey}`,
				`kubectl --token=${SECRETS.commandArgumentSecret} get secret`,
				`export KC_BOOTSTRAP_ADMIN_PASSWORD=${SECRETS.keycloakAdminPassword}`,
				`{"auth":{"accessToken":"${SECRETS.authorizationToken}"}}`,
			].join("\n"),
		);

		const { text } = buildDiagnosticsReport([]);

		for (const value of [
			"SYNTHETIC_HEADER_VALUE_41",
			"SYNTHETIC_AWS_ID_ABC",
			"ZZZ_UNSTRUCTURED_ACCESS_MATERIAL_91",
			...Object.values(SECRETS),
		]) {
			expect(text).not.toContain(value);
		}
		expect(text).toContain('"included": false');
		expect(text).not.toContain("code.log");
	});
});

describe("shareable diagnostic export — strict global settings projection", () => {
	it("does not serialize unexpected global settings fields", () => {
		const settingsPath = join(dataDir, "settings", "global-settings.json");
		mkdirSync(join(dataDir, "settings"), { recursive: true });
		writeFileSync(
			settingsPath,
			JSON.stringify({
				telemetryOptOut: false,
				autoUpdateEnabled: true,
				// A SYNTHETIC fixture, not a credential: the value must NOT
				// reach the shareable artifact.
				unexpectedCredential: "SYNTHETIC_GLOBAL_SECRET_73", // gitleaks:allow
			}),
		);

		const { text } = buildDiagnosticsReport([]);
		expect(text).not.toContain("unexpectedCredential");
		expect(text).not.toContain("SYNTHETIC_GLOBAL_SECRET_73");
		expect(text).toContain('"telemetryOptOut": false');
	});

	it("CORRECTION02: does not publish free-form global settings VALUES", () => {
		// The settings SCHEMA allows arbitrary strings in `tuiTheme` and in
		// the disabled-name lists, so selecting those KEYS was never
		// sufficient. A synthetic sensitive string placed in
		// `disabledPlugins` must not reach the shareable artifact.
		const settingsPath = join(dataDir, "settings", "global-settings.json");
		mkdirSync(join(dataDir, "settings"), { recursive: true });
		writeFileSync(
			settingsPath,
			JSON.stringify({
				telemetryOptOut: false,
				autoUpdateEnabled: true,
				tuiTheme: "SYNTHETIC_THEME_SECRET_91",
				cloudModelId: "SYNTHETIC_MODEL_SECRET_92",
				disabledTools: ["SYNTHETIC_DISABLED_TOOL_SECRET_93"],
				disabledPlugins: ["SYNTHETIC_DISABLED_PLUGIN_SECRET_94"],
				disabledAgentPlugins: ["SYNTHETIC_DISABLED_AGENT_PLUGIN_95"],
			}),
		);

		const { text } = buildDiagnosticsReport([]);

		for (const secret of [
			"SYNTHETIC_THEME_SECRET_91",
			"SYNTHETIC_MODEL_SECRET_92",
			"SYNTHETIC_DISABLED_TOOL_SECRET_93",
			"SYNTHETIC_DISABLED_PLUGIN_SECRET_94",
			"SYNTHETIC_DISABLED_AGENT_PLUGIN_95",
		]) {
			expect(
				text.includes(secret),
				`shareable export disclosed ${secret}`,
			).toBe(false);
		}
		// The unrestricted values are not published under ANY key: the
		// QUOTED key names of the raw settings are absent (the count
		// fields carry a different, suffixed key).
		expect(text).not.toContain('"tuiTheme"');
		expect(text).not.toContain('"cloudModelId"');
		expect(text).not.toContain('"disabledPlugins"');
		expect(text).not.toContain('"disabledAgentPlugins"');
		expect(text).not.toContain('"disabledTools"');
		// The COUNTS are published instead: the SIZE is evidence, the
		// ENTRIES are content.
		expect(text).toContain('"disabledPluginsCount": 1');
		expect(text).toContain('"disabledToolsCount": 1');
		expect(text).toContain('"disabledAgentPluginsCount": 1');
	});

	it("CORRECTION02: publishes only validated primitives for the global settings", () => {
		const settingsPath = join(dataDir, "settings", "global-settings.json");
		mkdirSync(join(dataDir, "settings"), { recursive: true });
		writeFileSync(
			settingsPath,
			JSON.stringify({
				telemetryOptOut: true,
				autoUpdateEnabled: false,
				compactionStrategy: "basic",
				compactionEnabled: true,
				planActMode: "plan",
				toolAutoApprove: false,
				tools: { web_search: { enabled: true } },
			}),
		);

		const { text } = buildDiagnosticsReport([]);

		expect(text).toContain('"telemetryOptOut": true');
		expect(text).toContain('"autoUpdateEnabled": false');
		expect(text).toContain('"compactionStrategy": "basic"');
		expect(text).toContain('"compactionEnabled": true');
		expect(text).toContain('"planActMode": "plan"');
		expect(text).toContain('"toolAutoApprove": false');
		expect(text).toContain('"web_search": true');
		// The model-tool block is a FINITE key set of booleans.
		expect(text).toMatch(/"modelTools":\s*\{\s*"web_search":\s*true\s*\}/);
	});
});

describe("shareable diagnostic export — failure isolation", () => {
	it("still produces a report when a session manifest is unreadable", () => {
		// A manifest that is not valid JSON: the export must skip it and
		// still produce a usable report for the other sessions.
		const dir = join(dataDir, "sessions", "session_broken");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "session_broken.json"), "{not json");
		writeCanonicalSession("session_ok", adversarialManifest("session_ok"));

		const report = buildDiagnosticsReport(["session_broken", "session_ok"]);

		expect(report.sessionIds).toEqual(["session_ok"]);
		expect(report.text).toContain("session_ok");
	});

	it("does not read the canonical conversation artifacts", () => {
		const sessionId = "session_not_read";
		const { messagesPath, compactionPath } =
			writeSessionWithArtifacts(sessionId);
		// Replace the canonical artifacts with content that would be obvious
		// in the report if it were read.
		writeFileSync(messagesPath, "CANONICAL_MESSAGES_MARKER\n");
		writeFileSync(compactionPath, "CANONICAL_COMPACTION_MARKER\n");

		const { text } = buildDiagnosticsReport([sessionId]);

		expect(text).not.toContain("CANONICAL_MESSAGES_MARKER");
		expect(text).not.toContain("CANONICAL_COMPACTION_MARKER");
	});
});

describe("shareable diagnostic export — complete recursive schema inspection", () => {
	it("carries no unexpected key anywhere in the session projection", () => {
		const sessionId = "session_schema";
		writeCanonicalSession(sessionId, adversarialManifest(sessionId));

		const { text } = buildDiagnosticsReport([sessionId]);

		// Take the session section out of the report and parse it.
		const marker = `===== session ${sessionId} =====`;
		const start = text.indexOf(marker);
		expect(start).toBeGreaterThan(-1);
		const body = text.slice(start + marker.length).trim();
		const projection = JSON.parse(body);

		// The ALLOWED keys of the projection, at the top level.
		const allowed = new Set([
			"sessionId",
			"source",
			"status",
			"interactive",
			"provider",
			"model",
			"startedAt",
			"endedAt",
			"exitCode",
			"workspace",
			"gitBranch",
			"checkpointRef",
			"usage",
			"omittedFields",
			"unknownOmittedFieldCount",
		]);
		for (const key of Object.keys(projection)) {
			expect(allowed.has(key), `unexpected projection key: ${key}`).toBe(true);
		}

		// The ALLOWED keys of the usage block.
		const allowedUsage = new Set([
			"inputTokens",
			"outputTokens",
			"cacheReadTokens",
			"cacheWriteTokens",
			"totalCost",
		]);
		for (const key of Object.keys(projection.usage ?? {})) {
			expect(allowedUsage.has(key), `unexpected usage key: ${key}`).toBe(true);
		}

		// EVERY leaf in the projection is a string, a number, a boolean or
		// null: no nested object or array can hide a credential. The only
		// nested containers are `usage` (an object whose keys were checked
		// above) and `omittedFields` (an array of key names).
		const walk = (node: unknown, path: string): void => {
			if (node === null) return;
			if (Array.isArray(node)) {
				for (const [index, item] of node.entries()) {
					expect(
						typeof item,
						`projection array element at ${path}[${index}] is not a primitive`,
					).toBe("string");
				}
				return;
			}
			if (typeof node === "object") {
				for (const [key, value] of Object.entries(node)) {
					if (
						path === "projection" &&
						(key === "usage" || key === "omittedFields")
					) {
						walk(value, `${path}.${key}`);
						continue;
					}
					expect(
						typeof value !== "object" || value === null,
						`projection value at ${path}.${key} is a nested container`,
					).toBe(true);
					walk(value, `${path}.${key}`);
				}
			}
		};
		walk(projection, "projection");
	});

	it("carries no unexpected key anywhere in the global settings projection", () => {
		const settingsPath = join(dataDir, "settings", "global-settings.json");
		mkdirSync(join(dataDir, "settings"), { recursive: true });
		writeFileSync(
			settingsPath,
			JSON.stringify({
				telemetryOptOut: false,
				autoUpdateEnabled: true,
				compactionStrategy: "agentic",
				compactionEnabled: true,
				planActMode: "act",
				toolAutoApprove: true,
				tuiTheme: "SYNTHETIC_THEME_SECRET_91",
				cloudModelId: "SYNTHETIC_MODEL_SECRET_92",
				disabledTools: ["SYNTHETIC_DISABLED_TOOL_SECRET_93"],
				disabledPlugins: ["SYNTHETIC_DISABLED_PLUGIN_SECRET_94"],
				disabledAgentPlugins: ["SYNTHETIC_DISABLED_AGENT_PLUGIN_95"],
				tools: { web_search: { enabled: true } },
			}),
		);

		const { text } = buildDiagnosticsReport([]);

		// The report header is the top-level JSON object; the session
		// sections are appended after it as text. The header is extracted
		// by brace matching, so the parse does not depend on the order of
		// the header's keys.
		const headerEnd = text.indexOf("\n}");
		expect(headerEnd).toBeGreaterThan(-1);
		const header = JSON.parse(text.slice(0, headerEnd + 2));

		const settings = header.globalSettings as Record<string, unknown>;

		// The ALLOWED keys of the global settings projection.
		const allowed = new Set([
			"telemetryOptOut",
			"autoUpdateEnabled",
			"compactionStrategy",
			"compactionEnabled",
			"planActMode",
			"toolAutoApprove",
			"modelTools",
			"disabledToolsCount",
			"disabledPluginsCount",
			"disabledAgentPluginsCount",
		]);
		for (const key of Object.keys(settings)) {
			expect(allowed.has(key), `unexpected global settings key: ${key}`).toBe(
				true,
			);
		}

		// Every leaf is a boolean, a closed-enum string, or a count.
		for (const [key, value] of Object.entries(settings)) {
			if (key === "modelTools") {
				const toggles = value as Record<string, unknown>;
				for (const [tool, enabled] of Object.entries(toggles)) {
					expect(typeof enabled, `model tool ${tool} is not a boolean`).toBe(
						"boolean",
					);
				}
				continue;
			}
			expect(
				typeof value === "boolean" ||
					typeof value === "number" ||
					value === undefined ||
					value === "basic" ||
					value === "agentic" ||
					value === "plan" ||
					value === "act",
				`global settings value at ${key} is not a validated primitive`,
			).toBe(true);
		}
	});
});
