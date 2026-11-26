/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION03.
 *
 * The PUBLISHED BUILTIN ROUTE matcher.
 *
 * The matcher decides whether a configured base URL is a route the
 * repository itself publishes. Its canonical form must be exact: the HOST is
 * case-insensitive (the URL standard says so), but the PATH is
 * CASE-SENSITIVE, so `/V1` and `/v1` are two DIFFERENT routes.
 */

import { describe, expect, it } from "vitest";
import { isPublishedBuiltinRoute } from "./published-routes";

const ANTHROPIC = "anthropic";
const PUBLISHED_ANTHROPIC_ROUTE = "https://api.anthropic.com/v1";

describe("published builtin route matching", () => {
	it("accepts the published route itself", () => {
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: PUBLISHED_ANTHROPIC_ROUTE,
			}),
		).toBe(true);
	});

	it("accepts an UPPERCASE hostname, because the host is case-insensitive", () => {
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "https://API.ANTHROPIC.COM/v1",
			}),
		).toBe(true);
	});

	it("rejects /V1, because the PATH is case-sensitive", () => {
		// `/V1` and `/v1` are two DIFFERENT routes. A matcher that lowercases
		// the whole URL would collapse them into one and grant authority to a
		// route the repository never published.
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "https://api.anthropic.com/V1",
			}),
		).toBe(false);
	});

	it("normalizes only the TRAILING SLASHES", () => {
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "https://api.anthropic.com/v1/",
			}),
		).toBe(true);
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "https://api.anthropic.com/v1///",
			}),
		).toBe(true);
	});

	it("rejects an INVALID url", () => {
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "not a url",
			}),
		).toBe(false);
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "://missing-scheme",
			}),
		).toBe(false);
	});

	it("rejects a non-HTTP(S) scheme", () => {
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "ftp://api.anthropic.com/v1",
			}),
		).toBe(false);
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "file:///etc/passwd",
			}),
		).toBe(false);
	});

	it("rejects USER INFORMATION, a QUERY STRING and a FRAGMENT", () => {
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "https://user:secret@api.anthropic.com/v1",
			}),
		).toBe(false);
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "https://api.anthropic.com/v1?api_key=SECRET",
			}),
		).toBe(false);
		expect(
			isPublishedBuiltinRoute({
				providerId: ANTHROPIC,
				baseUrl: "https://api.anthropic.com/v1#fragment",
			}),
		).toBe(false);
	});

	it("rejects a route published for a DIFFERENT provider", () => {
		expect(
			isPublishedBuiltinRoute({
				providerId: "not-a-provider",
				baseUrl: PUBLISHED_ANTHROPIC_ROUTE,
			}),
		).toBe(false);
	});
});
