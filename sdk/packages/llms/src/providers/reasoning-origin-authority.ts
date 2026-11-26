/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02.
 *
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A2/A3).
 *
 * THE DESTINATION ORIGIN AUTHORITY.
 *
 * ## WHY IT IS EXTRACTED
 * ----------------------
 * The ORIGIN AUTHORITY of a provider endpoint is the value the fail-closed
 * destination-specific replay-eligibility policy compares a recorded origin
 * against. It was computed INSIDE the outbound conversion
 * (`providers/ai-sdk.ts`), which made it unreachable to the request-budget
 * authority: the budget could not know the destination's authority, so it
 * could not apply the SAME policy the wire applies.
 *
 * It is extracted here so the wire and the budget compute the IDENTICAL
 * value with the IDENTICAL function. The policy itself is unchanged; only
 * its location changed.
 *
 * ## THE CONTRACT
 * --------------
 * The authority identifies BOTH:
 *
 *   - the provider id, and
 *   - the EFFECTIVE endpoint (the resolved base URL), when one is known.
 *
 * A provider id alone does NOT establish a trust domain: two endpoints can
 * share one provider id (a regional or self-hosted endpoint, a gateway, a
 * proxy) while being entirely distinct trust domains.
 *
 * CREDENTIAL FREEDOM (A2). The authority is PERSISTED alongside the
 * payload, so it must never carry a credential. The repository's provider
 * configuration contract places credentials in `apiKey` / `apiKeyResolver` /
 * `apiKeyEnv` / `headers` — NEVER in the base URL — but the base URL is
 * still SYNTANTICALLY capable of carrying one (the configuration schema
 * accepts any `z.string().url()`, including user information, query
 * strings and fragments). The route identity is therefore built ONLY from
 * the URL components that are provably credential-free and provably
 * route-identity, and a URL that carries any other component produces NO
 * authority at all (fail closed) rather than a value that would either
 * leak a credential or silently drop an identity-bearing component.
 *
 * ABSENCE IS EXPLICIT (A1). The authority is `string | undefined`, and
 * `undefined` means "this route is UNRESOLVED". There is deliberately no
 * nonempty sentinel: a sentinel would make two DIFFERENT unresolved routes
 * compare EQUAL and would grant replay authority across a boundary that was
 * never established.
 *
 * The two parts are joined with a separator that cannot occur in either,
 * so the composite cannot be forged by moving characters between them.
 */

import { isPublishedBuiltinRoute } from "./published-routes";

/**
 * Build the ORIGIN AUTHORITY of a provider endpoint.
 *
 * ## THE EFFECTIVE ROUTE
 * ----------------------
 * The EFFECTIVE ROUTE, not merely the logical provider id and not the
 * unresolved configuration value:
 *
 *   - `context.config.baseUrl` is the RESOLVED endpoint. The registry
 *     resolves it as `config.baseUrl ?? apiLineBaseUrl ??
 *     registration.defaults.baseUrl`, so the API-line variant (for
 *     example MiniMax's China vs international endpoint) is already
 *     applied.
 *   - The full base URL is used, INCLUDING its PATH, because two
 *     endpoints can share a hostname and differ only by path, and a
 *     different path can be a different trust domain. The Anthropic
 *     adapter builds its effective request URL as
 *     `${baseURL}/messages`, so the base URL's path IS part of the
 *     route.
 *   - Only trailing slashes are normalized, so `/v1` and `/v1/` are the
 *     same route while `/v1` and `/v2` are not.
 *
 * ## CREDENTIAL EXCLUSION
 * -----------------------
 * The URL is parsed and then INSPECTED; a URL that carries ANY of the
 * following produces NO authority:
 *
 *   - USER INFORMATION (`https://user:secret@host/...`) — a credential. It
 *     is not route identity, and stripping it would make two different
 *     effective routes indistinguishable.
 *   - a QUERY STRING (`?api_key=...`) — the canonical credential carrier in
 *     a URL. It cannot be told apart from route identity by shape, so it is
 *     refused rather than persisted or stripped.
 *   - a FRAGMENT (`#...`) — never transmitted to the server, so it cannot be
 *     route identity, and it may carry a credential.
 *   - a URL that does not parse — an invalid endpoint, and therefore an
 *     unresolved route.
 *
 * The PATH is RETAINED IN FULL for an ESTABLISHED route, because it is
 * route identity under this repository's configuration contract
 * (credentials travel in `apiKey` and `headers`, never in the path).
 * Retaining it is what keeps a same-host / different-path pair two
 * DISTINCT routes.
 *
 * ## ESTABLISHMENT IS THE GATE (CORRECTION03)
 * --------------------------------------------
 * The authority is established ONLY for an EXACT match against the
 * repository's PUBLISHED BUILTIN ROUTES (the builtin spec's default base
 * URL and its per-API-line base URLs). An UNESTABLISHED route — an
 * operator-configured base URL, a self-hosted or proxied endpoint, an
 * extension-registered provider — has NO published fact behind it, so it
 * is WITHHELD authority: it produces NO authority at all, and nothing
 * about it (host, path, or a credential in either) can reach the persisted
 * record.
 *
 * A PUBLISHED route, by contrast, IS established by the repository: its
 * paths are the repository's own (deployment ids, API versions), never
 * operator-placed secrets. Its COMPLETE route identity is therefore
 * preserved, including the FULL path, because the path is what keeps a
 * same-host / different-path pair two DISTINCT routes.
 *
 * ## LIMITATION (stated explicitly)
 * ---------------------------------
 * Route identity establishes the ROUTE that issued a payload. It does NOT
 * by itself prove every account-, model- or conversation-level
 * compatibility condition that a provider may require.
 */
export function buildReasoningOriginAuthority(input: {
	providerId: string;
	baseUrl: string | undefined;
}): string | undefined {
	const providerId = input.providerId?.trim();
	if (!providerId) {
		return undefined;
	}
	const rawBaseUrl = input.baseUrl?.trim();
	if (!rawBaseUrl) {
		return undefined;
	}
	let url: URL;
	try {
		url = new URL(rawBaseUrl);
	} catch {
		// An INVALID endpoint is an UNRESOLVED route, not a route.
		return undefined;
	}
	if (url.username.length > 0 || url.password.length > 0) {
		return undefined;
	}
	if (url.search.length > 0) {
		return undefined;
	}
	if (url.hash.length > 0) {
		return undefined;
	}
	const origin = url.origin;
	if (!origin || origin === "null") {
		return undefined;
	}
	if (!isPublishedBuiltinRoute({ providerId, baseUrl: rawBaseUrl })) {
		return undefined;
	}
	const path = url.pathname.replace(/\/+$/, "");
	return `${providerId}\u0000${origin}\u0000${path}`;
}
