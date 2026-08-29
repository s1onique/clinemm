/**
 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01
 *
 * Production-seam binding test: persisted Settings values must flow
 * through the real production capability builder
 * (buildExperimentalReconCapability) and produce exactly the intended
 * runtime selection with no hidden authority expansion.
 *
 * Pre-RED behaviour: the production seam reads
 * process.env.CLINEMM_SAFE_YOLO_* only. Persisted boolean Settings
 * values do NOT change the capability. This proves the missing binding.
 *
 * Post-GREEN behaviour:
 *   - When a setting-driven snapshot is supplied, the network and
 *     sshAuthenticationAuthority capability fields follow the
 *     snapshot, not the env.
 *   - When the snapshot says "deny" (the pre-ACT default for both
 *     fields), the capability MUST stay at network: "deny" and
 *     sshAuthenticationAuthority: undefined, regardless of env.
 *     This is the MIGRATION_OR_DEFAULT_AUTHORITY_DELTA = 0 invariant.
 *   - When the snapshot says "allow" for one field and "deny" for the
 *     other, only that one field is affected. Independence.
 *   - When the snapshot is undefined (legacy code paths that have
 *     not been migrated), the env path is the source of truth.
 *
 * ABLATION DISCIPLINARITY: this test exercises the production
 * buildExperimentalReconCapability builder directly with a snapshot
 * argument. A parallel hand-built object is NOT sufficient as sole
 * evidence (ACT §10). The FALLBACK subtest ensures the env-path
 * stays in place for pre-migrated callers.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	buildExperimentalReconCapability,
	resolveSafeYoloCapabilityFromState,
	type SafeYoloCapabilitySnapshot,
} from "./sandbox-policy"

beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
	delete process.env.CLINEMM_SAFE_YOLO_NETWORK
	delete process.env.CLINEMM_SAFE_YOLO_SSH_AGENT
})

afterEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
	delete process.env.CLINEMM_SAFE_YOLO_NETWORK
	delete process.env.CLINEMM_SAFE_YOLO_SSH_AGENT
})

/**
 * The production call site reads the snapshot, converts it to
 * { networkOverride, sshAgentOverride } via `resolveSafeYoloCapability-
 * FromState`, and passes the overrides to `buildExperimentalRecon-
 * Capability`. The two-arg form in this test file mirrors that
 * contract precisely — both the snapshot helper AND the production
 * builder are exercised on every test case below. The pattern
 * guarantees the test cannot pass by accident: it depends on the
 * snapshot helper getting the field right AND on the production
 * builder correctly honouring the overrides.
 *
 * `sshAuthenticationAuthority` is part of the production
 * CommandCapability type (sdk/packages/core/.../types.ts) but is
 * not re-exported from the SDK's main entry index. This is a
 * pre-existing SDK export gap (out of scope for this ACT). The
 * runtime field IS built by the production builder under
 * ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01, so the
 * test exercises the field through a typed cast that mirrors how
 * production callers use it (e.g. command-job-manager.ts).
 */
type CapabilityWithSshAuth = ReturnType<typeof buildExperimentalReconCapability> & {
	readonly sshAuthenticationAuthority?: { readonly mode: "agent" } | undefined
}
function buildCapabilityWithSnapshot(snap: SafeYoloCapabilitySnapshot): CapabilityWithSshAuth {
	return buildExperimentalReconCapability({
		cwd: "/tmp",
		workspaceRoots: [],
		networkOverride: snap.network,
		sshAgentOverride: snap.sshAgent,
	}) as CapabilityWithSshAuth
}

/**
 * Pre-ACT / legacy default snapshot: the persisted state file
 * does NOT carry either new key. With the three-valued design,
 * this maps to { network: undefined, sshAgent: undefined } —
 * the env-only path is the runtime source of truth, which
 * preserves the pre-ACT runtime behaviour exactly.
 */
const DEFAULT_SNAPSHOT: SafeYoloCapabilitySnapshot = resolveSafeYoloCapabilityFromState({
	network: undefined,
	sshAgent: undefined,
})

describe("ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01 — production-seam binding", () => {
	it("default snapshot maps to pre-ACT deny/deny (MIGRATION_OR_DEFAULT_AUTHORITY_DELTA = 0)", () => {
		const cap = buildCapabilityWithSnapshot(DEFAULT_SNAPSHOT)
		expect(cap.network).toBe("deny")
		expect(cap.sshAuthenticationAuthority).toBeUndefined()
	})

	it("persisted allowOutboundNetwork=true → capability.network = 'allow'", () => {
		const snapshot = resolveSafeYoloCapabilityFromState({
			network: true,
			sshAgent: undefined,
		})
		const cap = buildCapabilityWithSnapshot(snapshot)
		expect(cap.network).toBe("allow")
		expect(cap.sshAuthenticationAuthority).toBeUndefined()
	})

	it("persisted allowSshAgent=true → capability.sshAuthenticationAuthority.mode = 'agent'", () => {
		const snapshot = resolveSafeYoloCapabilityFromState({
			network: undefined,
			sshAgent: true,
		})
		const cap = buildCapabilityWithSnapshot(snapshot)
		expect(cap.network).toBe("deny")
		expect(cap.sshAuthenticationAuthority).toEqual({ mode: "agent" })
	})

	it("SSH-agent ON does NOT enable network (independence)", () => {
		const snapshot = resolveSafeYoloCapabilityFromState({
			network: undefined,
			sshAgent: true,
		})
		const cap = buildCapabilityWithSnapshot(snapshot)
		expect(cap.network).toBe("deny")
		expect(cap.sshAuthenticationAuthority).toEqual({ mode: "agent" })
	})

	it("network ON does NOT enable SSH-agent (independence)", () => {
		const snapshot = resolveSafeYoloCapabilityFromState({
			network: true,
			sshAgent: undefined,
		})
		const cap = buildCapabilityWithSnapshot(snapshot)
		expect(cap.network).toBe("allow")
		expect(cap.sshAuthenticationAuthority).toBeUndefined()
	})

	it("persisted network=false forces deny even when env says allow (persistence authoritative)", () => {
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		const snapshot = resolveSafeYoloCapabilityFromState({
			network: false,
			sshAgent: undefined,
		})
		const cap = buildCapabilityWithSnapshot(snapshot)
		expect(cap.network).toBe("deny")
	})

	it("persisted sshAgent=false forces deny even when env says allow (persistence authoritative)", () => {
		process.env.CLINEMM_SAFE_YOLO_SSH_AGENT = "allow"
		const snapshot = resolveSafeYoloCapabilityFromState({
			network: undefined,
			sshAgent: false,
		})
		const cap = buildCapabilityWithSnapshot(snapshot)
		expect(cap.sshAuthenticationAuthority).toBeUndefined()
	})

	it("env path is the fallback when no overrides are supplied (legacy callers stay green)", () => {
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		// Calling the production builder without any setting overrides
		// must still honour the env-only path (legacy call sites).
		const cap = buildExperimentalReconCapability({ cwd: "/tmp", workspaceRoots: [] })
		expect(cap.network).toBe("allow")
		process.env.CLINEMM_SAFE_YOLO_SSH_AGENT = "allow"
		const cap2 = buildExperimentalReconCapability({
			cwd: "/tmp",
			workspaceRoots: [],
		}) as CapabilityWithSshAuth
		expect(cap2.sshAuthenticationAuthority).toEqual({ mode: "agent" })
	})

	it("snapshot helper: undefined persisted values map to undefined opt-in (no silent defaults)", () => {
		const snap = resolveSafeYoloCapabilityFromState({
			network: undefined,
			sshAgent: undefined,
		})
		expect(snap.network).toBeUndefined()
		expect(snap.sshAgent).toBeUndefined()
	})

	it("snapshot helper: explicit persisted false maps to literal 'deny' (persistence authoritative)", () => {
		// After the §16 hardening, `false` resolves to the explicit
		// 'deny' literal — NOT to 'undefined'. This is the load-bearing
		// piece that lets a persisted-disable override an env-allow.
		// Reverting this back to `undefined` would re-open the silent
		// re-enable vulnerability (see the "persisted=false forces
		// deny even when env says allow" test above).
		const snap = resolveSafeYoloCapabilityFromState({
			network: false,
			sshAgent: false,
		})
		expect(snap.network).toBe("deny")
		expect(snap.sshAgent).toBe("deny")
	})
})
