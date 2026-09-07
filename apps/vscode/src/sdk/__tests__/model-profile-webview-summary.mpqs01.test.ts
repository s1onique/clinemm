/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase D
 *
 * RED -> GREEN witness for MP-R10 (webview serialization contains
 * no raw secret) at the projection seam.
 *
 * Production seams driven (this file):
 *   projectModelProfileToSummary       = REAL_PRODUCTION_SEAM
 *   projectAllModelProfilesToSummaries = REAL_PRODUCTION_SEAM
 *   DEFAULT_SECRET_SENTINELS           = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed: readInstance (a plain function).
 */

import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import type { ProviderConfigurationInstance } from "../instance-store/contracts"
import { describe, expect, it } from "vitest"
import { type ModelProfile } from "../profile-store/contracts"
import {
	DEFAULT_SECRET_SENTINELS,
	projectAllModelProfilesToSummaries,
	projectModelProfileToSummary,
} from "../profile-store/webview-summary"

function makeInstance(
	instanceId: string,
	providerId: string,
	modelId: string,
): ProviderConfigurationInstance {
	return {
		instanceId,
		providerId,
		displayLabel: `inst-${instanceId}`,
		credentialRef: { kind: "secret", name: `instance:${instanceId}-key` as InstanceSecretName },
		connection: { modelId, baseUrl: `https://${instanceId}` },
		createdAt: 1,
		updatedAt: 1,
	}
}

function makeProfile(profileId: string, instanceId: string, modelId: string): ModelProfile {
	return {
		profileId,
		name: `Profile ${profileId}`,
		providerInstanceId: instanceId,
		modelId,
	}
}

describe("ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase D", () => {
	describe("single-profile projection", () => {
		it("MPQS01_SUMMARY_ACTIVE_FLAG: isActive reflects currentActiveProfileId", () => {
			const summary = projectModelProfileToSummary(
				makeProfile("prof-A", "inst-A", "model-A"),
				makeInstance("inst-A", "openai-compatible", "model-A"),
				"prof-A",
				undefined,
			)
			expect(summary.isActive).toBe(true)
			expect(summary.isDefault).toBe(false)
		})

		it("MPQS01_SUMMARY_DEFAULT_FLAG: isDefault reflects currentDefaultProfileId", () => {
			const summary = projectModelProfileToSummary(
				makeProfile("prof-A", "inst-A", "model-A"),
				makeInstance("inst-A", "openai-compatible", "model-A"),
				undefined,
				"prof-A",
			)
			expect(summary.isDefault).toBe(true)
			expect(summary.isActive).toBe(false)
		})

		it("MPQS01_SUMMARY_PROVIDER_FROM_INSTANCE: providerId comes from the referenced instance", () => {
			const summary = projectModelProfileToSummary(
				makeProfile("prof-A", "inst-A", "model-A"),
				makeInstance("inst-A", "openai-compatible", "model-A"),
				undefined,
				undefined,
			)
			expect(summary.providerId).toBe("openai-compatible")
		})

		it("MPQS01_SUMMARY_MISSING_INSTANCE_FALLBACK: missing instance -> providerId='unknown' (no crash)", () => {
			const summary = projectModelProfileToSummary(
				makeProfile("prof-A", "inst-DELETED", "model-A"),
				undefined,
				undefined,
				undefined,
			)
			expect(summary.providerId).toBe("unknown")
		})
	})

	describe("all-profiles projection + secret sentinel scan", () => {
		it("MPQS01_PROJECT_ALL_RETURNS_ALL_PROFILES: each profile becomes a summary", () => {
			const profiles: Record<string, ModelProfile> = {
				"prof-A": makeProfile("prof-A", "inst-A", "model-A"),
				"prof-B": makeProfile("prof-B", "inst-B", "model-B"),
			}
			const instances: Record<string, ProviderConfigurationInstance> = {
				"inst-A": makeInstance("inst-A", "openai-compatible", "model-A"),
				"inst-B": makeInstance("inst-B", "openai-compatible", "model-B"),
			}
			const summaries = projectAllModelProfilesToSummaries(
				profiles,
				(id) => instances[id],
				"prof-A",
				"prof-B",
			)
			expect(summaries).toHaveLength(2)
			expect(summaries.find((s) => s.profileId === "prof-A")?.isActive).toBe(true)
			expect(summaries.find((s) => s.profileId === "prof-B")?.isDefault).toBe(true)
		})

		it("MPQS01_SERIALIZATION_CONTAINS_NO_SECRET: JSON-serialized summaries contain none of DEFAULT_SECRET_SENTINELS", () => {
			const profiles: Record<string, ModelProfile> = {
				"prof-A": makeProfile("prof-A", "inst-A", "model-A"),
				"prof-B": makeProfile("prof-B", "inst-B", "model-B"),
			}
			const instances: Record<string, ProviderConfigurationInstance> = {
				"inst-A": makeInstance("inst-A", "openai-compatible", "model-A"),
				"inst-B": makeInstance("inst-B", "openai-compatible", "model-B"),
			}
			const summaries = projectAllModelProfilesToSummaries(
				profiles,
				(id) => instances[id],
				undefined,
				undefined,
			)
			const serialized = JSON.stringify(summaries)
			for (const sentinel of DEFAULT_SECRET_SENTINELS) {
				expect(serialized.toLowerCase()).not.toContain(sentinel.toLowerCase())
			}
		})

		it("MPQS01_SENTINEL_SCAN_THROWS_ON_LEAK: a fixture secret injected via a profile name triggers the scan", () => {
			const profiles: Record<string, ModelProfile> = {
				"prof-A": {
					...makeProfile("prof-A", "inst-A", "model-A"),
					name: "leaky sk-proj-12345",
				},
			}
			expect(() =>
				projectAllModelProfilesToSummaries(
					profiles,
					() => makeInstance("inst-A", "openai-compatible", "model-A"),
					undefined,
					undefined,
				),
			).toThrow(/secret sentinel/)
		})

		it("MPQS01_SUMMARY_HAS_NO_RAW_SECRET_FIELD: every field of the summary is one of the allowed shape fields", () => {
			const profiles: Record<string, ModelProfile> = {
				"prof-A": makeProfile("prof-A", "inst-A", "model-A"),
			}
			const instances: Record<string, ProviderConfigurationInstance> = {
				"inst-A": makeInstance("inst-A", "openai-compatible", "model-A"),
			}
			const summaries = projectAllModelProfilesToSummaries(
				profiles,
				(id) => instances[id],
				"prof-A",
				"prof-A",
			)
			const allowedKeys = new Set(["profileId", "name", "providerId", "modelId", "isActive", "isDefault"])
			for (const summary of summaries) {
				for (const k of Object.keys(summary)) {
					expect(allowedKeys.has(k)).toBe(true)
				}
			}
		})
	})
})
