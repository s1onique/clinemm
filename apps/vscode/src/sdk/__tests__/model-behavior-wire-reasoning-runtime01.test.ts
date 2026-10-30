/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01 — extension-host
 * runtime witnesses.
 *
 * These witnesses drive the REAL extension-host runtime module
 * (`src/sdk/model-behavior-trace-runtime.ts`), not a re-implementation of
 * it, so the shipped behaviour is what is observed.
 *
 * Gates covered here:
 *   WR10  The recorder is DEFAULT OFF: with the trace disabled, the wire
 *         observer records NOTHING — the evidence channel follows the same
 *         toggle as every other trace channel.
 *   WR11  The recorded wire evidence retains NO prompt, message,
 *         tool-argument or credential material.
 *   WR12  The observer is installed IDEMPOTENTLY and is INDEPENDENT of the
 *         full provider-request capture: installing it never arms
 *         `CLINE_CAPTURE_WIRE` / `CLINE_CAPTURE_PROVIDER_REQUEST`.
 *   WR13  The observer registers with a LIVE `isActive` predicate, so the
 *         provider seam can skip the request-body read entirely while the
 *         trace is OFF — and an ON/OFF toggle takes effect for the NEXT
 *         provider request without a re-registration or a new gateway.
 */

import { isModelBehaviorWireReasoningObserverActive } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	_resetModelBehaviorTrace,
	getModelBehaviorTraceRecords,
	installModelBehaviorWireReasoningObserver,
	recordModelBehaviorTraceWireReasoning,
	setModelBehaviorTraceEnabled,
} from "../model-behavior-trace-runtime"

/** A distinctive marker that must never survive into a trace record. */
const SECRET_MARKER = "SECRET-CREDENTIAL-MUST-NOT-LEAK"
const PROMPT_MARKER = "PROMPT-CONTENT-MUST-NOT-LEAK"

describe("model behavior wire-reasoning runtime", () => {
	beforeEach(() => {
		_resetModelBehaviorTrace()
		setModelBehaviorTraceEnabled(false)
	})

	afterEach(() => {
		_resetModelBehaviorTrace()
		setModelBehaviorTraceEnabled(false)
	})

	it("WR10: the recorder is DEFAULT OFF — a wire observation records NOTHING", () => {
		expect(getModelBehaviorTraceRecords()).toHaveLength(0)

		// The recorder is disarmed, so the observation is dropped.
		const record = recordModelBehaviorTraceWireReasoning(
			{ sessionId: "s-off", runId: "r-off" },
			{ requestId: "req-off", attempt: 1, wireOutputConfigEffort: "low" },
		)
		expect(record).toBeUndefined()
		expect(getModelBehaviorTraceRecords()).toHaveLength(0)
	})

	it("WR10b: arming the recorder makes the wire evidence observable", () => {
		setModelBehaviorTraceEnabled(true)
		const record = recordModelBehaviorTraceWireReasoning(
			{ sessionId: "s-on", runId: "r-on" },
			{ requestId: "req-on", attempt: 1, wireOutputConfigEffort: "low" },
		)
		expect(record).not.toBeUndefined()

		const records = getModelBehaviorTraceRecords()
		expect(records).toHaveLength(1)
		expect(records[0].event).toBe("model_wire_reasoning")
		expect(records[0].payload.requestId).toBe("req-on")
		expect(records[0].payload.wireOutputConfigEffort).toBe("low")
	})

	it("WR11: the recorded wire evidence retains NO prompt or credential material", () => {
		setModelBehaviorTraceEnabled(true)
		recordModelBehaviorTraceWireReasoning(
			{ sessionId: "s-priv", runId: "r-priv" },
			{
				requestId: "req-priv",
				attempt: 1,
				wireOutputConfigEffort: "low",
				wireThinkingMode: "adaptive",
			},
		)

		const records = getModelBehaviorTraceRecords()
		const serialized = JSON.stringify(records)
		expect(serialized).not.toContain(SECRET_MARKER)
		expect(serialized).not.toContain(PROMPT_MARKER)
		// The retained fields are ONLY the reasoning controls plus identity.
		const payload = records[0].payload as Record<string, unknown>
		expect(Object.keys(payload).sort()).toEqual(["attempt", "requestId", "wireOutputConfigEffort", "wireThinkingMode"].sort())
	})

	it("WR12: the observer install is IDEMPOTENT and never arms the full capture", () => {
		expect(process.env.CLINE_CAPTURE_WIRE).toBeUndefined()
		expect(process.env.CLINE_CAPTURE_PROVIDER_REQUEST).toBeUndefined()

		installModelBehaviorWireReasoningObserver()
		installModelBehaviorWireReasoningObserver()

		// Installing the observer does not enable the disk-level capture.
		expect(process.env.CLINE_CAPTURE_WIRE).toBeUndefined()
		expect(process.env.CLINE_CAPTURE_PROVIDER_REQUEST).toBeUndefined()
	})

	it("WR13: the observer registers a LIVE isActive predicate that follows the recorder toggle", () => {
		// The recorder is DISARMED. The observer is not installed yet, so
		// there is nothing that could want an observation.
		expect(isModelBehaviorWireReasoningObserverActive()).toBe(false)

		// Installing the observer registers it for the whole process
		// lifetime, but it declares itself INACTIVE while the recorder is
		// disarmed. This is the signal the provider seam uses to skip the
		// request-body read entirely.
		installModelBehaviorWireReasoningObserver()
		expect(isModelBehaviorWireReasoningObserverActive()).toBe(false)

		// Arming the recorder flips the LIVE predicate — no
		// re-registration, no new gateway, no reload.
		setModelBehaviorTraceEnabled(true)
		expect(isModelBehaviorWireReasoningObserverActive()).toBe(true)

		// Disarming it flips the predicate back, so the NEXT provider
		// request skips the body read again.
		setModelBehaviorTraceEnabled(false)
		expect(isModelBehaviorWireReasoningObserverActive()).toBe(false)

		// The predicate is read LIVE, so re-arming is observed too.
		setModelBehaviorTraceEnabled(true)
		expect(isModelBehaviorWireReasoningObserverActive()).toBe(true)
	})
})
