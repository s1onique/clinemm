/**
 * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 2 pure resolver.
 *
 * The schema (`schemas.ts`) validates that each `env` entry is a well-formed
 * string or EnvEntry. This module's job is narrower: take the already-parsed
 * template (raw string|object values), the running process's `rawEnv`, and the
 * active Cline session context (if any), and return the FLAT
 * `Record<string, string>` that the child will see.
 *
 * Purity invariant (A2A-11 PROJECTION PURITY):
 *   `rawEnv` MUST NOT be mutated. The result MAY be a fresh object.
 *   Reference identity of the result is NOT a contract — only rawEnv
 *   non-mutation is.
 *
 * Resolution rules per entry:
 *   string value                   → use as-is
 *   { value }                      → use the literal
 *   { fromEnv: key }               → copy rawEnv[key]; missing + required:true → THROW
 *   { fromSession: "sessionId" }   → copy sessionCtx.sessionId;
 *                                    missing + required:true → THROW
 *
 * Multi-source entries (XOR) are schema-rejected upstream (A2A-07), so this
 * function never sees them.
 */
/**
 * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 2 pure resolver.
 *
 * The schema (`schemas.ts`) validates that each `env` entry is a well-formed
 * string or EnvEntry. This module's job is narrower: take the already-parsed
 * template (raw string|object values), the running process's `rawEnv`, and the
 * active Cline session context (if any), and return the FLAT
 * `Record<string, string>` that the child will see.
 *
 * Purity invariant (A2A-11 PROJECTION PURITY):
 *   `rawEnv` MUST NOT be mutated. The result MAY be a fresh object.
 *   Reference identity of the result is NOT a contract — only rawEnv
 *   non-mutation is.
 *
 * Resolution rules per entry:
 *   string value                   → use as-is
 *   { value }                      → use the literal
 *   { fromEnv: key }               → copy rawEnv[key]; missing + required:true → THROW
 *   { fromSession: "sessionId" }   → copy sessionCtx.sessionId;
 *                                    missing + required:true → THROW
 *
 * Multi-source entries (XOR) are schema-rejected upstream (A2A-07), so this
 * function never sees them.
 */
import type { z } from "zod"
import { EnvEntrySchema } from "./schemas"

export interface ResolveEnvSessionCtx {
	sessionId?: string
}

export class MissingEnvSourceError extends Error {
	constructor(
		public readonly envName: string,
		public readonly source: "fromEnv" | "fromSession",
		public readonly detail: string,
	) {
		super(`Missing required env source for "${envName}" (${source}): ${detail}`)
		this.name = "MissingEnvSourceError"
	}
}

export type EnvTemplate = Record<string, string | z.infer<typeof EnvEntrySchema>>

export function resolveMcpServerEnv(
	template: EnvTemplate | undefined,
	rawEnv: Record<string, string | undefined>,
	sessionCtx: ResolveEnvSessionCtx | undefined,
): Record<string, string> {
	const out: Record<string, string> = {}
	if (!template) return out

	for (const [name, entry] of Object.entries(template)) {
		// Legacy string form: pass through unchanged.
		if (typeof entry === "string") {
			out[name] = entry
			continue
		}

		// Object form. The schema (A2A-07) guarantees exactly one of
		// value/fromEnv/fromSession is set.
		const required = entry.required === true

		if (entry.value !== undefined) {
			out[name] = entry.value
			continue
		}

		if (entry.fromEnv !== undefined) {
			const v = rawEnv[entry.fromEnv]
			if (v === undefined || v === "") {
				if (required) {
					throw new MissingEnvSourceError(name, "fromEnv", `process.env.${entry.fromEnv} is unset`)
				}
				// Optional + missing: omit the key from the result.
				continue
			}
			out[name] = v
			continue
		}

		if (entry.fromSession !== undefined) {
			// Schema literal locks this to "sessionId" today; the check is here
			// so the resolver stays correct if more literals are added later.
			const v = sessionCtx?.sessionId
			if (!v) {
				if (required) {
					throw new MissingEnvSourceError(name, "fromSession", "sessionCtx.sessionId is unset")
				}
				continue
			}
			out[name] = v
			continue
		}

		// Unreachable given A2A-07 schema rejection, but be defensive:
		// if we somehow see a multi-source or source-less object, throw loudly.
		throw new Error(
			`Unreachable: env entry "${name}" reached the resolver without a source. ` +
				"This indicates a schema bypass — file a regression bug.",
		)
	}

	return out
}
