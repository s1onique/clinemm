/**
 * NoSandboxBackend — the default backend.
 *
 * Returns a prepared invocation that is byte-equivalent to the input
 * invocation. No profile generation, no temp file, no env scrubbing,
 * no PATH change, no cwd change, no shell change, no wrapper process.
 *
 * This is the most important backward-compatibility guarantee in the
 * sandbox abstraction: when sandbox mode is `"disabled"` (the DEFAULT),
 * the executor must observe the EXACT same `SpawnConfig` it observed
 * before this ACT.
 *
 * The `backendId` is `"no-sandbox"` so logs can distinguish "ran
 * normally" from "ran sandboxed".
 */

import type {
	CommandInvocation,
	CommandCapability,
	SandboxBackend,
	SandboxPreparedInvocation,
} from "./types";

/**
 * The single, shared `NoSandboxBackend` instance.
 *
 * Stateless and immutable: it can be safely reused across calls without
 * any concurrency concerns.
 */
export const noSandboxBackend: SandboxBackend = Object.freeze({
	id: "no-sandbox",

	async isAvailable(): Promise<boolean> {
		// Always available — there is no substrate to probe.
		return true;
	},

	async prepare(input: {
		readonly capability: CommandCapability;
		readonly command: CommandInvocation;
	}): Promise<SandboxPreparedInvocation> {
		// The capability is ignored in disabled mode. We do NOT validate
		// it; callers may pass anything because `disabled` is the
		// canonical "no opinion" mode.
		void input.capability;
		const cmd = input.command;
		return {
			executable: cmd.executable,
			args: [...cmd.args],
			cwd: cmd.cwd,
			env: { ...cmd.env },
			// CORRECTION01-P1: explicit envSemantics for the legacy
			// overlay path. The production executor spreads process.env
			// underneath `env` (existing production behavior), which is
			// exactly the "overlay" contract. See types.ts
			// EnvironmentSemantics.
			envSemantics: "overlay",
			// Preserve `input` semantics: `undefined` (not present) is
			// distinct from `""` (present-but-empty). `CommandInvocation`
			// has `input?: string`, so we must forward the optional.
			input: cmd.input,
			cleanup: undefined,
			backendId: "no-sandbox",
		};
	},
});
