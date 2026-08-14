/**
 * CLI Parity Tests
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION01
 *
 * The CLI uses `toolPolicies` to configure auto-approve behavior.
 * For command tools (`run_commands`/`execute_command`), the CLI's
 * `autoApproveTools` flag is the only knob.
 *
 * Mapping:
 *   - CLI autoApproveTools=true  => host mode "all" (user authorized all commands)
 *   - CLI autoApproveTools=false => host mode "manual" (no auto-approve)
 *
 * These tests verify the CLI's authoritative authority path produces
 * the same lattice as the VS Code path.
 */

import { describe, expect, it } from "bun:test"
import { type CommandDecision, type CommandDecisionKind, commandHostAuthorization, evaluateCommandPolicy } from "./command-policy"

function cliResolveHostAuthorization(autoApproveTools: boolean) {
	return commandHostAuthorization({
		mode: autoApproveTools ? "all" : "manual",
	})
}

function evaluate(toolInput: unknown, autoApproveTools: boolean, modelHint: boolean | undefined = undefined): CommandDecision {
	const host = cliResolveHostAuthorization(autoApproveTools)
	const input = {
		command: toolInput,
		...(modelHint === undefined ? {} : { requires_approval: modelHint }),
	}
	const result = evaluateCommandPolicy({
		toolInput: input,
		hostAuthorization: host,
	})
	return result.decision
}

describe("CLI parity: command authority via toolPolicies", () => {
	describe("autoApproveTools=true (CLI user authorized all commands)", () => {
		it("safe command + model=false => ALLOW", () => {
			const d = evaluate("ls", true, false)
			expect(d.kind).toBe("allow")
			expect(d.source).toBe("host_mode_all")
		})

		it("safe command + model=true => ASK (model escalation)", () => {
			const d = evaluate("ls", true, true)
			expect(d.kind).toBe("ask")
			expect(d.source).toBe("model_escalation")
		})

		it("safe command + model=missing => ALLOW", () => {
			const d = evaluate("ls", true)
			expect(d.kind).toBe("allow")
		})

		it("destructive command + model=false => ALLOW (user authorized)", () => {
			const d = evaluate("rm -rf /", true, false)
			expect(d.kind).toBe("allow")
			expect(d.source).toBe("host_mode_all")
		})

		it("destructive command + model=true => ASK (model escalation)", () => {
			const d = evaluate("rm -rf /", true, true)
			expect(d.kind).toBe("ask")
		})
	})

	describe("autoApproveTools=false (no auto-approve)", () => {
		it("safe command + model=false => ASK", () => {
			const d = evaluate("ls", false, false)
			expect(d.kind).toBe("ask")
			expect(d.source).toBe("host_mode_manual")
		})

		it("safe command + model=true => ASK", () => {
			const d = evaluate("ls", false, true)
			expect(d.kind).toBe("ask")
		})

		it("destructive command + model=false => ASK", () => {
			const d = evaluate("rm -rf /", false, false)
			expect(d.kind).toBe("ask")
		})

		it("destructive command + model=true => ASK", () => {
			const d = evaluate("rm -rf /", false, true)
			expect(d.kind).toBe("ask")
		})
	})

	describe("CLI parity with VS Code path", () => {
		// The CLI path uses "all" or "manual" modes only.
		// The VS Code path adds "safe-only" but the lattice is the same:
		// - All-mode is broader than VS Code's "execute_safe_commands"
		//   (CLI "all" auto-approves ALL commands; VS Code "safe-only"
		//   never auto-approves arbitrary commands).
		// This is by design: CLI's "autoApproveTools" is the user's
		// explicit opt-in to autonomous execution.

		it("CLI 'all' mode is broader than VS Code 'safe-only' (intentional)", () => {
			const cliAll = evaluate("kubectl delete ns x", true, false)
			const vsCodeSafeOnly = evaluateCommandPolicy({
				toolInput: { command: "kubectl delete ns x", requires_approval: false },
				hostAuthorization: commandHostAuthorization({ mode: "safe-only" }),
			}).decision

			expect(cliAll.kind).toBe("allow")
			expect(vsCodeSafeOnly.kind).toBe("ask")
		})
	})

	describe("execution boundary proof (CLI path)", () => {
		it("destructive command + model=false in 'all' mode would auto-execute without approval", () => {
			// This is the documented CLI "autoApproveTools" / YOLO mode.
			// The user explicitly opted into autonomous execution.
			// This is NOT a security defect; it is the documented behavior.
			const d = evaluate("rm -rf /", true, false)
			expect(d.kind).toBe("allow")
		})

		it("destructive command + model=true in 'all' mode requires approval (model escalation)", () => {
			const d = evaluate("rm -rf /", true, true)
			expect(d.kind).toBe("ask")
		})

		it("destructive command + model=false in 'manual' mode requires approval", () => {
			const d = evaluate("rm -rf /", false, false)
			expect(d.kind).toBe("ask")
		})
	})

	describe("lattice invariant (CLI path)", () => {
		const CASES: ReadonlyArray<{
			autoApproveTools: boolean
			modelHint: boolean | undefined
			expected: CommandDecisionKind
			desc: string
		}> = [
			{ autoApproveTools: true, modelHint: false, expected: "allow", desc: "all+false=allow" },
			{ autoApproveTools: true, modelHint: undefined, expected: "allow", desc: "all+missing=allow" },
			{ autoApproveTools: true, modelHint: true, expected: "ask", desc: "all+true=ask (escalation)" },
			{ autoApproveTools: false, modelHint: false, expected: "ask", desc: "manual+false=ask" },
			{ autoApproveTools: false, modelHint: undefined, expected: "ask", desc: "manual+missing=ask" },
			{ autoApproveTools: false, modelHint: true, expected: "ask", desc: "manual+true=ask" },
		]

		for (const c of CASES) {
			it(`lattice: ${c.desc}`, () => {
				const d = evaluate("ls", c.autoApproveTools, c.modelHint)
				expect(d.kind).toBe(c.expected)
			})
		}
	})
})
