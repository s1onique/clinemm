/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02
 *
 * Live Elm shadow observer of the factual CCARD stream.
 *
 * The shadow attaches to the SAME
 * `captureContinuationCardinalityAuthorityRecord` helper that
 * production uses, and feeds the resulting
 * `ContinuationCardinalityAuthorityRecord` through the existing
 * `adaptRecord` adapter into a fresh `Elm.Main.init({})` per Cline
 * session. The Elm kernel has ZERO authority: its outputs are
 * captured into a bounded JSONL-shaped ring and a counter snapshot,
 * then surfaced through a single Command Palette dump command.
 *
 * Hard invariants:
 *   - Default-off.
 *   - Fail-open.
 *   - Non-blocking. `observeElmShadowFireAndForget` returns
 *     immediately.
 *   - Session isolation. One `ShadowKernelSession` per
 *     `sessionId`.
 *   - FIFO per session.
 *   - Adapter reuse.
 *   - Loader reuse.
 *
 * Module-instance invariant: the runtime state (enabled flag,
 * ring, counters, per-session maps) lives on `globalThis` under a
 * fixed key. This means CCARD's static import and the test's
 * direct import share the SAME state, regardless of how the module
 * loader resolves duplicate paths. Mirrors Elm's IIFE global.
 */

import type { KernelHandle, KernelOutbound } from "./completion-authority-elm-replay"
import { adaptRecord } from "./completion-authority-elm-replay"
import { loadKernel } from "./completion-authority-elm-replay.kernel"

// ----------------------------------------------------------------------------
// Shadow diagnostic counter snapshot
// ----------------------------------------------------------------------------

export interface ElmShadowCountersSnapshot {
	readonly total: number
	readonly states: number
	readonly violations: number
	readonly decodeErrors: number
	readonly kernelErrors: number
}

// ----------------------------------------------------------------------------
// One session-scoped shadow
// ----------------------------------------------------------------------------

interface ShadowKernelSession {
	readonly sessionId: string
	readonly kernel: KernelHandle
	failed: boolean
}

interface PendingRecord {
	readonly record: Record<string, unknown>
	readonly sessionId: string
}

interface ShadowGlobalState {
	enabled: boolean
	kernelPath: string | null
	ring: Array<Record<string, unknown>>
	ringSize: number
	counters: {
		total: number
		states: number
		violations: number
		decodeErrors: number
		kernelErrors: number
	}
	sessions: Map<string, ShadowKernelSession>
	fifos: Map<string, PendingRecord[]>
	inflight: Set<string>
	teardownMarker: Set<string>
}

const GLOBAL_KEY = "__clineEmmElmShadowState"
const DEFAULT_RING_SIZE = 512

// Use Symbol.for() for the global key so the state is shared across
// ALL module instances of the shadow regardless of how the bundler
// (vite, vitest, bun, esbuild) resolves duplicate module paths.
const SHARED_STATE_KEY = Symbol.for("__clineEmmElmShadowState")

function getOrInitGlobal(): ShadowGlobalState {
	// Cast through unknown — Symbol.for() returns a unique symbol
	// per process, but our key collisions across module instances
	// are by design (we want one state per process).
	const g = globalThis as unknown as Record<symbol, ShadowGlobalState | undefined>
	let state = g[SHARED_STATE_KEY]
	if (!state) {
		state = {
			enabled: false,
			kernelPath: null,
			ring: [],
			ringSize: DEFAULT_RING_SIZE,
			counters: { total: 0, states: 0, violations: 0, decodeErrors: 0, kernelErrors: 0 },
			sessions: new Map(),
			fifos: new Map(),
			inflight: new Set(),
			teardownMarker: new Set(),
		}
		g[SHARED_STATE_KEY] = state
	}
	return state
}

function pushObservation(obs: Record<string, unknown>): void {
	const s = getOrInitGlobal()
	s.ring.push(obs)
	if (s.ring.length > s.ringSize) {
		s.ring.shift()
	}
	s.counters.total++
	const kind = obs["elmOutputKind"]
	if (kind === "state") s.counters.states++
	else if (kind === "decode_error") s.counters.decodeErrors++
	if (typeof obs["violation"] === "string" && (obs["violation"] as string).length > 0) {
		s.counters.violations++
	}
	if (kind === "kernel_error") s.counters.kernelErrors++
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function isElmShadowEnabled(): boolean {
	return getOrInitGlobal().enabled
}

export function isElmShadowObserverActive(): boolean {
	return getOrInitGlobal().enabled
}

export function getElmShadowKernelPath(): string | null {
	return getOrInitGlobal().kernelPath
}

export function setElmShadowEnabled(nextEnabled: boolean, nextKernelPath: string | null): void {
	const s = getOrInitGlobal()
	s.enabled = Boolean(nextEnabled)
	s.kernelPath = nextKernelPath
	if (!s.enabled) {
		s.sessions.clear()
	}
}

export function getElmShadowRing(): readonly Record<string, unknown>[] {
	return getOrInitGlobal().ring
}

export function getElmShadowCounters(): ElmShadowCountersSnapshot {
	const s = getOrInitGlobal()
	return {
		total: s.counters.total,
		states: s.counters.states,
		violations: s.counters.violations,
		decodeErrors: s.counters.decodeErrors,
		kernelErrors: s.counters.kernelErrors,
	}
}

export function resetElmShadowForTesting(): void {
	const s = getOrInitGlobal()
	s.ring.length = 0
	s.ringSize = DEFAULT_RING_SIZE
	s.counters.total = 0
	s.counters.states = 0
	s.counters.violations = 0
	s.counters.decodeErrors = 0
	s.counters.kernelErrors = 0
	s.sessions.clear()
	s.fifos.clear()
	s.inflight.clear()
	s.teardownMarker.clear()
	s.enabled = false
	s.kernelPath = null
}

// ----------------------------------------------------------------------------
// Per-session lazy kernel creation
// ----------------------------------------------------------------------------

function sessionIdOfRecord(record: Record<string, unknown>): string | null {
	const sid = record["sessionId"]
	if (typeof sid === "string" && sid.length > 0) return sid
	const tid = record["taskId"]
	if (typeof tid === "string" && tid.length > 0) return tid
	return null
}

function ensureSession(sessionId: string): ShadowKernelSession | null {
	const s = getOrInitGlobal()
	if (!s.enabled || s.kernelPath === null) return null
	const existing = s.sessions.get(sessionId)
	if (existing) return existing.failed ? null : existing
	try {
		const kernel = loadKernel(s.kernelPath)
		const sess: ShadowKernelSession = { sessionId, kernel, failed: false }
		s.sessions.set(sessionId, sess)
		return sess
	} catch (err) {
		pushObservation({
			at: Date.now(),
			sessionId,
			sourceStage: "<kernel_load>",
			adapterStatus: "KERNEL_LOAD_FAIL",
			reason: err instanceof Error ? err.message : String(err),
			elmOutputKind: "kernel_error",
			violation: null,
			model: null,
		})
		setElmShadowEnabled(false, s.kernelPath)
		return null
	}
}

function maybeTeardownSession(sessionId: string, record: Record<string, unknown>): void {
	const s = getOrInitGlobal()
	const stage = record["stage"]
	if (stage === "task_completion_committed") {
		s.teardownMarker.add(sessionId)
	}
	if (stage === "agent_turn_done" && s.teardownMarker.has(sessionId)) {
		s.sessions.delete(sessionId)
		s.teardownMarker.delete(sessionId)
	}
}

// ----------------------------------------------------------------------------
// Per-session FIFO scheduling
// ----------------------------------------------------------------------------

function enqueueRecord(record: Record<string, unknown>): void {
	const s = getOrInitGlobal()
	const sessionId = sessionIdOfRecord(record)
	if (sessionId === null) return
	const queue = s.fifos.get(sessionId) ?? []
	queue.push({ record, sessionId })
	s.fifos.set(sessionId, queue)
	if (!s.inflight.has(sessionId)) {
		s.inflight.add(sessionId)
		queueMicrotask(() => {
			void drainAll(sessionId)
		})
	}
}

async function drainAll(sessionId: string): Promise<void> {
	const s = getOrInitGlobal()
	try {
		const queue = s.fifos.get(sessionId) ?? []
		const sess = ensureSession(sessionId)
		if (!sess) {
			while (queue.length > 0) {
				const item = queue.shift()!
				pushObservation({
					at: Date.now(),
					sessionId,
					sourceSeq: typeof item.record["seq"] === "number" ? (item.record["seq"] as number) : -1,
					sourceStage: typeof item.record["stage"] === "string" ? (item.record["stage"] as string) : "",
					adapterStatus: "SHADOW_DISABLED",
					reason: "shadow_disabled_or_kernel_load_failed",
					elmOutputKind: null,
					violation: null,
					model: null,
				})
			}
			return
		}
		while (queue.length > 0) {
			const item = queue.shift()!
			await processOne(sess, item.record, sessionId)
		}
	} finally {
		s.inflight.delete(sessionId)
	}
}

// Test seam: synchronously drain all pending FIFO entries for this
// session. Waits for any in-flight microtask drain to finish first,
// then drains any leftover items.
export async function drainOneTickForTesting(sessionId: string): Promise<void> {
	const s = getOrInitGlobal()
	// Wait for any pending microtask drain to release the inflight
	// flag before we take over. Microtasks + setTimeout(0) require
	// at least a microtask boundary and a macrotask boundary.
	while (s.inflight.has(sessionId)) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
	}
	s.inflight.add(sessionId)
	try {
		const queue = s.fifos.get(sessionId) ?? []
		const sess = ensureSession(sessionId)
		if (!sess) {
			while (queue.length > 0) {
				const item = queue.shift()!
				pushObservation({
					at: Date.now(),
					sessionId,
					sourceSeq: typeof item.record["seq"] === "number" ? (item.record["seq"] as number) : -1,
					sourceStage: typeof item.record["stage"] === "string" ? (item.record["stage"] as string) : "",
					adapterStatus: "SHADOW_DISABLED",
					reason: "shadow_disabled_or_kernel_load_failed",
					elmOutputKind: null,
					violation: null,
					model: null,
				})
			}
			return
		}
		while (queue.length > 0) {
			const item = queue.shift()!
			await processOne(sess, item.record, sessionId)
		}
	} finally {
		s.inflight.delete(sessionId)
	}
}
async function processOne(sess: ShadowKernelSession, record: Record<string, unknown>, sessionId: string): Promise<void> {
	if (sess.failed) {
		pushObservation({
			at: Date.now(),
			sessionId,
			sourceSeq: typeof record["seq"] === "number" ? (record["seq"] as number) : -1,
			sourceStage: typeof record["stage"] === "string" ? (record["stage"] as string) : "",
			adapterStatus: "SHADOW_DISABLED",
			reason: "shadow_session_failed",
			elmOutputKind: null,
			violation: null,
			model: null,
		})
		maybeTeardownSession(sessionId, record)
		return
	}
	let outcome: ReturnType<typeof adaptRecord>
	try {
		outcome = adaptRecord(record)
	} catch (err) {
		pushObservation({
			at: Date.now(),
			sessionId,
			sourceSeq: typeof record["seq"] === "number" ? (record["seq"] as number) : -1,
			sourceStage: typeof record["stage"] === "string" ? (record["stage"] as string) : "",
			adapterStatus: "ADAPTER_THROW",
			reason: err instanceof Error ? err.message : String(err),
			elmOutputKind: "kernel_error",
			violation: null,
			model: null,
		})
		sess.failed = true
		maybeTeardownSession(sessionId, record)
		return
	}

	if (outcome.status !== "DIRECT") {
		pushObservation({
			at: Date.now(),
			sessionId,
			sourceSeq: typeof record["seq"] === "number" ? (record["seq"] as number) : -1,
			sourceStage: typeof record["stage"] === "string" ? (record["stage"] as string) : "",
			adapterStatus: outcome.status,
			reason: outcome.reason,
			elmOutputKind: null,
			violation: null,
			model: null,
		})
		maybeTeardownSession(sessionId, record)
		return
	}

	try {
		sess.kernel.send(outcome.elmMsg)
	} catch (err) {
		pushObservation({
			at: Date.now(),
			sessionId,
			sourceSeq: typeof record["seq"] === "number" ? (record["seq"] as number) : -1,
			sourceStage: typeof record["stage"] === "string" ? (record["stage"] as string) : "",
			adapterStatus: outcome.status,
			elmMsg: outcome.elmMsg,
			reason: `ports.inbound.send threw: ${err instanceof Error ? err.message : String(err)}`,
			elmOutputKind: "kernel_error",
			violation: null,
			model: null,
		})
		sess.failed = true
		maybeTeardownSession(sessionId, record)
		return
	}

	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	let outbounds: KernelOutbound[] = []
	try {
		outbounds = sess.kernel.drainOutbound()
	} catch (err) {
		pushObservation({
			at: Date.now(),
			sessionId,
			sourceSeq: typeof record["seq"] === "number" ? (record["seq"] as number) : -1,
			sourceStage: typeof record["stage"] === "string" ? (record["stage"] as string) : "",
			adapterStatus: outcome.status,
			elmMsg: outcome.elmMsg,
			reason: `drainOutbound threw: ${err instanceof Error ? err.message : String(err)}`,
			elmOutputKind: "kernel_error",
			violation: null,
			model: null,
		})
		sess.failed = true
		maybeTeardownSession(sessionId, record)
		return
	}

	const lastState = [...outbounds].reverse().find((o) => o.kind === "state") as
		| { kind: "state"; model: Record<string, unknown>; violation?: string }
		| undefined
	const decodeError = outbounds.find((o) => o.kind === "decode_error") as { kind: "decode_error"; error: string } | undefined

	if (decodeError) {
		pushObservation({
			at: Date.now(),
			sessionId,
			sourceSeq: typeof record["seq"] === "number" ? (record["seq"] as number) : -1,
			sourceStage: typeof record["stage"] === "string" ? (record["stage"] as string) : "",
			adapterStatus: outcome.status,
			elmMsg: outcome.elmMsg,
			reason: decodeError.error,
			elmOutputKind: "decode_error",
			violation: null,
			model: null,
		})
		maybeTeardownSession(sessionId, record)
		return
	}

	if (lastState) {
		pushObservation({
			at: Date.now(),
			sessionId,
			sourceSeq: typeof record["seq"] === "number" ? (record["seq"] as number) : -1,
			sourceStage: typeof record["stage"] === "string" ? (record["stage"] as string) : "",
			adapterStatus: outcome.status,
			elmMsg: outcome.elmMsg,
			reason: "DIRECT",
			elmOutputKind: "state",
			violation: typeof lastState.violation === "string" ? lastState.violation : null,
			model: lastState.model,
		})
	} else {
		pushObservation({
			at: Date.now(),
			sessionId,
			sourceSeq: typeof record["seq"] === "number" ? (record["seq"] as number) : -1,
			sourceStage: typeof record["stage"] === "string" ? (record["stage"] as string) : "",
			adapterStatus: outcome.status,
			elmMsg: outcome.elmMsg,
			reason: "no_outbound_state_after_send",
			elmOutputKind: null,
			violation: null,
			model: null,
		})
	}
	maybeTeardownSession(sessionId, record)
}

// ----------------------------------------------------------------------------
// Public observation entry point
// ----------------------------------------------------------------------------

export function observeElmShadowFireAndForget(record: Record<string, unknown>): void {
	const s = getOrInitGlobal()
	if (!s.enabled) return
	try {
		enqueueRecord(record)
	} catch {
		// Never propagate.
	}
}
