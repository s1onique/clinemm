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
 * `event.snapshot.currentWorkingContextEstimate`.
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
 */
export interface WorkingContextHostCaptureState {
	readonly currentWorkingContextEstimate: number | undefined
}

export class WorkingContextHostCapture
	implements WorkingContextHostCaptureState
{
	private _latest: number | undefined = undefined

	get currentWorkingContextEstimate(): number | undefined {
		return this._latest
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
	 * conservation semantics).
	 */
	observe(event: AgentRuntimeEvent): void {
		if (event.type === "working-context-state-changed") {
			// ASSIGNMENT — do NOT conditionally skip.
			// Including `undefined` is the only way to
			// propagate the runtime's fail-closed W
			// lifetime to the host side.
			this._latest = event.snapshot.currentWorkingContextEstimate
		}
	}

	/**
	 * Test seam: build a capture pre-populated with an
	 * initial value. Production code never calls this.
	 */
	static forTest(initial: number | undefined): WorkingContextHostCapture {
		const c = new WorkingContextHostCapture()
		c._latest = initial
		return c
	}
}
