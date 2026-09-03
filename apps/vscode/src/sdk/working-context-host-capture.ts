/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (nineteenth-pass) — Host-side capture of AgentRuntime's
 * canonical W.
 *
 * PURPOSE
 * -------
 * A lightweight in-memory store that captures the canonical
 * `AgentRuntimeStateSnapshot.currentWorkingContextEstimate`
 * value as it arrives on the
 * `working-context-state-changed` runtime event, so the
 * host-side webview-state projection
 * (`getStateToPostToWebview`) can transport it into the
 * `ExtensionState` payload that the ChatView consumes.
 *
 * This is the Boundary-3-side component of the P3 carrier.
 * The Boundary-4-side is `getStateToPostToWebview` (which
 * reads the carrier and includes it in the projected
 * payload). The full chain is:
 *
 *   AgentRuntime.prepareTurn W
 *     -> working-context-state-changed { snapshot.W }
 *     -> LocalRuntimeHost.subscribeRuntimeEvents
 *     -> apps/vscode canonical subscription
 *         (apps/vscode/src/sdk/SdkController
 *           .attachCanonicalRuntimeEventSubscription)
 *     -> [THIS CARRIER] .observe(event)
 *     -> getStateToPostToWebview reads
 *          carrier.currentWorkingContextEstimate
 *     -> ExtensionState.currentWorkingContextEstimate
 *     -> ChatView / TaskHeader / ContextWindow
 *        (next-pass GREEN, after this carrier lands)
 *
 * ASSIGNMENT SEMANTICS (load-bearing conservation)
 * -------------------------------------------------
 * The runtime's STATE_BIND contract is fail-closed:
 * a missing W reaches this observer as
 * `snapshot.currentWorkingContextEstimate === undefined`.
 * This observer MUST use unconditional assignment
 *
 *     this._latest =
 *       event.snapshot.currentWorkingContextEstimate
 *
 * (which includes `undefined` when the field is absent)
 * so the host W slot is honest about the latest authority.
 * A conditional skip such as
 *
 *     if (event.snapshot.currentWorkingContextEstimate
 *           !== undefined) {
 *       this._latest = event.snapshot.currentWorking
 *         ContextEstimate
 *     }
 *
 * would resurrect stale-W behavior (the previous captured
 * value would persist across a runtime "no W" emit). That
 * is FORBIDDEN by the
 *
 *   UNDEFINED_W_STALE_REUSE = FORBIDDEN
 *
 * invariant in the ACT body. This implementation enforces
 * the rule at the type/source level by never branching on
 * `event.snapshot.currentWorkingContextEstimate` — every
 * observed `working-context-state-changed` event REPLACES
 * the slot unconditionally.
 *
 * (twenty-first-pass) — Boundary 5 normalization:
 * the slot's public surface is `number | null`. The
 * runtime-published `undefined` is normalized to `null`
 * in `observe()` so the webview can distinguish
 * "runtime cleared" (`null`) from "carrier absent /
 * legacy path" (`undefined` at the projection layer).
 * The carrier assignment is STILL unconditional — a
 * conditional skip would resurrect stale-W.
 *
 * NOT RECOMPUTED
 * --------------
 * The carrier is transport only. It does not import or use
 * `estimateRequestInputTokens` / `estimateMessageTokens`
 * (those are forbidden by the conservation rule of the
 * P3 contract). It does not call the runtime estimator
 * machinery; it only reads the snapshot field the runtime
 * itself produced.
 */

import type { AgentRuntimeEvent } from "@cline/shared"

/**
 * The host-side projection surface. Implementations only
 * need to expose the latest captured W.
 *
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-first-pass) — Boundary 5 normalization:
 *
 * The carrier's slot type is `number | null`, where:
 *   - `number` = runtime published a W value
 *   - `null`   = runtime emitted a no-W
 *                `working-context-state-changed` event
 *                (or the carrier has never observed an
 *                event since construction). The webview
 *                interprets `null` as "runtime cleared"
 *                and renders the bar UNAVAILABLE per
 *                reviewer twentieth-pass fallback B.
 *
 * `undefined` is FORBIDDEN at the carrier surface: the
 * absence of a value at this layer means "legacy /
 * classic path / no Boundary 3 -> 4 wiring" — handled
 * at the projection / producer layer instead. Keeping
 * `undefined` out of the carrier prevents the
 * runtime-cleared case from being misclassified as a
 * legacy-omission case downstream.
 */
export interface WorkingContextHostCaptureState {
	readonly currentWorkingContextEstimate: number | null
}

/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-sixth-pass) — optional side-channel observer
 * hook. Called from `observe()` AFTER the carrier
 * assignment, so the trace captures the post-assignment
 * state. Used by the temporary Q1..Q4 W-carrier
 * diagnostic; production code that does not opt in
 * simply leaves it undefined.
 */
export type WorkingContextHostObserveTrace = (info: {
	eventType: string
	carrierW: number | null
	snapshotW: number | undefined
}) => void

export class WorkingContextHostCapture implements WorkingContextHostCaptureState {
	private _latest: number | null = null

	get currentWorkingContextEstimate(): number | null {
		return this._latest
	}

	/**
	 * Optional trace observer. Set via `setTraceObserver`.
	 * The trace is a pure side-channel; it does NOT
	 * influence carrier assignment semantics.
	 */
	private _traceObserver: WorkingContextHostObserveTrace | undefined

	/**
	 * Wire the optional Q1..Q4 trace observer. Called
	 * once during SdkController construction when the
	 * diagnostic is enabled. Production code that does
	 * not opt in simply leaves this undefined.
	 */
	setTraceObserver(observer: WorkingContextHostObserveTrace | undefined): void {
		this._traceObserver = observer
	}

	/**
	 * Observe one canonical runtime event. Fast-skips any
	 * event whose type is not
	 * `working-context-state-changed`. Called from the
	 * SdkController's canonical runtime-event subscription
	 * for every event the runtime emits (recovery,
	 * execution, working-context, etc.).
	 *
	 * For a `working-context-state-changed` event, the
	 * observer captures `event.snapshot.currentWorking
	 * ContextEstimate` into `_latest` using UNCONDITIONAL
	 * assignment (see the file-level comment on the
	 * conservation semantics). When the snapshot's W
	 * is `undefined` (the runtime's no-W lifetime), the
	 * carrier normalizes to `null` so the boundary-5
	 * fallback (reviewer twentieth-pass) can
	 * distinguish "runtime cleared" from "legacy
	 * carrier absent" downstream.
	 */
	observe(event: AgentRuntimeEvent): void {
		if (event.type === "working-context-state-changed") {
			// ASSIGNMENT — do NOT conditionally skip.
			// Including `undefined` (normalized to
			// `null` here) is the only way to
			// propagate the runtime's fail-closed W
			// lifetime to the host side. Stale-W
			// reuse is FORBIDDEN.
			const w = event.snapshot.currentWorkingContextEstimate
			this._latest = typeof w === "number" ? w : null
			// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
			// (twenty-sixth-pass): emit one Q1..Q4 carrier_observe
			// trace record AFTER the assignment. The carrier
			// surface value (`this._latest`) is the post-
			// normalization number | null that the webview
			// will see; the snapshot value (`w`) is the
			// raw publisher-side value (number | undefined).
			// This row answers Q3 (did the event reach the
			// host?) and Q2 (what did the snapshot carry?).
			this._traceObserver?.({
				eventType: event.type,
				carrierW: this._latest,
				snapshotW: w,
			})
		}
	}

	/**
	 * Test seam: build a capture pre-populated with an
	 * initial value. Production code never calls this.
	 */
	static forTest(initial: number | null): WorkingContextHostCapture {
		const c = new WorkingContextHostCapture()
		c._latest = initial
		return c
	}

	/**
	 * ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01
	 * (PASS POST_COMPACTION_PUBLICATION_REPAIRED):
	 *
	 * PRODUCTION SEAM — write a `currentWorkingContextEstimate`
	 * that came from outside the canonical runtime-event
	 * subscription (specifically, the manual-compaction producer
	 * seam at `apps/vscode/src/sdk/sdk-compaction.ts`). The
	 * carrier assignment semantics (UNDEFINED_W_STALE_REUSE =
	 * FORBIDDEN) are preserved verbatim — `null` for non-number
	 * inputs, unconditional assignment otherwise.
	 *
	 * This is the transport-only publication the bounded repair
	 * uses to drive the host-side webview bar without forcing a
	 * full runtime-emit round-trip.
	 */
	setLatest(estimate: number | null): void {
		this._latest = typeof estimate === "number" ? estimate : null
	}
}
