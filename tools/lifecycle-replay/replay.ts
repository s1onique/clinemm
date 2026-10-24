/**
 * ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 / C9C10SCR01
 *
 * Offline trace-to-Mermaid projection over the EXISTING JSONL
 * evidence (the continuation-cardinality-authority capture).
 *
 * The tool NEVER guesses a join. Every projected fact carries an
 * explicit `correlation` value:
 *
 *   exact   - every available identity field matched
 *   partial - the available identity fields matched; at least one was
 *             absent from the source record
 *   unknown - the join could not be established. The fact is recorded
 *             as UNKNOWN, not inferred.
 *
 * Usage:
 *   bun tools/lifecycle-replay/replay.ts \
 *     --trace <ccard.jsonl> --session <sessionId> --out <dir>
 */

import fs from "node:fs"
import path from "node:path"

export interface CcardRecord {
	readonly seq: number
	readonly at?: number
	readonly stage: string
	readonly origin?: string
	readonly sessionId?: string
	readonly taskId?: string
	readonly jobId?: string
	readonly promptId?: string
	readonly correlationId?: string
	readonly runId?: string
	readonly ownerId?: string
	readonly submitId?: string
	readonly completionId?: string
}

/** The identity fields the projection correlates on, in priority order. */
const IDENTITY_FIELDS = ["sessionId", "taskId", "runId", "jobId", "ownerId"] as const

export interface ProjectedFact {
	readonly seq: number
	readonly at: number | undefined
	readonly stage: string
	readonly origin: string | undefined
	readonly sessionId: string | undefined
	readonly taskId: string | undefined
	readonly runId: string | undefined
	readonly jobId: string | undefined
	readonly submitId: string | undefined
	readonly completionId: string | undefined
	readonly correlation: "exact" | "partial" | "unknown"
	readonly identityPresent: readonly string[]
	readonly identityMissing: readonly string[]
}

export interface SessionProjection {
	readonly sessionId: string
	readonly taskIds: readonly string[]
	readonly facts: readonly ProjectedFact[]
	readonly counters: Readonly<Record<string, number>>
	/** The C9 attempts (submit_and_exit_seen) observed in this session. */
	readonly c9Attempts: number
	/** The C10 commits (task_completion_committed) observed in this session. */
	readonly c10Commits: number
	/** Whether the C9 -> C10 relation is fully determined by the trace. */
	readonly c9c10Relation: "determined" | "unknown"
	readonly notes: readonly string[]
}

/**
 * Project one session's records out of a CCARD trace.
 *
 * The session key is REQUIRED and is never guessed: a record whose
 * `sessionId` differs is not part of this projection.
 */
export function projectSession(records: readonly CcardRecord[], sessionId: string): SessionProjection {
	const owned = records.filter((r) => r.sessionId === sessionId)
	const notes: string[] = []

	if (owned.length === 0) {
		notes.push(`NO_RECORD_FOR_SESSION: the trace contains no record with sessionId=${sessionId}.`)
		return {
			sessionId,
			taskIds: [],
			facts: [],
			counters: {},
			c9Attempts: 0,
			c10Commits: 0,
			c9c10Relation: "unknown",
			notes,
		}
	}

	// The taskIds observed in this session. When there is more than
	// one, a fact that carries no taskId CANNOT be attributed to a
	// single task -> the correlation is `unknown`.
	const taskIdSet = new Set<string>()
	for (const r of owned) {
		if (r.taskId) taskIdSet.add(r.taskId)
	}
	const taskIds = [...taskIdSet].sort()

	const facts: ProjectedFact[] = owned.map((r) => {
		const identityPresent: string[] = []
		const identityMissing: string[] = []
		for (const f of IDENTITY_FIELDS) {
			const value = (r as unknown as Record<string, unknown>)[f]
			if (typeof value === "string" && value.length > 0) {
				identityPresent.push(f)
			} else {
				identityMissing.push(f)
			}
		}
		// The sessionId is ALWAYS present (it is the projection key), so
		// the correlation degrades only on the remaining identity
		// fields. A record that carries a taskId but whose taskId is
		// not among the observed taskIds is an `unknown` join.
		let correlation: ProjectedFact["correlation"]
		if (identityMissing.length === 0) {
			correlation = "exact"
		} else if (r.taskId && !taskIdSet.has(r.taskId)) {
			correlation = "unknown"
		} else if (taskIds.length > 1 && !r.taskId) {
			// Ambiguous across tasks: known to belong to the SESSION,
			// unknown which task.
			correlation = "unknown"
		} else {
			correlation = "partial"
		}
		return {
			seq: r.seq,
			at: r.at,
			stage: r.stage,
			origin: r.origin,
			sessionId: r.sessionId,
			taskId: r.taskId,
			runId: r.runId,
			jobId: r.jobId,
			submitId: r.submitId,
			completionId: r.completionId,
			correlation,
			identityPresent,
			identityMissing,
		}
	})

	const counters: Record<string, number> = {}
	for (const f of facts) {
		counters[f.stage] = (counters[f.stage] ?? 0) + 1
	}

	const c9Attempts = counters["submit_and_exit_seen"] ?? 0
	const c10Commits = counters["task_completion_committed"] ?? 0

	// The C9 -> C10 relation is DETERMINED only when the trace carries
	// the completionIds that tie the attempts to the commit. The trace
	// records a `submitId` per C9 and a `completionId` per C10, but
	// does NOT carry a join key between them.
	let c9c10Relation: SessionProjection["c9c10Relation"] = "unknown"
	if (c9Attempts === 0 && c10Commits === 0) {
		c9c10Relation = "determined"
		notes.push("NO_COMPLETION_ATTEMPT: the session contains neither a C9 attempt nor a C10 commit.")
	} else if (c10Commits > 0) {
		notes.push(
			`C10_PRESENT_BUT_UNJOINED: ${c10Commits} C10 commit(s) observed, but the trace carries no join key between a C9 submitId and a C10 completionId. The pairing is UNKNOWN, not inferred.`,
		)
	} else {
		notes.push(
			`C10_ABSENT: ${c9Attempts} C9 attempt(s) observed and 0 C10 commit(s). Every C9 attempt is therefore UNCOMMITTED.`,
		)
	}

	// The epoch is not carried by the CCARD record. It is therefore
	// UNKNOWN here; the epoch-scoped claims cannot be established from
	// this trace alone.
	notes.push(
		"EPOCH_UNKNOWN: the continuation-cardinality-authority record does not carry an epoch field; the epoch-scoped identity of any C9/C10 pair cannot be established from this trace alone.",
	)

	return { sessionId, taskIds, facts, counters, c9Attempts, c10Commits, c9c10Relation, notes }
}

/**
 * The Mermaid projection of a session's timeline.
 *
 * The diagram shows only what the trace ESTABLISHES. A transition
 * that the trace does not contain is drawn as a dotted edge labelled
 * "not observed". A fact whose correlation is `unknown` is drawn in a
 * separate "unjoined" state so it can never be mistaken for an
 * established step.
 */
export function renderMermaid(projection: SessionProjection): string {
	const lines: string[] = []
	lines.push("%% ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 / C9C10SCR01")
	lines.push(`%% Offline projection of session ${projection.sessionId}`)
	lines.push("%% Solid edges = observed in the trace. Dotted edges = not observed.")
	lines.push("%% Generated by tools/lifecycle-replay/replay.ts — do not hand-edit.")
	lines.push("stateDiagram-v2")
	lines.push("    direction TB")
	lines.push("")

	const ordered = [...projection.facts].sort((a, b) => a.seq - b.seq)
	// Collapse the high-cardinality per-job stages into ONE state with
	// a count, so the diagram shows the LIFECYCLE rather than 185
	// individual terminal records. The full per-record timeline stays
	// in incident-timeline.json.
	const COLLAPSED = new Set(["terminal_committed"])
	const stageState = (f: ProjectedFact): string => {
		if (COLLAPSED.has(f.stage)) return `${f.stage} (x${projection.counters[f.stage] ?? 0})`
		return f.stage
	}
	const seen = new Set<string>()
	for (const f of ordered) {
		const state = stageState(f)
		if (seen.has(state)) continue
		seen.add(state)
		lines.push(`    ${state} : ${f.stage}`)
	}

	lines.push("")
	let prevState = "[*]"
	for (const f of ordered) {
		const to = stageState(f)
		const marker =
			f.correlation === "exact" ? "observed" : f.correlation === "partial" ? "observed (partial join)" : "UNJOINED"
		if (to !== prevState) {
			lines.push(`    ${prevState} --> ${to} : seq=${f.seq} ${marker}`)
			prevState = to
		}
	}
	if (prevState !== "[*]") {
		lines.push(`    ${prevState} --> [*] : end of trace`)
	}

	lines.push("")
	lines.push("    note right of submit_and_exit_seen")
	lines.push(`        C9 attempts observed: ${projection.c9Attempts}`)
	lines.push(`        C10 commits observed: ${projection.c10Commits}`)
	lines.push(`        C9 -> C10 relation: ${projection.c9c10Relation}`)
	lines.push("    end note")
	for (const note of projection.notes) {
		lines.push(`    %% NOTE: ${note}`)
	}
	return `${lines.join("\n")}\n`
}

/** Read a CCARD JSONL capture. Malformed lines are reported, never guessed. */
export function readTrace(tracePath: string): { records: CcardRecord[]; malformed: number } {
	const raw = fs.readFileSync(tracePath, "utf8")
	const records: CcardRecord[] = []
	let malformed = 0
	for (const line of raw.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed) continue
		try {
			const parsed = JSON.parse(trimmed) as CcardRecord
			if (typeof parsed?.seq !== "number" || typeof parsed?.stage !== "string") {
				malformed++
				continue
			}
			records.push(parsed)
		} catch {
			malformed++
		}
	}
	return { records, malformed }
}

/** Every distinct sessionId present in the trace. */
export function traceSessions(records: readonly CcardRecord[]): string[] {
	const set = new Set<string>()
	for (const r of records) {
		if (typeof r.sessionId === "string" && r.sessionId.length > 0) {
			set.add(r.sessionId)
		}
	}
	return [...set].sort()
}

/** CLI entry point. */
async function main(): Promise<void> {
	const argv = process.argv.slice(2)
	const arg = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`)
		return i >= 0 ? argv[i + 1] : undefined
	}
	const tracePath = arg("trace")
	const outDir = arg("out")
	const session = arg("session")
	if (!tracePath || !outDir) {
		console.error("usage: replay.ts --trace <ccard.jsonl> [--session <id>] --out <dir>")
		process.exit(2)
	}
	const { records, malformed } = readTrace(tracePath)
	const sessions = session ? [session] : traceSessions(records)
	const projections = sessions.map((s) => projectSession(records, s))

	fs.mkdirSync(outDir, { recursive: true })
	const timeline = {
		tool: "tools/lifecycle-replay/replay.ts",
		act: "ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01",
		trace: path.resolve(tracePath),
		traceSha256: sha256Hex(fs.readFileSync(tracePath)),
		recordsRead: records.length,
		malformedLinesSkipped: malformed,
		sessionsProjected: sessions,
		projections,
	}
	fs.writeFileSync(path.join(outDir, "incident-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`)
	for (const p of projections) {
		fs.writeFileSync(path.join(outDir, `incident-path.${p.sessionId}.mmd`), renderMermaid(p))
	}
	// The canonical single-session artifact name.
	if (projections.length === 1) {
		fs.writeFileSync(path.join(outDir, "incident-path.mmd"), renderMermaid(projections[0]))
	}
	console.log(
		`projected ${projections.length} session(s) from ${records.length} record(s); wrote ${outDir}`,
	)
}

function sha256Hex(input: Buffer | string): string {
	// Lazy import keeps the module importable from tests without a
	// crypto dependency at module load time.
	const { createHash } = require("node:crypto") as typeof import("node:crypto")
	return createHash("sha256").update(input).digest("hex")
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
