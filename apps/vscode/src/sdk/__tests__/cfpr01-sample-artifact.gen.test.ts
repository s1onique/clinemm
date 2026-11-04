/**
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01)
 *
 * EVIDENCE GENERATOR — produces the sample provenance artifact that
 * accompanies the ACT report.
 *
 * It drives the REAL production seams:
 *   - `CommandJobManager` with the documented `terminalPostconditionProbe`
 *     test seam (a FAKE supervisor — NO real process is spawned and NO
 *     real signal is sent),
 *   - the real controller terminal-publication record shape,
 *   - the real C10 blocking-set record shape,
 *   - the real `dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic`
 *     dump adapter.
 *
 * The point of the artifact is to show what an operator gets: the
 * ORIGINAL failure verdict and errno for a job whose evidence has aged
 * out of the ordinary 256-record FIFO.
 *
 * Run with:
 *   CFPR01_OUT=<dir> bun x vitest run --config vitest.config.ts \
 *     src/sdk/__tests__/cfpr01-sample-artifact.gen.test.ts
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SupervisableShellProcess } from "@cline/core"
import { expect, it } from "vitest"
import {
	captureBackgroundJobLivenessAuthorityRecord,
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	clearBackgroundJobLivenessAuthorityProvenanceStore,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
} from "../background-job-liveness-authority"
import { dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic } from "../background-job-liveness-authority-runtime"
import { CommandJobManager } from "../command-job-manager"

function makeSupervisorDouble(pid: number, pgid: number): SupervisableShellProcess {
	let exitResolve: ((v: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | null = null
	const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((r) => {
		exitResolve = r
	})
	return {
		pid,
		pgid,
		exit,
		killTree: async () => {},
		terminateTree: async () => {
			setImmediate(() => {
				exitResolve?.({ exitCode: null, signal: "SIGKILL" })
			})
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	} as unknown as SupervisableShellProcess
}

it("CFPR01-SAMPLE: produces the sample provenance artifact", async () => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	setBackgroundJobLivenessAuthorityCaptureEnabled(true)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	clearBackgroundJobLivenessAuthorityProvenanceStore()

	const manager = new CommandJobManager({
		spawnFactory: () => makeSupervisorDouble(4242, 4242),
		// A DENIED cleanup probe: the invariant is UNPROVEN, not refuted.
		terminalPostconditionProbe: () => ({ postcondition: "eperm", osErrorCode: "EPERM" }),
	})
	const started = await manager.start(
		{ command: "/bin/sh -c 'sleep 60'", cwd: process.cwd(), waitBudgetMs: 5, executionDeadlineMs: 30_000 },
		{ sessionId: "session-1793817350459" } as never,
	)
	const jobId = started.jobId
	await manager.cancel({ jobId })
	for (let i = 0; i < 200; i += 1) {
		const status = await manager.status({ jobId, waitMs: 0 })
		if (status.ok && status.snapshot.state !== "running") break
		await new Promise((r) => setTimeout(r, 10))
	}

	// The controller's terminal-state publication (production record shape).
	captureBackgroundJobLivenessAuthorityRecord({
		event: "containment_terminal_state_published",
		capturedAt: Date.now(),
		managerInstance: null,
		hostInstance: null,
		jobId,
		publishedState: "containment_failed",
		ownerSessionId: "session-1793817350459",
		isContainmentFailure: true,
	})

	// The C10 completion-hold blocking set (production record shape).
	captureBackgroundJobLivenessAuthorityRecord({
		event: "containment_ledger_blocking_set",
		capturedAt: Date.now(),
		managerInstance: null,
		hostInstance: null,
		activeSessionId: "session-1793817350459",
		blockingJobIds: [jobId],
		blockingOwnershipClasses: ["matching_owner"],
		totalContainmentFailureEntries: 4,
		foreignOwnerEntriesExcluded: 0,
		boundary: "c10_completion_attempt",
	})

	// Age the ordinary 256-record FIFO out of the original evidence.
	for (let i = 0; i < 300; i += 1) {
		captureBackgroundJobLivenessAuthorityRecord({
			event: "job_status_lookup",
			capturedAt: Date.now(),
			managerInstance: null,
			hostInstance: null,
			jobId: `ordinary-job-${i}`,
			source: "miss",
			returnedState: null,
		})
	}

	const dir = mkdtempSync(join(tmpdir(), "cfpr01-sample-"))
	const { file, provenanceFile } = await dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic({
		globalStorageUri: { fsPath: dir },
	})
	const jsonl = readFileSync(file, "utf8")
	const provenance = readFileSync(provenanceFile, "utf8")

	// The ordinary FIFO no longer carries the failure record.
	const ordinaryHasFailure = jsonl.includes("containment_failure_classified")
	// The companion artifact DOES.
	const protectedHasFailure = provenance.includes("containment_failure_classified")
	expect(ordinaryHasFailure).toBe(false)
	expect(protectedHasFailure).toBe(true)

	const outDir = process.env.CFPR01_OUT ?? dir
	const out = {
		jobId,
		ordinaryFifoStillContainsFailureRecord: ordinaryHasFailure,
		companionProvenanceContainsFailureRecord: protectedHasFailure,
		ordinaryJsonlRecordCount: jsonl.split("\n").filter((l) => l.length > 0).length,
		provenanceArtifact: JSON.parse(provenance),
	}
	writeFileSync(join(outDir, "cfpr01-sample-provenance.json"), `${JSON.stringify(out, null, 2)}\n`, "utf8")
	process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
	await manager.dispose()
})
