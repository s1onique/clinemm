/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION03.
 *
 * The repository's PUBLISHED BUILTIN PROVIDER ROUTES.
 *
 * A provider route is "published" when the repository itself declares it:
 * the builtin spec's default base URL, and the per-API-line base URLs that
 * the same spec publishes for the regional endpoints. Those declarations are
 * the ONLY route facts the repository publishes, and they are the only facts
 * a caller can compare a configured base URL against.
 *
 * Everything else — an operator-configured base URL, a self-hosted or
 * proxied endpoint, an extension-registered provider — is an UNESTABLISHED
 * route: the repository publishes nothing about it, so nothing about it can
 * be treated as a trustworthy route identity.
 *
 * This module reads the existing builtin specs. It introduces no new
 * registry, no new identity framework and no new migration subsystem.
 */

import { BUILTIN_SPECS } from "./builtins";
import { normalizeProviderId } from "./ids";

/**
 * The published base URLs of every builtin provider, keyed by the provider's
 * canonical id.
 *
 * The values are the raw published strings; the comparison canonicalizes both
 * sides (see `canonicalRoute`), so a trailing slash does not create a
 * spurious mismatch.
 */
const PUBLISHED_ROUTES_BY_PROVIDER_ID: ReadonlyMap<
	string,
	ReadonlySet<string>
> = (() => {
	const byProviderId = new Map<string, Set<string>>();
	for (const spec of BUILTIN_SPECS) {
		const routes = byProviderId.get(spec.id) ?? new Set<string>();
		const defaultBaseUrl = spec.defaults?.baseUrl?.trim();
		if (defaultBaseUrl) {
			routes.add(defaultBaseUrl);
		}
		for (const baseUrl of Object.values(spec.apiLineBaseUrls ?? {})) {
			const trimmed = baseUrl?.trim();
			if (trimmed) {
				routes.add(trimmed);
			}
		}
		byProviderId.set(spec.id, routes);
	}
	return byProviderId;
})();

/**
 * The canonical form of a route, so that two spellings of the SAME published
 * route compare equal — or so that two DIFFERENT routes do not.
 *
 * The canonical form is the PARSED URL's ORIGIN plus its PATH:
 *
 *   - the ORIGIN (scheme + host + port) is case-insensitive for the scheme
 *     and the host, and the URL parser already normalizes them;
 *   - the PATH is CASE-SENSITIVE and is preserved EXACTLY, because the path
 *     is the part that keeps a same-host / different-path pair two DISTINCT
 *     routes. Lowercasing the path would collapse `/V1` into `/v1` and make
 *     two different routes compare EQUAL.
 *
 * Only TRAILING SLASHES are normalized, so `/v1` and `/v1/` are the same
 * route while `/v1` and `/v2` are not.
 *
 * A URL that cannot be parsed, or that carries user information, a query
 * string, a fragment, or a non-HTTP(S) scheme, has NO canonical form: it
 * cannot be a published route, so it is rejected.
 */
function canonicalRoute(route: string): string | undefined {
	let url: URL;
	try {
		url = new URL(route.trim());
	} catch {
		// An INVALID URL is not a route.
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
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
	// The PATH is preserved EXACTLY (it is case-sensitive); only the
	// trailing slashes are normalized.
	const path = url.pathname.replace(/\/+$/, "");
	return `${origin}\u0000${path}`;
}

/**
 * Whether the given base URL is one of the repository's PUBLISHED builtin
 * routes for the given provider.
 *
 * The comparison is an EXACT match against a published route. A route that
 * is published for a DIFFERENT provider is not a match either: the route
 * identity includes the provider id, so the two parts must agree.
 */
export function isPublishedBuiltinRoute(input: {
	providerId: string;
	baseUrl: string;
}): boolean {
	const providerId = normalizeProviderId(input.providerId);
	const published = PUBLISHED_ROUTES_BY_PROVIDER_ID.get(providerId);
	if (!published) {
		return false;
	}
	const candidate = canonicalRoute(input.baseUrl);
	if (candidate === undefined) {
		return false;
	}
	for (const route of published) {
		if (canonicalRoute(route) === candidate) {
			return true;
		}
	}
	return false;
}
