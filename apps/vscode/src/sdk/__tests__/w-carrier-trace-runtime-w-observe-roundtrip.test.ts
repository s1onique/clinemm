/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (thirtieth-pass) — end-to-end roundtrip test for the
 * upstream W discriminator.
 *
 * Pins that a `runtime_w_observe` row produced by
 * `installRuntimeWTraceObserver` flows into the
 * host-side `recordWCarrierTrace` JSONL buffer (and the
 * resulting dump file) under the existing
 * `isWCarrierTraceEnabled` module seam. Mirrors the
 * `w-carrier-trace-production-dump-roundtrip` pattern for
 * the new record kind.
 *
 * The seam is OFF by default; the test enables it via
 * `applyWCarrierTraceDiagnosticProfile({}, true)` (dogfood
 * profile = ON).
 *
 * The test does NOT exercise the live `AgentRuntime` path;
 * it records one synthetic `runtime_w_observe` row and
 * asserts that:
 *   1. the record appends when the seam is ON
 *   2. the dump command produces a JSONL file containing
 *      exactly that record's fields
 *   3. the env-override-down (CLINEMM_W_TRACE=0) flip
 *      silences new records while preserving existing
 *      buffer contents
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

describe("WCarrierTraceRecord.runtime_w_observe - production roundtrip", () => {
	let dirs: string[] = []
	beforeEach(() => {
		_resetWCarrierTrace()
	})
	afterEach(async () => {
		await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
		dirs = []
	})

	function makeContext(): { ctx: WCarrierTraceContext; dir: string } {
		const dir = mkdtempSync(join(tmpdir(), "w-carrier-runtime-w-"))
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

	it("dogfood profile ON -> record runtime_w_observe -> production dump command -> JSONL contains the upstream discriminator row", async () => {
		// Activate dogfood (no env juggling).
		applyWCarrierTraceDiagnosticProfile({}, true)

		const { ctx, dir } = makeContext()

		// AgentRuntime fires one runtime_w_observe per
		// prepareTurnForModelRequest invocation. Record one
		// synthetic row that mirrors the production payload.
		const t = 100
		recordWCarrierTrace(ctx, {
			t,
			kind: "runtime_w_observe",
			sessionId: "session-1788420156838_rtl5d",
			iteration: 1,
			resultKind: "prepare_turn",
			prepareTurnW: 4242,
			runtimeW: 4242,
			previousRuntimeW: undefined,
			willEmit: true,
			emitResolved: true,
		})

		// Operator invokes the production command handler.
		const filePath = await dumpExtensionSideWCarrierTraceDiagnostic(ctx)
		expect(filePath).toBe(join(dir, "w-carrier-trace.jsonl"))

		// JSONL roundtrip equality: the upstream discriminator
		// row is present, exact, with all A1..A4 fields.
		const lines = readFileSync(filePath, "utf8").trim().split("\n")
		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0])).toEqual({
			t,
			kind: "runtime_w_observe",
			sessionId: "session-1788420156838_rtl5d",
			iteration: 1,
			resultKind: "prepare_turn",
			prepareTurnW: 4242,
			runtimeW: 4242,
			previousRuntimeW: undefined,
			willEmit: true,
			emitResolved: true,
		})
	})

	it("runtime_w_observe + carrier_observe + state_publish all co-exist in one JSONL file (no shape contamination)", async () => {
		applyWCarrierTraceDiagnosticProfile({}, true)
		const { ctx } = makeContext()

		// All three record kinds in causal order:
		//   1. runtime_w_observe (upstream)
		//   2. carrier_observe (host capture, downstream)
		//   3. state_publish (webview publication, downstream)
		recordWCarrierTrace(ctx, {
			t: 100,
			kind: "runtime_w_observe",
			sessionId: "session-mix",
			iteration: 1,
			resultKind: "prepare_turn",
			prepareTurnW: 4242,
			runtimeW: 4242,
			previousRuntimeW: undefined,
			willEmit: true,
			emitResolved: true,
		})
		recordWCarrierTrace(ctx, {
			t: 200,
			kind: "carrier_observe",
			sessionId: "session-mix",
			carrierW: 4242,
			eventType: "working-context-state-changed",
			snapshotW: 4242,
		})
		recordWCarrierTrace(ctx, {
			t: 300,
			kind: "state_publish",
			sessionId: "session-mix",
			publishedW: 4242,
		})

		const filePath = await dumpExtensionSideWCarrierTraceDiagnostic(ctx)
		const lines = readFileSync(filePath, "utf8").trim().split("\n")
		expect(lines).toHaveLength(3)

		// Each kind retains its discriminator field and
		// does NOT bleed shape into the others.
		const upstream = JSON.parse(lines[0])
		expect(upstream.kind).toBe("runtime_w_observe")
		expect(upstream.prepareTurnW).toBe(4242)
		expect(upstream.runtimeW).toBe(4242)
		expect(upstream.willEmit).toBe(true)
		expect(upstream.emitResolved).toBe(true)

		const carrier = JSON.parse(lines[1])
		expect(carrier.kind).toBe("carrier_observe")
		expect(carrier.carrierW).toBe(4242)
		expect(carrier.snapshotW).toBe(4242)

		const publisher = JSON.parse(lines[2])
		expect(publisher.kind).toBe("state_publish")
		expect(publisher.publishedW).toBe(4242)
	})

	it("explicit env override-down -> new runtime_w_observe records bail; existing buffer preserved", async () => {
		applyWCarrierTraceDiagnosticProfile({}, true)
		const { ctx } = makeContext()

		// Record one sentinel runtime_w_observe with seam ON.
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "runtime_w_observe",
			sessionId: "session-pre",
			iteration: 1,
			resultKind: "prepare_turn",
			prepareTurnW: 100,
			runtimeW: 100,
			previousRuntimeW: undefined,
			willEmit: true,
			emitResolved: true,
		})

		// Flip the seam OFF via env override.
		applyWCarrierTraceDiagnosticProfile({ CLINEMM_W_TRACE: "0" }, true)

		// Try to record a second runtime_w_observe — recorder
		// must bail (no append).
		recordWCarrierTrace(ctx, {
			t: 2,
			kind: "runtime_w_observe",
			sessionId: "session-post",
			iteration: 2,
			resultKind: "prepare_turn",
			prepareTurnW: 200,
			runtimeW: 200,
			previousRuntimeW: 100,
			willEmit: true,
			emitResolved: true,
		})

		const filePath = await dumpExtensionSideWCarrierTraceDiagnostic(ctx)
		const lines = readFileSync(filePath, "utf8").trim().split("\n")
		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0]).prepareTurnW).toBe(100)
	})
})
