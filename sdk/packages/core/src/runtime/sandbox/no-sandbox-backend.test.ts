/**
 * Tests for NoSandboxBackend — the disabled-mode default.
 *
 * Verify:
 *
 *  - `id === "no-sandbox"`;
 *  - `isAvailable()` always returns `true`;
 *  - `prepare()` returns a prepared invocation byte-equivalent to the
 *    input invocation (the conservation oracle);
 *  - the capability is IGNORED in disabled mode;
 *  - `args` and `env` are fresh copies (mutating them after the call
 *    does not affect the backend's internal state, and vice versa).
 *
 * ACT: ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01
 */

import { describe, expect, it } from "vitest";

import { noSandboxBackend } from "./no-sandbox-backend";
import type { CommandInvocation } from "./types";

describe("NoSandboxBackend", () => {
	it("has id 'no-sandbox'", () => {
		expect(noSandboxBackend.id).toBe("no-sandbox");
	});

	it("isAvailable() returns true (no substrate to probe)", async () => {
		expect(await noSandboxBackend.isAvailable()).toBe(true);
	});

	it("prepare() returns a byte-equivalent invocation", async () => {
		const cmd: CommandInvocation = {
			executable: "/bin/bash",
			args: ["-c", "echo hello"],
			cwd: "/Users/me/proj",
			env: { FOO: "bar", BAZ: "qux" },
			input: undefined,
		};
		const prepared = await noSandboxBackend.prepare({
			// Capability is ignored; pass an "interesting" one to prove
			// the backend does not consult it.
			capability: {
				readonlyRoots: ["/should/be/ignored"],
				writableRoots: ["/should/be/ignored/too"],
				network: "deny",
				environment: { mode: "sanitized", allow: ["SHOULD_NOT_BE_HONORED"] },
				cwd: "/should/be/ignored/cwd",
			},
			command: cmd,
		});
		expect(prepared.executable).toBe(cmd.executable);
		expect(prepared.args).toEqual(cmd.args);
		expect(prepared.cwd).toBe(cmd.cwd);
		expect(prepared.env).toEqual(cmd.env);
		expect(prepared.backendId).toBe("no-sandbox");
	});

	it("prepare() returns fresh copies of args and env (no aliasing)", async () => {
		const cmd: CommandInvocation = {
			executable: "/bin/bash",
			args: ["-c", "echo hello"],
			cwd: "/Users/me/proj",
			env: { FOO: "bar" },
		};
		const prepared = await noSandboxBackend.prepare({
			capability: {
				readonlyRoots: [],
				writableRoots: [],
				network: "allow",
				environment: { mode: "inherit" },
			},
			command: cmd,
		});

		// Mutating the prepared invocation must not affect the input.
		(prepared.args as string[]).push("-x");
		(prepared.env as Record<string, string>).FOO = "mutated";
		expect(cmd.args).toEqual(["-c", "echo hello"]);
		expect(cmd.env.FOO).toBe("bar");

		// Mutating the input must not affect a previously prepared invocation.
		const prepared2 = await noSandboxBackend.prepare({
			capability: {
				readonlyRoots: [],
				writableRoots: [],
				network: "allow",
				environment: { mode: "inherit" },
			},
			command: cmd,
		});
		(prepared2.args as string[]).push("-y");
		expect(prepared.args).not.toContain("-y");
	});

	it("preserves input semantics: undefined vs missing vs empty string", async () => {
		// `undefined` is the "not provided" signal.
		const a = await noSandboxBackend.prepare({
			capability: {
				readonlyRoots: [],
				writableRoots: [],
				network: "allow",
				environment: { mode: "inherit" },
			},
			command: {
				executable: "/bin/bash",
				args: ["-c", "true"],
				cwd: "/Users/me/proj",
				env: {},
				input: undefined,
			},
		});
		expect(a.input).toBeUndefined();

		// Empty string is a different signal and must be preserved.
		const b = await noSandboxBackend.prepare({
			capability: {
				readonlyRoots: [],
				writableRoots: [],
				network: "allow",
				environment: { mode: "inherit" },
			},
			command: {
				executable: "/bin/bash",
				args: ["-c", "true"],
				cwd: "/Users/me/proj",
				env: {},
				input: "",
			},
		});
		expect(b.input).toBe("");

		// Non-empty input is preserved verbatim.
		const c = await noSandboxBackend.prepare({
			capability: {
				readonlyRoots: [],
				writableRoots: [],
				network: "allow",
				environment: { mode: "inherit" },
			},
			command: {
				executable: "/bin/bash",
				args: ["-c", "true"],
				cwd: "/Users/me/proj",
				env: {},
				input: "hello world",
			},
		});
		expect(c.input).toBe("hello world");
	});

	it("is reusable across concurrent calls (no shared mutable state)", async () => {
		const cmd: CommandInvocation = {
			executable: "/bin/echo",
			args: ["x"],
			cwd: "/Users/me/proj",
			env: {},
		};
		const calls = await Promise.all(
			Array.from({ length: 16 }, () =>
				noSandboxBackend.prepare({
					capability: {
						readonlyRoots: [],
						writableRoots: [],
						network: "allow",
						environment: { mode: "inherit" },
					},
					command: cmd,
				}),
			),
		);
		for (const p of calls) {
			expect(p.executable).toBe("/bin/echo");
			expect(p.args).toEqual(["x"]);
		}
	});
});
