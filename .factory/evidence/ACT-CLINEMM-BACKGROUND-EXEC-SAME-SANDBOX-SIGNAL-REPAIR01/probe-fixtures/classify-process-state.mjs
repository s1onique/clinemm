#!/usr/bin/env node
/**
 * Fail-closed process-state classifier for
 * ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01.
 * Marker: CLINEMM_REPAIR01_CLASSIFY_PROCESS_STATE
 *
 * WHY THIS EXISTS
 * ---------------
 * The shell implementation this replaces classified a process by string
 * matching the text of `kill -0` output and by falling back to "the `ps`
 * lookup returned nothing, therefore the process is GONE".  That fallback is
 * UNSOUND:
 *
 *   - `kill -0` failing with EPERM means "the process EXISTS but we may not
 *     signal it".  Promoting that to GONE loses a live process.
 *   - If the `ps` lookup itself fails (tool missing, timeout, unreadable
 *     process table) the lookup returns EMPTY, and the old code promoted
 *     that empty result to GONE — reporting absence from a FAILED
 *     observation.
 *
 * The contract required by the qualification runbook is:
 *
 *   ESRCH  -> GONE           (the ONLY thing that establishes absence)
 *   EPERM  -> UNVERIFIABLE   (exists, but not signalable; never absence)
 *   other  -> UNVERIFIABLE
 *   rc=0   -> ALIVE
 *   and a FAILED process-table observation must NEVER override EPERM.
 *
 * This implementation uses the ACTUAL errno from the Node runtime, and
 * consults the process table only as a corroborating observation that can
 * distinguish "exists but unsignalable" from "could not be observed".
 *
 * The decision is exposed as a PURE function so the contract can be proven
 * against every errno/observation combination without needing to manufacture
 * a real EPERM (which requires a process owned by another user).
 *
 * Usage:
 *   node classify-process-state.mjs <pid>          classify a real pid
 *   node classify-process-state.mjs --contract      print the contract matrix
 *
 * Output (single line, authoritative):
 *   ALIVE | GONE | UNVERIFIABLE
 */
import { execFileSync } from "node:child_process"

const CLASSIFIER_MARKER = "CLINEMM_REPAIR01_CLASSIFY_PROCESS_STATE"
const PS_TIMEOUT_MS = 2_000

function signalZero(pid) {
	try {
		process.kill(pid, 0)
		return { ok: true, errnoCode: null }
	} catch (error) {
		return { ok: false, errnoCode: error?.code ?? null }
	}
}

/**
 * Observe the process table.  Returns `{ observed: false }` when the
 * observation FAILED (tool missing, timeout, non-zero exit).  A failed
 * observation carries no information and must never be turned into an
 * absence claim.
 */
function observeProcessTable(pid) {
	try {
		const out = execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], {
			encoding: "utf8",
			timeout: PS_TIMEOUT_MS,
			killSignal: "SIGKILL",
			stdio: ["ignore", "pipe", "ignore"],
		})
		const trimmed = out.trim()
		return { observed: true, present: trimmed.length > 0, argv: trimmed }
	} catch {
		return { observed: false, present: null, argv: null }
	}
}

/**
 * PURE decision function.
 *
 * @param zero   `{ ok: boolean, errnoCode: string|null }` — the signal-zero result.
 * @param table  `{ observed: boolean, present: boolean|null }` — the process-table result.
 * @returns "ALIVE" | "GONE" | "UNVERIFIABLE"
 */
export function classify(zero, table) {
	if (zero.ok) return "ALIVE"
	// ONLY ESRCH establishes absence.
	if (zero.errnoCode === "ESRCH") return "GONE"
	// EPERM (and every other errno) is NOT absence.  A successful process-table
	// observation that SHOWS the process confirms it exists; a FAILED
	// observation carries no information.  Neither may be promoted to GONE.
	if (table.observed && table.present) return "UNVERIFIABLE"
	return "UNVERIFIABLE"
}

/**
 * The contract matrix.  Every row is a (errno, process-table observation)
 * pair with the REQUIRED classification.  This is the machine-checkable
 * statement of the P0-3 correction.
 */
export const CONTRACT_MATRIX = [
	{
		case: "signal-zero succeeds",
		zero: { ok: true, errnoCode: null },
		table: { observed: true, present: true },
		expected: "ALIVE",
	},
	{
		case: "ESRCH — the ONLY thing that establishes absence",
		zero: { ok: false, errnoCode: "ESRCH" },
		table: { observed: true, present: false },
		expected: "GONE",
	},
	{
		case: "EPERM with the process visible in the process table",
		zero: { ok: false, errnoCode: "EPERM" },
		table: { observed: true, present: true },
		expected: "UNVERIFIABLE",
	},
	{
		case: "EPERM with a FAILED process-table observation must not become GONE",
		zero: { ok: false, errnoCode: "EPERM" },
		table: { observed: false, present: null },
		expected: "UNVERIFIABLE",
	},
	{
		case: "EPERM with a successful but EMPTY process-table observation must not become GONE",
		zero: { ok: false, errnoCode: "EPERM" },
		table: { observed: true, present: false },
		expected: "UNVERIFIABLE",
	},
	{
		case: "an unknown errno with a FAILED process-table observation",
		zero: { ok: false, errnoCode: "EIO" },
		table: { observed: false, present: null },
		expected: "UNVERIFIABLE",
	},
	{
		case: "an unknown errno with an empty process-table observation",
		zero: { ok: false, errnoCode: "EIO" },
		table: { observed: true, present: false },
		expected: "UNVERIFIABLE",
	},
]

if (process.argv.includes("--contract")) {
	const results = CONTRACT_MATRIX.map((row) => {
		const actual = classify(row.zero, row.table)
		return { ...row, actual, pass: actual === row.expected }
	})
	const failed = results.filter((r) => !r.pass)
	console.log(
		`CLASSIFIER_CONTRACT_JSON=${JSON.stringify({
			marker: CLASSIFIER_MARKER,
			total: results.length,
			passed: results.length - failed.length,
			failed: failed.length,
			verdict: failed.length === 0 ? "PASS_CLASSIFIER_CONTRACT" : "FAIL_CLASSIFIER_CONTRACT",
			results,
		})}`,
	)
	for (const r of results) {
		console.log(
			`[classifier-contract] ${r.pass ? "PASS" : "FAIL"} ${r.case} — expected=${r.expected} actual=${r.actual}`,
		)
	}
	process.exit(failed.length === 0 ? 0 : 1)
}

const rawPid = process.argv[2]
const pid = Number.parseInt(rawPid ?? "", 10)
if (!Number.isInteger(pid) || pid <= 1) {
	console.log("UNVERIFIABLE")
	process.exit(0)
}

const zero = signalZero(pid)
const table = zero.ok ? { observed: true, present: true } : observeProcessTable(pid)
console.log(classify(zero, table))
process.exit(0)
