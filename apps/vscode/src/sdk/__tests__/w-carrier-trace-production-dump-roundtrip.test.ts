/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-ninth-pass) — production-dump roundtrip test.
 *
 * Per the operator's P0 fix directive: the missing edge is
 *
 *   operator action
 *   -> VS Code command
 *   -> dumpWCarrierTrace()
 *   -> file
 *
 * This test exercises the PRODUCTION host-side dump entry point
 * (`dumpExtensionSideWCarrierTraceDiagnostic`) — the same
 * function wired to `cline.debug.dumpWCarrierTrace` in
 * `extension.ts:activate` — NOT the lower-level
 * `dumpWCarrierTrace` (which the previous test suites already
 * cover). The discriminator: real operator-flow JSONL roundtrip
 * via the entry point that production calls.
 */

import { mkdtempSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyWCarrierTraceDiagnosticProfile } from "../dogfood-diagnostic-profile"
import {
	_resetWCarrierTrace,
	dumpExtensionSideWCarrierTraceDiagnostic,
	recordWCarrierTrace,
	type WCarrierTraceContext,
} from "../w-carrier-trace-runtime"

describe("dumpExtensionSideWCarrierTraceDiagnostic — production roundtrip", () => {
	let dirs: string[] = []
	beforeEach(() => {
		_resetWCarrierTrace()
	})
	afterEach(async () => {
		await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
		dirs = []
	})

	function makeContext(): { ctx: WCarrierTraceContext; dir: string } {
		const dir = mkdtempSync(join(tmpdir(), "w-carrier-prod-roundtrip-"))
		dirs.push(dir)
		const ctx: WCarrierTraceContext = {
			workspaceState: {
				get: () => undefined as never,
				update: async () => {},
			},
			globalStorageUri: { fsPath: dir },
			subscriptions: [],
		}
		return { ctx, dir }
	}

	it("dogfood profile ON -> record carrier_observe + state_publish -> production dump command -> JSONL contains both exact records", async () => {
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
		// (twenty-ninth-pass) — production-flow mirror: the operator
		// activates dogfood (no env juggling), the SdkController
		// observer + producer wires the trace observer and forwarder,
		// events flow into the buffer; the operator invokes the
		// `cline.debug.dumpWCarrierTrace` command which calls
		// `dumpExtensionSideWCarrierTraceDiagnostic`; the JSONL
		// file at `<globalStorageUri>/w-carrier-trace.jsonl` MUST
		// contain BOTH records exactly.

		// 1) Activate dogfood (no env).
		applyWCarrierTraceDiagnosticProfile({}, true)

		// 2) Build a real temporary context.
		const { ctx, dir } = makeContext()

		// 3) SdkController observer fires on working-context-state-changed.
		recordWCarrierTrace(ctx, {
			t: 100,
			kind: "carrier_observe",
			sessionId: "session-q1q2",
			carrierW: 4242,
			eventType: "working-context-state-changed",
			snapshotW: 4242,
		})

		// 4) SdkController producer fires after projection.
		recordWCarrierTrace(ctx, {
			t: 200,
			kind: "state_publish",
			sessionId: "session-q1q2",
			publishedW: 4242,
		})

		// 5) Operator invokes the production command handler.
		const filePath = await dumpExtensionSideWCarrierTraceDiagnostic(ctx)

		// 6) JSONL roundtrip equality: both records present, exact.
		expect(filePath).toBe(join(dir, "w-carrier-trace.jsonl"))
		const lines = readFileSync(filePath, "utf8").trim().split("\n")
		expect(lines).toHaveLength(2)
		expect(JSON.parse(lines[0])).toEqual({
			t: 100,
			kind: "carrier_observe",
			sessionId: "session-q1q2",
			carrierW: 4242,
			eventType: "working-context-state-changed",
			snapshotW: 4242,
		})
		expect(JSON.parse(lines[1])).toEqual({
			t: 200,
			kind: "state_publish",
			sessionId: "session-q1q2",
			publishedW: 4242,
		})
	})

	it("explicit env override-down -> production dump command still exports the (OFF-seam-bailed) buffer", async () => {
		// 1) Activate dogfood, record one sentinel.
		applyWCarrierTraceDiagnosticProfile({}, true)
		const { ctx, dir } = makeContext()
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "state_publish",
			sessionId: "s",
			publishedW: 1,
		})
		// 2) Flip to OFF via env override.
		applyWCarrierTraceDiagnosticProfile({ CLINEMM_W_TRACE: "0" }, true)
		// 3) Try to record after OFF — recorder MUST bail.
		recordWCarrierTrace(ctx, {
			t: 2,
			kind: "state_publish",
			sessionId: "s",
			publishedW: 2,
		})
		// 4) Operator invokes the production dump command — file
		//    persists the only the first sentinel.
		const filePath = await dumpExtensionSideWCarrierTraceDiagnostic(ctx)
		expect(filePath).toBe(join(dir, "w-carrier-trace.jsonl"))
		const lines = readFileSync(filePath, "utf8").trim().split("\n")
		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0]).publishedW).toBe(1)
	})
})
