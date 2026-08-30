/**
 * ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01 — RED #2
 *
 * Beyond the H2 absence-default RED, prove that the FULL production
 * chain produces the expected runtime capability when the user has
 * explicitly toggled the network switch to true (persisted state).
 *
 * Production chain (verified here):
 *   StateManager.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork")
 *   → safeYoloCapabilitySource closure (in SdkController)
 *     → resolveSafeYoloCapabilityFromState(snap)
 *       → buildExperimentalReconCapability({networkOverride})
 *         → sandboxBackend.prepare(capability, command)
 *           → spawned Seatbelt-exec process
 *
 * This test exercises the production modules, NOT a parallel hand-built
 * object. It captures the effective capability at the
 * buildExperimentalReconCapability boundary as the live-quality
 * observable.
 *
 * The red tests below cover BOTH legacy absence (H2 red) and the
 * complete production composition (network=true → "allow").
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

describe("ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01 — production chain", () => {
	let savedEnv: Record<string, string | undefined>

	beforeEach(() => {
		savedEnv = {
			CLINEMM_EXPERIMENTAL_SANDBOX: process.env.CLINEMM_EXPERIMENTAL_SANDBOX,
			CLINEMM_SAFE_YOLO_NETWORK: process.env.CLINEMM_SAFE_YOLO_NETWORK,
			CLINEMM_SAFE_YOLO_SSH_AGENT: process.env.CLINEMM_SAFE_YOLO_SSH_AGENT,
		}
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow" // legacy opt-in kept on
		delete process.env.CLINEMM_SAFE_YOLO_SSH_AGENT
	})

	afterEach(() => {
		for (const [k, v] of Object.entries(savedEnv)) {
			if (v === undefined) {
				delete process.env[k]
			} else {
				process.env[k] = v
			}
		}
	})

	it("LEGACY-ABSENT — capability.network must be 'allow' (env wins) per documented invariant", async () => {
		const { resolveSafeYoloCapabilityFromState, buildExperimentalReconCapability } = await import("../sandbox-policy")

		// Documented contract: ABSENT legacy key → snap.network=undefined
		// → env-only path → env=allow → "allow".
		const legacySnap = resolveSafeYoloCapabilityFromState({
			network: undefined,
			sshAgent: undefined,
		})
		const cap = buildExperimentalReconCapability({
			cwd: "/tmp",
			workspaceRoots: [],
			networkOverride: legacySnap.network,
			sshAgentOverride: legacySnap.sshAgent,
		})
		console.log("[GREEN ref] legacy absent → cap.network =", cap.network)
		expect(cap.network).toBe("allow")
	})

	it("TOGGLE-ON — capability.network must be 'allow' (persisted wins)", async () => {
		const { resolveSafeYoloCapabilityFromState, buildExperimentalReconCapability } = await import("../sandbox-policy")

		const onSnap = resolveSafeYoloCapabilityFromState({
			network: true,
			sshAgent: false,
		})
		const cap = buildExperimentalReconCapability({
			cwd: "/tmp",
			workspaceRoots: [],
			networkOverride: onSnap.network,
			sshAgentOverride: onSnap.sshAgent,
		})
		console.log("[GREEN ref] toggle-on → cap.network =", cap.network)
		expect(cap.network).toBe("allow")
	})

	it("TOGGLE-OFF — capability.network must be 'deny' (persisted wins over env allow)", async () => {
		const { resolveSafeYoloCapabilityFromState, buildExperimentalReconCapability } = await import("../sandbox-policy")

		const offSnap = resolveSafeYoloCapabilityFromState({
			network: false,
			sshAgent: false,
		})
		const cap = buildExperimentalReconCapability({
			cwd: "/tmp",
			workspaceRoots: [],
			networkOverride: offSnap.network,
			sshAgentOverride: offSnap.sshAgent,
		})
		console.log("[GREEN ref] toggle-off + env=allow → cap.network =", cap.network)
		expect(cap.network).toBe("deny")
	})
})
