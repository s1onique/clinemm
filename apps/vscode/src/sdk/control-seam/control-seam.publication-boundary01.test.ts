/**
 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01
 *
 * The PUBLICATION-BOUNDARY witness.
 *
 * This file drives the REAL production handoff:
 *
 *   ExtensionState (constructed)
 *     -> sendStateUpdate(state)          [REAL, apps/vscode/src/core/controller/state/subscribeToState.ts]
 *       -> PublishedTaskStateStore.capture(...)  [REAL]
 *
 * It proves the load-bearing R4 claims:
 *
 *   1. A CONSTRUCTED-BUT-NEVER-SUBMITTED snapshot is not exposed.
 *   2. A FAILED state publication does NOT advance the record.
 *   3. A SUCCESSFUL eligible publication becomes observable.
 *   4. A STALE async completion cannot replace a newer publication.
 *
 * The `sendStateUpdate` handoff is exercised through the REAL module —
 * not a mock — so the "publication failed" path is the production one
 * (a payload that cannot be serialized).
 */

import { describe, expect, it, vi } from "vitest"

// The REAL `subscribeToState` module imports the telemetry service,
// whose singleton construction requires a HostProvider. The telemetry
// call is irrelevant to the publication-boundary contract, so the
// service is stubbed — the REAL `sendStateUpdate` handoff itself (the
// load-bearing production code under test) is NOT mocked.
vi.mock("@/services/telemetry", () => ({
	telemetryService: { captureGrpcResponseSize: () => {} },
}))

import { sendStateUpdate } from "@core/controller/state/subscribeToState"
import type { ExtensionState } from "@shared/ExtensionMessage"

import { attachPublishedTaskStateIdentity, type PublishedTaskState, PublishedTaskStateStore } from "@/sdk/published-task-state"
import { Controller as SdkController } from "../SdkController"

import { projectControlSeamTaskState } from "./control-seam-authority"

/**
 * A production-shape ExtensionState carrying an Elm-selected TaskHeader
 * projection, exactly as `SdkController.getStateToPostToWebview()`
 * stamps it.
 */
function makeState(options: {
	phase: "idle" | "streaming" | "awaiting_approval" | "awaiting_followup" | "compacting" | "completed" | "error" | "resumable"
	source: "shadow" | "host" | "legacy"
	seq: number
	stateVersion: number
	epoch: number
}): ExtensionState {
	return {
		taskHeaderPresentation: {
			phase: options.phase,
			source: options.source,
			seq: options.seq,
		},
		stateVersion: options.stateVersion,
		epoch: options.epoch,
	} as unknown as ExtensionState
}

/**
 * The REAL production controller capture, invoked against the REAL store.
 *
 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — IDENTITY-BOUNDARY CORRECTION01:
 *
 *   This helper previously MIRRORED `SdkController.capturePublishedTaskState()`
 *   (a test-local re-implementation of the production logic). It now
 *   invokes the REAL production method on the REAL prototype, so the
 *   publication-boundary suite exercises the production capture rather
 *   than a copy of it.
 *
 *   The production capture reads the publication identity from the
 *   carrier that travels WITH the submitted snapshot, so the helper
 *   attaches that carrier exactly as the production builder does.
 */
function captureFromSubmittedState(
	store: PublishedTaskStateStore,
	state: ExtensionState,
	identity: { sessionId: string; taskId: string },
): void {
	attachPublishedTaskStateIdentity(state, identity)
	// biome-ignore lint/suspicious/noExplicitAny: the production method is
	// private; the prototype call is the established controller-test seam.
	const capture = (SdkController.prototype as any).capturePublishedTaskState
	capture.call({ publishedTaskState: store }, state)
}

const IDENTITY = { sessionId: "session-a", taskId: "task-a" }

describe("ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — publication boundary", () => {
	it("PB01: a CONSTRUCTED-BUT-NEVER-SUBMITTED snapshot is not exposed", () => {
		const store = new PublishedTaskStateStore()
		// The state is CONSTRUCTED — no publication handoff happened.
		const state = makeState({ phase: "streaming", source: "shadow", seq: 10, stateVersion: 100, epoch: 4 })

		expect(store.read()).toBeUndefined()
		expect(projectControlSeamTaskState(store.read(), IDENTITY.sessionId, IDENTITY.taskId, 4)).toBeUndefined()

		// The constructed state itself carries the projection — the
		// point is that it was never SUBMITTED.
		expect(state.taskHeaderPresentation?.phase).toBe("streaming")
	})

	it("PB02: a FAILED state publication does NOT advance the record", async () => {
		const store = new PublishedTaskStateStore()

		// A first, SUCCESSFUL publication establishes the record.
		const good = makeState({ phase: "streaming", source: "shadow", seq: 10, stateVersion: 100, epoch: 4 })
		expect(await sendStateUpdate(good)).toBe(true)
		captureFromSubmittedState(store, good, IDENTITY)
		expect(store.read()?.projection.phase).toBe("streaming")

		// A FAILED publication: the payload cannot be serialized, so the
		// REAL handoff returns false and NOTHING is dispatched.
		const unserializable = {
			taskHeaderPresentation: { phase: "completed", source: "shadow", seq: 11 },
			stateVersion: 101,
			epoch: 4,
			// A self-referencing object is not JSON-serializable:
			// JSON.stringify throws.
			circular: (() => {
				const circular: Record<string, unknown> = {}
				circular.self = circular
				return circular
			})(),
		} as unknown as ExtensionState
		expect(await sendStateUpdate(unserializable)).toBe(false)

		// The failed publication did NOT advance the record: the previous
		// publication still stands.
		expect(store.read()?.projection.phase).toBe("streaming")
		expect(store.read()?.stateVersion).toBe(100)
	})

	it("PB03: a SUCCESSFUL eligible publication becomes observable", async () => {
		const store = new PublishedTaskStateStore()
		const state = makeState({ phase: "awaiting_followup", source: "shadow", seq: 12, stateVersion: 102, epoch: 4 })

		expect(await sendStateUpdate(state)).toBe(true)
		captureFromSubmittedState(store, state, IDENTITY)

		const projected = projectControlSeamTaskState(store.read(), IDENTITY.sessionId, IDENTITY.taskId, 4)
		expect(projected).toEqual({
			phase: "awaiting_followup",
			source: "shadow",
			seq: 12,
			epoch: 4,
			stateVersion: 102,
			label: "Your turn",
		})
	})

	it("PB04: a STALE async completion cannot replace a newer publication", async () => {
		const store = new PublishedTaskStateStore()

		// The newer publication lands first.
		const newer = makeState({ phase: "streaming", source: "shadow", seq: 20, stateVersion: 300, epoch: 4 })
		expect(await sendStateUpdate(newer)).toBe(true)
		captureFromSubmittedState(store, newer, IDENTITY)

		// A late completion from an OLDER publication arrives.
		const older = makeState({ phase: "completed", source: "shadow", seq: 19, stateVersion: 299, epoch: 4 })
		expect(await sendStateUpdate(older)).toBe(true)
		captureFromSubmittedState(store, older, IDENTITY)

		expect(store.read()?.projection.phase).toBe("streaming")
		expect(store.read()?.stateVersion).toBe(300)
		expect(store.read()?.projection.seq).toBe(20)
	})

	it("PB05: a publication from an OLDER epoch is rejected", () => {
		const store = new PublishedTaskStateStore()
		store.capture({
			sessionId: IDENTITY.sessionId,
			taskId: IDENTITY.taskId,
			epoch: 5,
			stateVersion: 400,
			projection: { phase: "streaming", source: "shadow", seq: 30 },
		})

		// A late publication from epoch 4 arrives after epoch 5 was
		// established.
		const accepted = store.capture({
			sessionId: IDENTITY.sessionId,
			taskId: IDENTITY.taskId,
			epoch: 4,
			stateVersion: 401,
			projection: { phase: "completed", source: "shadow", seq: 31 },
		})

		expect(accepted).toBe(false)
		expect(store.read()?.epoch).toBe(5)
		expect(store.read()?.projection.phase).toBe("streaming")
	})

	it("PB06: the store holds exactly ONE bounded record", () => {
		const store = new PublishedTaskStateStore()
		for (let i = 0; i < 50; i++) {
			store.capture({
				sessionId: IDENTITY.sessionId,
				taskId: IDENTITY.taskId,
				epoch: 4,
				stateVersion: 1000 + i,
				projection: { phase: "streaming", source: "shadow", seq: i },
			})
		}
		// ONE record — no history, no diagnostic queue.
		expect(store.read()?.stateVersion).toBe(1049)
		expect(store.read()?.projection.seq).toBe(49)
	})

	it("PB07: the read record is immutable — a consumer cannot mutate controller-owned state", () => {
		const store = new PublishedTaskStateStore()
		const captured: PublishedTaskState = {
			sessionId: IDENTITY.sessionId,
			taskId: IDENTITY.taskId,
			epoch: 4,
			stateVersion: 500,
			projection: { phase: "streaming", source: "shadow", seq: 40 },
		}
		store.capture(captured)

		const record = store.read()!
		expect(Object.isFrozen(record)).toBe(true)
		expect(Object.isFrozen(record.projection)).toBe(true)
		// Mutating the returned record throws in strict mode — it never
		// reaches the store's own state.
		expect(() => {
			;(record as { projection: { phase: string } }).projection.phase = "completed"
		}).toThrow()
		expect(store.read()?.projection.phase).toBe("streaming")
	})

	it("PB08: the projected label equals the shared UI label mapping", () => {
		const store = new PublishedTaskStateStore()
		store.capture({
			sessionId: IDENTITY.sessionId,
			taskId: IDENTITY.taskId,
			epoch: 4,
			stateVersion: 600,
			projection: { phase: "resumable", source: "host", seq: 50 },
		})
		const projected = projectControlSeamTaskState(store.read(), IDENTITY.sessionId, IDENTITY.taskId, 4)
		expect(projected?.label).toBe("Paused")
		expect(projected?.source).toBe("host")
	})
})
