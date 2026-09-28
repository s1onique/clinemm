// ACT-MYC-CLINEMM02-C — Session-start prime automation.
//
// The smallest safe lifecycle slice: when a Cline session starts (the
// canonical `SdkSessionLifecycle.startNewSession` seam installs a fresh
// `activeSession`), invoke `myc prime` over the session-bound MCP
// transport and record the result.
//
// Why this and only this:
//   - `myc prime` is the ONLY myc lifecycle operation that is BOTH a
//     real callable operation (CLI + MCP) AND observable from a
//     real ClineMM lifecycle seam (the canonical "new session
//     installed" site). Other candidate operations are deferred for
//     documented reasons (see .factory/evidence/ACT-MYC-CLINEMM02-C/01-recon.md).
//   - The prime result is recorded for diagnostic observability
//     (`ExtensionState.mycPrimeAutomation`). It is NOT injected into
//     the model's initial context in this ACT — that requires a
//     `StartSessionBootstrap` shape change that is
//     `REQUIRES_SEPARATE_DESIGN`.
//
// Failure behavior: `DEGRADED_WITH_DIAGNOSTIC`.
//   - On any error (MCP unavailable, spawn failure, callTool error,
//     JSON parse failure) the helper records `status: "failed"` and
//     the underlying error message, AND emits a `Logger.warn`.
//   - The session proceeds normally; no model-visible impact.

import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import { recordMycPrimeLiveAcquisition, startMycPrimeLiveDiag } from "./myc-prime-live-diag"

/**
 * Conventional server names for the `myc` MCP server. The user names
 * their MCP server whatever they want — but `myc mcp` is always served
 * as an MCP server whose tool profile is documented as including
 * `prime`. We look for these names (in order) when checking whether
 * prime automation is applicable to the current McpHub configuration.
 * Users who rename their myc server can opt out of prime automation
 * by renaming — the automation is a no-op when no matching server is
 * configured.
 */
export const MYC_MCP_SERVER_NAMES: readonly string[] = ["myc", "myc-mcp"] as const

export type MycPrimeStatus = "pending" | "ok" | "failed" | "skipped"

export interface MycPrimeResult {
	sessionId: string
	status: MycPrimeStatus
	text?: string
	error?: string
	ts: number
}

export interface RunMycPrimeInput {
	sessionId: string
	cwd?: string
	mcpHub: McpHub
	signal?: AbortSignal
	/** Optional override for the MCP server name. Defaults to MYC_MCP_SERVER_NAMES[0]. */
	serverName?: string
	/** Optional budget forwarded to `myc prime --budget`. Defaults to 2000. */
	budget?: number
	/** Optional repo slug forwarded to `myc prime --repo`. */
	repo?: string
}

const PRIME_FORMAT = "agent" as const

/**
 * Module-level singleton recorder. Holds the latest prime result per
 * session id. Webview state pulls `mycPrimeAutomation` from the active
 * session id at every state push.
 *
 * Cardinality invariant: at most ONE result per sessionId. A second
 * `runMycPrimeOnSessionStart` for the same sessionId OVERWRITES the
 * prior entry — and is logged as a duplicate. This is the
 * `recordMycPrimeResult` side of the "no duplicate prime beyond frozen
 * cardinality" rule (C10).
 */
const lastResultBySessionId = new Map<string, MycPrimeResult>()

/**
 * Resolve which configured MCP server should be treated as `myc`.
 * Looks up the McpHub's connection list and returns the first server
 * whose name matches the conventional myc names (case-sensitive).
 * Returns undefined when no myc server is configured — the caller is
 * then expected to record `status: "skipped"`.
 */
export function resolveMycServerName(mcpHub: McpHub, override?: string): string | undefined {
	if (override !== undefined) {
		return override
	}
	const servers = mcpHub.getServers()
	for (const candidate of MYC_MCP_SERVER_NAMES) {
		if (servers.some((s) => s.name === candidate)) {
			return candidate
		}
	}
	return undefined
}
/**
 * Run `myc prime` for the given session over the session-bound MCP
 * transport. Returns the recorded result (also recorded on the
 * module-level singleton). Never throws — all errors are captured
 * into `result.status = "failed"` and `result.error`.
 *
 * The function:
 *   1. Looks up the configured `myc` MCP server (no-op if absent).
 *   2. Calls `mcpHub.callTool(serverName, "prime", args, ulid, signal, sessionId)`.
 *      The `sessionId` arg is the load-bearing sixth argument —
 *      it triggers `ensureSessionConnection(sessionId)` which lazily
 *      spawns the per-session child with `MYC_SESSION_ID` injected.
 *   3. Parses the first text content block as the prime text.
 *   4. On success, records `status: "ok"` with the parsed text.
 *   5. On any error, records `status: "failed"` with the error message
 *      and emits a `Logger.warn`.
 *
 * This function is SAFE TO CALL from any lifecycle seam that holds a
 * canonical `sessionId`. It does NOT mutate any global state, does
 * NOT block the calling task, and does NOT change any model-visible
 * behavior on failure.
 */
export async function runMycPrimeOnSessionStart(input: RunMycPrimeInput): Promise<MycPrimeResult> {
	const { sessionId, cwd, mcpHub, signal, serverName: serverNameOverride, budget, repo } = input
	const ts = Date.now()
	const serverName = resolveMycServerName(mcpHub, serverNameOverride)
	// ACT-MYC-CLINEMM03-LIVE-DIAG01: ensure a fresh diagnostic entry for
	// every prime acquisition attempt. No-op when diag is disabled.
	startMycPrimeLiveDiag(sessionId)

	if (!serverName) {
		const result: MycPrimeResult = {
			sessionId,
			status: "skipped",
			error: `No myc MCP server configured (looked for ${MYC_MCP_SERVER_NAMES.join(", ")}).`,
			ts,
		}
		recordMycPrimeResult(result)
		// ACT-MYC-CLINEMM03-LIVE-DIAG01: observe acquisition outcome. The
		// diagnostic entry is already initialized by
		// `startMycPrimeLiveDiag` above. This call is a no-op when diag
		// is disabled.
		//
		// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: tag the
		// observation with `phase=registration_lookup` (no
		// failureClass — skipped is not a failure, so the absence of
		// failureClass is itself a discriminator). The session-bound
		// MCP child was never reached, so
		// `sessionConnectionStatus="not_attempted"`.
		recordMycPrimeLiveAcquisition(sessionId, {
			attempted: true,
			serverDetected: false,
			status: "skipped",
			textPresent: false,
			textBytes: 0,
			error: result.error,
			phase: "registration_lookup",
			sessionConnectionStatus: "not_attempted",
			toolFound: false,
		})
		// Not an error — silent skip when myc is not configured.
		return result
	}

	const ulid = `prime-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
	const args: Record<string, unknown> = {
		session: sessionId,
		format: PRIME_FORMAT,
	}
	if (typeof budget === "number") {
		args.budget = budget
	}
	if (typeof repo === "string" && repo.length > 0) {
		args.repo = repo
	}

	try {
		const response = await mcpHub.callTool(serverName, "prime", args, ulid, signal, sessionId)
		const content = (response as { content?: unknown }).content
		// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01:
		// discriminate the three result-parse failure modes (H5):
		//   - missing_content: response.content is undefined or non-array
		//   - non_text_response: content array has no {type:"text"} block
		//   - empty_text: text-block exists but text === "" or not a string
		// The previous code collapsed all three into a single
		// `status="failed"` + `error="myc prime returned an empty/non-text
		// response..."` and was indistinguishable from H4 tool_call
		// failures at the readout level.
		const parseErrorCode = !Array.isArray(content)
			? "missing_content"
			: (() => {
					const firstTextBlock = content.find((c) => c?.type === "text") as
						| { type?: string; text?: unknown }
						| undefined
					if (!firstTextBlock) {
						return "non_text_response"
					}
					const text = firstTextBlock.text
					if (typeof text !== "string" || text.length === 0) {
						return "empty_text"
					}
					return undefined
				})()
		if (parseErrorCode) {
			const result: MycPrimeResult = {
				sessionId,
				status: "failed",
				error: `myc prime returned an empty/non-text response (cwd=${cwd ?? "<unset>"}).`,
				ts,
			}
			recordMycPrimeResult(result)
			// ACT-MYC-CLINEMM03-LIVE-DIAG01: observe empty / non-text
			// response. `serverDetected=true` is required so the live
			// diagnostic distinguishes "no myc server configured" from
			// "myc server responded empty" — these collapse to the same
			// `status="failed"` for the recorder but are different
			// broken boundaries (Case A above).
			//
			// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: tag
			// the observation with `phase=result_parse` and the
			// discriminating `failureClass` so H5 has its own
			// discriminator distinct from H4 (tool_call failures). The
			// session-bound child was reached (so
			// `sessionConnectionStatus="spawned"`); the tool was found
			// (so `toolFound=true`); only the result parser failed.
			recordMycPrimeLiveAcquisition(sessionId, {
				attempted: true,
				serverDetected: true,
				status: "failed",
				textPresent: false,
				textBytes: 0,
				error: result.error,
				phase: "result_parse",
				failureClass: parseErrorCode,
				sessionConnectionStatus: "spawned",
				toolFound: true,
			})
			Logger.warn("[MycPrimeAutomation] prime returned empty response:", response)
			return result
		}
		// The closure above classified `parseErrorCode` as undefined for
		// the success branch. Re-derive the text so the existing
		// downstream code path can stay bit-identical.
		const firstTextBlock = (content as Array<{ type?: string; text?: string }>).find((c) => c?.type === "text")
		const text = firstTextBlock?.text
		if (typeof text !== "string" || text.length === 0) {
			// Defensive: should be unreachable because parseErrorCode was
			// undefined; covered separately to preserve the existing
			// type-narrowing invariant for `text`.
			const result: MycPrimeResult = {
				sessionId,
				status: "failed",
				error: `myc prime returned an empty/non-text response (cwd=${cwd ?? "<unset>"}).`,
				ts,
			}
			recordMycPrimeResult(result)
			recordMycPrimeLiveAcquisition(sessionId, {
				attempted: true,
				serverDetected: true,
				status: "failed",
				textPresent: false,
				textBytes: 0,
				error: result.error,
				phase: "result_parse",
				failureClass: "empty_text",
				sessionConnectionStatus: "spawned",
				toolFound: true,
			})
			Logger.warn("[MycPrimeAutomation] prime returned empty response (defensive):", response)
			return result
		}
		const result: MycPrimeResult = {
			sessionId,
			status: "ok",
			text,
			ts,
		}
		recordMycPrimeResult(result)
		// ACT-MYC-CLINEMM03-LIVE-DIAG01: observe successful non-empty
		// prime. `textBytes` records size only — the prime text itself
		// is NEVER stored in the diagnostic.
		//
		// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: tag
		// the success observation with `toolFound=true` and
		// `sessionConnectionStatus="spawned"` so a downstream post-mortem
		// can confirm the tool was reached. `phase="tool_call"` is
		// the boundary the observation reached (the result parser then
		// succeeds — no `failureClass` is set because the call
		// succeeded).
		recordMycPrimeLiveAcquisition(sessionId, {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: Buffer.byteLength(text, "utf8"),
			phase: "tool_call",
			sessionConnectionStatus: "spawned",
			toolFound: true,
		})
		return result
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		const result: MycPrimeResult = {
			sessionId,
			status: "failed",
			error: `myc prime failed: ${message}`,
			ts,
		}
		recordMycPrimeResult(result)
		// ACT-MYC-CLINEMM03-LIVE-DIAG01: observe caught failure. The
		// helper itself never throws, so a `recordMycPrimeLiveAcquisition`
		// after the catch is safe even on the unhappy path.
		//
		// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01: tag
		// the failure observation. Without splitting the `phase` and
		// `failureClass` here, this catch was the SINGLE collapse point
		// for H2 (session_connection failure: ensureSessionConnection
		// throws) and H4 (tool_call failure: client.request throws or
		// returns isError:true). The discriminator tree now requires
		// this catch to disambiguate. We do that by inspecting the
		// error message — a sufficient heuristic until a future ACT
		// threads a richer error envelope from McpHub (which would
		// carry error.code). For now: any thrown error from the
		// callTool path is H4 by default (the callTool call itself
		// is what threw). H2 errors are caught and re-thrown by
		// callTool with a "No per-session connection available"
		// prefix; we use that prefix to discriminate.
		const isSessionConnectionUnavailable =
			typeof message === "string" && message.startsWith("No per-session connection available")
		const phase = isSessionConnectionUnavailable ? "session_connection" : "tool_call"
		const failureClass = isSessionConnectionUnavailable ? "no_static_connection" : "client_request_failed"
		recordMycPrimeLiveAcquisition(sessionId, {
			attempted: true,
			serverDetected: true,
			status: "failed",
			textPresent: false,
			textBytes: 0,
			error: result.error,
			phase,
			failureClass,
			sessionConnectionStatus: "unavailable",
			toolFound: false,
		})
		Logger.warn(`[MycPrimeAutomation] prime failed for session=${sessionId}:`, error)
		return result
	}
}

/**
 * Record the latest prime result for a sessionId. Subsequent calls
 * for the same sessionId overwrite (and log a duplicate warning).
 *
 * Pure side-effect: mutates the module-level singleton map. Intended
 * for use by both the helper (above) AND by any test that wants to
 * seed a synthetic result.
 */
export function recordMycPrimeResult(result: MycPrimeResult): void {
	const prior = lastResultBySessionId.get(result.sessionId)
	if (prior) {
		Logger.warn(
			`[MycPrimeAutomation] overwriting prior prime result for session=${result.sessionId} ` +
				`(prior.status=${prior.status}, new.status=${result.status}). ` +
				`This violates the cardinality-1 invariant.`,
		)
	}
	lastResultBySessionId.set(result.sessionId, result)
}

/**
 * Lookup the latest prime result for a sessionId. Returns undefined
 * when no prime has been recorded for that session.
 */
export function getMycPrimeResult(sessionId: string): MycPrimeResult | undefined {
	return lastResultBySessionId.get(sessionId)
}

/**
 * Drop all recorded prime results. Test-only helper.
 */
export function __resetMycPrimeResultsForTests(): void {
	lastResultBySessionId.clear()
}
