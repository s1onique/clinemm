/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01
 *
 * SDK-core side of the model behavior flight recorder.
 *
 * This module owns:
 *   - the sink plumbing that real runtime paths call into,
 *   - the EFFECTIVE INPUT BUDGET PROVENANCE resolver (which source of the
 *     production budget chain actually won), and
 *   - the tool-call identity / fingerprint correlation helpers.
 *
 * TRUST BOUNDARY
 * --------------
 * The sink is READ-ONLY observation. Every call site in this package:
 *
 *   1. never changes a value the runtime uses,
 *   2. never gates an operation on the sink's answer, and
 *   3. is wrapped so a sink failure can never affect a model call, a tool
 *      execution, or a lifecycle commit.
 *
 * The sink is OPT-IN and defaults to {@link NOOP_MODEL_BEHAVIOR_TRACE_SINK},
 * so the default production path pays a single null check.
 */

import type {
	ModelBehaviorTraceBudgetSource,
	ModelBehaviorTraceObservation,
	ModelBehaviorTraceSink,
} from "@cline/shared";
import { NOOP_MODEL_BEHAVIOR_TRACE_SINK } from "@cline/shared";

/**
 * The production fallback input budget.
 *
 * Mirrors `DEFAULT_MAX_INPUT_TOKENS` in
 * `sdk/packages/core/src/extensions/context/compaction-shared.ts` (128_000).
 * It is duplicated here as a LITERAL rather than imported so the
 * observability module cannot create an import cycle with the compaction
 * extension, and so the mutation witness can prove the constant is checked
 * against the production value.
 */
export const MODEL_BEHAVIOR_TRACE_FALLBACK_MAX_INPUT_TOKENS = 128_000;

/**
 * The inputs the production budget resolver consults.
 *
 * These are the EXACT inputs passed to
 * `resolveEffectiveMaxInputTokens({ maxInputTokens, contextWindow })` in
 * `compaction.ts`, followed by the user ceiling applied on top.
 */
export interface ModelBehaviorTraceBudgetInputs {
	/** `ModelInfo.maxInputTokens` — the model's reported input limit. */
	readonly modelMaxInputTokens?: number;
	/** `ModelInfo.contextWindow` — the model's reported total window. */
	readonly contextWindow?: number;
	/** The user-configured operating ceiling (Auto ⇒ undefined). */
	readonly userContextCeiling?: number;
}

/**
 * The resolved effective budget plus its PROVENANCE.
 */
export interface ModelBehaviorTraceBudgetResolution {
	/** The effective input budget the production policy will use. */
	readonly effectiveMaxInputTokens: number;
	/** Which input actually determined the effective budget. */
	readonly source: ModelBehaviorTraceBudgetSource;
	/** The trigger threshold the production policy applies. */
	readonly triggerTokens: number;
	/** True when the fallback 128k budget was used. */
	readonly usedFallback: boolean;
}

/**
 * The production trigger ratio. Mirrors `COMPACTION_TRIGGER_RATIO`
 * (`compaction-shared.ts` = 0.9).
 */
export const MODEL_BEHAVIOR_TRACE_TRIGGER_RATIO = 0.9;

/**
 * Resolve the effective input budget AND its provenance using the SAME
 * inputs and the SAME precedence the production resolver uses.
 *
 * Production precedence (see `compaction.ts`):
 *
 *   1. `resolveEffectiveMaxInputTokens({ maxInputTokens, contextWindow })`
 *        - if `maxInputTokens` is present → `min(maxInputTokens, contextWindow)`
 *          when a context window exists, else `maxInputTokens`;
 *        - else if `contextWindow` is present → `contextWindow * 0.9`;
 *        - else → `undefined`.
 *   2. `applyUserContextCeiling(resolved, userCeiling)` — may only REDUCE,
 *      and is ignored when the resolved value is `undefined`.
 *   3. `?? DEFAULT_MAX_INPUT_TOKENS` → the 128k fallback.
 *
 * The recorded `source` names the input that won, so an operator can tell a
 * genuine model limit apart from the 128k fallback that produced the
 * previously-observed compaction around 119k.
 */
export function resolveModelBehaviorTraceBudget(
	inputs: ModelBehaviorTraceBudgetInputs,
): ModelBehaviorTraceBudgetResolution {
	const modelMaxInputTokens = positiveFinite(inputs.modelMaxInputTokens);
	const contextWindow = positiveFinite(inputs.contextWindow);
	const userCeiling = positiveFinite(inputs.userContextCeiling);

	// Step 1 — production model resolution.
	let resolved: number | undefined;
	let source: ModelBehaviorTraceBudgetSource;
	if (modelMaxInputTokens !== undefined) {
		resolved =
			contextWindow === undefined
				? modelMaxInputTokens
				: Math.min(modelMaxInputTokens, contextWindow);
		source = "modelMaxInputTokens";
	} else if (contextWindow !== undefined) {
		// The production resolver retains a conservative margin for request
		// overhead when only a context window is reported.
		resolved = Math.floor(contextWindow * 0.9);
		source = "contextWindow";
	} else {
		resolved = undefined;
		source = "fallback_128k";
	}

	// Step 2 — user ceiling (may only reduce; ignored without a resolved
	// model capacity, matching `applyUserContextCeiling`).
	if (
		resolved !== undefined &&
		userCeiling !== undefined &&
		userCeiling < resolved
	) {
		resolved = userCeiling;
		source = "userCeiling";
	}

	// Step 3 — production fallback.
	if (resolved === undefined) {
		resolved = MODEL_BEHAVIOR_TRACE_FALLBACK_MAX_INPUT_TOKENS;
		source = "fallback_128k";
	}

	return {
		effectiveMaxInputTokens: resolved,
		source,
		triggerTokens: Math.floor(resolved * MODEL_BEHAVIOR_TRACE_TRIGGER_RATIO),
		usedFallback: source === "fallback_128k",
	};
}

function positiveFinite(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

/**
 * A sink that forwards observations to a caller-supplied handler, with
 * failure isolation baked in.
 *
 * The handler receives the observation and is expected to record it. Any
 * throw inside the handler is swallowed here so the SDK path is unaffected.
 */
export function createIsolatedModelBehaviorTraceSink(
	handler: (observation: ModelBehaviorTraceObservation) => void,
): ModelBehaviorTraceSink {
	const safe = (observation: ModelBehaviorTraceObservation): void => {
		try {
			handler(observation);
		} catch {
			// Failure isolation: the recorder must never break production.
		}
	};
	return {
		onModelRequestStart: safe,
		onModelRequestFinish: safe,
		onModelRequestError: safe,
		onModelRequestAbort: safe,
		onToolStart: safe,
		onToolFinish: safe,
		onLoopVerdict: safe,
		onCompactionDiagnostics: safe,
		onCompactionCompleted: safe,
		onRunTerminated: safe,
	};
}

/**
 * Resolve the effective sink: the configured one, or the no-op.
 *
 * Keeping this as a single helper means every call site has ONE way to ask
 * "is anybody listening?" and the default path is a single comparison.
 */
export function resolveModelBehaviorTraceSink(
	sink: ModelBehaviorTraceSink | undefined,
): ModelBehaviorTraceSink {
	return sink ?? NOOP_MODEL_BEHAVIOR_TRACE_SINK;
}

/**
 * True when the sink has at least one observer attached.
 *
 * The SDK call sites use this to skip constructing observation payloads
 * entirely when tracing is OFF, so the default path stays cheap.
 */
export function isModelBehaviorTraceSinkActive(
	sink: ModelBehaviorTraceSink | undefined,
): boolean {
	if (!sink) {
		return false;
	}
	return Boolean(
		sink.onModelRequestStart ||
			sink.onModelRequestFinish ||
			sink.onModelRequestError ||
			sink.onModelRequestAbort ||
			sink.onToolStart ||
			sink.onToolFinish ||
			sink.onLoopVerdict ||
			sink.onCompactionDiagnostics ||
			sink.onCompactionCompleted ||
			sink.onRunTerminated,
	);
}
