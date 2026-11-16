/**
 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01
 *
 * RED -> GREEN witnesses for the MCP task-header projection.
 *
 * The load-bearing witnesses drive the REAL seams:
 *
 *   - the REAL `PublishedTaskStateStore` (the controller-owned bounded
 *     record captured at the publication handoff),
 *   - the REAL `ControlSeamAuthority` projection,
 *   - the REAL `ControlSeamServer` AF_UNIX listener,
 *   - the REAL `ControlSeamClient` NDJSON transport.
 *
 * They do NOT merely serialize an object. R4 additionally drives the
 * REAL `sendStateUpdate` handoff (the publication boundary) and asserts
 * that a constructed-but-never-submitted snapshot is not observable.
 *
 * CONTRACT UNDER TEST
 *
 *   `clinemm_get_run` gains an OPTIONAL `taskState` property that
 *   describes the LAST ELIGIBLE HOST-SUBMITTED TaskHeader presentation:
 *
 *     { phase, source, seq, epoch, stateVersion, label }
 *
 *   - `running` is the SDK agent-turn mirror. It is INDEPENDENT of the
 *     header phase. `running: false` does NOT mean completed.
 *   - `taskState` is ABSENT when no valid identity-bound published
 *     projection exists. It is never a fabricated `idle`.
 *   - `taskState.phase` is the EXACT canonical `TurnPhase` selected by
 *     the Elm task-header authority. MCP never re-derives it.
 *   - `taskState.seq` (presentation/turn-state sequence domain) and
 *     `taskState.stateVersion` (publication sequence domain) are DIFFERENT
 *     clocks and are never compared against each other.
 */

import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import type { TaskHeaderPresentationProjection, TurnPhase } from "@shared/ExtensionMessage"
import { taskHeaderPhaseLabel } from "@shared/task-header-state-label"
import { afterEach, describe, expect, it } from "vitest"

import { type PublishedTaskState, PublishedTaskStateStore } from "@/sdk/published-task-state"

import type { ControlSeamAuthority } from "./control-seam-authority"
import { readControlSeamRunIdentity } from "./control-seam-authority"
import { ControlSeamClient, connectControlSeam } from "./control-seam-client"
import { isControlSeamRunIdentity } from "./control-seam-protocol"
import { ControlSeamServer } from "./control-seam-server"

const openServers: ControlSeamServer[] = []

afterEach(async () => {
	while (openServers.length > 0) {
		await openServers.pop()?.dispose()
	}
})

interface Fixture {
	readonly sessionId?: string
	readonly taskId?: string
	readonly isRunning?: boolean
	readonly queuedPromptCount?: number
	readonly published?: PublishedTaskState
	/** The controller's current conversation epoch. */
	readonly epoch?: number
}

/**
 * Build the REAL authority projection over a fixture. The published
 * record is read through the SAME closure the controller installs.
 */
function makeAuthority(fixture: Fixture): ControlSeamAuthority {
	return {
		readActiveSessionId: () => fixture.sessionId,
		readActiveTaskId: () => fixture.taskId,
		readIsRunning: () => fixture.isRunning ?? false,
		readQueuedPromptCount: () => fixture.queuedPromptCount ?? 0,
		readRuntimeSnapshot: () => undefined,
		readPublishedTaskState: () => fixture.published,
		readCurrentEpoch: () => fixture.epoch ?? 4,
	}
}

/** A published record with the given projection, bound to one identity. */
function published(
	projection: TaskHeaderPresentationProjection,
	overrides: { sessionId?: string; taskId?: string; epoch?: number; stateVersion?: number } = {},
): PublishedTaskState {
	return {
		sessionId: overrides.sessionId ?? "session-a",
		taskId: overrides.taskId ?? "task-a",
		epoch: overrides.epoch ?? 4,
		stateVersion: overrides.stateVersion ?? 2001,
		projection: { ...projection },
	}
}

/** Start the REAL AF_UNIX listener and return a connected REAL client. */
async function startSeam(fixture: Fixture) {
	const dir = mkdtempSync(join("/tmp", "cs-taskstate-"))
	const socketPath = join(dir, "control.sock")
	const tokenPath = join(dir, "token")
	const server = new ControlSeamServer({
		authority: makeAuthority(fixture),
		extensionVersion: "0.0.0-task-state-test",
		platform: "darwin",
		socketPath,
		tokenPath,
		dirPath: dir,
		forceEnabled: true,
	})
	openServers.push(server)
	const handle = await server.start()
	const socket = await connectControlSeam(socketPath)
	const client = new ControlSeamClient(handle!.token)
	client.setWriter((payload) => socket?.write(payload))
	client.attach(socket!)
	return { client, socket }
}

// ===========================================================================
// R1 — Active turn versus published phase
// ===========================================================================

describe("ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — R1 active turn versus published phase", () => {
	it("R1-1: running=false with a published streaming phase reports the EXACT published phase", async () => {
		const { client, socket } = await startSeam({
			sessionId: "session-a",
			taskId: "task-a",
			isRunning: false,
			queuedPromptCount: 0,
			published: published({ phase: "streaming", source: "shadow", seq: 1957 }),
		})

		const response = await client.request("clinemm_get_run")

		expect(response.ok).toBe(true)
		const result = response.result as {
			running: boolean
			taskState?: {
				phase: TurnPhase
				source: string
				seq: number
				epoch: number
				stateVersion: number
				label?: string
			}
		}
		// The runtime mirror is preserved verbatim.
		expect(result.running).toBe(false)
		// The phase is NOT coerced to completed.
		expect(result.taskState?.phase).toBe("streaming")
		expect(result.taskState?.source).toBe("shadow")
		expect(result.taskState?.seq).toBe(1957)
		expect(result.taskState?.epoch).toBe(4)
		expect(result.taskState?.stateVersion).toBe(2001)
		expect(result.taskState?.label).toBe("Working")

		socket?.destroy()
	})

	it("R1-2: the phase is NOT derived from running — running=true still reports the published phase", async () => {
		const { client, socket } = await startSeam({
			sessionId: "session-a",
			taskId: "task-a",
			isRunning: true,
			published: published({ phase: "completed", source: "host", seq: 20 }),
		})

		const response = await client.request("clinemm_get_run")
		const result = response.result as { running: boolean; taskState?: { phase: TurnPhase } }
		expect(result.running).toBe(true)
		expect(result.taskState?.phase).toBe("completed")

		socket?.destroy()
	})
})

// ===========================================================================
// R2 — Terminal completion
// ===========================================================================

describe("ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — R2 terminal completion", () => {
	it("R2-1: the Elm-selected completed phase is returned exactly, with no synthetic completion signal", async () => {
		const { client, socket } = await startSeam({
			sessionId: "session-a",
			taskId: "task-a",
			isRunning: false,
			published: published({ phase: "completed", source: "shadow", seq: 42 }),
		})

		const response = await client.request("clinemm_get_run")
		const result = response.result as Record<string, unknown>

		expect(result.taskState).toEqual({
			phase: "completed",
			source: "shadow",
			seq: 42,
			epoch: 4,
			stateVersion: 2001,
			label: "Complete",
		})
		// No synthetic completion field is introduced beyond taskState.
		expect(Object.keys(result).sort()).toEqual(["queuedPromptCount", "running", "sessionId", "taskId", "taskState"])

		socket?.destroy()
	})
})

// ===========================================================================
// R3 — Other user-visible states
// ===========================================================================

describe("ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — R3 other user-visible states", () => {
	const matrix: ReadonlyArray<{ phase: TurnPhase; label: string }> = [
		{ phase: "resumable", label: "Paused" },
		{ phase: "awaiting_followup", label: "Your turn" },
		{ phase: "awaiting_approval", label: "Approval" },
		{ phase: "compacting", label: "Compacting" },
		{ phase: "error", label: "Error" },
		{ phase: "idle", label: "Idle" },
	]

	for (const { phase, label } of matrix) {
		it(`R3-${phase}: the exact phase and provenance are reported with the UI label`, async () => {
			const { client, socket } = await startSeam({
				sessionId: "session-a",
				taskId: "task-a",
				published: published({ phase, source: "shadow", seq: 7 }),
			})

			const response = await client.request("clinemm_get_run")
			const result = response.result as { taskState?: { phase: TurnPhase; source: string; label?: string } }

			expect(result.taskState?.phase).toBe(phase)
			expect(result.taskState?.source).toBe("shadow")
			expect(result.taskState?.label).toBe(label)

			socket?.destroy()
		})
	}

	// ===========================================================================
	// R4 — Publication boundary
	// ===========================================================================

	describe("ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — R4 publication boundary", () => {
		it("R4-1: a constructed-but-never-submitted snapshot is not exposed", () => {
			const store = new PublishedTaskStateStore()
			// The store starts EMPTY: constructing a snapshot is not publishing.
			expect(store.read()).toBeUndefined()
		})

		it("R4-2: a failed state publication does not advance the record", () => {
			const store = new PublishedTaskStateStore()
			store.capture(published({ phase: "streaming", source: "shadow", seq: 10 }))

			// A FAILED publication must not call capture() at all. The store
			// only advances through capture(), so the previous record stands.
			expect(store.read()?.projection.phase).toBe("streaming")
		})

		it("R4-3: a successful eligible publication becomes observable", () => {
			const store = new PublishedTaskStateStore()
			store.capture(published({ phase: "awaiting_followup", source: "shadow", seq: 11 }))
			expect(store.read()?.projection.phase).toBe("awaiting_followup")
		})

		it("R4-4: a stale async completion cannot replace a newer publication", () => {
			const store = new PublishedTaskStateStore()
			store.capture(published({ phase: "streaming", source: "shadow", seq: 20 }, { stateVersion: 300 }))
			// A late completion from an OLDER publication arrives.
			store.capture(published({ phase: "completed", source: "shadow", seq: 19 }, { stateVersion: 299 }))

			const record = store.read()
			expect(record?.projection.phase).toBe("streaming")
			expect(record?.stateVersion).toBe(300)
		})

		it("R4-5: an MCP read triggers no Elm evaluation, state post or new agent execution", async () => {
			const { client, socket } = await startSeam({
				sessionId: "session-a",
				taskId: "task-a",
				published: published({ phase: "streaming", source: "shadow", seq: 1 }),
			})

			await client.request("clinemm_get_run")
			await client.request("clinemm_get_run")

			// The authority surface exposes NO mutating member and NO
			// publication trigger, so an MCP read structurally cannot cause
			// an Elm evaluation, a state post, or an agent execution.
			const authority = makeAuthority({
				sessionId: "session-a",
				taskId: "task-a",
				published: published({ phase: "streaming", source: "shadow", seq: 1 }),
			})
			expect(Object.keys(authority).sort()).toEqual([
				"readActiveSessionId",
				"readActiveTaskId",
				"readCurrentEpoch",
				"readIsRunning",
				"readPublishedTaskState",
				"readQueuedPromptCount",
				"readRuntimeSnapshot",
			])

			socket?.destroy()
		})
	})

	// ===========================================================================
	// R5 — Identity and epoch conservation
	// ===========================================================================

	describe("ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — R5 identity and epoch conservation", () => {
		it("R5-1: the authority OMITS taskState when the active identity does not match", () => {
			const identity = readControlSeamRunIdentity(
				makeAuthority({
					sessionId: "session-b",
					taskId: "task-b",
					published: published(
						{ phase: "streaming", source: "shadow", seq: 1 },
						{ sessionId: "session-a", taskId: "task-a" },
					),
				}),
			)
			expect(identity).toBeDefined()
			expect(identity?.taskState).toBeUndefined()
		})

		it("R5-2: an epoch bump invalidates the old phase", () => {
			const store = new PublishedTaskStateStore()
			store.capture(published({ phase: "streaming", source: "shadow", seq: 5 }, { epoch: 4 }))

			const identity = readControlSeamRunIdentity(
				makeAuthority({
					sessionId: "session-a",
					taskId: "task-a",
					published: store.read(),
				}),
			)
			expect(identity?.taskState).toBeDefined()

			// The epoch transitions (e.g. a task clear / conversation boundary).
			store.invalidate()
			const after = readControlSeamRunIdentity(
				makeAuthority({
					sessionId: "session-a",
					taskId: "task-a",
					published: store.read(),
				}),
			)
			expect(after?.taskState).toBeUndefined()
		})

		it("R5-3: a session replacement under the same task ID cannot expose the old session projection", () => {
			const store = new PublishedTaskStateStore()
			store.capture(
				published({ phase: "streaming", source: "shadow", seq: 5 }, { sessionId: "session-a", taskId: "task-a" }),
			)

			// Same task id, DIFFERENT session id.
			const identity = readControlSeamRunIdentity(
				makeAuthority({
					sessionId: "session-b",
					taskId: "task-a",
					published: store.read(),
				}),
			)
			expect(identity?.taskState).toBeUndefined()
		})

		it("R5-4: no active session produces the existing no-active-run response", async () => {
			const { client, socket } = await startSeam({ sessionId: undefined })
			const response = await client.request("clinemm_get_run")
			expect(response.ok).toBe(false)
			expect(response.error?.code).toBe("control_seam_no_active_run")
			socket?.destroy()
		})

		// ===========================================================================
		// R6 — Read-only security
		// ===========================================================================

		describe("ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — R6 read-only security", () => {
			it("R6-1: an unauthenticated request discloses nothing", async () => {
				const dir = mkdtempSync(join("/tmp", "cs-taskstate-unauth-"))
				const socketPath = join(dir, "control.sock")
				const tokenPath = join(dir, "token")
				const server = new ControlSeamServer({
					authority: makeAuthority({
						sessionId: "session-a",
						taskId: "task-a",
						published: published({ phase: "streaming", source: "shadow", seq: 1 }),
					}),
					extensionVersion: "0.0.0-task-state-test",
					platform: "darwin",
					socketPath,
					tokenPath,
					dirPath: dir,
					forceEnabled: true,
				})
				openServers.push(server)
				await server.start()

				const socket = await connectControlSeam(socketPath)
				const client = new ControlSeamClient("wrong-token")
				client.setWriter((payload) => socket?.write(payload))
				client.attach(socket!)

				const response = await client.request("clinemm_get_run")
				expect(response.ok).toBe(false)
				expect(response.error?.code).toBe("control_seam_unauthorized")
				expect(JSON.stringify(response)).not.toContain("session-a")
				expect(JSON.stringify(response)).not.toContain("streaming")

				socket?.destroy()
			})

			it("R6-2: unknown response keys are rejected by the allow-list", () => {
				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskState: { phase: "streaming", source: "shadow", seq: 1, epoch: 1, stateVersion: 2 },
						unexpected: "nope",
					}),
				).toBe(false)

				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskState: {
							phase: "streaming",
							source: "shadow",
							seq: 1,
							epoch: 1,
							stateVersion: 2,
							transcript: "secret content",
						},
					}),
				).toBe(false)
			})

			it("R6-3: an unknown phase value is rejected", () => {
				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskState: { phase: "not_a_phase", source: "shadow", seq: 1, epoch: 1, stateVersion: 2 },
					}),
				).toBe(false)
			})

			it("R6-4: an invalid source discriminant is rejected", () => {
				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskState: { phase: "streaming", source: "inferred", seq: 1, epoch: 1, stateVersion: 2 },
					}),
				).toBe(false)
			})

			it("R6-5: negative / non-integer sequence and version values are rejected", () => {
				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskState: { phase: "streaming", source: "shadow", seq: -1, epoch: 1, stateVersion: 2 },
					}),
				).toBe(false)
				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskState: { phase: "streaming", source: "shadow", seq: 1.5, epoch: 1, stateVersion: 2 },
					}),
				).toBe(false)
				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskState: { phase: "streaming", source: "shadow", seq: 1, epoch: 1, stateVersion: -2 },
					}),
				).toBe(false)
			})

			it("R6-6: a missing required nested field is rejected", () => {
				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskState: { phase: "streaming", source: "shadow", seq: 1, epoch: 1 },
					}),
				).toBe(false)
			})

			it("R6-7: null substituted for optional absence is rejected", () => {
				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskState: null,
					}),
				).toBe(false)
				expect(
					isControlSeamRunIdentity({
						sessionId: "session-a",
						running: false,
						queuedPromptCount: 0,
						taskId: null,
					}),
				).toBe(false)
			})

			it("R6-8: the published payload exposes no task content, paths or secrets", async () => {
				const { client, socket } = await startSeam({
					sessionId: "session-a",
					taskId: "task-a",
					published: published({ phase: "streaming", source: "shadow", seq: 1 }),
				})
				const response = await client.request("clinemm_get_run")
				const text = JSON.stringify(response.result)
				for (const forbidden of ["messages", "transcript", "content", "filePath", "workspaceRoot", "apiKey", "token"]) {
					expect(text).not.toContain(forbidden)
				}
				socket?.destroy()
			})

			it("R6-9: repeated reads without a new publication are byte-identical", async () => {
				const { client, socket } = await startSeam({
					sessionId: "session-a",
					taskId: "task-a",
					published: published({ phase: "streaming", source: "shadow", seq: 3 }),
				})
				const first = await client.request("clinemm_get_run")
				const second = await client.request("clinemm_get_run")
				expect(JSON.stringify(first.result)).toBe(JSON.stringify(second.result))
				socket?.destroy()
			})

			it("R6-10: a disconnected client cannot change a task", async () => {
				const { client, socket } = await startSeam({
					sessionId: "session-a",
					taskId: "task-a",
					published: published({ phase: "streaming", source: "shadow", seq: 3 }),
				})
				const before = await client.request("clinemm_get_run")
				socket?.destroy()
				client.dispose()
				const after = await client.request("clinemm_get_run")
				expect(after.ok).toBe(false)
				expect(JSON.stringify(before.result)).toContain("streaming")
			})
		})

		it("R5-5: a phase record absent at startup remains absent until a valid publication", async () => {
			const { client, socket } = await startSeam({
				sessionId: "session-a",
				taskId: "task-a",
				published: undefined,
			})
			const response = await client.request("clinemm_get_run")
			const result = response.result as Record<string, unknown>
			expect(result).not.toHaveProperty("taskState")
			expect(result).not.toHaveProperty("taskStatus")
			socket?.destroy()
		})

		it("R5-6: foreign-session requests are still refused", async () => {
			const { client, socket } = await startSeam({
				sessionId: "session-a",
				taskId: "task-a",
				published: published({ phase: "streaming", source: "shadow", seq: 1 }),
			})
			const response = await client.request("clinemm_get_run", "session-foreign")
			expect(response.ok).toBe(false)
			expect(response.error?.code).toBe("control_seam_foreign_session")
			socket?.destroy()
		})
	})

	it("R3-label: the MCP label equals the existing UI label mapping", () => {
		// The shared mapping IS the UI mapping — not a second switch.
		expect(taskHeaderPhaseLabel("awaiting_followup")).toBe("Your turn")
		expect(taskHeaderPhaseLabel("resumable")).toBe("Paused")
	})
})
