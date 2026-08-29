/**
 * Source-proven capability derivation validation.
 *
 * ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01 §4 metadata —
 * complementary evidence to HALT_HOST_SUBSTRATE_UNAVAILABLE.txt.
 *
 * Even though the kernel probe cannot run from this shell, the
 * source-proven half of the three-point proof IS validatable
 * without Seatbelt substrate. This script demonstrates that the
 * three configurations produce the expected capability derivations
 * and is structurally expected to produce the SBPL network-rule
 * lines cited in source-seam-map.md §E (the buildNetworkRule
 * mapping). The expected rule is a STRUCTURAL projection from
 * capability.network — the actual SBPL profile generator is not
 * invoked.
 *
 * WHAT THIS SCRIPT DOES:
 *   - Per configuration: set env → call resolveExperimentalSandboxMode,
 *     resolveSafeYoloNetworkOptIn, buildExperimentalReconCapability.
 *   - Project capability.network to its expected SBPL NETWORK RULE via
 *     the closed-union STRUCTURAL mapping (deny|allow → (deny|allow)*).
 *     This projection is documented in source-seam-map.md §E and matches
 *     `buildNetworkRule` in
 *     sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:274.
 *   - Restore prior env state on exit (P1 review fix).
 *
 * WHAT THIS SCRIPT DOES NOT DO:
 *   - It does NOT execute generateSeatbeltProfile. That would require
 *     importing the SDK's compiled profile generator via a deep
 *     relative path. The closed-union derivation is structurally
 *     equivalent and avoids the import.
 *
 * Run with:
 *   bun run .factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01/§4-metadata/source-proven-capability-validation.ts
 */
import {
	buildExperimentalReconCapability,
	resolveSafeYoloNetworkOptIn,
	resolveExperimentalSandboxMode,
} from "../../../../apps/vscode/src/sdk/sandbox-policy"

function expectedSbplRuleFromSourceMapping(capability: { network: "deny" | "allow" }): string {
	// STRUCTURAL projection of the closed-union mapping in
	// sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:274
	// (buildNetworkRule). NOT the result of running generateSeatbeltProfile.
	return capability.network === "deny" ? "(deny network*)" : "(allow network*)"
}

interface CaseSpec {
	label: "D" | "A" | "O"
	sandbox: string | undefined
	network: string | undefined
	expectedMode: "seatbelt-experimental" | undefined
	expectedOptIn: string | undefined
	expectedNetwork: "deny" | "allow"
	expectedRule: string
}

const cases: CaseSpec[] = [
	{
		label: "D",
		sandbox: undefined,
		network: undefined,
		expectedMode: "seatbelt-experimental",
		expectedOptIn: undefined,
		expectedNetwork: "deny",
		expectedRule: "(deny network*)",
	},
	{
		label: "A",
		sandbox: undefined,
		network: "allow",
		expectedMode: "seatbelt-experimental",
		expectedOptIn: "allow",
		expectedNetwork: "allow",
		expectedRule: "(allow network*)",
	},
	{
		label: "O",
		sandbox: "off",
		network: undefined,
		expectedMode: undefined,
		expectedOptIn: undefined, // resolveSafeYoloNetworkOptIn() requires seatbelt-experimental
		expectedNetwork: "deny",
		expectedRule: "(deny network*)",
	},
]

const cwd = "/tmp"
const workspaceRoots = [cwd]
let pass = 0
let fail = 0

// Capture the prior env state so we can restore it on exit
// (P1 review fix: env must not leak past process termination).
const PRIOR_SANDBOX_ENV = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
const PRIOR_NETWORK_ENV = process.env.CLINEMM_SAFE_YOLO_NETWORK

try {
	for (const cfg of cases) {
		if (cfg.sandbox === undefined) delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		else process.env.CLINEMM_EXPERIMENTAL_SANDBOX = cfg.sandbox
		if (cfg.network === undefined) delete process.env.CLINEMM_SAFE_YOLO_NETWORK
		else process.env.CLINEMM_SAFE_YOLO_NETWORK = cfg.network

		const mode = resolveExperimentalSandboxMode()
		const optIn = resolveSafeYoloNetworkOptIn()
		const cap = buildExperimentalReconCapability({ cwd, workspaceRoots })
		const rule = expectedSbplRuleFromSourceMapping(cap)

		console.log(`\n=== Case ${cfg.label} ===`)
		console.log(`  CLINEMM_EXPERIMENTAL_SANDBOX=${JSON.stringify(process.env.CLINEMM_EXPERIMENTAL_SANDBOX ?? "<unset>")}`)
		console.log(`  CLINEMM_SAFE_YOLO_NETWORK=${JSON.stringify(process.env.CLINEMM_SAFE_YOLO_NETWORK ?? "<unset>")}`)
		console.log(`  resolveExperimentalSandboxMode() = ${JSON.stringify(mode)}`)
		console.log(`  resolveSafeYoloNetworkOptIn()     = ${JSON.stringify(optIn)}`)
		console.log(`  buildExperimentalReconCapability(...).network = ${JSON.stringify(cap.network)}`)
		console.log(`  expectedSbplRuleFromSourceMapping = ${JSON.stringify(rule)}  (STRUCTURAL, not generated)`)

		const checks: Array<[string, unknown, unknown]> = [
			["mode", mode, cfg.expectedMode],
			["optIn", optIn, cfg.expectedOptIn],
			["capability.network", cap.network, cfg.expectedNetwork],
			["expectedSbplRuleFromSourceMapping", rule, cfg.expectedRule],
		]
		for (const [name, actual, expected] of checks) {
			const ok = JSON.stringify(actual) === JSON.stringify(expected)
			console.log(`  ${ok ? "✓" : "✗"} ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)
			if (ok) pass++
			else fail++
		}
	}
} finally {
	// Restore prior env state regardless of how we exit.
	if (PRIOR_SANDBOX_ENV === undefined) delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	else process.env.CLINEMM_EXPERIMENTAL_SANDBOX = PRIOR_SANDBOX_ENV
	if (PRIOR_NETWORK_ENV === undefined) delete process.env.CLINEMM_SAFE_YOLO_NETWORK
	else process.env.CLINEMM_SAFE_YOLO_NETWORK = PRIOR_NETWORK_ENV
}

console.log(`\n=== Result: ${pass} pass, ${fail} fail ===`)
process.exit(fail === 0 ? 0 : 1)
