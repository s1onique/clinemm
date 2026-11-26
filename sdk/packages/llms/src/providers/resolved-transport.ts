/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A1).
 *
 * THE RESOLVED TRANSPORT AUTHORITY.
 *
 * ## WHAT THIS IS
 * ---------------
 * The request-budget authority, the task-contract guard and the compaction
 * trigger all need to know whether the target transport REQUIRES
 * provider-origin authorization for a reasoning block. That is a property of
 * the TRANSPORT that will serialize the request — specifically, of whether
 * the Anthropic AI SDK module is the one that runs.
 *
 * The previous implementation answered that question from the MODEL FAMILY.
 * That is a lineage guess, and it is wrong on exactly the routes that
 * matter:
 *
 *   - the MiniMax builtin route publishes a model family of "minimax" while
 *     the provider resolves to the ANTHROPIC transport, so the family-first
 *     answer was FALSE and the CMP-09 exclusion was UNREACHABLE in
 *     production on the very route the historical defect was observed on;
 *   - an Anthropic-lineage model served over a NON-Anthropic transport was
 *     answered TRUE, which would exclude reasoning the provider would have
 *     received.
 *
 * ## THE AUTHORITY
 * ----------------
 * This resolver reads the RESOLVED TRANSPORT CLIENT the repository already
 * publishes:
 *
 *   - `ProviderInfo.client` — the `ProviderClient` the provider collection
 *     resolves to, and the SAME value the gateway's transport factory is
 *     selected by (`resolveFactory` / `resolveModelProviderKind`);
 *   - `ProviderInfo.protocol` — the provider's wire protocol;
 *   - `ModelInfo.metadata.apiProtocol` — the PER-MODEL wire protocol
 *     override for a gateway that serves several API formats.
 *
 * It introduces NO new registry, NO new identity framework and NO new
 * migration subsystem: it only reads facts the repository already publishes.
 *
 * ## THE ORDER
 * -----------
 * The PER-MODEL protocol wins over the provider-level client, because a
 * multi-format gateway dispatches each model through its own protocol. The
 * provider-level client is the fallback.
 */

import type { ModelInfo, ProviderClient } from "@cline/shared";
import { resolveProviderApiLineBaseUrl } from "./builtins";
import { getProviderCollectionSync } from "./model-registry";

/**
 * The EFFECTIVE base URL of a provider route.
 *
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A2/A3).
 *
 * It mirrors the registry's own resolution EXACTLY
 * (`config.baseUrl ?? apiLineBaseUrl ?? registration.defaults.baseUrl`), so
 * the request-budget authority measures the SAME route the wire dispatches
 * to.
 *
 * It matters because the origin authority is a property of the EFFECTIVE
 * ENDPOINT: an operator-configured base URL resolves to an UNESTABLISHED
 * route (and therefore to NO authority), while the repository's published
 * builtin endpoint resolves to an ESTABLISHED one.
 *
 * `undefined` means the route is unresolved.
 */
export function resolveEffectiveBaseUrl(input: {
	providerId: string;
	/** The caller-configured base URL, when one was supplied. */
	baseUrl?: string | undefined;
	/** The caller-selected API line, when one was supplied. */
	apiLine?: string | undefined;
}): string | undefined {
	const configured = input.baseUrl?.trim();
	if (configured) {
		return configured;
	}
	const apiLineBaseUrl = resolveProviderApiLineBaseUrl(
		input.providerId,
		input.apiLine,
	);
	if (apiLineBaseUrl) {
		return apiLineBaseUrl;
	}
	const collection = getProviderCollectionSync(input.providerId);
	return collection?.provider.baseUrl;
}

/**
 * The resolved transport facts for one provider/model pair.
 */
export interface ResolvedTransportFacts {
	/**
	 * The RESOLVED transport client the request is dispatched through.
	 *
	 * `undefined` means the transport identity is NOT established, in which
	 * case no transport-specific requirement may be inferred.
	 */
	client?: ProviderClient;
	/**
	 * The PER-MODEL wire protocol, when the catalog publishes one.
	 */
	apiProtocol?: string;
}

/**
 * Resolve the transport facts for a provider (and optionally a model).
 *
 * The provider's resolved client is the authority. The per-model wire
 * protocol OVERRIDES it, because a multi-format gateway dispatches each
 * model through its own protocol.
 */
export function resolveTransportFacts(input: {
	providerId: string;
	model?: ModelInfo | undefined;
}): ResolvedTransportFacts {
	const collection = getProviderCollectionSync(input.providerId);
	const provider = collection?.provider;
	// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A1).
	//
	// The PER-MODEL wire protocol is the more specific fact, so it wins.
	const apiProtocol = readApiProtocol(input.model);
	if (apiProtocol) {
		return { client: provider?.client, apiProtocol };
	}
	return { client: provider?.client };
}

function readApiProtocol(model: ModelInfo | undefined): string | undefined {
	const protocol = model?.metadata?.apiProtocol;
	return typeof protocol === "string" && protocol.length > 0
		? protocol
		: undefined;
}
