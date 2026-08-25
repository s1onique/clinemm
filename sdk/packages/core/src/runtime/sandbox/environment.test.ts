/**
 * Tests for the environment materializer.
 *
 * Verify:
 *
 *  - "inherit" mode returns empty overrides;
 *  - "sanitized" mode emits the safe baseline (PATH, LANG, TERM, ...);
 *  - secret-shaped names (SSH_AUTH_SOCK, AWS_*, OPENAI_API_KEY, *_SECRET*,
 *    *_TOKEN*) are NEVER inherited unless explicitly allowlisted;
 *  - caller-provided allowlist IS honored (including for secret-shaped names
 *    if explicitly opted in);
 *  - synthetic HOME / TMPDIR override the baseline.
 *
 * ACT: ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01
 */

import { describe, expect, it } from "vitest";

import {
	DEFAULT_READONLY_ALLOW,
	SAFE_ENVIRONMENT_BASELINE,
	SECRET_BLOCKLIST,
	isSecretShapedEnvName,
	materializeEnvironment,
} from "./environment";

describe("isSecretShapedEnvName", () => {
	it("matches every literal name in SECRET_BLOCKLIST", () => {
		for (const name of SECRET_BLOCKLIST) {
			expect(isSecretShapedEnvName(name)).toBe(true);
		}
	});

	it("matches *_SECRET* and *_TOKEN* family patterns", () => {
		expect(isSecretShapedEnvName("FOO_SECRET_BAR")).toBe(true);
		expect(isSecretShapedEnvName("MY_APP_TOKEN")).toBe(true);
		expect(isSecretShapedEnvName("GITHUB_TOKEN")).toBe(true);
	});

	it("does NOT match benign names", () => {
		expect(isSecretShapedEnvName("PATH")).toBe(false);
		expect(isSecretShapedEnvName("LANG")).toBe(false);
		expect(isSecretShapedEnvName("HOME")).toBe(false);
		expect(isSecretShapedEnvName("EDITOR")).toBe(false);
		expect(isSecretShapedEnvName("NODE_ENV")).toBe(false);
	});
});

describe("materializeEnvironment — inherit mode", () => {
	it("returns an empty record (caller adds process.env)", () => {
		const out = materializeEnvironment({ mode: "inherit" }, {
			parentEnv: { PATH: "/usr/bin", FOO: "bar" },
		});
		expect(out).toEqual({});
	});

	it("ignores synthetic HOME / TMPDIR in inherit mode", () => {
		const out = materializeEnvironment({ mode: "inherit" }, {
			parentEnv: {},
			syntheticHome: "/sandbox/home",
			syntheticTempDir: "/sandbox/tmp",
		});
		expect(out).toEqual({});
	});
});

describe("materializeEnvironment — sanitized mode", () => {
	it("emits the safe baseline with parent overrides", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: [] },
			{
				parentEnv: { PATH: "/parent/bin", TERM: "xterm" },
			},
		);
		for (const key of Object.keys(SAFE_ENVIRONMENT_BASELINE)) {
			expect(out).toHaveProperty(key);
		}
		expect(out.PATH).toBe("/parent/bin");
		expect(out.TERM).toBe("xterm");
	});

	it("uses the constant fallback when parent did not set PATH", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: [] },
			{ parentEnv: {} },
		);
		expect(out.PATH.length).toBeGreaterThan(0);
	});

	it("never inherits SSH_AUTH_SOCK from the parent", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: [] },
			{
				parentEnv: {
					SSH_AUTH_SOCK: "/tmp/fake.sock",
					SSH_AGENT_PID: "999",
				},
			},
		);
		expect(out.SSH_AUTH_SOCK).toBe("");
		expect(out.SSH_AGENT_PID).toBe("");
	});

	it("never inherits AWS_*, AZURE_*, GITHUB_TOKEN, NPM_TOKEN, *_SECRET*, *_TOKEN* from the parent", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: [] },
			{
				parentEnv: {
					AWS_ACCESS_KEY_ID: "AKIA-FOR-TEST",
					AWS_SECRET_ACCESS_KEY: "SECRET",
					AWS_SESSION_TOKEN: "TOKEN",
					AZURE_CLIENT_SECRET: "az",
					GITHUB_TOKEN: "ghp_xxx",
					NPM_TOKEN: "npm_xxx",
					OPENAI_API_KEY: "sk-xxx",
					ANTHROPIC_API_KEY: "ant-xxx",
					FOO_SECRET: "x",
					MY_TOKEN: "y",
					DOCKER_HOST: "tcp://example",
					KUBECONFIG: "/path",
					NIX_SSL_CERT_FILE: "/nix/cert",
				},
			},
		);
		// Secret-shaped names inherited from parent are explicitly
		// overridden to empty string (so spread-merge executors
		// actually strip them).
		for (const key of [
			"AWS_ACCESS_KEY_ID",
			"AWS_SECRET_ACCESS_KEY",
			"AWS_SESSION_TOKEN",
			"AZURE_CLIENT_SECRET",
			"GITHUB_TOKEN",
			"NPM_TOKEN",
			"OPENAI_API_KEY",
			"ANTHROPIC_API_KEY",
			"FOO_SECRET",
			"MY_TOKEN",
			"DOCKER_HOST",
			"KUBECONFIG",
			"NIX_SSL_CERT_FILE",
		]) {
			expect(out[key]).toBe("");
		}
	});

	it("honors the explicit allow list for non-secret names", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: ["NODE_ENV"] },
			{ parentEnv: { NODE_ENV: "production" } },
		);
		expect(out.NODE_ENV).toBe("production");
	});

	it("honors an explicit allow list entry for a secret-shaped name (caller has opted in)", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: ["OPENAI_API_KEY"] },
			{ parentEnv: { OPENAI_API_KEY: "sk-allowlisted" } },
		);
		expect(out.OPENAI_API_KEY).toBe("sk-allowlisted");
	});

	it("does NOT include the leaked value when parent had a secret-shaped name not in the allow list", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: ["NODE_ENV"] },
			{ parentEnv: { OPENAI_API_KEY: "sk-leaked" } },
		);
		// The leaked value MUST NOT appear; the override is an empty
		// string (so spread-merge executors see an explicit empty
		// rather than the parent value).
		expect(out.OPENAI_API_KEY).toBe("");
	});

	it("skips empty / non-string entries in the allow list", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: ["", 42 as unknown as string] },
			{ parentEnv: {} },
		);
		expect(out[""]).toBeUndefined();
		expect(out["42"]).toBeUndefined();
	});
});

describe("materializeEnvironment — synthetic HOME / TMPDIR override", () => {
	it("overrides HOME with syntheticHome when provided", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: [] },
			{
				parentEnv: { HOME: "/real/home" },
				syntheticHome: "/sandbox/home",
			},
		);
		expect(out.HOME).toBe("/sandbox/home");
	});

	it("overrides TMPDIR with syntheticTempDir when provided", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: [] },
			{
				parentEnv: {},
				syntheticTempDir: "/sandbox/tmp",
			},
		);
		expect(out.TMPDIR).toBe("/sandbox/tmp");
	});

	it("keeps the parent's HOME when no synthetic HOME is provided", () => {
		const out = materializeEnvironment(
			{ mode: "sanitized", allow: [] },
			{ parentEnv: { HOME: "/real/home" } },
		);
		// HOME is not in the baseline so the parent's value passes through
		// only if allow-listed. Without allowlist, HOME is unset.
		expect(out.HOME).toBeUndefined();
	});
});

describe("DEFAULT_READONLY_ALLOW is non-empty and contains common dev variables", () => {
	it("contains NODE_ENV, EDITOR, USER, LOGNAME", () => {
		expect(DEFAULT_READONLY_ALLOW).toContain("NODE_ENV");
		expect(DEFAULT_READONLY_ALLOW).toContain("EDITOR");
		expect(DEFAULT_READONLY_ALLOW).toContain("USER");
		expect(DEFAULT_READONLY_ALLOW).toContain("LOGNAME");
	});

	it("does NOT contain any secret-shaped name", () => {
		for (const name of DEFAULT_READONLY_ALLOW) {
			expect(isSecretShapedEnvName(name)).toBe(false);
		}
	});
});


