/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-RUNTIME-SHADOW-REACTIVATION01
 * / RSR01-CORRECTION01 — production-seam RED at the production reinit
 * / resume attachment boundary.
 *
 * SCOPE (CORRECTION01)
 * -------------------
 * The reviewer correctly observed that RSR01 (commit a2d1dd7a2) supplied
 * the canonical reattachment itself via
 * `subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")`. That
 * proved the canonical-event → shadow bridge works IF a subscription
 * is attached to the active agent, but did NOT prove that production
 * performs that attachment on the resume path.
 *
 * Per the reviewer's directive:
 *
 *   "**CRITICALLY**: TEST MUST NOT CALL
 *    `subscribeCanonicalRuntimeEventsToShadow(...)` on behalf of
 *    production. Production must earn that call."
 *
 *   "**CALL**: actual `reinitExistingTaskFromId(...)` OR the smallest
 *    extracted production collaborator that executes the same branch
 *    unmodified."
 *
 * This file uses the second option: it extracts the literal body of
 * `SdkController.attachCanonicalRuntimeEventSubscription` and the
 * `reinitExistingTaskFromId` body via source-level brace-matching
 * (the same pattern used by the existing
 * `ask-response-epoch-turnstate-coherence.aretc01-c01-real-seam.test.ts`)
 * and executes it with `new Function(...)` against a harness with
 * production-typed deps. If production source drifts, the extraction
 * throws and the test fails — preserving the load-bearing invariant
 * "the test exercises the SAME branch unmodified."
 *
 * The single instance-identity asymmetry between the two production
 * resume paths (RSP01 line 36: "RESUME_RUNTIME_ATTACH" is added at
 * `reinitExistingTaskFromId`; `SdkFollowupCoordinator.resumeSessionFromTask`
 * never reaches it) is OUT OF SCOPE for this RED. It is the
 * next-step source-level finding documented in the board's
 * NEXT_RECOMMENDED_ACT.
 *
 * MINIMUM WITNESS
 * ---------------
 * Same as RSR01 §4 — `{event reached subscriber?, identity fence
 * accept?, writer invoked?, final shadow status}` — captured at
 * the production-extracted-body seam.
 *
 * Witnesses:
 *   W1 (POSITIVE CONTROL): production `attachCanonicalRuntimeEventSubscription`
 *      body executes when active session has matching sdkHost →
 *      `taskStateRuntimeEventsSubscription.attach` called exactly once
 *      with the (sdkHost, wiring, sessionId) triple.
 *   W2 (NO ACTIVE SESSION): production body executes when
 *      `getActiveSession()` returns undefined →
 *      `taskStateRuntimeEventsSubscription.attach` called with
 *      `sdkHost=undefined`. (Defensive; production today passes the
 *      result straight to the owner.)
 *   W3 (REINIT BODY, sessionId matches): production `reinitExistingTaskFromId`
 *      body executes against a harness where `getActiveSession()`
 *      returns `{sessionId: "A"}` and the controller's taskStart
 *      resolves with `taskId="A"` → `attachCanonicalRuntimeEventSubscription`
 *      IS called (count == 1).
 *   W4 (REINIT BODY, sessionId MISMATCHED): production body executes
 *      where the harness returns `{sessionId: "A"}` AFTER
 *      `taskStart.reinitExistingTaskFromId("B")` ran → `attach*` is
 *      NOT called (count == 0). Proves the `sessionId === taskId` fence.
 *   W5 (NO ACTIVE SESSION AFTER START): production body where
 *      `taskStart.reinitExistingTaskFromId("A")` runs but
 *      `getActiveSession()` returns undefined → `attach*` NOT called
 *      (the fence guard against superseding intents).
 *   W6 (STRUCTURAL GATE): production source contains the
 *      `attachCanonicalRuntimeEventSubscription` call inside the
 *      `if (sessionId && sessionId === taskId)` fence on this HEAD.
 *      Re-derives RSP01 F1-LC-4 / F1-LC-8 invariant.
 *
 * REPAIR BUDGET
 * -------------
 * This ACT does NOT repair. The witnesses above classify the
 * production reinit seam. If W3+W4+W6 are GREEN: D2 IS REJECTED at
 * the production reinit seam. Move to RSR02 (downstream
 * coordinator). If W6 is RED (fence missing): the production
 * source itself is the defect — repair at SdkController:1954-1955.
 * If W3 is RED (attach not called when fence passes): a different
 * defect — likely a dependency failure (taskStart.resolve throw,
 * taskTelemetry.startTask throw) — surface via the harness exception
 * capture and stop.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const SDK_CONTROLLER_PATH = path.resolve(__dirname, "..", "SdkController.ts")

function readSource(): string {
	return fs.readFileSync(SDK_CONTROLLER_PATH, "utf8")
}

function extractMethodBody(methodSignature: string): string {
	const source = readSource()
	const start = source.indexOf(methodSignature)
	if (start < 0) {
		throw new Error(`SdkController method signature not found: ${methodSignature}`)
	}
	const braceStart = source.indexOf("{", start)
	if (braceStart < 0) {
		throw new Error(`opening brace not found for ${methodSignature}`)
	}
	let depth = 0
	for (let i = braceStart; i < source.length; i++) {
		const ch = source[i]
		if (ch === "{") depth++
		else if (ch === "}") {
			depth--
			if (depth === 0) {
				return source.slice(braceStart, i + 1)
			}
		}
	}
	throw new Error(`matching closing brace not found for ${methodSignature}`)
}

// =========================================================================
// Production-body compile helpers. Each compiles the extracted body
// with `new Function(...)` against an explicit dep list. NO shadow
// copy — the body is the literal production source.
// =========================================================================

function compileAttachBody(): (
	this: {
		sessions: { getActiveSession: () => { sdkHost: unknown } | undefined }
		taskStateRuntimeEventsSubscription: {
			attach: (sdkHost: unknown, wiring: unknown, sessionId: string) => void
		}
		taskStateShadowWiring: unknown
	},
	sessionId: string,
) => void {
	const body = extractMethodBody("private attachCanonicalRuntimeEventSubscription(sessionId: string): void")
	const inner = body.slice(1, body.lastIndexOf("}"))
	// Wrap as a regular function (NOT arrow) so `this` is bound by
	// `.call(harness, sessionId)` and the body's `this.sessions...`
	// references resolve to the harness.
	return new Function(`"use strict"; return function attach(sessionId) { ${inner} };`)() as (
		this: {
			sessions: { getActiveSession: () => { sdkHost: unknown } | undefined }
			taskStateRuntimeEventsSubscription: {
				attach: (sdkHost: unknown, wiring: unknown, sessionId: string) => void
			}
			taskStateShadowWiring: unknown
		},
		sessionId: string,
	) => void
}

function compileReinitBody(): (this: ReinitHarness, taskId: string) => Promise<void> {
	const body = extractMethodBody("async reinitExistingTaskFromId(taskId: string): Promise<void>")
	const inner = body.slice(1, body.lastIndexOf("}"))
	// Wrap as an `async function` (NOT arrow) so `this` is bound by
	// `.call(harness, taskId)` and the body's `this.messageTranslatorState...`
	// references resolve to the harness. Also ensures `await` works.
	return new Function(`"use strict"; return async function reinit(taskId) { ${inner} };`)() as (
		this: ReinitHarness,
		taskId: string,
	) => Promise<void>
}

// =========================================================================
// Harness: minimal `this` context for the reinit body. Records call
// counts so witnesses can assert against them.
// =========================================================================

interface ReinitHarness {
	messageTranslatorState: { clearTurnOutcome: () => void }
	taskStart: { reinitExistingTaskFromId: (taskId: string) => Promise<void> }
	sessions: {
		getActiveSession: () => { sessionId: string; sdkHost: unknown } | undefined
	}
	stateManager: {
		getGlobalStateKey: (key: string) => Array<{ id: string; ts?: number }> | undefined
	}
	taskTelemetry: { startTask: ReturnType<typeof vi.fn> }
	// taskStateShadowWiring is the wiring the production body passes
	// to the canonical subscription. The harness surfaces it so the
	// spy can record the same opaque reference.
	taskStateShadowWiring: unknown
	attachRecoveryTelemetrySubscription: ReturnType<typeof vi.fn>
	attachCanonicalRuntimeEventSubscription: ReturnType<typeof vi.fn>
}

interface AttachCall {
	sdkHost: unknown
	wiring: unknown
	sessionId: string
}

interface ReinitCallRecord {
	attachCanonical: AttachCall[]
	attachRecovery: Array<{ sessionId: string }>
	startTask: Array<{ sessionId: string; persistedTs?: number }>
}

function makeReinitHarness(opts: {
	activeSession?: { sessionId: string; sdkHost?: unknown }
	history?: Array<{ id: string; ts?: number }>
}): { harness: ReinitHarness; record: ReinitCallRecord } {
	const record: ReinitCallRecord = {
		attachCanonical: [],
		attachRecovery: [],
		startTask: [],
	}
	const harness: ReinitHarness = {
		messageTranslatorState: { clearTurnOutcome: vi.fn() },
		taskStateShadowWiring: { tag: "wiring-stub" },
		taskStart: {
			reinitExistingTaskFromId: vi.fn(async (_taskId: string) => {
				// Production-side effect: on success the coordinator calls
				// startNewSession which sets `lifecycle.activeSession =
				// {sessionId, ...}`. The harness owns
				// `sessions.getActiveSession()` directly, so the test
				// sets the desired active session BEFORE awaiting.
			}),
		},
		sessions: {
			getActiveSession: vi.fn(() =>
				opts.activeSession
					? {
							sessionId: opts.activeSession.sessionId,
							sdkHost: opts.activeSession.sdkHost,
						}
					: undefined,
			),
		},
		stateManager: {
			getGlobalStateKey: vi.fn(() => opts.history),
		},
		taskTelemetry: {
			startTask: vi.fn((sessionId: string, persistedTs?: number) => {
				record.startTask.push({ sessionId, persistedTs })
			}),
		},
		attachRecoveryTelemetrySubscription: vi.fn((sessionId: string) => {
			record.attachRecovery.push({ sessionId })
		}),
		attachCanonicalRuntimeEventSubscription: vi.fn((sessionId: string) => {
			// The private SdkController method takes (sessionId) only.
			// The production body internally reads
			// `this.sessions.getActiveSession()?.sdkHost` and delegates
			// to the owner's `attach(sdkHost, wiring, sessionId)`. The
			// harness above emulates the OWNER's attach by reading the
			// live sdkHost. That gives the witness the full
			// (sdkHost, wiring, sessionId) triple observed at the
			// owner boundary — equivalent to what
			// `CanonicalRuntimeShadowSubscription.attach` would see.
			const sdkHost = harness.sessions.getActiveSession()?.sdkHost
			record.attachCanonical.push({
				sdkHost,
				wiring: harness.taskStateShadowWiring,
				sessionId,
			})
		}),
	}
	return { harness, record }
}

// =========================================================================
// Tests
// =========================================================================

describe("RSR01-CORRECTION01 — production reinit attachment discriminator", () => {
	let attachBody: ReturnType<typeof compileAttachBody>
	let reinitBody: ReturnType<typeof compileReinitBody>

	beforeEach(() => {
		attachBody = compileAttachBody()
		reinitBody = compileReinitBody()
	})

	// ---- W1 (POSITIVE): production attach body fires when active session has sdkHost ----
	it("RSR01-C01-W1 production attachCanonicalRuntimeEventSubscription body attaches when active session has sdkHost", () => {
		const attachSpy = vi.fn()
		const wiring = {}
		const sdkHost = { tag: "host-A" }
		const harness = {
			sessions: {
				getActiveSession: () => ({ sessionId: "A", sdkHost }),
			},
			taskStateRuntimeEventsSubscription: { attach: attachSpy },
			taskStateShadowWiring: wiring,
		}
		attachBody.call(harness, "A")
		expect(attachSpy).toHaveBeenCalledTimes(1)
		const [calledSdkHost, calledWiring, calledSessionId] = attachSpy.mock.calls[0] as [unknown, unknown, string]
		expect(calledSdkHost).toBe(sdkHost)
		expect(calledWiring).toBe(wiring)
		expect(calledSessionId).toBe("A")
	})

	// ---- W2 (PASSIVE): no active session ----
	it("RSR01-C01-W2 production attach body when no active session passes sdkHost=undefined to the owner", () => {
		const attachSpy = vi.fn()
		const wiring = {}
		const harness = {
			sessions: { getActiveSession: () => undefined },
			taskStateRuntimeEventsSubscription: { attach: attachSpy },
			taskStateShadowWiring: wiring,
		}
		attachBody.call(harness, "A")
		expect(attachSpy).toHaveBeenCalledTimes(1)
		const [calledSdkHost] = attachSpy.mock.calls[0] as [unknown, unknown, string]
		expect(calledSdkHost).toBeUndefined()
	})

	// ---- W3 (REINIT MATCH): production reinit body, sessionId === taskId → attach called ----
	it("RSR01-C01-W3 production reinitExistingTaskFromId body attaches canonical+recovery when sessionId === taskId", async () => {
		const { harness, record } = makeReinitHarness({
			activeSession: { sessionId: "A", sdkHost: { tag: "host-A" } },
			history: [{ id: "A", ts: 1700000000000 }],
		})
		await reinitBody.call(harness, "A")
		expect(record.attachCanonical.length).toBe(1)
		expect(record.attachCanonical[0].sessionId).toBe("A")
		expect(record.attachCanonical[0].sdkHost).toEqual({ tag: "host-A" })
		expect(record.attachCanonical[0].wiring).toEqual({ tag: "wiring-stub" })
		expect(record.attachRecovery.length).toBe(1)
		expect(record.attachRecovery[0].sessionId).toBe("A")
		expect(record.startTask.length).toBe(1)
		expect(record.startTask[0].sessionId).toBe("A")
		expect(record.startTask[0].persistedTs).toBe(1700000000000)
	})

	// ---- W4 (REINIT MISMATCH): production reinit body, sessionId !== taskId → attach NOT called ----
	it("RSR01-C01-W4 production reinitExistingTaskFromId body SKIPS attach when active sessionId !== taskId", async () => {
		const { harness, record } = makeReinitHarness({
			activeSession: { sessionId: "Z-different", sdkHost: { tag: "host-Z" } },
			history: [{ id: "A", ts: 1700000000000 }],
		})
		await reinitBody.call(harness, "A")
		expect(record.attachCanonical.length).toBe(0)
		expect(record.attachRecovery.length).toBe(0)
		expect(record.startTask.length).toBe(0)
	})

	// ---- W5 (REINIT NO ACTIVE SESSION): production reinit body when getActiveSession undefined → attach NOT called ----
	it("RSR01-C01-W5 production reinitExistingTaskFromId body SKIPS attach when no active session", async () => {
		const { harness, record } = makeReinitHarness({
			activeSession: undefined,
			history: [{ id: "A", ts: 1700000000000 }],
		})
		await reinitBody.call(harness, "A")
		expect(record.attachCanonical.length).toBe(0)
		expect(record.attachRecovery.length).toBe(0)
	})

	// ---- W6 (STRUCTURAL GATE): production source's attach is INSIDE the sessionId===taskId fence ----
	it("RSR01-C01-W6 production source places attachCanonicalRuntimeEventSubscription inside the sessionId===taskId fence", () => {
		const source = readSource()
		const sigIdx = source.indexOf("async reinitExistingTaskFromId(taskId: string): Promise<void>")
		expect(sigIdx).toBeGreaterThanOrEqual(0)
		const body = extractMethodBody("async reinitExistingTaskFromId(taskId: string): Promise<void>")
		const fenceOpen = body.indexOf("if (sessionId && sessionId === taskId) {")
		expect(fenceOpen).toBeGreaterThanOrEqual(0)
		let depth = 0
		let fenceEnd = -1
		for (let i = fenceOpen; i < body.length; i++) {
			const ch = body[i]
			if (ch === "{") depth++
			else if (ch === "}") {
				depth--
				if (depth === 0) {
					fenceEnd = i
					break
				}
			}
		}
		expect(fenceEnd).toBeGreaterThan(fenceOpen)
		const fenceBody = body.slice(fenceOpen, fenceEnd + 1)
		expect(fenceBody).toMatch(/this\.attachCanonicalRuntimeEventSubscription\(sessionId\)/)
		expect(fenceBody).toMatch(/this\.attachRecoveryTelemetrySubscription\(sessionId\)/)
	})

	// ---- W7 (STRESS): a SECOND reinit with the SAME sessionId is re-attached (idempotency lives in the owner, not the body) ----
	it("RSR01-C01-W7 production reinit body called twice with same taskId produces two attach calls (body never owns idempotency)", async () => {
		const { harness, record } = makeReinitHarness({
			activeSession: { sessionId: "A", sdkHost: { tag: "host-A" } },
			history: [{ id: "A", ts: 1700000000000 }],
		})
		await reinitBody.call(harness, "A")
		await reinitBody.call(harness, "A")
		expect(record.attachCanonical.length).toBe(2)
		expect(record.attachCanonical.every((c) => c.sessionId === "A")).toBe(true)
	})
})
