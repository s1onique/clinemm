/**
 * ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01-CORRECTION01
 *
 * SdkController-owned approval-callback diagnostic probes.
 *
 * The two production probes under test are:
 *
 *   approval.sdk-controller.entry.v2
 *     - emitted at the EARLIEST entry of the callback returned by
 *       `buildSdkControllerEvaluateCommandToolApproval`, BEFORE
 *       `isCommandTool` and BEFORE the `await resolveHostAuthorization`.
 *     - `data`: { sessionId, toolName }
 *
 *   approval.sdk-controller.authorization.v2
 *     - emitted immediately AFTER `resolveHostAuthorization` returns
 *       and BEFORE the canonical composer / parser-helper pipeline
 *       consumes the authorization.
 *     - `data`: { sessionId, resolvedMode, sandboxMode, mandatorySeatbelt, pathAuthorityEvidenceOk }
 *
 * These probes sit INSIDE the
 * `buildSdkControllerEvaluateCommandToolApproval` factory, so the
 * test exercises the REAL factory with a fake helper (mirroring
 * `sdk-interaction-coordinator.parser-helper.test.ts`).
 *
 * The ambient V2 capture context (correlationId + commandDigest) is
 * provided by `withV2CaptureContext(...)` in the tests, mirroring
 * the `SdkInteractionCoordinator` production wiring. Without that
 * wrapper, the emitter falls back to "no-correlation" / "no-input"
 * and the same-correlationId invariant (T3) cannot be pinned.
 *
 * Default-off contract: the env flag `CLINEMM_CAPTURE_V2_PATH` must
 * be UNSET in production. When unset, every emit is a no-op and the
 * T4 / T5 invariants hold without ever touching the file system.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { buildSdkControllerEvaluateCommandToolApproval } from "./SdkController"
import {
	__resetV2CaptureForTests,
	isV2CaptureEnabled,
	newV2CorrelationId,
	v2CommandDigest,
	withV2CaptureContext,
} from "./v2-capture"

type FakeHelper = { invoke(toolInput: unknown): Promise<unknown> }

function makeHelperReturningNull(): FakeHelper {
	// Mirrors the production default where the helper's binary is
	// not bundled: invoke returns null, V2 stays dormant, the
	// canonical composer produces a V1 fallthrough decision. The
	// probes under test are observable regardless.
	return { invoke: async (_) => null }
}

describe("ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01-CORRECTION01 / SdkController approval-callback probes", () => {
	let tmpDir: string
	let capturePath: string
	let originalEnv: string | undefined

	beforeEach(() => {
		originalEnv = process.env.CLINEMM_CAPTURE_V2_PATH
		tmpDir = mkdtempSync(join(tmpdir(), "sdkctrl-capture-"))
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

	function makeCallback(_opts?: { sessionId: string }) {
		// Production-shape authorization with `mode: "all"` and the
		// Seatbelt envelope stamp already applied. This is the
		// "auto-approved / Seatbelt-required" composition the
		// operator runs in the GOOD sibling case.
		const auth = commandHostAuthorization({
			mode: "all",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			mandatorySeatbelt: true,
		})
		const helper: FakeHelper = makeHelperReturningNull()
		const callback = buildSdkControllerEvaluateCommandToolApproval({
			resolveHostAuthorization: async (_toolName, requestInput) => ({
				hostAuthorization: auth,
				toolInput: requestInput,
			}),
			getHelper: () => helper as never,
		})
		return { callback, auth }
	}

	// -----------------------------------------------------------------
	// T1 - outer probe emitted on callback invocation
	// -----------------------------------------------------------------
	it("T1: callback invoked -> outer probe emitted", async () => {
		expect(isV2CaptureEnabled()).toBe(true)
		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest("pwd; pwd")
		const { callback } = makeCallback({ sessionId: "session-T1" })

		await withV2CaptureContext({ correlationId, commandDigest }, async () => {
			await callback({ sessionId: "session-T1", toolName: "run_commands", input: { command: "pwd; pwd" } })
		})

		const lines = readFileSync(capturePath, "utf8").trim().split("\n")
		const outer = lines.map((l) => JSON.parse(l)).find((r) => r.codePoint === "approval.sdk-controller.entry.v2")
		expect(outer).toBeDefined()
		expect(outer.scope).toBe("request")
		expect(outer.correlationId).toBe(correlationId)
		expect(outer.commandDigest).toBe(commandDigest)
		expect(outer.data.sessionId).toBe("session-T1")
		expect(outer.data.toolName).toBe("run_commands")
	})

	// -----------------------------------------------------------------
	// T2 - inner probe emitted after the outer, when resolveHostAuthorization succeeds
	// -----------------------------------------------------------------
	it("T2: resolveHostAuthorization succeeds -> inner probe emitted AFTER outer", async () => {
		expect(isV2CaptureEnabled()).toBe(true)
		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest("pwd; pwd")
		const { callback } = makeCallback({ sessionId: "session-T2" })

		await withV2CaptureContext({ correlationId, commandDigest }, async () => {
			await callback({ sessionId: "session-T2", toolName: "run_commands", input: { command: "pwd; pwd" } })
		})

		const records = readFileSync(capturePath, "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l))

		const outer = records.find((r) => r.codePoint === "approval.sdk-controller.entry.v2")
		const inner = records.find((r) => r.codePoint === "approval.sdk-controller.authorization.v2")

		expect(outer).toBeDefined()
		expect(inner).toBeDefined()
		// The inner probe MUST come after the outer probe in the
		// request's emission order. The JSONL writer is append-only
		// so position-in-file is a sufficient proxy.
		const outerIdx = records.indexOf(outer)
		const innerIdx = records.indexOf(inner)
		expect(innerIdx).toBeGreaterThan(outerIdx)

		// Carries the documented fields, no command text, no paths,
		// no env dump.
		expect(inner.data.sessionId).toBe("session-T2")
		expect(typeof inner.data.resolvedMode).toBe("string")
		// sandboxMode is the live read; it can be either
		// "seatbelt-experimental" (darwin + unset) or "undefined"
		// (non-darwin / explicit "off"). Either is valid; just pin
		// the field is present and is a string.
		expect(typeof inner.data.sandboxMode).toBe("string")
		expect(typeof inner.data.mandatorySeatbelt).toBe("boolean")
		expect(typeof inner.data.pathAuthorityEvidenceOk).toBe("boolean")
		// No leakage.
		const flat = JSON.stringify(inner.data)
		expect(flat).not.toContain("pwd; pwd")
		expect(flat).not.toContain("PII")
	})

	// -----------------------------------------------------------------
	// T3 - both probes share the same correlationId/commandDigest
	// -----------------------------------------------------------------
	it("T3: auto-approved / Seatbelt-required request -> both probes share the same correlationId/commandDigest", async () => {
		expect(isV2CaptureEnabled()).toBe(true)
		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest("rm -rf $HOME")
		const { callback, auth } = makeCallback({ sessionId: "session-T3" })

		await withV2CaptureContext({ correlationId, commandDigest }, async () => {
			await callback({
				sessionId: "session-T3",
				toolName: "run_commands",
				input: { command: "rm -rf $HOME" },
			})
		})

		const records = readFileSync(capturePath, "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l))
		const outer = records.find((r) => r.codePoint === "approval.sdk-controller.entry.v2")
		const inner = records.find((r) => r.codePoint === "approval.sdk-controller.authorization.v2")
		expect(outer).toBeDefined()
		expect(inner).toBeDefined()
		// Same correlationId and commandDigest on BOTH probes.
		expect(outer.correlationId).toBe(correlationId)
		expect(inner.correlationId).toBe(correlationId)
		expect(outer.commandDigest).toBe(commandDigest)
		expect(inner.commandDigest).toBe(commandDigest)
		// Inner probe records the live authorization state at the
		// seam. Our test fixture stamps mandatorySeatbelt=true and
		// mode="all", so the probe MUST reflect that.
		expect(inner.data.resolvedMode).toBe(auth.mode)
		expect(inner.data.mandatorySeatbelt).toBe(true)
	})

	// -----------------------------------------------------------------
	// T4 - capture disabled -> zero state-semantic delta, no file output
	// -----------------------------------------------------------------
	it("T4: capture disabled -> zero state-semantic delta, no file output, approval semantics unchanged", async () => {
		delete process.env.CLINEMM_CAPTURE_V2_PATH
		__resetV2CaptureForTests()
		expect(isV2CaptureEnabled()).toBe(false)

		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest("pwd; pwd")
		const { callback, auth } = makeCallback({ sessionId: "session-T4" })

		const result = await withV2CaptureContext({ correlationId, commandDigest }, async () =>
			callback({ sessionId: "session-T4", toolName: "run_commands", input: { command: "pwd; pwd" } }),
		)

		// No file created at the configured path. When capture is
		// disabled, the file is never created, so readFileSync may
		// throw ENOENT. We treat absence-as-zero-records.
		let lines: string[] = []
		try {
			lines = readFileSync(capturePath, "utf8")
				.trim()
				.split("\n")
				.filter((l) => l.length > 0)
		} catch {
			lines = []
		}
		expect(lines).toHaveLength(0)

		// Approval semantics UNCHANGED. The fixture uses
		// `mode: "all" + mandatorySeatbelt: true`, so the canonical
		// composer yields ALLOW with `host_mode_all_seatbelt_required`
		// — this is the "auto-approved / Seatbelt-required"
		// composition the operator runs in the GOOD sibling case.
		// The exact decision is the same as the pre-probe factory
		// would have produced — the probes are observational only
		// and must not branch on capture state.
		expect(result).toBeDefined()
		expect(result?.approved).toBe(true)
		expect(result?.decision?.kind).toBe("allow")
		expect(result?.decision?.source).toBe("host_mode_all_seatbelt_required")
		expect(result?.mandatorySeatbeltExecution).toBe(true)
		expect(result?.hostAuthorization?.mode).toBe(auth.mode)
		expect(result?.hostAuthorization?.mandatorySeatbelt).toBe(true)
	})

	// -----------------------------------------------------------------
	// T5 - capture writer throws -> approval semantics unchanged
	// -----------------------------------------------------------------
	it("T5: capture writer throws -> approval semantics unchanged", async () => {
		// Point at a path whose parent does not exist. appendFileSync
		// will fail with ENOENT; the emit must swallow it and the
		// approval pipeline must produce the same result as if
		// capture were disabled.
		const badPath = join(tmpDir, "missing-parent", "deep", "capture.jsonl")
		process.env.CLINEMM_CAPTURE_V2_PATH = badPath
		__resetV2CaptureForTests()
		expect(isV2CaptureEnabled()).toBe(true)

		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest("pwd; pwd")
		const { callback, auth } = makeCallback({ sessionId: "session-T5" })

		const result = await withV2CaptureContext({ correlationId, commandDigest }, async () => {
			// Emits will hit a write that throws. They must NOT
			// bubble out of the callback.
			return await callback({
				sessionId: "session-T5",
				toolName: "run_commands",
				input: { command: "pwd; pwd" },
			})
		})

		// Decision shape is identical to T4 — capture failure is
		// invisible to the approval pipeline.
		expect(result).toBeDefined()
		expect(result?.approved).toBe(true)
		expect(result?.decision?.kind).toBe("allow")
		expect(result?.decision?.source).toBe("host_mode_all_seatbelt_required")
		expect(result?.mandatorySeatbeltExecution).toBe(true)
		expect(result?.hostAuthorization?.mode).toBe(auth.mode)
		expect(result?.hostAuthorization?.mandatorySeatbelt).toBe(true)

		// No file was created (parent missing, write failed silently).
		let exists = false
		try {
			readFileSync(badPath, "utf8")
			exists = true
		} catch {
			exists = false
		}
		expect(exists).toBe(false)
	})
})
