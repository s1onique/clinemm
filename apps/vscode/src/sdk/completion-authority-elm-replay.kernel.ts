import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { KernelHandle, KernelOutbound, ReplayEvent, ReplayResult } from "./completion-authority-elm-replay"
import { adaptRecord } from "./completion-authority-elm-replay"

export function loadKernel(kernelPath: string): KernelHandle {
	const fullPath = path.isAbsolute(kernelPath) ? kernelPath : path.resolve(kernelPath)
	const code = fs.readFileSync(fullPath, "utf8")
	const scope: Record<string, unknown> = {}
	const fn = new Function("scope", code + "; return this.Elm;")
	const Elm = fn(scope) as {
		Main: {
			init: (flags: unknown) => {
				ports: { inbound: { send: (n: unknown) => void }; outbound: { subscribe: (cb: (v: unknown) => void) => void } }
			}
		}
	}
	const app = Elm.Main.init({})
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
export function replayTrace(args: { kernel: KernelHandle; tracePath: string }): ReplayResult {
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
		const out = args.kernel.drainOutbound()
		const decodeError = out.find((o) => o.kind === "decode_error")
		const stateOut = out.find((o) => o.kind === "state")
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
