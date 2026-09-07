/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01
 *
 * RPC handler: `bootstrapModelProfileFromCurrentConfiguration`.
 *
 * Boots the FIRST ModelProfile for a fresh user who has zero profiles
 * and a valid legacy/current API configuration. Materializes a new
 * opaque `ProviderConfigurationInstance` + instance-scoped physical
 * credential + `ModelProfile` from the existing `ApiConfiguration`,
 * WITHOUT providerId-equality matching against any pre-existing
 * instance (which is the MPWC01 C3 identity-collapse bug).
 *
 * This RPC is distinct from `saveCurrentAsModelProfile`:
 *   - `saveCurrentAsModelProfile` requires an existing authoritative
 *     `providerInstanceId` (from a bound profile or applied profile)
 *     and fails closed if none is available.
 *   - `bootstrapModelProfileFromCurrentConfiguration` has NO existing
 *     identity requirement; it CREATES the instance identity, the
 *     instance-scoped secret, and the profile from the legacy config.
 *
 * The two RPCs share no code path and the existing
 * `saveCurrentAsModelProfile` semantics are NOT mutated by this
 * handler (per freeze `BOOTSTRAP_RPC`).
 *
 * The handler delegates to `bootstrapModelProfileFromCurrentConfiguration`
 * in `@/sdk/profile-store/bootstrap.ts`, which encodes the full causal
 * chain and the result algebra. The handler is a thin glue layer that
 * resolves the controller-level dependencies (`StateManager`,
 * `InstancesStore`, `ProfilesStore`, `getMode`, `getCurrentTaskHistoryItem`,
 * `writeTaskHistoryItem`, `postStateToWebview`) and translates the typed
 * result into a `BootstrapModelProfileResponse` proto message.
 *
 * Result algebra: see `BootstrapModelProfileResult` in
 * `@/sdk/profile-store/bootstrap.ts`. The handler NEVER throws across
 * the gRPC boundary; every failure mode is surfaced as a typed
 * `status` string with a human-readable `message`.
 */

import { StateManager } from "@/core/storage/StateManager"
import {
	type BootstrapModelProfileDeps,
	bootstrapModelProfileFromCurrentConfiguration as bootstrapPrimitive,
} from "@/sdk/profile-store/bootstrap"
import { BootstrapModelProfileRequest, BootstrapModelProfileResponse } from "@/shared/proto/cline/state"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

export async function bootstrapModelProfileFromCurrentConfiguration(
	controller: Controller,
	request: BootstrapModelProfileRequest,
): Promise<BootstrapModelProfileResponse> {
	const trimmedName = (request.name ?? "").trim()
	if (!trimmedName) {
		// Validate at the handler boundary so we can return a typed
		// failure envelope instead of letting the primitive emit a
		// generic PROFILE_WRITE_FAILED with a confusing message.
		return BootstrapModelProfileResponse.create({
			status: "PROFILE_WRITE_FAILED",
			profileId: "",
			instanceId: "",
			message: "bootstrapModelProfileFromCurrentConfiguration: name must be a non-empty string",
		})
	}

	const owner = controller.modelProfilesOwner
	if (!owner) {
		Logger.error(
			"[bootstrapModelProfileFromCurrentConfiguration] Controller has no modelProfilesOwner -- production wiring missing",
		)
		return BootstrapModelProfileResponse.create({
			status: "PROFILE_WRITE_FAILED",
			profileId: "",
			instanceId: "",
			message:
				"bootstrapModelProfileFromCurrentConfiguration: production owner not wired (modelProfilesOwner is undefined)",
		})
	}

	const stateManager = StateManager.get()
	const deps: BootstrapModelProfileDeps = {
		getApiConfiguration: () => stateManager.getApiConfiguration(),
		getMode: () => owner.getMode?.() ?? "act",
		setInstanceSecret: (name, value) => {
			stateManager.setInstanceSecret(name, value)
		},
		// CORRECTION02 P0-1: drain the debounced secret persistence
		// BEFORE the profile commit boundary, so the durable
		// `CREATED` semantics carry through a cold restart.
		flushInstanceSecrets: () => stateManager.flushPendingState(),
		instancesStore: owner.instancesStore,
		profilesStore: owner.profilesStore,
		getCurrentTaskHistoryItem: () => owner.getCurrentTaskHistoryItem(),
		writeTaskHistoryItem: owner.writeTaskHistoryItem,
		postStateToWebview: owner.postStateToWebview,
	}

	try {
		const result = await bootstrapPrimitive(deps, trimmedName)
		Logger.log(
			`[bootstrapModelProfileFromCurrentConfiguration] ${result.status}` +
				(result.status === "CREATED" || result.status === "CREATED_BINDING_FAILED"
					? ` profile=${result.profileId} instance=${result.instanceId}`
					: ""),
		)
		return BootstrapModelProfileResponse.create({
			status: result.status,
			profileId: result.status === "CREATED" || result.status === "CREATED_BINDING_FAILED" ? result.profileId : "",
			instanceId: result.status === "CREATED" || result.status === "CREATED_BINDING_FAILED" ? result.instanceId : "",
			message:
				result.status === "CREATED"
					? ""
					: result.status === "CREATED_BINDING_FAILED"
						? result.message
						: "message" in result
							? result.message
							: "",
		})
	} catch (err) {
		// The primitive is contractually non-throwing, so a throw
		// here indicates a programming error (e.g. an InstancesStore
		// or ProfilesStore fault we did not catch upstream, or a
		// postStateToWebview that bypassed the best-effort guard).
		// Surface as PROFILE_WRITE_FAILED with the original error
		// message; never throw across the gRPC boundary.
		Logger.error("[bootstrapModelProfileFromCurrentConfiguration] Unexpected error:", err)
		return BootstrapModelProfileResponse.create({
			status: "PROFILE_WRITE_FAILED",
			profileId: "",
			instanceId: "",
			message: err instanceof Error ? err.message : String(err),
		})
	}
}
