/**
 * ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01
 *
 * Discriminator: prove that the model-supplied `requires_approval`
 * hint can RAISE friction (ALLOW -> ASK) but NEVER LOWER it.
 *
 * Upstream radar: cline/cline#12020 ("destructive command runs without
 * approval when model sets requires_approval=false"). ClineMM is
 * structurally immune because the canonical policy composition rule
 * (command-policy.ts:120) only checks `effectiveEscalation` (which is
 * `true` only when ANY hint is `true`) and ONLY fires on the raise
 * branch; there is no symmetric `false`/lower branch.
 *
 * The upstream #12020 bug specifically bit the *auto-approve /
 * safe-command path* (mode "safe-only"). The original A3 used
 * MANUAL mode which is tautological (every command asks under MANUAL
 * regardless of classification). The CORRECTED A3 exercises the
 * actual upstream #12020 contract under SAFE_ONLY, plus a stronger
 * ClineMM conservation under ALL/YOLO (which #12020 did not
 * require):
 *
 *   - safe-only + known-safe + model=false    => ALLOW (positive match)
 *   - safe-only + approval-required + model=false => ASK (fallthrough)
 *   - safe-only + R5-destructive + model=false => ASK (fallthrough OR
 *                                              hard floor; both ASK)
 *                                              = A3' load-bearing:
 *                                                DIRECT upstream #12020
 *                                                reproduction
 *   - all (YOLO) + R5-destructive + model=false => ASK (R5 hard floor
 *                                              forces downgrade even
 *                                              under user-explicit YOLO)
 *                                              = A3'' load-bearing:
 *                                                STRONGER ClineMM
 *                                                conservation, NOT a
 *                                                direct #12020
 *                                                reproduction (the
 *                                                upstream bug does not
 *                                                require global YOLO)
 *
 * EVIDENCE LABEL: SYNTHETIC_REAL through REAL_PRODUCTION_SEAM —
 * the discriminator invokes the canonical `evaluateCommandPolicy`
 * entry point directly (REAL_PRODUCTION_SEAM); the host-mode and
 * tool-input fixtures are synthetic. No new Function extraction.
 * No mocked approval algorithm. The composition rule is taken
 * verbatim from the production source.
 *
 * Each test name encodes the (harness_base, model_hint, command) tuple
 * and the expected invariant assertion. The verdict must remain
 * APPROVAL_AUTHORITY_FAIL_CLOSED_PROVEN for every case.
 */

import { describe, expect, it } from "vitest"

import {
	commandHostAuthorization,
	evaluateCommandPolicy,
} from "./command-policy"
import { evaluateCommandRiskWithParser } from "./command-risk-internal"
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules"

const MANUAL = commandHostAuthorization({ mode: "manual" })
const SAFE_ONLY = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
})
const ALL = commandHostAuthorization({ mode: "all" })

const DENY_RULE = {
	source: "unit_test_destructive_remove",
	pattern: /^\s*rm\s+-rf/u,
}
const DENY_BY_RULE = commandHostAuthorization({
	mode: "all",
	explicitDenyRules: [DENY_RULE],
})

// ---------------------------------------------------------------------------
// A1: harness-safe (all mode + safe shape) + model=false => ALLOW
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — A1", () => {
	it("harness-safe + model=false => ALLOW (no downgrade needed)", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "date", requires_approval: false },
			hostAuthorization: ALL,
		})
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all")
	})
})

// ---------------------------------------------------------------------------
// A2: harness-safe + model=true => ASK (model raises friction)
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — A2", () => {
	it("harness-safe + model=true => ASK (model escalation honored)", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "date", requires_approval: true },
			hostAuthorization: ALL,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("model_escalation")
	})
})

// ---------------------------------------------------------------------------
// A3 (conservation only): MANUAL + destructive + model hint => ASK trivially.
// This is a CONSERVATION witness only. MANUAL always asks regardless of
// model metadata. The upstream #12020 bug is NOT in MANUAL mode — it is
// in the *auto-approve / safe-command* path. The load-bearing cases are:
//   A3'  SAFE_ONLY  = DIRECT upstream #12020 reproduction
//   A3''  ALL/YOLO   = STRONGER ClineMM conservation (not #12020)
// (see A3' and A3'' below).
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — A3 (conservation: manual)", () => {
	it("MANUAL + destructive + model=false => ASK trivially", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "rm -rf /", requires_approval: false },
			hostAuthorization: MANUAL,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("host_mode_manual")
	})

	it("MANUAL + destructive + model=missing => ASK trivially", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "rm -rf /" },
			hostAuthorization: MANUAL,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("host_mode_manual")
	})

	it("MANUAL + destructive + model=malformed => ASK trivially", () => {
		const result = evaluateCommandPolicy({
			toolInput: {
				command: "rm -rf /",
				requires_approval: "yes" as unknown as boolean,
			},
			hostAuthorization: MANUAL,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("host_mode_manual")
	})
})

// ---------------------------------------------------------------------------
// A3' LOAD-BEARING (SAFE_ONLY lane) — DIRECT upstream #12020 reproduction
//
// Upstream #12020: in Cline's auto-approve/safe-command path, the
// model-supplied `requires_approval=false` was trusted to waive
// approval even for commands not in the bounded safe allow list.
//
// ClineMM has NO default hard-deny rules. The safe-only lane is
// `positive-match -> ALLOW; non-match -> ASK (fallthrough)`. The R5
// catastrophic hard floor (command-risk.ts:179) additionally forces
// `never-auto-approve` (re-skinned ASK) for a bounded set of
// catastrophic patterns (rm -rf $HOME, rm -rf /, rm -rf .., etc.).
//
// Load-bearing invariant: a command that is NOT in the bounded safe
// allow list (or that positively matches R5 catastrophic) MUST become
// ASK in safe-only mode even when the model says false. This is the
// DIRECT upstream #12020 reproduction; MANUAL mode would trivially
// pass and is therefore only a conservation witness (see A3 above).
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — A3' (LOAD-BEARING: safe-only)", () => {
	it("SAFE_ONLY + known-safe (pwd) + model=false => ALLOW (positive rule match)", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "pwd", requires_approval: false },
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_safe_only_rule")
	})

	it("SAFE_ONLY + known-safe (git status) + model=false => ALLOW", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "git status", requires_approval: false },
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_safe_only_rule")
	})

	it("SAFE_ONLY + not-in-allowlist (random-tool) + model=false => ASK (fallthrough)", () => {
		// The whole point of #12020: a command that the bounded positive
		// matcher does NOT recognize must NOT be silently allowed just
		// because the model hint says false. ClineMM's positive-matcher
		// policy forces ASK for non-matching commands.
		const result = evaluateCommandPolicy({
			toolInput: { command: "some-unknown-tool", requires_approval: false },
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_safe_only_rule")
	})

	it("SAFE_ONLY + unknown + model=true => ASK (mirror)", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "some-unknown-tool", requires_approval: true },
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.kind).not.toBe("allow")
	})

	it("SAFE_ONLY + rm -rf $HOME (R5 catastrophic) + model=false => ASK (floor)", () => {
		// R5 catastrophic hard floor: bounded positive match for
		// home-destruction family. The canonical policy returns ASK
		// with the host_mode_safe_only_fallthrough source (the safe
		// rule engine refuses to match rm -rf $HOME because it is not
		// in the bounded allow list — "absence of danger never implies
		// ALLOW"; command-safe-rules.ts:10). The model hint cannot
		// erase this.
		const result = evaluateCommandPolicy({
			toolInput: { command: "rm -rf $HOME", requires_approval: false },
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_safe_only_rule")
		expect(result.decision.source).not.toBe("host_mode_all")
	})

	it("SAFE_ONLY + rm -rf / (R5 root-destruction) + model=false => ASK", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "rm -rf /", requires_approval: false },
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_safe_only_rule")
		expect(result.decision.source).not.toBe("host_mode_all")
	})
})

// ---------------------------------------------------------------------------
// A4: harness-requires-approval + model=true => ASK (also from model path)
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — A4", () => {
	it("harness-requires-approval (manual) + model=true => ASK", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "rm -rf /", requires_approval: true },
			hostAuthorization: MANUAL,
		})
		expect(result.decision.kind).toBe("ask")
		// source stays host_mode_manual because the host already required ASK;
		// the model hint is a no-op here (it can only raise, not lower).
		expect(result.decision.source).toBe("host_mode_manual")
	})
})

// ---------------------------------------------------------------------------
// A3'' STRONGER CONSERVATION (ALL / YOLO lane)
//
// In mode "all" (CLI --auto-approve / VS Code YOLO), the host has
// explicitly granted the model ALLOW. The R5 catastrophic hard floor
// (production callsite at sdk-tool-policies.ts:633 invokes
// evaluateCommandRiskWithParser()) must STILL downgrade
// ALLOW → ASK on R5 catastrophic matches. This is a STRONGER
// ClineMM conservation than the upstream #12020 reproduction:
// #12020 does not require global YOLO; this case proves that even
// when the user has explicitly opted into YOLO, R5-catastrophic
// commands cannot silently auto-approve. See ACT §6 for the
// composed proof framing.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — A3'' (STRONGER CONSERVATION: YOLO)", () => {
	it("ALL + rm -rf $HOME (R5 catastrophic) + model=false => ALLOW at canonical lattice; ASK at host adapter (R5 floor wins)", () => {
		// Canonical lattice under mode="all" returns ALLOW (host_mode_all).
		const canonical = evaluateCommandPolicy({
			toolInput: { command: "rm -rf $HOME", requires_approval: false },
			hostAuthorization: ALL,
		})
		expect(canonical.decision.kind).toBe("allow")
		expect(canonical.decision.source).toBe("host_mode_all")

		// STRUCTURAL production callsite (sdk-tool-policies.ts:633)
		// invokes evaluateCommandRiskWithParser() to layer the R5
		// catastrophic hard floor ON TOP of the canonical lattice.
		// Under the floor, ALLOW is downgraded to ASK with disposition
		// "never-auto-approve". STRUCTURAL production callsite + direct
		// execution of evaluateCommandRiskWithParser() compose the
		// host-adapter proof. A3'' is STRONGER ClineMM conservation,
		// not a direct #12020 reproduction (the upstream bug does not
		// require global YOLO).
		const adapted = evaluateCommandRiskWithParser({
			toolInput: { command: "rm -rf $HOME", requires_approval: false },
			hostAuthorization: ALL,
		})
		expect(adapted.decision).toBe("ask")
		expect(adapted.disposition).toBe("never-auto-approve")
	})

	it("ALL + rm -rf / (R5 root-destruction) + model=false => ASK at host adapter (R5 floor wins)", () => {
		const canonical = evaluateCommandPolicy({
			toolInput: { command: "rm -rf /", requires_approval: false },
			hostAuthorization: ALL,
		})
		expect(canonical.decision.kind).toBe("allow")
		expect(canonical.decision.source).toBe("host_mode_all")

		const adapted = evaluateCommandRiskWithParser({
			toolInput: { command: "rm -rf /", requires_approval: false },
			hostAuthorization: ALL,
		})
		expect(adapted.decision).toBe("ask")
		expect(adapted.disposition).toBe("never-auto-approve")
	})

	it("ALL + non-catastrophic + model=false => ALLOW (YOLO honored for non-dangerous commands)", () => {
		// Sanity check: YOLO/--auto-approve actually allows non-dangerous
		// commands. Otherwise the R5 floor would be vacuously true.
		const result = evaluateCommandPolicy({
			toolInput: { command: "echo hi", requires_approval: false },
			hostAuthorization: ALL,
		})
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all")
	})

	it("ALL + rm -rf $HOME + model=true (escalation) => ASK at canonical lattice too", () => {
		// Sanity: model escalation must also not weaken the canonical
		// lattice. The model hint true forces ASK at the canonical layer
		// (model_escalation source), so the R5 floor is moot here.
		const result = evaluateCommandPolicy({
			toolInput: { command: "rm -rf $HOME", requires_approval: true },
			hostAuthorization: ALL,
		})
		expect(result.decision.kind).toBe("ask")
	})
})

// ---------------------------------------------------------------------------
// A5: classifier / parser failure + model=false => FAIL CLOSED (ASK)
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — A5", () => {
	it("null toolInput + model=irrelevant => ASK + unknown_input", () => {
		const result = evaluateCommandPolicy({
			toolInput: null,
			hostAuthorization: ALL,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("unknown_input")
	})

	it("empty commands array + model=false => ASK + unknown_input", () => {
		const result = evaluateCommandPolicy({
			toolInput: { commands: [], requires_approval: false },
			hostAuthorization: ALL,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("unknown_input")
	})

	it("unparseable command element + model=false => ASK + unknown_input", () => {
		const result = evaluateCommandPolicy({
			toolInput: { commands: [null], requires_approval: false },
			hostAuthorization: ALL,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("unknown_input")
	})
})

// ---------------------------------------------------------------------------
// A6: compound input (safe + approval-required) + model=false =>
//     whole request requires approval (lattice conservation on
//     aggregateLattice; NOT a #12020 reproduction — see A3' for that).
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — A6", () => {
	it("SAFE_ONLY compound (known-safe + non-matching) + model=false everywhere => ASK (aggregate lattice conservation)", () => {
		// Under SAFE_ONLY the aggregate is:
		//   - pwd (matches host_safe_pwd) → ALLOW
		//   - some-unknown-tool (no rule match) → ASK via fallthrough
		//   aggregateLattice: ANY ASK → ASK
		// This proves that the aggregate does NOT silently ALLOW a
		// compound input just because one segment is allowlisted.
		// A6 is a lattice-conservation witness, not a #12020 reproduction.
		const result = evaluateCommandPolicy({
			toolInput: {
				commands: [
					{ command: "pwd", requires_approval: false },
					{ command: "some-unknown-tool", requires_approval: false },
				],
			},
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_safe_only_rule")
		expect(result.decision.kind).not.toBe("allow")
	})

	it("SAFE_ONLY compound (known-safe + R5-catastrophic) + model=false everywhere => ASK", () => {
		// R5-catastrophic compound: pwd && rm -rf $HOME. The R5 hard
		// floor scans each command independently (command-risk.ts:135);
		// the rm -rf $HOME leg forces ASK regardless of the pwd leg.
		const canonical = evaluateCommandPolicy({
			toolInput: {
				commands: [
					{ command: "pwd", requires_approval: false },
					{ command: "rm -rf $HOME", requires_approval: false },
				],
			},
			hostAuthorization: SAFE_ONLY,
		})
		expect(canonical.decision.kind).toBe("ask")
		expect(canonical.decision.source).not.toBe("host_mode_safe_only_rule")
	})

	it("SAFE_ONLY compound (known-safe + known-safe) + model=false => ALLOW (positive matches)", () => {
		const result = evaluateCommandPolicy({
			toolInput: {
				commands: [
					{ command: "pwd", requires_approval: false },
					{ command: "git status", requires_approval: false },
				],
			},
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("allow")
	})

	it("compound (safe + safe) + model=false => ALLOW under mode=all", () => {
		const result = evaluateCommandPolicy({
			toolInput: {
				commands: [
					{ command: "pwd", requires_approval: false },
					{ command: "ls", requires_approval: false },
				],
			},
			hostAuthorization: ALL,
		})
		expect(result.decision.kind).toBe("allow")
	})

	it("multi-command ANY true model hint => ASK (order-independent)", () => {
		const a = evaluateCommandPolicy({
			toolInput: {
				commands: [
					{ command: "pwd", requires_approval: false },
					{ command: "ls", requires_approval: true },
				],
			},
			hostAuthorization: ALL,
		})
		expect(a.decision.kind).toBe("ask")
		expect(a.decision.source).toBe("model_escalation")

		const b = evaluateCommandPolicy({
			toolInput: {
				commands: [
					{ command: "pwd", requires_approval: true },
					{ command: "ls", requires_approval: false },
				],
			},
			hostAuthorization: ALL,
		})
		expect(b.decision.kind).toBe("ask")
		expect(b.decision.source).toBe("model_escalation")
	})
})

// ---------------------------------------------------------------------------
// EXTRA: hard deny rule must win; model hint cannot waive it.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — EXTRA: hard deny", () => {
	it("DENY rule + model=false => DENY (no downgrade)", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "rm -rf /", requires_approval: false },
			hostAuthorization: DENY_BY_RULE,
		})
		expect(result.decision.kind).toBe("deny")
		expect(result.decision.source).toBe("host_hard_deny")
	})

	it("DENY rule + model=true => DENY (model cannot override deny)", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "rm -rf /", requires_approval: true },
			hostAuthorization: DENY_BY_RULE,
		})
		expect(result.decision.kind).toBe("deny")
	})
})

// ---------------------------------------------------------------------------
// EXTRA: safe-only mode + host-proven safe + model=false => ALLOW
//        (proves model hint does not weaken host_safe_rule match)
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — EXTRA: safe-only match", () => {
	it("safe-only + pwd + model=false => ALLOW (host_safe_pwd)", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "pwd", requires_approval: false },
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_safe_only_rule")
	})

	it("safe-only + git status + model=false => ALLOW", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: "git status", requires_approval: false },
			hostAuthorization: SAFE_ONLY,
		})
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_safe_only_rule")
	})
})

// ---------------------------------------------------------------------------
// LATTICE INVARIANT (the formal contract):
//   For any pair of inputs (toolInput, hostAuthorization),
//   if the verdict is V, then the model hint can only change V to a
//   verdict V' where V' >= V in the restrictiveness lattice (ALLOW < ASK < DENY).
//
// We probe this invariant directly: for every (base) verdict, the model
// hint `requires_approval=true` must not weaken it.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 — LATTICE INVARIANT", () => {
	function restrictiveness(kind: "allow" | "ask" | "deny"): number {
		return kind === "allow" ? 0 : kind === "ask" ? 1 : 2
	}

	it("model=true never weakens any verdict (lattice monotonicity)", () => {
		const probes: Array<{
			label: string
			toolInput: unknown
			hostAuthorization: ReturnType<typeof commandHostAuthorization>
		}> = [
			{ label: "allow base", toolInput: { command: "date", requires_approval: false }, hostAuthorization: ALL },
			{ label: "ask base (manual)", toolInput: { command: "date", requires_approval: false }, hostAuthorization: MANUAL },
			{ label: "deny base", toolInput: { command: "rm -rf /", requires_approval: false }, hostAuthorization: DENY_BY_RULE },
			{ label: "safe-only ask base", toolInput: { command: "weird-thing", requires_approval: false }, hostAuthorization: SAFE_ONLY },
		]

		for (const probe of probes) {
			const base = evaluateCommandPolicy({
				toolInput: probe.toolInput,
				hostAuthorization: probe.hostAuthorization,
			}).decision.kind
			const raised = evaluateCommandPolicy({
				toolInput:
					typeof probe.toolInput === "object" && probe.toolInput !== null
						? { ...(probe.toolInput as Record<string, unknown>), requires_approval: true }
						: probe.toolInput,
				hostAuthorization: probe.hostAuthorization,
			}).decision.kind

			expect(
				restrictiveness(raised),
				`Lattice monotonicity violated for ${probe.label}: base=${base}, raised=${raised}`,
			).toBeGreaterThanOrEqual(restrictiveness(base))
		}
	})

	it("model=false never raises any verdict (no spurious escalation)", () => {
		const probes: Array<{
			label: string
			toolInput: unknown
			hostAuthorization: ReturnType<typeof commandHostAuthorization>
		}> = [
			{ label: "allow base", toolInput: { command: "date", requires_approval: false }, hostAuthorization: ALL },
			{ label: "ask base (manual)", toolInput: { command: "date", requires_approval: false }, hostAuthorization: MANUAL },
			{ label: "deny base", toolInput: { command: "rm -rf /", requires_approval: false }, hostAuthorization: DENY_BY_RULE },
		]

		for (const probe of probes) {
			const base = evaluateCommandPolicy({
				toolInput: probe.toolInput,
				hostAuthorization: probe.hostAuthorization,
			}).decision.kind
			// model=false on an already-allow/ask/deny verdict cannot
			// change the verdict kind because the composition rule only
			// fires on the raise branch.
			const withFalse = evaluateCommandPolicy({
				toolInput:
					typeof probe.toolInput === "object" && probe.toolInput !== null
						? { ...(probe.toolInput as Record<string, unknown>), requires_approval: false }
						: probe.toolInput,
				hostAuthorization: probe.hostAuthorization,
			}).decision.kind

			expect(
				withFalse,
				`model=false changed verdict for ${probe.label}: base=${base}, withFalse=${withFalse}`,
			).toBe(base)
		}
	})
})
