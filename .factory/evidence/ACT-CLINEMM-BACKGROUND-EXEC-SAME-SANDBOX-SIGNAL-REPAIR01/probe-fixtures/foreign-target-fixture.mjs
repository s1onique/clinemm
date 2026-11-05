#!/usr/bin/env node
/**
 * Finite foreign target for the repaired Seatbelt signal scope.
 * Marker: CLINEMM_REPAIR01_FOREIGN_TARGET
 *
 * The target is started OUTSIDE the ClineMM production sandbox by the
 * operator harness.  It self-exits after 12 seconds and records any SIGTERM
 * it receives.  Its identity is captured from its anchored READY marker and
 * verified by PID, argv, numeric uid, and process start identity before any
 * signal attempt.
 */
import { appendFileSync } from "node:fs"

const MARKER = "CLINEMM_REPAIR01_FOREIGN_TARGET"
const LIFETIME_MS = 12_000
const logPath = process.argv[2]
if (!logPath) {
	console.error("usage: foreign-target-fixture.mjs <log-path>")
	process.exit(2)
}

appendFileSync(logPath, `FOREIGN_READY pid=${process.pid} ppid=${process.ppid} marker=${MARKER}\n`)
const timer = setTimeout(() => {
	appendFileSync(logPath, `FOREIGN_SELF_EXIT pid=${process.pid}\n`)
	process.exit(0)
}, LIFETIME_MS)
process.on("SIGTERM", () => {
	appendFileSync(logPath, `FOREIGN_GOT_SIGTERM pid=${process.pid}\n`)
	clearTimeout(timer)
	process.exit(0)
})
setInterval(() => {}, 250)
