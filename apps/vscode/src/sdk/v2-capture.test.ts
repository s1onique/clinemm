/**
 * V2 capture module — opt-in tests.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-CAPTURE01
 *
 * These tests ONLY assert anything meaningful when `CLINEMM_CAPTURE_V2_PATH`
 * is set. When the env var is unset (the production default), the
 * module is a no-op and all assertions become "nothing happened".
 *
 * We never mutate the env inside the test process — instead we route
 * writes to a temp file and flip the env var locally for the duration
 * of one block.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	__resetV2CaptureForTests,
	emitCaptureAttach,
	emitV2Capture,
	getV2CaptureContext,
	isV2CaptureEnabled,
	newV2CorrelationId,
	v2CommandDigest,
	withV2CaptureContext,
} from "./v2-capture"

describe("ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-CAPTURE01 / v2-capture", () => {
	let tmpDir: string
	let capturePath: string
	let originalEnv: string | undefined

	beforeEach(() => {
		originalEnv = process.env.CLINEMM_CAPTURE_V2_PATH
		tmpDir = mkdtempSync(join(tmpdir(), "v2-capture-"))
		capturePath = join(tmpDir, "capture.jsonl")
		process.env.CLINEMM_CAPTURE_V2_PATH = capturePath
		__resetV2CaptureForTests()
	})

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_CAPTURE_V2_PATH
		} else {
			process.env.CLINEMM_CAPTURE_V2_PATH = originalEnv
		}
		__resetV2CaptureForTests()
		try {
			rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// best-effort cleanup
		}
	})

	it("writes one JSONL record per emit when env var is set", () => {
		expect(isV2CaptureEnabled()).toBe(true)
		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest("pwd; pwd")
		emitV2Capture({
			codePoint: "approval.entry.v2",
			correlationId,
			commandDigest,
			data: { toolName: "run_commands", isCommand: true },
		})
		emitV2Capture({
			codePoint: "approval.terminal.v2",
			correlationId,
			commandDigest,
		})

		const contents = readFileSync(capturePath, "utf8").trim().split("\n")
		expect(contents).toHaveLength(2)
		const first = JSON.parse(contents[0])
		expect(first.codePoint).toBe("approval.entry.v2")
		expect(first.scope).toBe("request")
		expect(first.correlationId).toBe(correlationId)
		expect(first.commandDigest).toBe(commandDigest)
		expect(first.data.toolName).toBe("run_commands")
		const second = JSON.parse(contents[1])
		expect(second.codePoint).toBe("approval.terminal.v2")
		expect(second.correlationId).toBe(correlationId)
	})

	it("never logs the raw shell command", () => {
		const secretCommand = "echo PII-SECRET-TOKEN-12345"
		const digest = v2CommandDigest({ command: secretCommand })
		emitV2Capture({
			codePoint: "commandRisk.structured.v2",
			commandDigest: digest,
			data: { preV2Decision: "ask" },
		})
		const contents = readFileSync(capturePath, "utf8")
		expect(contents).not.toContain(secretCommand)
		expect(contents).not.toContain("PII-SECRET-TOKEN")
		expect(contents).toContain(digest)
	})

	it("does not create the parent directory", () => {
		delete process.env.CLINEMM_CAPTURE_V2_PATH
		__resetV2CaptureForTests()
		const deepMissingPath = join(tmpDir, "missing-parent", "deep", "capture.jsonl")
		process.env.CLINEMM_CAPTURE_V2_PATH = deepMissingPath
		__resetV2CaptureForTests()
		expect(isV2CaptureEnabled()).toBe(true)
		emitV2Capture({ codePoint: "approval.entry.v2" })
		// No throw, no write — the parent does not exist and we must
		// not create it.
		let exists = false
		try {
			readFileSync(deepMissingPath, "utf8")
			exists = true
		} catch {
			exists = false
		}
		expect(exists).toBe(false)
	})

	it("swallows write errors without throwing", () => {
		// Point at a path whose parent does not exist. emitV2Capture
		// must not throw even though appendFileSync will fail.
		const badPath = join(tmpDir, "missing-parent.jsonl")
		process.env.CLINEMM_CAPTURE_V2_PATH = badPath
		__resetV2CaptureForTests()
		expect(() => emitV2Capture({ codePoint: "approval.entry.v2" })).not.toThrow()
	})

	it("falls back to a no-op when env var is unset", () => {
		delete process.env.CLINEMM_CAPTURE_V2_PATH
		__resetV2CaptureForTests()
		expect(isV2CaptureEnabled()).toBe(false)
		expect(() => emitV2Capture({ codePoint: "approval.entry.v2" })).not.toThrow()
	})

	it("produces a 12-char sha256 digest", () => {
		const digest = v2CommandDigest("pwd; pwd")
		expect(digest).toHaveLength(12)
		expect(digest).toMatch(/^[0-9a-f]{12}$/)
	})

	it("produces a deterministic digest for the same input", () => {
		expect(v2CommandDigest("pwd; pwd")).toBe(v2CommandDigest("pwd; pwd"))
	})

	it("produces distinct digests for distinct inputs", () => {
		expect(v2CommandDigest("pwd; pwd")).not.toBe(v2CommandDigest("rm -rf /"))
	})

	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-CAPTURE01
	// CORRECTION01 — request-scope correlation via AsyncLocalStorage.

	it("propagates correlationId + commandDigest through withV2CaptureContext", async () => {
		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest("git status")
		await withV2CaptureContext({ correlationId, commandDigest }, async () => {
			// Synchronous nested emit (the request would naturally
			// call into multiple modules on this side of an await).
			emitV2Capture({ codePoint: "approval.authorization.v2", data: { mode: "safe-only" } })
			// Asynchronous nested emit — exercises the AsyncLocalStorage
			// propagation through the await boundary (the load-bearing
			// property Node's AsyncLocalStorage is designed to provide).
			await new Promise<void>((resolve) => setImmediate(resolve))
			emitV2Capture({
				codePoint: "commandRisk.structured.v2",
				data: { structuredSource: "risk_v2_structured_promotion" },
			})
			emitV2Capture({ codePoint: "hostDecision.compose.v2", data: { finalDecision: "allow" } })
		})
		const lines = readFileSync(capturePath, "utf8").trim().split("\n")
		expect(lines).toHaveLength(3)
		for (const line of lines) {
			const rec = JSON.parse(line)
			expect(rec.correlationId).toBe(correlationId)
			expect(rec.commandDigest).toBe(commandDigest)
			expect(rec.scope).toBe("request")
		}
	})

	it("emits 'no-correlation' / 'no-input' when no request context is active", () => {
		// Outside any withV2CaptureContext (this is the default in
		// the beforeEach state). The emitter should fall through to
		// the legacy defaults instead of throwing or reading stale state.
		emitV2Capture({
			codePoint: "approval.authorization.v2",
			data: { mode: "manual" },
		})
		const line = JSON.parse(readFileSync(capturePath, "utf8").trim())
		expect(line.correlationId).toBe("no-correlation")
		expect(line.commandDigest).toBe("no-input")
		expect(line.scope).toBe("request")
	})

	it("process-scope events do NOT inherit the ambient request context", async () => {
		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest("git status")
		await withV2CaptureContext({ correlationId, commandDigest }, () => {
			// Simulate C1 firing DURING a request (e.g. helper
			// rebuild). Process scope MUST stay neutral.
			emitV2Capture({
				codePoint: "extensionRoot.resolve.v2",
				scope: "process",
				data: { resolved: true, extensionId: "s1onique.clinemm" },
			})
		})
		const line = JSON.parse(readFileSync(capturePath, "utf8").trim())
		expect(line.scope).toBe("process")
		expect(line.correlationId).toBe("no-request")
		expect(line.commandDigest).toBe("no-input")
	})

	it("interleaves two overlapping request contexts without bleed", async () => {
		// Two independent requests fired in parallel. Each MUST carry
		// only its own correlation/digest, even though both share the
		// same JSONL writer. AsyncLocalStorage is the load-bearing
		// mechanism here — this is exactly the race condition a
		// module-global mutable state would lose.
		const idA = newV2CorrelationId()
		const idB = newV2CorrelationId()
		const digestA = v2CommandDigest("request A")
		const digestB = v2CommandDigest("request B")

		async function emitUnder(id: string, digest: string, label: "A" | "B"): Promise<void> {
			await withV2CaptureContext({ correlationId: id, commandDigest: digest }, async () => {
				// Two emissions per request, separated by a microtask
				// hop so the runtime gets a chance to interleave.
				emitV2Capture({ codePoint: "approval.entry.v2", data: { label } })
				await new Promise<void>((resolve) => setImmediate(resolve))
				emitV2Capture({ codePoint: "approval.terminal.v2", data: { label } })
			})
		}

		// Fire both requests without awaiting between them.
		const [,] = await Promise.all([emitUnder(idA, digestA, "A"), emitUnder(idB, digestB, "B")])

		const lines = readFileSync(capturePath, "utf8").trim().split("\n")
		expect(lines).toHaveLength(4)
		const records = lines.map((l) => JSON.parse(l))
		for (const rec of records) {
			if (rec.data.label === "A") {
				expect(rec.correlationId).toBe(idA)
				expect(rec.commandDigest).toBe(digestA)
			} else {
				expect(rec.correlationId).toBe(idB)
				expect(rec.commandDigest).toBe(digestB)
			}
		}
	})

	it("getV2CaptureContext returns the ambient context inside withV2CaptureContext", async () => {
		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest("pwd")
		await withV2CaptureContext({ correlationId, commandDigest }, () => {
			const ctx = getV2CaptureContext()
			expect(ctx).toEqual({ correlationId, commandDigest })
		})
		// After the context scope ends, ambient lookup returns undefined.
		expect(getV2CaptureContext()).toBeUndefined()
	})

	// ----------------------------------------------------------------
	// ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01
	// capture.attach.v1 — diagnostic attachment marker.
	// ----------------------------------------------------------------

	it("emitCaptureAttach writes one process-scope capture.attach.v1 record", () => {
		expect(isV2CaptureEnabled()).toBe(true)
		emitCaptureAttach()
		const contents = readFileSync(capturePath, "utf8").trim().split("\n")
		expect(contents).toHaveLength(1)
		const rec = JSON.parse(contents[0])
		expect(rec.codePoint).toBe("capture.attach.v1")
		expect(rec.scope).toBe("process")
		expect(rec.correlationId).toBe("no-request")
		expect(rec.commandDigest).toBe("no-input")
		// runtimeInstanceId is a non-empty string (ULID tail).
		expect(typeof rec.data.runtimeInstanceId).toBe("string")
		expect(rec.data.runtimeInstanceId.length).toBeGreaterThan(0)
		// clineVersion must be present — either a real version or
		// the literal UNAVAILABLE marker (never missing).
		expect(typeof rec.data.clineVersion).toBe("string")
		expect(rec.data.clineVersion.length).toBeGreaterThan(0)
		// repoHead must be present — either a 40-char sha or
		// the literal UNAVAILABLE marker (never missing).
		expect(typeof rec.data.repoHead).toBe("string")
		expect(rec.data.repoHead.length).toBeGreaterThan(0)
		expect(typeof rec.data.emittedAt).toBe("string")
	})

	it("emitCaptureAttach never logs raw command text or PII", () => {
		const secretToken = "PII-SECRET-TOKEN-67890"
		// Even if the caller context somehow had a token, the
		// attachment record must not leak it: it carries only the
		// bounded identity fields above.
		emitCaptureAttach()
		const contents = readFileSync(capturePath, "utf8")
		expect(contents).not.toContain(secretToken)
		expect(contents).not.toContain("PII-SECRET")
	})

	it("emitCaptureAttach is a no-op when env flag is unset", () => {
		delete process.env.CLINEMM_CAPTURE_V2_PATH
		__resetV2CaptureForTests()
		// Should NOT throw, and should NOT create a file.
		expect(() => emitCaptureAttach()).not.toThrow()
		expect(existsSync(capturePath)).toBe(false)
	})
})

// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
// CORRECTION03 (cache-ordering repair) lives in
// `v2-capture.cache-ordering.test.ts` (a sibling file that imports
// `bun:test`) so the RED can run on `bun test` without the Node-based
// vitest harness.
