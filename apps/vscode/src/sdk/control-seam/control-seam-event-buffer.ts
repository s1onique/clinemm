/**
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01
 *
 * The bounded, ordered event buffer behind `clinemm_read_events`.
 *
 * WHY THIS EXISTS
 *
 * Codex needs to observe task progress. The seam must expose the REAL
 * emitted events — not a reconstruction from `running`, not a scrape of
 * the webview, not an invented timeline.
 *
 * The EXISTING production event source is `SdkMessageCoordinator`:
 *
 *   runtime event
 *     -> SdkSessionEventCoordinator.handleSessionEvent
 *       -> translateSessionEvent(...)          [existing translation]
 *         -> SdkMessageCoordinator.appendAndEmit(messages, event)
 *           -> stamp(messages)                 [existing seq/epoch authority]
 *           -> task.messageStateHandler.addMessages(...)
 *           -> emitSessionEvents(messages, event)  <-- THE PUBLICATION BOUNDARY
 *
 * `emitSessionEvents` is the EXISTING publication point: the same
 * messages that reach the webview reach every `onSessionEvent`
 * listener. This module subscribes THERE, so the events it retains are
 * the events the UI saw — with the EXISTING identity (`seq`, `epoch`)
 * and the EXISTING ordering.
 *
 * WHAT THIS IS NOT
 *
 *   - It is NOT a new event bus. It is a READER of the existing
 *     publication boundary.
 *   - It is NOT a new event-history database. It is a bounded
 *     in-memory ring, scoped to the extension-host instance, dropped on
 *     disposal.
 *   - It does NOT reconstruct events from approximate state. A gap in
 *     the retained window is reported as a gap, never filled in.
 *
 * CONTENT BOUNDARY
 *
 * The buffer retains only the event's IDENTITY (cursor, epoch, type,
 * kind, ts) and — only when the content-read grant is present — the
 * message's text, truncated to a bounded length. It never retains raw
 * tool arguments, credentials, hidden reasoning, or file contents.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"

/**
 * The maximum number of retained events.
 *
 * The ring is bounded. When it is full, the OLDEST event is evicted.
 */
export const CONTROL_SEAM_EVENT_BUFFER_MAX_EVENTS = 500

/**
 * One retained event's identity.
 *
 * `cursor` is the EXISTING `ClineMessage.seq` — the same ordering
 * identity the webview merge uses.
 */
export interface ControlSeamBufferedEvent {
	readonly cursor: string
	readonly epoch: number
	readonly type: string
	readonly kind?: string
	readonly ts: number
	/** The bounded message text. Absent when the content grant is off. */
	readonly text?: string
}

/**
 * Project a `ClineMessage` into the buffer's identity shape.
 *
 * The `text` is included ONLY when `allowContentRead` is true AND the
 * message is a content-bearing kind. It is truncated to
 * `maxTextLength` with an explicit truncation marker so a reader can
 * tell that the text was cut.
 */
export function projectControlSeamBufferedEvent(
	message: ClineMessage,
	options: { readonly allowContentRead: boolean; readonly maxTextLength: number },
): ControlSeamBufferedEvent | undefined {
	if (!message || typeof message !== "object") {
		return undefined
	}
	const type = typeof message.type === "string" ? message.type : ""
	if (type.length === 0) {
		return undefined
	}
	// The EXISTING ordering identity. A message without a `seq` was
	// never stamped by the minter, so it has no stable cursor and is
	// NOT retained — inventing a cursor would invent an ordering.
	if (typeof message.seq !== "number" || !Number.isFinite(message.seq)) {
		return undefined
	}
	const epoch = typeof message.epoch === "number" && Number.isFinite(message.epoch) ? message.epoch : 0
	const ts = typeof message.ts === "number" && Number.isFinite(message.ts) ? message.ts : 0
	const say = typeof message.say === "string" ? message.say : undefined
	const ask = typeof message.ask === "string" ? message.ask : undefined
	const kind = ask ?? say

	let text: string | undefined
	if (options.allowContentRead && type === "say" && say !== undefined && CONTENT_BEARING_SAY_KINDS.has(say)) {
		const raw = typeof message.text === "string" ? message.text : ""
		if (raw.length > 0) {
			if (raw.length <= options.maxTextLength) {
				text = raw
			} else {
				text = `${raw.slice(0, options.maxTextLength)}…[truncated]`
			}
		}
	}

	return {
		cursor: String(message.seq),
		epoch,
		type,
		...(kind !== undefined ? { kind } : {}),
		ts,
		...(text !== undefined ? { text } : {}),
	}
}

/**
 * A bounded slice of retained events plus the paging metadata.
 */
export interface ControlSeamBufferedSlice {
	readonly events: readonly ControlSeamBufferedEvent[]
	readonly nextCursor?: string
	/** True when the requested cursor is older than the retained window. */
	readonly cursorExpired: boolean
}

/**
 * The bounded, in-memory event ring.
 *
 * ONE instance per extension-host instance. Events are appended in the
 * EXISTING publication order. The ring is dropped on disposal, so a
 * restarted host has NO event history — a client must reconcile
 * through `clinemm_get_run` instead.
 */
export class ControlSeamEventBuffer {
	private readonly events: ControlSeamBufferedEvent[] = []
	private readonly maxEvents: number

	constructor(options: { readonly maxEvents?: number } = {}) {
		this.maxEvents = Math.max(1, Math.floor(options.maxEvents ?? CONTROL_SEAM_EVENT_BUFFER_MAX_EVENTS))
	}

	/**
	 * Append one event.
	 *
	 * Events that cannot be projected (no stable `seq`, not an object)
	 * are IGNORED — they are not retained, and they do not create a gap
	 * marker, because they never had an identity to begin with.
	 */
	append(event: ControlSeamBufferedEvent): void {
		this.events.push(event)
		while (this.events.length > this.maxEvents) {
			this.events.shift()
		}
	}

	/**
	 * Read a bounded slice AFTER `afterCursor`.
	 *
	 * `afterCursor` is the EXISTING `seq` the client last observed. When
	 * it is omitted, the slice starts at the beginning of the retained
	 * window. When it is older than the retained window, the slice
	 * starts at the OLDEST retained event and `cursorExpired` is true —
	 * the caller MUST treat the slice as INCOMPLETE.
	 *
	 * The returned events are in the EXISTING production order. Missing
	 * events are NEVER synthesized.
	 */
	read(options: { readonly afterCursor?: string; readonly limit: number }): ControlSeamBufferedSlice {
		const limit = Math.max(1, Math.floor(options.limit))
		let startIndex = 0
		let cursorExpired = false
		if (options.afterCursor !== undefined) {
			const after = Number.parseInt(options.afterCursor, 10)
			if (!Number.isFinite(after)) {
				// An unparseable cursor cannot be positioned. Fail
				// closed by reporting the whole retained window as
				// expired rather than guessing a position.
				cursorExpired = this.events.length > 0
				startIndex = 0
			} else {
				const index = this.events.findIndex((event) => Number.parseInt(event.cursor, 10) > after)
				if (index === -1) {
					// The cursor is at or after the newest retained
					// event: nothing new. Not an expiry.
					return { events: [], cursorExpired: false }
				}
				if (index === 0 && this.events.length > 0) {
					// The requested cursor is older than the retained
					// window: the caller missed events.
					cursorExpired = true
				}
				startIndex = index
			}
		}
		const slice = this.events.slice(startIndex, startIndex + limit)
		const last = slice[slice.length - 1]
		const hasMore = startIndex + slice.length < this.events.length
		return {
			events: slice,
			...(hasMore && last !== undefined ? { nextCursor: last.cursor } : {}),
			cursorExpired,
		}
	}

	/** The number of retained events. */
	get size(): number {
		return this.events.length
	}

	/** Drop every retained event. Called on controller disposal. */
	clear(): void {
		this.events.length = 0
	}
}

/**
 * Whether a message's text may be exposed.
 *
 * ONLY user-visible prose kinds qualify. Tool invocations, tool
 * results, API request bodies, file contents and reasoning payloads
 * are NEVER exposed as text — their `kind` alone is exposed.
 */
const CONTENT_BEARING_SAY_KINDS = new Set(["task", "text", "error", "completion_result"])
