// Replaces classic manual-condense handling from src/core/task (see origin/main)
//
// Manual context compaction for the VSCode SDK adapter. This mirrors the CLI's
// apps/cli/src/runtime/interactive/compaction.ts (`compactInteractiveMessages`):
// it builds a manual-mode compaction `prepareTurn` via the SDK's
// `createContextCompactionPrepareTurn` and runs it against the current session
// transcript, returning the compacted working-context sidecar state.
//
// The VSCode coordinator persists that sidecar without replacing the canonical
// transcript, so the active session and later resumes use compacted working
// context while saved messages remain intact.

import {
	type CoreSessionConfig,
	createContextCompactionPrepareTurn,
	createSessionCompactionState,
	type SessionCompactionState,
} from "@cline/core"
import { estimateRequestInputTokens } from "@cline/shared"
import type { Message as SdkMessage, ModelInfo as SdkModelInfo } from "@cline/llms"
import { Logger } from "@/shared/services/Logger"

// When the active model does not declare a context window, fall back to a
// conservative input budget so manual compaction still has a target to shrink
// toward. Matches the CLI's FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS.
const FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS = 64_000

export interface CompactSessionMessagesInput {
	/**
	 * Provider/model/compaction config for the active session.
	 *
	 * ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
	 * (seventy-seventh-pass): `systemPrompt` and `extraTools` are
	 * included on the Pick<> so the manual seam can compute
	 * `POST_COMPACTION_CURRENT_CONFIG_W` via explicit
	 * `estimateRequestInputTokens(...)` on the success branch.
	 * These are session-config-time operands (NOT
	 * runtime-composed operands); the quality of the resulting W
	 * is APPROXIMATE per the architectural freeze at file-09.
	 */
	config: Pick<
		CoreSessionConfig,
		| "providerConfig"
		| "providerId"
		| "modelId"
		| "knownModels"
		| "compaction"
		| "logger"
		| "telemetry"
	> & {
		// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
		// (seventy-seventh-pass, Option 1 repair): the manual
		// seam now requires session-config-time operands
		// (`systemPrompt` and `extraTools`) to compute
		// POST_COMPACTION_CURRENT_CONFIG_W via explicit
		// `estimateRequestInputTokens(...)`. These are declared
		// optional for backwards compatibility with pre-existing
		// fixtures/tests that construct the input without them;
		// the runtime coordinator always forwards both. When
		// callers omit them, the estimator degrades to
		// `systemPrompt: undefined, tools: []` (no system
		// contribution, no tool contribution) but still produces
		// a valid number from the messages alone.
		systemPrompt?: string
		extraTools?: CoreSessionConfig["extraTools"]
	}
	/** The active session id (used for telemetry keying). */
	sessionId: string
	/** The conversation transcript to compact (SDK message shape). */
	messages: SdkMessage[]
	/**
	 * Receives the SDK's compaction status notices (started/completed/skipped
	 * with token + message counters) so the caller can drive progress UI.
	 */
	emitStatusNotice?: (message: string, metadata?: Record<string, unknown>) => void
}

export interface CompactSessionMessagesResult {
	compacted: boolean
	messages: SdkMessage[]
	compactionState?: SessionCompactionState
	/**
	 * ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01 (PASS
	 * POST_COMPACTION_PUBLICATION_REPAIRED):
	 *
	 * The post-compaction `currentWorkingContextEstimate` computed by
	 * the producer seam
	 * (`sdk/packages/core/src/extensions/context/compaction.ts`:
	 * `publishWorkingContextEstimate`). Optional: undefined when the
	 * producer returned no W (legacy / pre-repair path) or when
	 * `compacted === false` (no projection to publish).
	 *
	 * The coordinator (or any consumer driving the
	 * `WorkingContextHostCapture` carrier via a synthetic
	 * `working-context-state-changed` event) MUST surface this value
	 * so the persistent top working-context bar updates at the same
	 * moment the divider does. Without this field, manual compaction
	 * leaves the carrier holding the pre-compaction W (typically the
	 * last prepareTurn value, often large) and the bar visibly lags
	 * until the next message triggers a fresh prepareTurn.
	 */
	currentWorkingContextEstimate?: number
}

/**
 * Run a manual context compaction over the supplied messages.
 *
 * Returns `{ compacted: false }` (with the original messages) when there is
 * nothing to compact or the configured strategy declines to compact.
 */
export async function compactSessionMessages(input: CompactSessionMessagesInput): Promise<CompactSessionMessagesResult> {
	if (input.messages.length === 0) {
		return { compacted: false, messages: input.messages }
	}

	const modelInfo: SdkModelInfo | undefined = input.config.knownModels?.[input.config.modelId]
	const compactionModelInfo: SdkModelInfo = modelInfo
		? {
				...modelInfo,
				id: modelInfo.id ?? input.config.modelId,
			}
		: {
				id: input.config.modelId,
				maxInputTokens: FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS,
			}

	const compact = createContextCompactionPrepareTurn(
		{
			providerConfig: input.config.providerConfig,
			providerId: input.config.providerId,
			modelId: input.config.modelId,
			// Force-enable compaction for this manual request even when
			// auto-condense is off — the user explicitly asked for it.
			compaction: {
				...input.config.compaction,
				enabled: true,
			},
			logger: input.config.logger,
			// Forward telemetry + sessionId so manual compactions emit
			// `task.compaction_executed` / `task.compaction_skipped` events,
			// matching the CLI and auto-compaction.
			telemetry: input.config.telemetry,
			sessionId: input.sessionId,
		},
		{ mode: "manual" },
	)
	if (!compact) {
		Logger.warn("[SdkCompaction] Compaction prepareTurn unavailable; skipping manual compaction")
		return { compacted: false, messages: input.messages }
	}

	const result = await compact({
		agentId: "cline-vscode",
		conversationId: input.sessionId,
		parentAgentId: null,
		iteration: 0,
		messages: input.messages,
		apiMessages: input.messages,
		abortSignal: new AbortController().signal,
		systemPrompt: "",
		tools: [],
		model: {
			id: input.config.modelId,
			provider: input.config.providerId,
			info: compactionModelInfo,
		},
		emitStatusNotice: input.emitStatusNotice,
	})
	if (!result) {
		return { compacted: false, messages: input.messages }
	}
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-third-pass, P0-A): `ContextPipelinePrepareTurnResult`
	// now declares `messages` and `systemPrompt` as OPTIONAL to
	// support a metadata-only return shape (just
	// `currentWorkingContextEstimate`; the projection branches
	// are skipped). For manual compaction, a metadata-only
	// return is NOT an actual compaction artifact — it is a
	// no-op projection signal (semantically equivalent to the
	// pre-fix `return undefined` for projection purposes, but
	// publishes W on every prepareTurn for the producer-
	// cadence invariant). Without this guard the caller would
	// receive:
	//
	//   { compacted: true, messages: undefined, ... }
	//
	// which would (a) mis-report a real compaction that never
	// happened, and (b) build a `compactionState` whose
	// `compactedMessages` field is undefined (a hard
	// `MessageWithMetadata[]`-required schema field).
	//
	// The bounded contract here is:
	//
	//   CompactSessionMessagesResult.compacted
	//   and CompactSessionMessagesResult.compactionState
	//   MUST come from an actual message projection
	//   (`result.messages !== undefined`),
	//   NOT merely from presence of W metadata.
	if (!result.messages) {
		return {
			compacted: false,
			messages: input.messages,
			// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
			// (seventy-seventh-pass, Option 1 contract): the
			// `messages === undefined` branch is a metadata-only
			// prepareTurn return (no real projection happened for
			// manual mode). It MUST NOT publish optimistic W -- the
			// manual seam did not produce one and the carrier is
			// failure-closed (UNDEFINED_W_STALE_REUSE = FORBIDDEN).
			// Set the field explicitly to undefined so surface
			// mutation cannot leak a metadata-only W through.
			currentWorkingContextEstimate: undefined,
		}
	}
	// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
	// (seventy-seventh-pass, Option 1 repair):
	//
	// The raw compactor returns `CoreCompactionResult`, which by
	// design carries no `currentWorkingContextEstimate` field --
	// the W has to be computed at the seam that has the operands
	// in scope. Per the reviewer's authorized repair, the manual
	// seam now explicitly calls `estimateRequestInputTokens(...)`
	// on the success branch using SESSION-CONFIG-TIME operands:
	//
	//   W = estimateRequestInputTokens({
	//     systemPrompt: input.config.systemPrompt,
	//     messages:     result.messages,
	//     tools:        input.config.extraTools ?? [],
	//   })
	//
	// This is `POST_COMPACTION_CURRENT_CONFIG_W`, with quality =
	// APPROXIMATE per the architectural freeze at file-09. The
	// approximation discriminator test (R2) proves this value
	// differs from CANONICAL_RUNTIME_W whenever the runtime has
	// appended tool definitions (plugin/MCP/addTools paths).
	//
	// The next prepareTurn boundary replaces this approximation
	// with CANONICAL_RUNTIME_W via the existing runtime-event
	// subscription path inside `subscribeRuntimeEvents` ->
	// `WorkingContextHostCapture.observe`. The bar interval
	// between (a) this manual publication and (b) the next
	// prepareTurn is short and labeled APPROXIMATE per the
	// existing semantic name `currentWorkingContextEstimate`.
	const currentWorkingContextEstimate = estimateRequestInputTokens({
		systemPrompt: input.config.systemPrompt,
		messages: result.messages,
		tools: input.config.extraTools ?? [],
	})
	return {
		compacted: true,
		messages: result.messages,
		compactionState: createSessionCompactionState({
			sourceMessages: input.messages,
			compactedMessages: result.messages,
			conversationId: input.sessionId,
			systemPrompt: result.systemPrompt,
		}),
		// POST_COMPACTION_CURRENT_CONFIG_W -- APPROXIMATE quality.
		// The next prepareTurn overwrites with CANONICAL_RUNTIME_W.
		currentWorkingContextEstimate,
	}
}
