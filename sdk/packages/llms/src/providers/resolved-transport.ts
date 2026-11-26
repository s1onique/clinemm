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
import { buildReasoningOriginAuthority } from "./reasoning-origin-authority";

/**
 * THE DESTINATION ORIGIN AUTHORITY OF A PROVIDER ROUTE.
 *
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A2).
 *
 * ## WHY THIS EXISTS
 * -----------------
 * The request-budget authority, the task-contract guard, the compaction
 * trigger and the wire gate all need the DESTINATION's origin authority: the
 * value the recorded origin of an opaque reasoning payload is compared
 * against.
 *
 * Before this resolver, each consumer resolved the destination ITSELF:
 *
 *   - `AgentRuntime` captured `config.baseUrl` at CONSTRUCTION time;
 *   - `createContextCompactionPrepareTurn()` resolved it from the
 *     compaction config;
 *   - `LocalRuntimeHost` resolved it from the connection config.
 *
 * Three copies of one decision drift, and they had already drifted: none of
 * them passed the API LINE, so a route selected by API line (MiniMax's
 * `china` vs `international` endpoints are different HOSTS, and therefore
 * different trust domains) resolved to the WRONG destination.
 *
 * ## THE CONTRACT
 * ---------------
 * ONE resolver, fed the route facts, produces ONE destination authority.
 *
 * The route facts are the SAME ones the registry resolves the wire's
 * `config.baseUrl` from (`config.baseUrl ?? apiLineBaseUrl ??
 * registration.defaults.baseUrl`), so the authority names the endpoint the
 * request is actually dispatched to.
 *
 * ## FAIL CLOSED
 * -------------
 * An UNRESOLVED route produces NO authority. That is the SAFE direction: an
 * unresolved destination grants no opaque replay authority, so the budget
 * excludes exactly the reasoning the wire also withholds. It never silently
 * EXCLUDES content the provider would have received.
 */
export function resolveDestinationOriginAuthority(input: {
	providerId: string;
	/** The caller-configured base URL, when one was supplied. */
	baseUrl?: string | undefined;
	/** The caller-selected API line, when one was supplied. */
	apiLine?: string | undefined;
}): string | undefined {
	return buildReasoningOriginAuthority({
		providerId: input.providerId,
		baseUrl: resolveEffectiveBaseUrl({
			providerId: input.providerId,
			baseUrl: input.baseUrl,
			apiLine: input.apiLine,
		}),
	});
}

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
	/**
	 * THE EFFECTIVE TRANSPORT — the serializer that actually runs.
	 *
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A1).
	 *
	 * `client` and `apiProtocol` are two INDEPENDENT facts, and neither of
	 * them alone answers "which serializer runs". The answer is the
	 * EFFECTIVE transport, established by consuming the SAME selection the
	 * production dispatch performs (see
	 * {@link resolveEffectiveTransportClient}).
	 *
	 * `undefined` means the effective transport is NOT established. A caller
	 * that needs a transport-specific behaviour MUST then fail CLOSED on the
	 * side that keeps every content (measure conservatively) rather than
	 * guessing.
	 */
	effectiveClient?: ProviderClient;
}

/**
 * The provider client's transport identity, as the production dispatch sees it.
 *
 * The dispatch selects the transport FACTORY from the provider's resolved
 * client and protocol (`resolveFactory` in `providers/compat.ts`,
 * `resolveRuntimeFamily` in `providers/builtins-runtime.ts`):
 *
 *   - `client === "openai"` OR `protocol === "openai-responses"` -> the
 *     OpenAI transport;
 *   - otherwise the client's own module (`anthropic`, `gemini`, `vertex`,
 *     `bedrock`, `openai-compatible`, ...).
 *
 * The `openai-compatible` case is the one the per-model protocol can
 * override, and it is the DEFAULT for a multi-format gateway.
 */
function resolveFactoryTransportClient(input: {
	client: ProviderClient | undefined;
	protocol: string | undefined;
}): ProviderClient | undefined {
	if (input.client === "openai" || input.protocol === "openai-responses") {
		return "openai";
	}
	return input.client;
}

/**
 * THE EFFECTIVE TRANSPORT CLIENT — the serializer that actually runs.
 *
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A1).
 *
 * ## THE DEFECT THIS REPAIRS
 * ---------------------------
 * The predecessor returned the provider's client and the model's protocol as
 * two SEPARATE facts and let the consumer decide. The consumer
 * (`requiresSignedReasoningCapability`) consults the provider client FIRST
 * and returns immediately when it is established, so the per-model protocol
 * was UNREACHABLE: a multi-format gateway whose model declares
 * `apiProtocol: "anthropic"` was classified by its PROVIDER client, not by
 * the serializer that runs.
 *
 * The real dispatch (`resolveModelProviderKind` in `providers/ai-sdk.ts`)
 * applies the per-model protocol ONLY when BOTH hold:
 *
 *   1. the factory's default transport is `openai-compatible`, and
 *   2. the provider DECLARES `metadata.routing.modelApiProtocol` — the
 *      provider's own statement that it honours the catalog's per-model API
 *      protocols under its shared base URL.
 *
 * A provider that publishes per-model protocols but does NOT declare that
 * routing flag dispatches EVERY model through its shared base transport, so
 * its per-model protocol is NOT the transport fact.
 *
 * ## WHY THIS REUSES THE ESTABLISHED SELECTION
 * ---------------------------------------------
 * The routing flag and the protocol vocabulary are the repository's OWN
 * published facts. This resolver consumes them with the SAME rule the
 * dispatch uses, rather than introducing a second transport registry, a
 * provider-id list or a model-name heuristic.
 */
export function resolveEffectiveTransportClient(input: {
	providerId: string;
	model?: ModelInfo | undefined;
}): ProviderClient | undefined {
	const collection = getProviderCollectionSync(input.providerId);
	const provider = collection?.provider;
	if (!provider) {
		return undefined;
	}
	const factoryTransport = resolveFactoryTransportClient({
		client: provider.client,
		protocol: provider.protocol,
	});
	const honoursModelApiProtocol = readsModelApiProtocol(provider.metadata);
	if (factoryTransport === "openai-compatible" && honoursModelApiProtocol) {
		switch (readApiProtocol(input.model)) {
			case "openai-responses":
				return "openai";
			case "anthropic":
				return "anthropic";
			case "gemini":
				return "gemini";
			default:
				break;
		}
	}
	return factoryTransport;
}

/**
 * Resolve the transport facts for a provider (and optionally a model).
 *
 * `effectiveClient` is THE ESTABLISHED transport: the serializer that
 * actually runs for this provider/model pair. It is what a caller must use
 * to decide a transport-specific behaviour; `client` and `apiProtocol` remain
 * available as the raw facts they are.
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
	const facts: ResolvedTransportFacts = apiProtocol
		? { client: provider?.client, apiProtocol }
		: { client: provider?.client };
	// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A1).
	//
	// The EFFECTIVE transport is established by the SAME selection the
	// production dispatch performs, so it cannot disagree with the
	// serializer that runs.
	const effectiveClient = resolveEffectiveTransportClient({
		providerId: input.providerId,
		model: input.model,
	});
	if (effectiveClient !== undefined) {
		facts.effectiveClient = effectiveClient;
	}
	return facts;
}

function readApiProtocol(model: ModelInfo | undefined): string | undefined {
	const protocol = model?.metadata?.apiProtocol;
	return typeof protocol === "string" && protocol.length > 0
		? protocol
		: undefined;
}

/**
 * Whether the provider DECLARES that it honours the catalog's per-model API
 * protocols under its shared base URL.
 *
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A1).
 *
 * This is the provider's OWN published routing fact
 * (`metadata.routing.modelApiProtocol`, the same key the production dispatch
 * reads in `resolveModelProviderKind`). The catalog's provider metadata is
 * schema-typed as an open record, so the value is read through a narrow,
 * shape-checked reader rather than a cast.
 *
 * Only an EXACT `true` counts. Anything else — absent, a non-boolean, or a
 * malformed routing record — means the provider does NOT declare the
 * capability, so the per-model protocol does not select the transport.
 */
function readsModelApiProtocol(metadata: unknown): boolean {
	if (!metadata || typeof metadata !== "object") {
		return false;
	}
	const routing = (metadata as { routing?: unknown }).routing;
	if (!routing || typeof routing !== "object") {
		return false;
	}
	return (routing as { modelApiProtocol?: unknown }).modelApiProtocol === true;
}
