import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { KernelHandle, KernelOutbound, ReplayEvent, ReplayResult } from "./completion-authority-elm-replay"
import { adaptRecord } from "./completion-authority-elm-replay"

// CORRECTION02: each loadKernel() call must return a fresh Elm
// application instance with independent state. The Elm bundle's IIFE
// registers a global `this.Elm = scope.Elm` which can only be evaluated
// once per process (it crashes on "Your page is loading multiple
// Elm scripts"). After the first evaluation we KEEP THE PARSED CODE
// in module scope but never re-execute it; instead, every call to
// loadKernel() looks up the cached `Elm` global (which the IIFE
// attached to `globalThis` on first evaluation) and calls
// Elm.Main.init({}) to create a fresh app. Each app has independent
// state — Elm's worker pattern is message-driven on a per-app model.
//
// On the very first loadKernel() we evaluate the IIFE. On every
// subsequent loadKernel() we read `globalThis.Elm` (set by the
// bundle's `_Platform_export({'Main':...})(this)` line) without
// re-executing the bundle.

let _bundleEvaluated = false
let _kernelCodeCache: { path: string; code: string } | null = null
let _ElmRef: { Main: { init: (flags: unknown) => { ports: { inbound: { send: (n: unknown) => void }; outbound: { subscribe: (cb: (v: unknown) => void) => void } } } } } | null = null

function evaluateBundleOnce(kernelPath: string): void {
	if (_bundleEvaluated) return
	if (!_kernelCodeCache || _kernelCodeCache.path !== kernelPath) {
		_kernelCodeCache = { path: kernelPath, code: fs.readFileSync(kernelPath, "utf8") }
	}
	const scope: Record<string, unknown> = {}
	const evaluator = new Function("scope", _kernelCodeCache.code + "; return this.Elm;")
	evaluator(scope)
	_ElmRef = (globalThis as { Elm?: typeof _ElmRef }).Elm ?? null
	if (!_ElmRef) {
		throw new Error("KERNEL_LOAD_FAIL: Elm bundle did not expose globalThis.Elm after evaluation")
	}
	_bundleEvaluated = true
}

export function loadKernel(kernelPath: string): KernelHandle {
	const fullPath = path.isAbsolute(kernelPath) ? kernelPath : path.resolve(kernelPath)
	evaluateBundleOnce(fullPath)
	if (!_ElmRef) {
		throw new Error("KERNEL_LOAD_FAIL: Elm reference is null after evaluateBundleOnce")
	}
	const app = _ElmRef.Main.init({})
	if (!app || !app.ports || !app.ports.inbound || !app.ports.outbound) {
		throw new Error("KERNEL_LOAD_FAIL: Elm.Main.init did not expose ports.inbound/outbound")
	}
	const queue: KernelOutbound[] = []
	app.ports.outbound.subscribe((v: unknown) => {
		queue.push(v as KernelOutbound)
	})
	queue.splice(0, queue.length)
	return {
		send: (msg: Record<string, unknown>) => app.ports.inbound.send(msg),
		drainOutbound: () => queue.splice(0, queue.length),
	}
}
// CORRECTION01: the Elm kernel delivers outbound port messages
// asynchronously (microtask-deferred). Drain the queue only after
// awaiting a microtask boundary, otherwise the test sees an empty
// queue and the `after.violation` classifier misses real signals.
const FLUSH_TICK_MS = 0

async function flushKernel(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TICK_MS))
}

export async function replayTrace(args: { kernel: KernelHandle; tracePath: string }): Promise<ReplayResult> {
	const fullPath = path.isAbsolute(args.tracePath) ? args.tracePath : path.resolve(args.tracePath)
	const text = fs.readFileSync(fullPath, "utf8")
	const sha256 = sha256Hex(text)
	const lines = text.split("\n").filter((l) => l.trim().length > 0)
	const events: ReplayEvent[] = []
	let tsCompletionCommitted = false
	let tsCompletionCommittedSeq: number | null = null
	let firstDivergenceSeq: number | null = null
	let firstDivergenceKind: ReplayResult["firstDivergenceKind"] = null
	let firstDivergenceStage: string | null = null
	let finalModel: Record<string, unknown> | null = null
	const manufacturedIdentityCount = 0
	const originRewriteCount = 0
	let unmodeledEventCount = 0
	let insufficientIdentityCount = 0
	for (const line of lines) {
		const record = JSON.parse(line) as Record<string, unknown>
		const seq = typeof record.seq === "number" ? record.seq : -1
		const sourceStage = String(record.stage ?? record.event ?? "")
		const sourceOrigin = record.origin === undefined ? undefined : String(record.origin)
		if (sourceStage === "task_completion_committed") {
			tsCompletionCommitted = true
			tsCompletionCommittedSeq = seq
		}
		const outcome = adaptRecord(record)
		if (outcome.status === "INSUFFICIENT_IDENTITY") {
			insufficientIdentityCount++
			events.push({
				seq,
				at: typeof record.at === "number" ? record.at : undefined,
				sourceStage,
				sourceOrigin,
				classification: "INSUFFICIENT_IDENTITY",
				reason: outcome.reason,
			})
			if (firstDivergenceSeq === null) {
				firstDivergenceSeq = seq
				firstDivergenceKind = "INSUFFICIENT_IDENTITY"
				firstDivergenceStage = sourceStage
			}
			continue
		}
		if (outcome.status === "UNMODELED_EVENT") {
			unmodeledEventCount++
			events.push({
				seq,
				at: typeof record.at === "number" ? record.at : undefined,
				sourceStage,
				sourceOrigin,
				classification: "UNMODELED_EVENT",
				reason: outcome.reason,
			})
			if (firstDivergenceSeq === null) {
				firstDivergenceSeq = seq
				firstDivergenceKind = "UNMODELED_EVENT"
				firstDivergenceStage = sourceStage
			}
			continue
		}
		args.kernel.send(outcome.elmMsg)
		await flushKernel()
		const out = args.kernel.drainOutbound()
		const decodeError = out.find((o) => o.kind === "decode_error")
		// The kernel is message-driven and synchronous: one inbound
		// `send` produces exactly one outbound state. Use the LAST
		// state in the queue (the most recent) as the post-state
		// for this transition. CORRECTION01: prefer the LAST state
		// over the FIRST so violations emitted later are not
		// shadowed by an earlier, harmless state in the same batch.
		const stateMessages = out.filter((o) => o.kind === "state")
		const stateOut = stateMessages[stateMessages.length - 1]
		const after = stateOut && stateOut.kind === "state" ? { model: stateOut.model, violation: stateOut.violation } : undefined
		finalModel = after?.model ?? finalModel
		if (decodeError) {
			events.push({
				seq,
				at: typeof record.at === "number" ? record.at : undefined,
				sourceStage,
				sourceOrigin,
				classification: "DECODER_REJECTED",
				reason: `Elm decoder rejected ${sourceStage} mapped to ${outcome.elmMsg.tag}: ${decodeError.error}`,
				elmMsg: outcome.elmMsg,
				after: after ? { model: after.model, violation: after.violation } : undefined,
			})
			if (firstDivergenceSeq === null) {
				firstDivergenceSeq = seq
				firstDivergenceKind = "ELM_REJECTS_TS_SEQUENCE"
				firstDivergenceStage = sourceStage
			}
			continue
		}
		// CORRECTION01: a state.violation is itself a load-bearing
		// signal — the Elm kernel accepted the message but rejected
		// the transition. Treat it as ELM_REJECTS_TS_SEQUENCE rather
		// than a quiet DIRECT.
		if (after && after.violation) {
			events.push({
				seq,
				at: typeof record.at === "number" ? record.at : undefined,
				sourceStage,
				sourceOrigin,
				classification: "ELM_REJECTS_TS_SEQUENCE",
				reason: `Elm kernel emitted violation=${after.violation} after ${sourceStage} mapped to ${outcome.elmMsg.tag}`,
				elmMsg: outcome.elmMsg,
				after,
			})
			if (firstDivergenceSeq === null) {
				firstDivergenceSeq = seq
				firstDivergenceKind = "ELM_REJECTS_TS_SEQUENCE"
				firstDivergenceStage = sourceStage
			}
			continue
		}
		events.push({
			seq,
			at: typeof record.at === "number" ? record.at : undefined,
			sourceStage,
			sourceOrigin,
			classification: "DIRECT",
			reason: `mapped to ${outcome.elmMsg.tag}`,
			elmMsg: outcome.elmMsg,
			after: after ? { model: after.model, violation: after.violation } : undefined,
		})
	}
	const canonical = canonicalize({
		trace: path.relative(path.resolve("."), fullPath),
		events: events.map((e) => ({
			seq: e.seq,
			sourceStage: e.sourceStage,
			sourceOrigin: e.sourceOrigin,
			classification: e.classification,
			reason: e.reason,
			elmMsg: e.elmMsg,
			after: e.after ? { model: e.after.model, violation: e.after.violation } : undefined,
		})),
		firstDivergenceSeq,
		firstDivergenceKind,
		firstDivergenceStage,
		finalModel,
		tsCompletionCommitted,
		tsCompletionCommittedSeq,
		manufacturedIdentityCount,
		originRewriteCount,
		unmodeledEventCount,
		insufficientIdentityCount,
	})
	const deterministicSha256 = sha256Hex(canonical)
	return {
		sourceTracePath: fullPath,
		sourceTraceSha256: sha256,
		eventsTotal: lines.length,
		events,
		firstDivergenceSeq,
		firstDivergenceKind,
		firstDivergenceStage,
		finalModel,
		tsCompletionCommitted,
		tsCompletionCommittedSeq,
		manufacturedIdentityCount,
		originRewriteCount,
		unmodeledEventCount,
		insufficientIdentityCount,
		deterministicSha256,
	}
}

function canonicalize(v: unknown): string {
	if (v === null) return "null"
	if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null"
	if (typeof v === "string") return JSON.stringify(v)
	if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`
	if (typeof v === "object") {
		const obj = v as Record<string, unknown>
		const keys = Object.keys(obj).sort()
		const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
		return `{${parts.join(",")}}`
	}
	return "null"
}

export function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex")
}
