import { describe, it } from "bun:test"
import "should"
import { type ResolveEnvSessionCtx, resolveMcpServerEnv } from "../envResolver"
import { EnvEntrySchema, McpSettingsSchema } from "../schemas"

describe("EnvEntrySchema (A2A-02..07)", () => {
	it("A2A-02 accepts { value: ... }", () => {
		const r = EnvEntrySchema.safeParse({ value: "v" })
		r.success.should.be.true()
		;(r.data as any).value.should.equal("v")
	})

	it("A2A-03 accepts { fromEnv: ... }", () => {
		const r = EnvEntrySchema.safeParse({ fromEnv: "PATH" })
		r.success.should.be.true()
		;(r.data as any).fromEnv.should.equal("PATH")
	})

	it("A2A-04 accepts { fromSession: 'sessionId' }", () => {
		const r = EnvEntrySchema.safeParse({ fromSession: "sessionId" })
		r.success.should.be.true()
		;(r.data as any).fromSession.should.equal("sessionId")
	})

	it("A2A-07 REJECTS multi-source entries", () => {
		const r = EnvEntrySchema.safeParse({ value: "v", fromEnv: "PATH" })
		r.success.should.be.false()
	})

	it("rejects fromSession with non-'sessionId' literals (the only literal allowed today)", () => {
		const r = EnvEntrySchema.safeParse({ fromSession: "userId" })
		r.success.should.be.false()
	})
})

describe("McpSettingsSchema — env additive union (Stage 1 RED→GREEN)", () => {
	it("legacy string env still round-trips (A2A-01)", () => {
		const input = {
			mcpServers: {
				legacy: {
					command: "node",
					args: ["s.js"],
					env: { API_KEY: "abc", OTHER: "xyz" },
				},
			},
		}
		const r = McpSettingsSchema.safeParse(input)
		r.success.should.be.true()
		const env = (r.data!.mcpServers["legacy"] as any).env
		env.API_KEY.should.equal("abc")
		env.OTHER.should.equal("xyz")
	})

	it("accepts an env map mixing strings and object entries (A2A-02..04 additive)", () => {
		const input = {
			mcpServers: {
				whoami: {
					command: "node",
					args: ["whoami.mjs"],
					env: {
						CONST: { value: "literal" },
						FROM_HOST: { fromEnv: "HOSTNAME" },
						SESSION_ID: { fromSession: "sessionId" },
						PLAIN: "still-works",
					},
				},
			},
		}
		const r = McpSettingsSchema.safeParse(input)
		r.success.should.be.true()
		const env = (r.data!.mcpServers["whoami"] as any).env
		env.CONST.should.deepEqual({ value: "literal" })
		env.FROM_HOST.should.deepEqual({ fromEnv: "HOSTNAME" })
		env.SESSION_ID.should.deepEqual({ fromSession: "sessionId" })
		env.PLAIN.should.equal("still-works")
	})

	it("rejects an env map with multi-source entries (A2A-07 schema reject)", () => {
		const input = {
			mcpServers: {
				bad: {
					command: "node",
					env: { X: { value: "v", fromEnv: "PATH" } },
				},
			},
		}
		const r = McpSettingsSchema.safeParse(input)
		r.success.should.be.false()
	})
})
const SESSION_CTX: ResolveEnvSessionCtx = { sessionId: "session-A" }

describe("resolveMcpServerEnv (Stage 2 pure resolver)", () => {
	const rawEnv: Record<string, string> = {
		HOSTNAME: "myhost",
		API_KEY: "k-123",
	}

	it("A2A-02 { value } is materialized as-is, rawEnv untouched", () => {
		const before = structuredClone(rawEnv)
		const result = resolveMcpServerEnv({ X: { value: "literal" } }, rawEnv, SESSION_CTX)
		result.should.deepEqual({ X: "literal" })
		rawEnv.should.deepEqual(before)
	})

	it("A2A-03 { fromEnv } copies the named key from rawEnv", () => {
		const result = resolveMcpServerEnv({ HOST: { fromEnv: "HOSTNAME" } }, rawEnv, SESSION_CTX)
		result.should.deepEqual({ HOST: "myhost" })
	})

	it("A2A-03 { fromEnv } missing source + required: false → key absent in result", () => {
		const result = resolveMcpServerEnv({ MISSING: { fromEnv: "NOPE" } }, rawEnv, SESSION_CTX)
		result.should.deepEqual({})
	})

	it("A2A-05 { fromEnv } missing source + required: true → THROW", () => {
		let threw = false
		try {
			resolveMcpServerEnv({ MISSING: { fromEnv: "NOPE", required: true } }, rawEnv, SESSION_CTX)
		} catch (_e) {
			threw = true
		}
		threw.should.be.true()
	})

	it("A2A-04 { fromSession: 'sessionId' } materializes the session id", () => {
		const result = resolveMcpServerEnv({ MYC_SESSION_ID: { fromSession: "sessionId" } }, rawEnv, SESSION_CTX)
		result.should.deepEqual({ MYC_SESSION_ID: "session-A" })
	})

	it("A2A-06 { fromSession } with no sessionCtx + required: true → THROW", () => {
		let threw = false
		try {
			resolveMcpServerEnv({ MYC_SESSION_ID: { fromSession: "sessionId", required: true } }, rawEnv, undefined)
		} catch (_e) {
			threw = true
		}
		threw.should.be.true()
	})

	it("A2A-11 PROJECTION PURITY — rawEnv deep-equals structuredClone(rawEnv) before/after; result may be a fresh object", () => {
		const before = structuredClone(rawEnv)
		const result = resolveMcpServerEnv(
			{
				HOST: { fromEnv: "HOSTNAME" },
				API_KEY: { fromEnv: "API_KEY" },
				MYC_SESSION_ID: { fromSession: "sessionId" },
			},
			rawEnv,
			SESSION_CTX,
		)
		rawEnv.should.deepEqual(before)
		result.should.deepEqual({
			HOST: "myhost",
			API_KEY: "k-123",
			MYC_SESSION_ID: "session-A",
		})
	})

	it("legacy template + undefined sessionCtx produces the same flat env as before session-context was threaded through", () => {
		const result = resolveMcpServerEnv({ A: "1", B: "2" }, rawEnv, undefined)
		result.should.deepEqual({ A: "1", B: "2" })
	})
})
