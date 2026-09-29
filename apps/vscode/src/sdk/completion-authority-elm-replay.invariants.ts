import fs from "node:fs"
import { adaptRecord } from "./completion-authority-elm-replay"
import { sha256Hex } from "./completion-authority-elm-replay.kernel"

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

export function adapterPreservesOrder(tracePath: string): { preserved: boolean; observedSeqs: number[] } {
	const lines = fs
		.readFileSync(tracePath, "utf8")
		.split("\n")
		.filter((l) => l.trim().length > 0)
	const seqs = lines.map((l) => JSON.parse(l).seq as number)
	const sorted = [...seqs].sort((a, b) => a - b)
	return { preserved: JSON.stringify(seqs) === JSON.stringify(sorted), observedSeqs: seqs }
}

export function adapterIsExplicitForUnknownStage(): { ok: boolean } {
	const out = adaptRecord({ stage: "wat_is_this", seq: 0, at: 0 })
	return { ok: out.status === "UNMODELED_EVENT" }
}

export function adapterIsExplicitForMissingId(): { ok: boolean } {
	const out = adaptRecord({ stage: "run_turn_started", origin: "explicit_user", sessionId: "s", seq: 0, at: 0 })
	return { ok: out.status === "INSUFFICIENT_IDENTITY" }
}

export function adapterIsDeterministic(): { ok: boolean; sha1: string; sha2: string } {
	const r = { seq: 1, at: 0, stage: "pending_prompt_enqueued", origin: "pending_prompt_drain", sessionId: "s", promptId: "p1" }
	const a = adaptRecord(r)
	const b = adaptRecord(r)
	const sha1 = sha256Hex(canonicalize(a))
	const sha2 = sha256Hex(canonicalize(b))
	return { ok: sha1 === sha2, sha1, sha2 }
}

export function adapterPreservesOrigin(): { ok: boolean } {
	const r = {
		seq: 1,
		at: 0,
		stage: "pending_prompt_enqueued",
		origin: "this_is_a_bespoke_origin",
		sessionId: "s",
		promptId: "p1",
	}
	const out = adaptRecord(r)
	if (out.status !== "DIRECT") return { ok: false }
	const originOut = (out.elmMsg as Record<string, unknown>).origin
	return { ok: originOut === "this_is_a_bespoke_origin" }
}

export function adapterNeverManufacturesIdentity(): { ok: boolean } {
	const r = { seq: 1, at: 0, stage: "run_turn_started", origin: "explicit_user", sessionId: "s" }
	const out = adaptRecord(r)
	return { ok: out.status === "INSUFFICIENT_IDENTITY" }
}
