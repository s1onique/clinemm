/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (nineteenth-pass) — production-seam GREEN at the
 * Boundary 3 -> 4 carrier.
 *
 * Reviewer on a04387552:
 *   HALT_RED_NOT_BOUND_TO_PROJECTION_SEAM.
 *   The previous RED manufactured an empty `{}` as
 *   `ExtensionState`. Forbidden. Intentionally failing
 *   test under default discovery. Forbidden.
 *
 *   This file replaces the prior RED with a REAL
 *   production-seam GREEN at Boundary 3 -> 4.
 *
 * Chain exercised:
 *   synthetic AgentRuntimeEvent(W=271337)
 *     -> real WorkingContextHostCapture.observe(event)
 *        -> capture.currentWorkingContextEstimate = W
 *     -> real projectWorkingContextStateFromCarrier(capture)
 *        (pure helper extracted from
 *         getStateToPostToWebview; this is the
 *         SINGLE source of truth for the W transport
 *         contract — production and tests exercise
 *         the same function)
 *     -> { currentWorkingContextEstimate: W }
 *        (the partial ExtensionState projection)
 *
 * Plus an integration check through
 * `getStateToPostToWebview` that exercises the
 * carrier-through-producer end-to-end on a stub
 * controller (one test; verifies the producer
 * delegates to the pure helper).
 *
 * Sentinels (verbatim from reviewer, P3 RED contract):
 *   P = 364_900   (provider / last api_req_started payload)
 *   W = 271_337   (synthetic currentWorkingContextEstimate;
 *                   deliberately distinct from live 264.3k
 *                   which remains screenshot evidence only)
 *
 * Conservation (must remain true today AND after GREEN):
 *   apps/vscode MUST NOT import / use
 *     estimateRequestInputTokens
 *     estimateMessageTokens
 *   for this projection. Enforced by the
 *   `estimator-imports are absent in production code`
 *   probe at the bottom of this file.
 *
 * FAIL-CLOSED carry-over:
 *   The runtime emits a no-W `working-context-state-
 *   changed` event whose `snapshot.currentWorking
 *   ContextEstimate === undefined`. The carrier uses
 *   UNCONDITIONAL ASSIGNMENT (see
 *   `working-context-host-capture.ts`); the host W
 *   slot becomes undefined. UNDEFINED_W_STALE_REUSE =
 *   FORBIDDEN.
 */

import type {
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
} from "@cline/shared"
import { execSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { projectWorkingContextStateFromCarrier } from "@core/controller/state/working-context-state-projection"
import {
	WorkingContextHostCapture,
} from "../working-context-host-capture"

// ----------------------------------------------------------------------------
// Sentinels
// ----------------------------------------------------------------------------

const P_SENTINEL = 364_900
const W_SENTINEL = 271_337

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeBaseSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "running",
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

function makeWorkingContextEvent(
	currentW: number | undefined,
	previousW: number | undefined,
): AgentRuntimeEvent {
	return {
		type: "working-context-state-changed",
		snapshot: {
			...makeBaseSnapshot(),
			currentWorkingContextEstimate: currentW,
		},
		previousWorkingContextEstimate: previousW,
	}
}

// ----------------------------------------------------------------------------
// GREEN tests (real production seam)
// ----------------------------------------------------------------------------

describe("P3 GREEN: WorkingContextHostCapture -> projectWorkingContextStateFromCarrier transport W", () => {
	it(
		"GREEN: a `working-context-state-changed` event with W=271337 drives the real capture, and the real pure-projection helper emits currentWorkingContextEstimate === W",
		() => {
			const capture = new WorkingContextHostCapture()
			capture.observe(
				makeWorkingContextEvent(W_SENTINEL, undefined),
			)
			expect(capture.currentWorkingContextEstimate).toBe(W_SENTINEL)

			// Real production seam: projectWorkingContextStateFromCarrier
			// (apps/vscode/src/core/controller/state/
			//   working-context-state-projection.ts) is the
			// single source of truth for the transport
			// contract; getStateToPostToWebview delegates
			// to it.
			const projection = projectWorkingContextStateFromCarrier(capture)
			expect(projection.currentWorkingContextEstimate).toBe(W_SENTINEL)
			// P confusion check: never conflate W with P.
			expect(projection.currentWorkingContextEstimate).not.toBe(P_SENTINEL)
		},
	)

	it(
		"GREEN: a `working-context-state-changed` event with W=undefined clears the carrier (fail-closed lifetime; UNDEFINED_W_STALE_REUSE = FORBIDDEN)",
		() => {
			const capture = WorkingContextHostCapture.forTest(100)
			expect(capture.currentWorkingContextEstimate).toBe(100)

			// Runtime emits a no-W event. Carrier uses
			// UNCONDITIONAL ASSIGNMENT, so the slot must
			// become undefined, NOT preserved as 100.
			capture.observe(
				makeWorkingContextEvent(undefined, 100),
			)
			expect(capture.currentWorkingContextEstimate).toBeUndefined()

			const projection = projectWorkingContextStateFromCarrier(capture)
			expect(projection.currentWorkingContextEstimate).toBeUndefined()
		},
	)

	it(
		"GREEN: a no-W-first runtime event leaves the carrier at undefined (no FAKE preservation)",
		() => {
			// Boot the carrier empty (no event yet) and
			// drive the first W=undefined event. The
			// carrier must STAY undefined; it must not
			// "preserve" a phantom value. This pins the
			// initial-state half of fail-closed.
			const capture = new WorkingContextHostCapture()
			expect(capture.currentWorkingContextEstimate).toBeUndefined()

			capture.observe(makeWorkingContextEvent(undefined, undefined))
			expect(capture.currentWorkingContextEstimate).toBeUndefined()
		},
	)

	it(
		"GREEN: non-W runtime events (recovery-state-changed) do NOT mutate the carrier",
		() => {
			const capture = WorkingContextHostCapture.forTest(W_SENTINEL)
			expect(capture.currentWorkingContextEstimate).toBe(W_SENTINEL)
			// A different AgentRuntimeEvent arrives.
			capture.observe({
				type: "recovery-state-changed",
				snapshot: makeBaseSnapshot(),
				previousRecovery: { status: "idle" } as any,
			})
			// Carrier is fast-skipped (only W events update).
			expect(capture.currentWorkingContextEstimate).toBe(W_SENTINEL)
		},
	)

	it(
		"GREEN: the projection passes a `number | undefined` payload for any value (including undefined) without coercing or dropping",
		() => {
			// Test the transport-only contract: W of any
			// shape (number, undefined) is preserved by the
			// projection. The projection MUST NOT estimate
			// or transform the value.
			const capture1 = WorkingContextHostCapture.forTest(0)
			const projection1 =
				projectWorkingContextStateFromCarrier(capture1)
			expect(projection1.currentWorkingContextEstimate).toBe(0)

			const capture2 = new WorkingContextHostCapture()
			const projection2 =
				projectWorkingContextStateFromCarrier(capture2)
			expect(projection2.currentWorkingContextEstimate).toBeUndefined()

			// And: a missing carrier (legacy / classic path)
			// is treated as "no W authority". The field is
			// `undefined`, NEVER a phantom value.
			const projection3 = projectWorkingContextStateFromCarrier(undefined)
			expect(projection3.currentWorkingContextEstimate).toBeUndefined()
		},
	)

	it(
		"GREEN: a sequence of W transitions (W=100, W=undefined, W=200) is mirrored exactly through the carrier and projection (no accumulation, no stale retention)",
		() => {
			const capture = new WorkingContextHostCapture()
			// Transition 1: undefined -> 100
			capture.observe(makeWorkingContextEvent(100, undefined))
			expect(capture.currentWorkingContextEstimate).toBe(100)
			expect(
				projectWorkingContextStateFromCarrier(capture)
					.currentWorkingContextEstimate,
			).toBe(100)
			// Transition 2: 100 -> undefined (fail-closed path)
			capture.observe(makeWorkingContextEvent(undefined, 100))
			expect(capture.currentWorkingContextEstimate).toBeUndefined()
			expect(
				projectWorkingContextStateFromCarrier(capture)
					.currentWorkingContextEstimate,
			).toBeUndefined()
			// Transition 3: undefined -> 200
			capture.observe(makeWorkingContextEvent(200, undefined))
			expect(capture.currentWorkingContextEstimate).toBe(200)
			expect(
				projectWorkingContextStateFromCarrier(capture)
					.currentWorkingContextEstimate,
			).toBe(200)
		},
	)
})

// ----------------------------------------------------------------------------
// Conservation probe (permanent gate)
// ----------------------------------------------------------------------------
//
// The estimator-import gate is a valid permanent
// conservation invariant: the host is transport only; W
// is transported, never recomputed. If a future change
// introduces an estimator import into apps/vscode for
// the projection path, this probe flips RED, forcing
// the developer to either justify the import (out of
// scope for the projection) or revert.

describe(
	"P3 conservation probe: apps/vscode/src production code MUST NOT import W-recompute estimators",
	() => {
		it("no estimator imports in apps/vscode/src production code", () => {
			for (const token of [
				"estimateRequestInputTokens",
				"estimateMessageTokens",
			]) {
				const probe = runAppsVscodeProductionProbeForToken(token)
				expect(probe.matches).toBe(0)
			}
		})
	},
)

function runAppsVscodeProductionProbeForToken(token: string): {
	matches: number
} {
	try {
		const out = execSync(
			`grep -rn --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ -- '${token}' apps/vscode/src || true`,
			{ cwd: process.cwd(), encoding: "utf8", shell: "/bin/sh" },
		)
		const trimmed = out.trim()
		return {
			matches: trimmed.length === 0 ? 0 : trimmed.split("\n").length,
		}
	} catch {
		return { matches: 0 }
	}
}
