import { describe, expect, it } from "vitest";
import {
	classifyToolRuntimeOutcome,
	isRecoverableToolFailure,
	toRecoveryClassification,
	serializeStableFailureCode,
} from "./failure-classifier";
import {
	createAttemptIdentity,
	createFamilyIdentity,
} from "./fingerprint";
import type { ToolRuntimeOutcome } from "@cline/shared";

// ---------------------------------------------------------------------------
// Helpers — produce structured shapes that mirror what the real runtime
// boundary would hand the classifier. The tests deliberately use
// `Object.assign(new Error(...), { code })` rather than bare `new Error`
// so the precedence test pins structured-code wins over prose.
// ---------------------------------------------------------------------------

function codeError(code: string, message = "msg"): Error & { code: string } {
	const err = new Error(message) as Error & { code: string };
	err.code = code;
	return err;
}

const BASE_SUCCESS_INPUT = {
	toolName: "run_commands",
	toolCallId: "call_1",
	toolExists: true,
	toolExecutionInvoked: true,
	result: { isError: false, output: "ok" },
};

// ---------------------------------------------------------------------------
// 1. Success classification
// ---------------------------------------------------------------------------

describe("failure-classifier / success", () => {
	it("classifies a normal successful execution as kind=success", () => {
		const out = classifyToolRuntimeOutcome(BASE_SUCCESS_INPUT);
		expect(out.kind).toBe("success");
		if (out.kind === "success") {
			expect(out.toolName).toBe("run_commands");
			expect(out.toolCallId).toBe("call_1");
		}
	});

	it("does not assign a recovery class or family on success", () => {
		const out = classifyToolRuntimeOutcome(BASE_SUCCESS_INPUT);
		expect(isRecoverableToolFailure(out)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 2. Control-plane outcomes — must outrank result.isError
// ---------------------------------------------------------------------------

describe("failure-classifier / control plane", () => {
	it.each([
		["host_policy_denied"],
		["user_rejected"],
		["approval_pending"],
		["provider_rate_limit"],
		["provider_transport_error"],
		["context_length_exceeded"],
		["task_cancelled"],
		["runtime_aborted"],
	] as const)("classifies %s as control_plane", (outcome) => {
		const out = classifyToolRuntimeOutcome({
			...BASE_SUCCESS_INPUT,
			// Force every other provenance to scream "failure" — the
			// control-plane signal MUST outrank them.
			toolExists: false,
			toolExecutionInvoked: true,
			executionError: codeError("ENOENT"),
			result: { isError: true, output: "boom" },
			controlPlaneOutcome: outcome,
		});
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe(outcome);
			expect(out.toolName).toBe("run_commands");
			expect(out.toolCallId).toBe("call_1");
		}
	});

	it("user_rejected takes precedence over a coincident ENOENT executor throw", () => {
		const out = classifyToolRuntimeOutcome({
			...BASE_SUCCESS_INPUT,
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: codeError("ENOENT"),
			controlPlaneOutcome: "user_rejected",
		});
		expect(out.kind).toBe("control_plane");
	});

	it("host_policy_denied takes precedence over isError=true result", () => {
		const out = classifyToolRuntimeOutcome({
			...BASE_SUCCESS_INPUT,
			toolExists: true,
			toolExecutionInvoked: true,
			result: { isError: true, output: { error: "denied" } },
			controlPlaneOutcome: "host_policy_denied",
		});
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("host_policy_denied");
		}
	});
});

// ---------------------------------------------------------------------------
// 3. Tool lookup miss — registry miss with execution-attempted = true
// ---------------------------------------------------------------------------

describe("failure-classifier / registry miss vs runtime skip — mutually exclusive", () => {
	// Production-truthful fixtures. Each test pins one of the three
	// mutually exclusive cases the runtime can produce:
	//
	//   1. unknown tool       → toolExists=false ∧ toolExecutionInvoked=false
	//   2. real tool skipped  → toolExists=true  ∧ toolExecutionInvoked=false
	//   3. real tool thrown   → toolExists=true  ∧ toolExecutionInvoked=true
	//                          (and executionError is the throw)
	//
	// The fixture `toolExists=false ∧ toolExecutionInvoked=true` is
	// considered an impossible / contradictory observation and is
	// tested as a rejection-pin below.

	it("unknown tool → tool_not_found (the canonical registry-miss shape)", () => {
		// `tools.get('ghost_tool')` returned nothing; the unknown-tool
		// path did NOT then invoke `tool.execute(...)`.
		const out = classifyToolRuntimeOutcome({
			toolName: "ghost_tool",
			toolCallId: "call_2",
			toolExists: false,
			toolExecutionInvoked: false,
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_not_found");
			expect(out.stableCode).toBe("tool:not_found");
			expect(out.familyConfidence).toBe("structured");
			expect(out.familyEligible).toBe(true);
		}
	});

	it("real tool skipped → control_plane / runtime_skipped", () => {
		// Real tool was registered, but prepare-tool short-circuited
		// (policy / hook / approval) and `tool.execute(...)` was not
		// invoked. The classifier must surface this as a structural
		// exclusion so C1.2 cannot feed it into RecoveryTracker.
		const out = classifyToolRuntimeOutcome({
			toolName: "real_tool",
			toolCallId: "call_sk_real",
			toolExists: true,
			toolExecutionInvoked: false,
			skipReason: "policy-disabled",
		});
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("runtime_skipped");
		}
	});

	it("real tool executed and threw → tool_execution_error", () => {
		// The canonical thrown execution shape: toolExists=true,
		// toolExecutionInvoked=true, executionError is the throw.
		const out = classifyToolRuntimeOutcome({
			toolName: "real_tool",
			toolCallId: "call_thrown",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: codeError("ENOENT"),
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_execution_error");
			expect(out.stableCode).toBe("ENOENT");
		}
	});

	// Invariant: registry miss wins over skip. `toolExists=false` must
	// classify as `tool_not_found` regardless of `toolExecutionInvoked`.
	it("invariant: toolExists=false ⇒ tool_not_found (regardless of toolExecutionInvoked)", () => {
		const truthy = classifyToolRuntimeOutcome({
			toolName: "ghost",
			toolCallId: "call_inv_t",
			toolExists: false,
			toolExecutionInvoked: true, // "impossible" but pinned
		});
		expect(truthy.kind).toBe("failure");
		if (truthy.kind === "failure") {
			expect(truthy.failureClass).toBe("tool_not_found");
		}

		const falsy = classifyToolRuntimeOutcome({
			toolName: "ghost",
			toolCallId: "call_inv_f",
			toolExists: false,
			toolExecutionInvoked: false, // canonical
		});
		expect(falsy.kind).toBe("failure");
		if (falsy.kind === "failure") {
			expect(falsy.failureClass).toBe("tool_not_found");
		}
	});

	// Invariant: runtime skip requires both `toolExists=true` and
	// `toolExecutionInvoked=false`. Once the tool is unknown we are no
	// longer talking about a skip; we are talking about a registry miss.
	it("invariant: toolExists=true ∧ toolExecutionInvoked=false ⇒ runtime_skipped", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "real",
			toolCallId: "call_skip_inv",
			toolExists: true,
			toolExecutionInvoked: false,
		});
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("runtime_skipped");
		}
	});

	// Anti-invariant: even when `executionAttempted=true` was the old
	// name, the new shape demands `toolExecutionInvoked`. Lock the
	// property that "registry-miss wins regardless of execution" by
	// also testing tool-not-found is family-eligible for circuit use.
	it("tool_not_found family is structured and family-eligible", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "ghost",
			toolCallId: "call_family",
			toolExists: false,
			toolExecutionInvoked: false,
		}) as Extract<ToolRuntimeOutcome, { kind: "failure" }>;
		expect(out.familyConfidence).toBe("structured");
		expect(out.familyEligible).toBe(true);
		expect(out.stableCode).toBe("tool:not_found");
		// The canonical family identity for registry-miss.
		expect(
			createFamilyIdentity(
				out.toolName,
				out.failureClass,
				serializeStableFailureCode(out.stableCode),
			).controlFamily,
		).toBe("ghost:tool_not_found:tool:not_found");
	});
});

// ---------------------------------------------------------------------------
// 4. Input validation provenance — outranks prose, but does NOT invent
//    a schema discriminator from prose.
// ---------------------------------------------------------------------------

describe("failure-classifier / input parse error", () => {
	it("classifies a prose-only parse error as tool_input_invalid / unknown / fallback / ineligible", () => {
		// The production boundary surfaces only a string message today,
		// not a structured schema discriminator. The classifier MUST
		// NOT invent `schema:missing_required` from prose.
		const out = classifyToolRuntimeOutcome({
			toolName: "write_file",
			toolCallId: "call_3",
			toolExists: true,
			toolExecutionInvoked: false,
			inputParseError: "Invalid input: expected string, received number",
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_input_invalid");
			expect(out.familyConfidence).toBe("fallback");
			expect(out.familyEligible).toBe(false);
			expect(out.stableCode).toBe("unknown");
		}
	});

	it("regression: three distinct parse messages all map to unknown (no prose scraping)", () => {
		// Mandatory regression from the C1.1 review:
		//   missing required property
		//   expected string received number
		//   unknown property foo
		// must all collapse to `unknown / fallback / familyEligible=false`
		// because the prose cannot distinguish schema:missing_required
		// from schema:invalid_type from schema:unknown_property.
		const messages = [
			"Invalid input: missing required property 'path'",
			"Invalid input: expected string, received number",
			"Invalid input: unknown property 'foo'",
		];
		for (const msg of messages) {
			const out = classifyToolRuntimeOutcome({
				toolName: "write_file",
				toolCallId: "call_3",
				toolExists: true,
				toolExecutionInvoked: false,
				inputParseError: msg,
			});
			expect(out.kind).toBe("failure");
			if (out.kind === "failure") {
				expect(out.failureClass).toBe("tool_input_invalid");
				expect(out.familyConfidence).toBe("fallback");
				expect(out.familyEligible).toBe(false);
				expect(out.stableCode).toBe("unknown");
			}
		}
	});

	// Pin the future upgrade path: when/if a structured parser
	// exposes a schema discriminator at the boundary, the classifier
	// will be taught to recognise it. For now, the input shape
	// reserves no structured schema field, so this is a forward-looking
	// regression pin via the doc comment, not a runtime test.
	// (Tracked for C1.2+ in the closure plan.)

	it("parse-error provenance wins over misleading 'not found' prose in the error message", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "write_file",
			toolCallId: "call_3",
			toolExists: true,
			toolExecutionInvoked: false,
			// Prose says "not found" but the provenance is parse failure.
			inputParseError: "Tool not found somewhere in documentation: required field 'path'",
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_input_invalid");
			expect(out.failureClass).not.toBe("tool_not_found");
		}
	});
});

// ---------------------------------------------------------------------------
// 5. Executor errors — structured errno, exit codes, opaque
// ---------------------------------------------------------------------------

describe("failure-classifier / executor throw", () => {
	it("ENOENT → tool_execution_error / ENOENT / structured / eligible", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "read_file",
			toolCallId: "call_4",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: codeError("ENOENT", "no such file"),
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_execution_error");
			expect(out.stableCode).toBe("ENOENT");
			expect(out.familyConfidence).toBe("structured");
			expect(out.familyEligible).toBe(true);
		}
	});

	it("EACCES → tool_execution_error / EACCES / structured / eligible", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "read_file",
			toolCallId: "call_5",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: codeError("EACCES", "permission denied"),
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_execution_error");
			expect(out.stableCode).toBe("EACCES");
			expect(out.familyConfidence).toBe("structured");
			expect(out.familyEligible).toBe(true);
		}
	});

	it("structured err.code beats misleading prose", () => {
		const err = codeError("EACCES", "configuration not found somewhere");
		const out = classifyToolRuntimeOutcome({
			toolName: "read_file",
			toolCallId: "call_6",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: err,
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.stableCode).toBe("EACCES");
			expect(out.familyEligible).toBe(true);
			// It must NOT collapse to tool_not_found on the basis of
			// "not found" prose.
			expect(out.failureClass).not.toBe("tool_not_found");
		}
	});

	it("executor text 'resource not found' must NOT become tool_not_found", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "read_file",
			toolCallId: "call_7",
			toolExists: true, // tool exists; prose is the only "not found" signal
			toolExecutionInvoked: true,
			executionError: new Error("resource not found at /tmp/foo"),
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).not.toBe("tool_not_found");
			expect(out.failureClass).toBe("tool_execution_error");
		}
	});

	it("opaque throw (no err.code) → unknown / fallback / ineligible", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "read_file",
			toolCallId: "call_8",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: new Error("some opaque failure"),
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_execution_error");
			expect(out.stableCode).toBe("unknown");
			expect(out.familyConfidence).toBe("fallback");
			expect(out.familyEligible).toBe(false);
		}
	});

	it("opaque throw with different message but same opaque envelope → unknown / ineligible", () => {
		const out1 = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_A",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: new Error("opaque error alpha"),
		});
		const out2 = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_B",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: new Error("opaque error beta"),
		});
		expect(out1.kind).toBe("failure");
		expect(out2.kind).toBe("failure");
		if (out1.kind === "failure" && out2.kind === "failure") {
			expect(out1.stableCode).toBe("unknown");
			expect(out2.stableCode).toBe("unknown");
			expect(out1.familyEligible).toBe(false);
			expect(out2.familyEligible).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// 6. Result-level failures (isError=true with no throw)
// ---------------------------------------------------------------------------

describe("failure-classifier / result-level failure", () => {
	it("exit code 127 → tool_execution_error / { exit: 127 } / structured / eligible", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_9",
			toolExists: true,
			toolExecutionInvoked: true,
			result: { isError: true, exitCode: 127 },
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_execution_error");
			expect(out.stableCode).toEqual({ exit: 127 });
			expect(out.familyConfidence).toBe("structured");
			expect(out.familyEligible).toBe(true);
		}
	});

	it("opaque isError=true (no exitCode) → unknown / fallback / ineligible", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_10",
			toolExists: true,
			toolExecutionInvoked: true,
			result: { isError: true, output: { error: "exit code 1" } },
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_execution_error");
			expect(out.stableCode).toBe("unknown");
			expect(out.familyConfidence).toBe("fallback");
			expect(out.familyEligible).toBe(false);
		}
	});

	it("isError=true with non-numeric exitCode (NaN) → unknown / fallback", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_11",
			toolExists: true,
			toolExecutionInvoked: true,
			result: { isError: true, exitCode: Number.NaN },
		});
		expect(out.kind).toBe("failure");
		if (out.kind === "failure") {
			expect(out.stableCode).toBe("unknown");
			expect(out.familyConfidence).toBe("fallback");
			expect(out.familyEligible).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// 7. Mandatory mutation-style regression: unknown must be ineligible
// ---------------------------------------------------------------------------

describe("failure-classifier / mutation regression", () => {
	it("opaque errors are pinned to familyEligible=false across two distinct inputs", () => {
		// Two completely different opaque errors — the classifier MUST
		// return the same `unknown` stableCode AND familyEligible=false
		// for both. If a future change makes `unknown` familyEligible,
		// these two assertions still pass structurally but the next
		// assertion pins the regression.
		const a = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_alpha",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: new Error("opaque alpha failure"),
		});
		const b = classifyToolRuntimeOutcome({
			toolName: "read_files",
			toolCallId: "call_beta",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: new Error("opaque beta failure with completely different shape"),
		});
		expect(a).toMatchObject({
			kind: "failure",
			stableCode: "unknown",
			familyEligible: false,
		});
		expect(b).toMatchObject({
			kind: "failure",
			stableCode: "unknown",
			familyEligible: false,
		});
	});

	it("control-plane provenance outranks isError=true (regression pin)", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_user_reject",
			toolExists: true,
			toolExecutionInvoked: true,
			result: { isError: true, exitCode: 1 },
			controlPlaneOutcome: "user_rejected",
		});
		expect(out.kind).toBe("control_plane");
		// If someone removes Priority 1 the test will see kind=failure
		// (because isError=true is the only thing left).
	});

	it("registry-miss vs executor-text 'not found' produces distinct outcomes (regression pin)", () => {
		const registry = classifyToolRuntimeOutcome({
			toolName: "ghost_tool",
			toolCallId: "call_miss",
			toolExists: false,
			toolExecutionInvoked: true,
			executionError: new Error("Unknown tool: ghost_tool"),
		});
		const executor = classifyToolRuntimeOutcome({
			toolName: "real_tool",
			toolCallId: "call_real",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: new Error("resource not found at /tmp/foo"),
		});
		expect(registry.kind).toBe("failure");
		expect(executor.kind).toBe("failure");
		if (registry.kind === "failure" && executor.kind === "failure") {
			expect(registry.failureClass).toBe("tool_not_found");
			expect(executor.failureClass).toBe("tool_execution_error");
			expect(registry.failureClass).not.toBe(executor.failureClass);
		}
	});
});

// ---------------------------------------------------------------------------
// 8. Narrowing helper
// ---------------------------------------------------------------------------

describe("failure-classifier / narrowing helper", () => {
	it("isRecoverableToolFailure returns true only for kind=failure", () => {
		const success = classifyToolRuntimeOutcome(BASE_SUCCESS_INPUT);
		const ctrl = classifyToolRuntimeOutcome({
			...BASE_SUCCESS_INPUT,
			controlPlaneOutcome: "host_policy_denied",
		});
		const failure = classifyToolRuntimeOutcome({
			toolName: "read_file",
			toolCallId: "call_n",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: codeError("ENOENT"),
		});
		expect(isRecoverableToolFailure(success)).toBe(false);
		expect(isRecoverableToolFailure(ctrl)).toBe(false);
		expect(isRecoverableToolFailure(failure)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 9. Classification → family identity handoff (no tracker)
// ---------------------------------------------------------------------------

describe("failure-classifier / handoff to family identity (no tracker)", () => {
	it("ENOENT classification hands off to a deterministic ToolFamilyIdentity", () => {
		// P0-2 fix: the family identity is parameterised by
		// (toolName, failureClass, stableCode). The handoff MUST
		// thread `outcome.toolName` through, not regress the
		// failureClass into the tool-name slot. The classifier returns
		// the toolName on the outcome itself; `toRecoveryClassification`
		// is a projection that preserves it for C1.2's benefit.
		const out = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_h1",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: codeError("ENOENT"),
		}) as Extract<ToolRuntimeOutcome, { kind: "failure" }>;
		const cls = toRecoveryClassification(out);
		// C1.2 will construct the family identity from the original
		// outcome (which carries toolName) — pin this exact shape.
		const family = createFamilyIdentity(
			out.toolName,
			cls.failureClass,
			serializeStableFailureCode(cls.stableCode),
		);
		// Pin the canonical control-family string. If C1.2 forms
		// a different family key, the contract has drifted.
		expect(family.controlFamily).toBe("run_commands:tool_execution_error:ENOENT");
		// Determinism: same inputs → same identity.
		const family2 = createFamilyIdentity(
			"run_commands",
			"tool_execution_error",
			"ENOENT",
		);
		expect(family.controlFamily).toBe(family2.controlFamily);
		expect(family.diagnosticFamily).toBe(family2.diagnosticFamily);
		// Serialised stable code is the canonical form.
		expect(serializeStableFailureCode(out.stableCode)).toBe("ENOENT");
	});

	it("structured exit-code classification hands off to a deterministic family", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_h2",
			toolExists: true,
			toolExecutionInvoked: true,
			result: { isError: true, exitCode: 127 },
		}) as Extract<ToolRuntimeOutcome, { kind: "failure" }>;
		expect(serializeStableFailureCode(out.stableCode)).toBe("exit:127");
		const fam = createFamilyIdentity(
			"run_commands",
			"tool_execution_error",
			"exit:127",
		);
		expect(fam.controlFamily).toBe("run_commands:tool_execution_error:exit:127");
	});

	it("exact-only handoff: unknown outcome still constructs attempt identity, but family identity is NOT used for convergence", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "run_commands",
			toolCallId: "call_h3",
			toolExists: true,
			toolExecutionInvoked: true,
			executionError: new Error("opaque alpha"),
		}) as Extract<ToolRuntimeOutcome, { kind: "failure" }>;
		// Policy assertion: familyEligible must be false. C1.2 will
		// branch on this to take the exact-only path.
		expect(out.familyEligible).toBe(false);
		expect(out.stableCode).toBe("unknown");
		// Attempt identity is still constructible (Stage-1 contract).
		const attempt = createAttemptIdentity("run_commands", { command: "A" });
		expect(attempt.controlKey).toContain("run_commands");
		// But we deliberately do NOT call createFamilyIdentity with
		// the unknown stable code for convergence — that policy is
		// enforced by `familyEligible=false` in the runtime wiring
		// layer (C1.2). The classifier hands the policy decision over
		// unchanged; this test pins that hand-off.
	});
});

// ---------------------------------------------------------------------------
// 10. Stateless / call-local — multiple sequential calls don't interfere
// ---------------------------------------------------------------------------

describe("failure-classifier / call-local isolation", () => {
	it("sequential calls produce independent outcomes with no cross-contamination", () => {
		const calls = [
			classifyToolRuntimeOutcome({ ...BASE_SUCCESS_INPUT }),
			classifyToolRuntimeOutcome({
				toolName: "run_commands",
				toolCallId: "call_s2",
				toolExists: true,
				toolExecutionInvoked: true,
				executionError: codeError("ENOENT"),
			}),
			classifyToolRuntimeOutcome({
				toolName: "ghost",
				toolCallId: "call_s3",
				toolExists: false,
				toolExecutionInvoked: true,
				executionError: new Error("Unknown tool: ghost"),
			}),
			classifyToolRuntimeOutcome({
				...BASE_SUCCESS_INPUT,
				controlPlaneOutcome: "user_rejected",
			}),
		];
		expect(calls[0].kind).toBe("success");
		expect(calls[1].kind).toBe("failure");
		expect(calls[2].kind).toBe("failure");
		expect(calls[3].kind).toBe("control_plane");
	});
});

// ---------------------------------------------------------------------------
// 11. runtime_skipped — toolExecutionInvoked=false (P1-1)
// ---------------------------------------------------------------------------

describe("failure-classifier / runtime_skipped", () => {
	it("generic hook skip → control_plane / runtime_skipped", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "write_file",
			toolCallId: "call_sk1",
			toolExists: true,
			toolExecutionInvoked: false,
			skipReason: "hook skipped",
		});
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("runtime_skipped");
		}
	});

	it("disabled tool skip → control_plane / runtime_skipped", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "dangerous_tool",
			toolCallId: "call_sk2",
			toolExists: true,
			toolExecutionInvoked: false,
			skipReason: "policy-disabled",
		});
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("runtime_skipped");
		}
	});

	it("explicit user_rejected still outranks runtime_skipped", () => {
		// More-specific control-plane provenance wins over the generic
		// skip — Priority 1 runs before Priority 4.
		const out = classifyToolRuntimeOutcome({
			toolName: "write_file",
			toolCallId: "call_sk3",
			toolExists: true,
			toolExecutionInvoked: false,
			skipReason: "approval-rejected",
			controlPlaneOutcome: "user_rejected",
		});
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("user_rejected");
		}
	});

	it("explicit host_policy_denied still outranks runtime_skipped", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "write_file",
			toolCallId: "call_sk4",
			toolExists: true,
			toolExecutionInvoked: false,
			skipReason: "policy-disabled",
			controlPlaneOutcome: "host_policy_denied",
		});
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("host_policy_denied");
		}
	});

	it("runtime_skipped + isError=true remains control_plane (no isError regression)", () => {
		// The result is a leftover from a previous attempted execution;
		// the new observation is "not attempted". control_plane wins.
		const out = classifyToolRuntimeOutcome({
			toolName: "write_file",
			toolCallId: "call_sk5",
			toolExists: true,
			toolExecutionInvoked: false,
			skipReason: "hook skipped",
			result: { isError: true, exitCode: 1 },
		});
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("runtime_skipped");
		}
	});

	it("runtime_skipped is NOT a failure (no failureClass surfaced)", () => {
		const out = classifyToolRuntimeOutcome({
			toolName: "write_file",
			toolCallId: "call_sk6",
			toolExists: true,
			toolExecutionInvoked: false,
		});
		// Narrowing helper should report false.
		expect(isRecoverableToolFailure(out)).toBe(false);
		// And the kind discriminator excludes failure.
		expect(out.kind).not.toBe("failure");
	});
});
