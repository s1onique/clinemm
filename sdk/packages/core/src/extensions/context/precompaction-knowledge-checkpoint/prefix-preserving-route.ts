/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C2/C6
 *
 * The B' ROUTE: the DEFAULT-OFF opt-in and the runtime-owned assembly of
 * the parent request authority.
 *
 * ============================================================================
 * THE CONFIGURATION KEY
 * ============================================================================
 *
 * The B' route is selected by ONE environment variable, which is the SAME
 * mechanism the sibling PCK features already use:
 *
 *   CLINEMM_PCK_PREFIX_PRESERVING_ENABLED=1
 *
 * It is DEFAULT-OFF. With the variable absent, or set to anything other
 * than "1" / "true", the LEGACY independent PCK request is dispatched
 * exactly as before and the parent request is not read at all.
 *
 * ============================================================================
 * THE PARENT REQUEST AUTHORITY
 * ============================================================================
 *
 * The authority is assembled from the ORDINARY request the runtime is
 * preparing. It is the REAL provider-visible projection, the REAL system
 * prompt and the REAL visible tool schema — never a reconstruction.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { collectCanonicalToolEvents } from "./evidence";
import type {
	BoundedObservation,
	PrefixPreservingParentAuthority,
	ProviderVisibleToolSchema,
} from "./prefix-preserving-request";
import {
	buildProviderVisibleBindings,
	type ProviderVisibleBinding,
	type ProviderVisibleMessage,
} from "./provider-visible-binding";

/**
 * The environment variable that opts into the prefix-preserving PCK route.
 */
export const PCK_PREFIX_PRESERVING_ENV_VAR =
	"CLINEMM_PCK_PREFIX_PRESERVING_ENABLED";

/**
 * Whether the prefix-preserving PCK route is enabled.
 *
 * The value must be exactly "1" or "true" (case-insensitive) so an
 * unrelated value cannot enable it accidentally.
 */
export function isPckPrefixPreservingEnabled(
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	const raw = env[PCK_PREFIX_PRESERVING_ENV_VAR];
	if (typeof raw !== "string") {
		return false;
	}
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true";
}

/**
 * The EXTRACTION OBJECTIVE the suffix carries.
 *
 * It is a fixed, runtime-owned statement. It is NOT model-authored and it
 * is NOT user-authored, so a forged instruction in the conversation cannot
 * become the objective.
 */
export const PCK_EXTRACTION_OBJECTIVE =
	"Report the working knowledge this session has ESTABLISHED, what its evidence actually supports, its unresolved hypotheses, and the canonical references that support each claim.";

/**
 * The parent request authority, as the ordinary request boundary holds it.
 */
export interface ParentRequestAuthorityInput {
	/** The parent's system prompt, verbatim. */
	readonly systemPrompt: string;
	/** The parent's REAL provider-visible projection. */
	readonly providerMessages: readonly ProviderVisibleMessage[];
	/**
	 * The parent's tool inventory, as the ordinary request boundary holds it.
	 *
	 * It is the RUNTIME's tool objects, not the wire schema, so it is
	 * PROJECTED onto the provider-visible schema below.
	 */
	readonly tools: readonly unknown[];
	/** The canonical history the projection was built from. */
	readonly canonicalMessages: readonly MessageWithMetadata[];
	/**
	 * The AUTHORIZED SOURCE INTERVAL: the number of leading canonical
	 * messages the compaction decision authorizes for extraction.
	 */
	readonly authorizedMessageCount: number;
}

/**
 * Project the parent's tool inventory onto the PROVIDER-VISIBLE schema.
 *
 * A tool that does not carry a usable name is DROPPED: it cannot be
 * advertised, so advertising a partial schema would make the rendered
 * request differ from the parent's for no reason.
 *
 * The projection is deliberately narrow. The runtime's tool objects carry
 * their EXECUTORS, and the auxiliary request must not hold one.
 */
export function projectProviderVisibleToolSchema(
	tools: readonly unknown[],
): readonly ProviderVisibleToolSchema[] {
	const projected: ProviderVisibleToolSchema[] = [];
	for (const tool of tools) {
		if (!tool || typeof tool !== "object") {
			continue;
		}
		const record = tool as {
			name?: unknown;
			description?: unknown;
			inputSchema?: unknown;
		};
		if (typeof record.name !== "string" || record.name.length === 0) {
			continue;
		}
		projected.push({
			name: record.name,
			description:
				typeof record.description === "string" ? record.description : "",
			inputSchema:
				record.inputSchema && typeof record.inputSchema === "object"
					? (record.inputSchema as Record<string, unknown>)
					: { type: "object", properties: {} },
		});
	}
	return projected;
}

/**
 * Assemble the parent request authority.
 *
 * It returns `undefined` when the parent authority is UNAVAILABLE, so the
 * caller selects the legacy route rather than dispatching an approximate
 * reconstruction.
 */
export function assembleParentRequestAuthority(
	input: ParentRequestAuthorityInput,
): PrefixPreservingParentAuthority | undefined {
	if (input.providerMessages.length === 0) {
		return undefined;
	}
	const bindings: ReadonlyMap<string, ProviderVisibleBinding> =
		buildProviderVisibleBindings({
			canonicalMessages: input.canonicalMessages,
			providerMessages: input.providerMessages,
			authorizedMessageCount: input.authorizedMessageCount,
		});
	const observations: BoundedObservation[] = collectCanonicalToolEvents(
		input.canonicalMessages,
	).map((event) => ({
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		succeeded: event.succeeded,
	}));
	return {
		systemPrompt: input.systemPrompt,
		messages: input.providerMessages,
		tools: projectProviderVisibleToolSchema(input.tools),
		bindings,
		authorizedMessageCount: input.authorizedMessageCount,
		observations,
		objective: PCK_EXTRACTION_OBJECTIVE,
	};
}
