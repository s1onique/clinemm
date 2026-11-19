/**
 * ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01
 *
 * The behavioural RED -> GREEN witness for the EVENT-SESSION ISOLATION
 * boundary of the MCP control seam.
 *
 * THE DEFECT THIS ACT QUALIFIES
 *
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01 corrected C3: the
 * `clinemm_read_events` AUTHORIZATION decision is fenced to the session
 * THIS mutation client started (`ControlSeamServer.ownedSessionId`).
 *
 * That fixes WHO MAY REQUEST events. It does NOT bind WHICH SESSION
 * PRODUCED the events that are returned:
 *
 *   - `ControlSeamBufferedEvent` (control-seam-event-buffer.ts) carries
 *     `cursor` / `epoch` / `type` / `kind` / `ts` / `text` — and NO
 *     session identity at all.
 *   - `ControlSeamEventBuffer.append()` accepts an event with no
 *     ownership, and `read()` slices the SHARED ring with no session
 *     filter.
 *   - The buffer is cleared on controller DISPOSAL only
 *     (`SdkController.dispose()`), NOT on a task / session transition.
 *
 * So the authorization fence passes for session B while the shared ring
 * still holds session A's events — and with the content-read grant on,
 * session A's message TEXT is disclosed to a client that only owns
 * session B.
 *
 * WHAT IS UNDER TEST
 *
 * The REAL production seams, in their real composition:
 *
 *   - the REAL `SdkMessageCoordinator` (the EXISTING publication
 *     boundary) — `onSessionEvent` / `appendAndEmit`;
 *   - the REAL `ControlSeamEventBuffer` (the bounded ring);
 *   - the REAL `ControlSeamServer` over the REAL AF_UNIX transport,
 *     driven through the REAL `ControlSeamClient`.
 *
 * The controller's OWN subscription wiring is reproduced EXACTLY as
 * `SdkController` performs it (SdkController.ts:3387-3397): subscribe
 * through `onSessionEvent`, project each message through
 * `projectControlSeamBufferedEvent`, append to the shared buffer.
 *
 * The authority is a fixture that stands in for the controller's own
 * closures — every decision under test (authorization, ownership,
 * session filtering) is PRODUCTION code.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CoreSessionEvent } from "@cline/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { afterEach, describe, expect, it } from "vitest"

import { MessageIdMinter } from "../message-id-minter"
import { SdkMessageCoordinator } from "../sdk-message-coordinator"

import { ControlSeamClient, connectControlSeam } from "./control-seam-client"
import { ControlSeamEventBuffer, projectControlSeamBufferedEvent } from "./control-seam-event-buffer"
import {
	CONTROL_SEAM_MAX_EVENT_TEXT_LENGTH,
	CONTROL_SEAM_PROTOCOL_VERSION,
	type ControlSeamResponse,
} from "./control-seam-protocol"
import { ControlSeamServer } from "./control-seam-server"

/** A short private root so the AF_UNIX socket path stays under the limit. */
const SHORT_TMP_ROOT = "/tmp"

interface AuthorityFixture {
	/** The active session id the controller owns, or `undefined`. */
	sessionId?: string
	/** The workspace the host currently reports. */
	workspace: string
	/** The recorded `startAct` calls. */
	readonly startCalls: string[]
	/** The session id the authority accepts. */
	acceptedSessionId?: string
	/**
	 * When true, the authority installs the accepted session id as the
	 * ACTIVE session — the production lifecycle does exactly this.
	 */
	installSessionOnAccept?: boolean
}

interface Harness {
	readonly server: ControlSeamServer
	readonly dir: string
	readonly socketPath: string
	readonly token: string
	readonly writeToken?: string
	readonly eventBuffer: ControlSeamEventBuffer
	readonly fixture: AuthorityFixture
	/**
	 * The REAL publication boundary. The subscription below is the
	 * EXACT wiring `SdkController` performs.
	 */
	readonly messages: SdkMessageCoordinator
	readonly minter: MessageIdMinter
}

const openHarnesses: Harness[] = []

afterEach(async () => {
	while (openHarnesses.length > 0) {
		const harness = openHarnesses.pop()
		if (!harness) {
			continue
		}
		harness.messages.dispose()
		await harness.server.dispose()
		try {
			rmSync(harness.dir, { recursive: true, force: true })
		} catch {
			// Best effort.
		}
	}
})

/**
 * Build the authority fixture.
 *
 * The fixture only stands in for the CONTROLLER's closures. Every
 * security decision is production code.
 */
function makeAuthority(fixture: AuthorityFixture) {
	return {
		readActiveSessionId: () => fixture.sessionId,
		readActiveTaskId: () => undefined,
		readIsRunning: () => false,
		readQueuedPromptCount: () => 0,
		readRuntimeSnapshot: () => undefined,
		readPublishedTaskState: () => undefined,
		readCurrentEpoch: () => 0,
		readCurrentTurnPhase: () => undefined,
		readWorkspaceRoot: async () => fixture.workspace,
		startAct: async (input: { readonly prompt: string }) => {
			fixture.startCalls.push(input.prompt)
			const sessionId = fixture.acceptedSessionId ?? "session-accepted"
			if (fixture.installSessionOnAccept !== false) {
				fixture.sessionId = sessionId
			}
			return { outcome: "accepted" as const, sessionId }
		},
		// ACT-CLINEMM-MCP-SUPERVISION-V2-01: the supervision members are
		// not exercised by this fixture.
		sendFeedback: async () => ({ outcome: "rejected" as const, reason: "not-authorized-in-this-fixture" }),
		cancelRun: async () => ({ outcome: "rejected" as const, reason: "not-authorized-in-this-fixture" }),
	}
}

async function startHarness(
	fixture: Partial<AuthorityFixture> & { readonly workspace?: string } = {},
	options: { readonly mutationEnabled?: boolean; readonly allowContentRead?: boolean } = {},
): Promise<Harness> {
	const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cec-iso01-"))
	const socketPath = join(dir, "control.sock")
	const tokenPath = join(dir, "token")
	const ownerPath = join(dir, "owner.json")
	const eventBuffer = new ControlSeamEventBuffer()
	const fullFixture: AuthorityFixture = {
		workspace: fixture.workspace ?? "/tmp/workspace",
		startCalls: fixture.startCalls ?? [],
		...(fixture.sessionId !== undefined ? { sessionId: fixture.sessionId } : {}),
		...(fixture.acceptedSessionId !== undefined ? { acceptedSessionId: fixture.acceptedSessionId } : {}),
		...(fixture.installSessionOnAccept !== undefined ? { installSessionOnAccept: fixture.installSessionOnAccept } : {}),
	}
	const mutationOptInPath = join(dir, "mutation.json")
	if (options.mutationEnabled !== undefined) {
		writeFileSync(
			mutationOptInPath,
			JSON.stringify({ v: 1, enabled: true, allowContentRead: options.allowContentRead === true }),
			{ mode: 0o600 },
		)
	}
	const server = new ControlSeamServer({
		authority: makeAuthority(fullFixture),
		extensionVersion: "9.9.9-iso01-test",
		platform: "darwin",
		socketPath,
		tokenPath,
		ownerPath,
		dirPath: dir,
		forceEnabled: true,
		eventBuffer,
		mutationOptInPath,
		...(options.mutationEnabled !== undefined ? { forceMutationEnabled: options.mutationEnabled } : {}),
	})
	// The REAL publication boundary. It has NO task attached — the
	// control-seam subscription only READS the emitted messages, exactly
	// as `SdkController`'s subscription does.
	//
	// The REAL minter is supplied, exactly as `SdkController` supplies
	// it (`this.messageTranslatorState.getMinter()`): the production
	// `seq` / `epoch` authority is what gives every published message
	// its stable cursor. Without it `stamp()` is a no-op and no event
	// has a cursor to retain.
	const minter = new MessageIdMinter()
	const messages = new SdkMessageCoordinator({ getTask: () => undefined, getMinter: () => minter })
	// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01 + CORR01 +
	// ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01: the EXACT wiring
	// `SdkController` performs (SdkController.ts:3387-3415). Subscribe
	// through the EXISTING publication boundary and append the REAL
	// projected events to the SHARED buffer, attributing each event to
	// the session that PRODUCED it.
	messages.onSessionEvent((emitted, event) => {
		const sessionId = event?.payload?.sessionId
		if (typeof sessionId !== "string" || sessionId.length === 0) {
			return
		}
		for (const message of emitted) {
			const projected = projectControlSeamBufferedEvent(message, {
				sessionId,
				allowContentRead: true,
				maxTextLength: CONTROL_SEAM_MAX_EVENT_TEXT_LENGTH,
			})
			if (projected) {
				eventBuffer.append(projected)
			}
		}
	})
	const harness: Harness = {
		server,
		dir,
		socketPath,
		token: "",
		eventBuffer,
		fixture: fullFixture,
		messages,
		minter,
	}
	openHarnesses.push(harness)
	const handle = await server.start()
	expect(handle).toBeDefined()
	const started = handle!
	return {
		...harness,
		token: started.token,
		...(started.writeToken !== undefined ? { writeToken: started.writeToken } : {}),
	}
}

/** Send a request over a FRESH socket. */
async function send(
	harness: Harness,
	request: Record<string, unknown>,
	options: { readonly writeToken?: string; readonly withWriteToken?: boolean } = {},
): Promise<ControlSeamResponse> {
	const socket = await connectControlSeam(harness.socketPath)
	expect(socket).toBeDefined()
	try {
		const client = new ControlSeamClient(
			harness.token,
			options.withWriteToken && options.writeToken !== undefined ? { writeToken: options.writeToken } : {},
		)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)
		const response = await client.request(
			request.op as "clinemm_get_run",
			request.sessionId as string | undefined,
			request.payload as never,
		)
		client.dispose()
		return response
	} finally {
		socket?.destroy()
	}
}

/** Build a `clinemm_start_act` request envelope. */
function startActRequest(input: {
	readonly requestId: string
	readonly prompt?: string
	readonly expectedWorkspace?: string
	readonly writeToken?: string
}): Record<string, unknown> {
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: "clinemm_start_act",
		token: "read-token",
		...(input.writeToken !== undefined ? { writeToken: input.writeToken } : {}),
		payload: {
			op: "clinemm_start_act",
			input: {
				requestId: input.requestId,
				prompt: input.prompt ?? "fix the three test failures",
				expectedWorkspace: input.expectedWorkspace ?? "/tmp/workspace",
			},
		},
	}
}

/** Build a `clinemm_read_events` request envelope. */
function readEventsRequest(input: {
	readonly sessionId: string
	readonly afterCursor?: string
	readonly limit?: number
	readonly writeToken?: string
}): Record<string, unknown> {
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: "clinemm_read_events",
		token: "read-token",
		...(input.writeToken !== undefined ? { writeToken: input.writeToken } : {}),
		payload: {
			op: "clinemm_read_events",
			input: {
				sessionId: input.sessionId,
				...(input.afterCursor !== undefined ? { afterCursor: input.afterCursor } : {}),
				...(input.limit !== undefined ? { limit: input.limit } : {}),
			},
		},
	}
}

/**
 * Publish one REAL event through the REAL publication boundary.
 *
 * The message is stamped by the REAL minter (the production seq/epoch
 * authority) and emitted with the REAL `CoreSessionEvent` shape, whose
 * payload carries the producing session id.
 */
function publishEvent(
	harness: Harness,
	input: {
		readonly sessionId: string
		readonly text: string
		readonly kind?: "say" | "ask"
		readonly say?: string
	},
): void {
	const message: ClineMessage = {
		ts: Date.now(),
		type: input.kind ?? "say",
		...(input.say !== undefined ? { say: input.say as never } : { say: "text" as never }),
		text: input.text,
		partial: false,
	}
	const event: CoreSessionEvent = {
		type: "status",
		payload: { sessionId: input.sessionId, status: "running" },
	}
	harness.messages.appendAndEmit([message], event)
}

// ===========================================================================
// The isolation witnesses
// ===========================================================================

describe("ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01 - event session isolation", () => {
	it("ISO-1: events published by a DIFFERENT session are NOT returned to the session this client owns", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", acceptedSessionId: "session-b", installSessionOnAccept: true },
			{ mutationEnabled: true, allowContentRead: true },
		)

		// (1) A UI-OWNED session A publishes an event BEFORE the MCP
		// client starts anything.
		publishEvent(harness, { sessionId: "session-a", text: "SECRET-A-UI-TASK-TEXT" })

		// (2) The MCP client starts its OWN session B.
		const started = await send(
			harness,
			startActRequest({
				requestId: "iso01-1",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(started.result).toMatchObject({ outcome: "accepted", sessionId: "session-b" })

		// (3) The client reads its OWN session's events. The
		// AUTHORIZATION fence passes (B is the session it started)...
		const response = await send(harness, readEventsRequest({ sessionId: "session-b", writeToken: harness.writeToken }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)

		// ...but the RETURNED SLICE must contain NO event produced by
		// session A — neither its metadata NOR its text.
		const result = response.result as { sessionId: string; events: { cursor: string; text?: string }[] }
		expect(result.sessionId).toBe("session-b")
		expect(JSON.stringify(response)).not.toContain("SECRET-A-UI-TASK-TEXT")
		expect(result.events).toEqual([])
	})

	it("ISO-2: an event published by a LATER UI-OWNED session is not returned to the session this client owns", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", acceptedSessionId: "session-b", installSessionOnAccept: true },
			{ mutationEnabled: true, allowContentRead: true },
		)

		const started = await send(
			harness,
			startActRequest({
				requestId: "iso01-2",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(started.result).toMatchObject({ outcome: "accepted", sessionId: "session-b" })

		// The MCP client publishes its OWN session's event.
		publishEvent(harness, { sessionId: "session-b", text: "MY-OWN-EVENT" })

		// A NEW UI-OWNED session C publishes into the SAME buffer.
		publishEvent(harness, { sessionId: "session-c", text: "SECRET-C-UI-TASK-TEXT" })

		const response = await send(harness, readEventsRequest({ sessionId: "session-b", writeToken: harness.writeToken }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)
		const result = response.result as { events: { cursor: string; text?: string }[] }
		expect(JSON.stringify(response)).not.toContain("SECRET-C-UI-TASK-TEXT")
		// ONLY the owned session's event is returned.
		expect(result.events.map((event) => event.text)).toEqual(["MY-OWN-EVENT"])
	})
})

describe("ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01 - event session isolation (metadata + continuity)", () => {
	it("ISO-3: WITHOUT the content-read grant, a foreign session's event METADATA is still not returned", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", acceptedSessionId: "session-b", installSessionOnAccept: true },
			{ mutationEnabled: true, allowContentRead: false },
		)

		publishEvent(harness, { sessionId: "session-a", text: "SECRET-A-UI-TASK-TEXT" })

		const started = await send(
			harness,
			startActRequest({
				requestId: "iso01-3",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(started.result).toMatchObject({ outcome: "accepted", sessionId: "session-b" })

		const response = await send(harness, readEventsRequest({ sessionId: "session-b", writeToken: harness.writeToken }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)
		const result = response.result as { events: { cursor: string; text?: string }[] }
		// No foreign event METADATA (the cursor) is disclosed either.
		expect(result.events).toEqual([])
	})

	it("ISO-4: the owned session's own events remain readable, with cursor continuity across an epoch transition", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", acceptedSessionId: "session-b", installSessionOnAccept: true },
			{ mutationEnabled: true, allowContentRead: true },
		)

		const started = await send(
			harness,
			startActRequest({
				requestId: "iso01-4",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(started.result).toMatchObject({ outcome: "accepted", sessionId: "session-b" })

		publishEvent(harness, { sessionId: "session-b", text: "OWNED-EVENT-1" })

		const first = await send(harness, readEventsRequest({ sessionId: "session-b", writeToken: harness.writeToken }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(first.ok).toBe(true)
		const firstResult = first.result as { events: { cursor: string; text?: string }[]; nextCursor?: string }
		expect(firstResult.events.map((event) => event.text)).toEqual(["OWNED-EVENT-1"])
		const firstCursor = firstResult.events[0]?.cursor
		expect(firstCursor).toBeDefined()

		// A TASK / EPOCH TRANSITION on the SAME owned session: a new
		// epoch, a NEWER cursor. The continuity must hold — the second
		// read resumes AFTER the first cursor and returns ONLY the new
		// event.
		publishEvent(harness, { sessionId: "session-b", text: "OWNED-EVENT-2" })

		const second = await send(
			harness,
			readEventsRequest({
				sessionId: "session-b",
				afterCursor: firstCursor,
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(second.ok).toBe(true)
		const secondResult = second.result as { events: { cursor: string; text?: string }[] }
		expect(secondResult.events.map((event) => event.text)).toEqual(["OWNED-EVENT-2"])
	})
})
