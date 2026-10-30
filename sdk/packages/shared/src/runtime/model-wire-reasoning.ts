/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01.
 *
 * Process-wide, opt-in registry of observers that see the SERIALIZED
 * provider wire controls of a model request.
 *
 * WHY THIS EXISTS
 * ---------------
 * The model-behavior flight recorder answers "what did the runtime REQUEST?".
 * It does not answer "what did the provider ACTUALLY receive on the wire?".
 *
 * For a provider with a non-portable reasoning contract (MiniMax M3.1's
 * Anthropic-compatible `output_config.effort`, for example) those two facts
 * can DISAGREE: the runtime asked for `effort: "low"` and the transport
 * silently serialized no effort at all. Only the SERIALIZED body is the
 * authority on what the model was actually asked to do.
 *
 * The full provider-request capture already observes the serialized body, but
 * it is:
 *   - gated by `CLINE_CAPTURE_PROVIDER_REQUEST` / `CLINE_CAPTURE_WIRE`, and
 *   - a DISK artifact that retains the prompt, the messages and (in `full`
 *     mode) the raw body.
 *
 * This registry is the LIGHTWEIGHT alternative: it carries ONLY the
 * reasoning-relevant control fields of the serialized body, in memory, to an
 * in-process observer. It never writes to disk and never retains prompt,
 * message, tool-argument or credential material.
 *
 * WHY A GLOBAL REGISTRY (AND NOT A MODULE SINGLETON)
 * ---------------------------------------------------
 * The VS Code extension host and `@cline/llms` do NOT share one module
 * instance of `@cline/shared`:
 *
 *   - `@cline/llms` BUNDLES `@cline/shared` into its own `dist` (its build
 *     keeps only NON-`@cline/*` dependencies external), and
 *   - `apps/vscode` bundles the whole workspace into `dist/extension.js`.
 *
 * So a module-scoped singleton in `@cline/shared` would produce ONE
 * registry per bundled copy, and the observer registered by the extension
 * host would never be seen by the provider bundle. The registry therefore
 * lives on `globalThis` under a `Symbol.for(...)` key, so every copy of the
 * module in the same JavaScript realm resolves the SAME registry object.
 *
 * `Symbol.for` is used to NAME the global slot. The slot's VALUE is a
 * plain object with a capability token, so the registry cannot be reached
 * by guessing a string key from another realm. The capability token is
 * ALSO created with `Symbol.for`, so every bundled copy of this module
 * agrees that a registry found in the slot is legitimate — see
 * {@link REGISTRY_CAPABILITY}.
 *
 * HARD CONSTRAINTS
 * ----------------
 *   - Default OFF: with no observer registered, the notification is a single
 *     property read and a `length` check.
 *   - Read-only observation: an observer receives facts and returns nothing.
 *     The observer can never influence the request, the transport, the
 *     provider response, or tool execution.
 *   - Failure-isolated: a throwing observer degrades to a no-op and never
 *     affects the model call.
 *   - Privacy-preserving: the observation carries ONLY correlation identity
 *     and the reasoning-relevant control fields of the serialized body.
 */

/**
 * The metadata key that carries the per-request correlation id from the
 * agent runtime to the provider transport.
 *
 * The id is minted per model request and is placed in the EXISTING request
 * metadata bag. It is never serialized into the provider body — the
 * metadata is a transport-side correlation channel, not a payload field.
 */
export const MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY =
	"__clineModelBehaviorRequestId" as const;

/**
 * The correlation identity of ONE serialized provider request.
 *
 * Every field is optional: an unavailable identity is OMITTED rather than
 * guessed. `requestId` is the join key between the agent-side request and
 * the wire-side observation.
 */
export interface ModelBehaviorWireReasoningObservation {
	/**
	 * The per-request correlation id minted by the agent runtime.
	 *
	 * This is the EXACT join key. It is never derived from a timestamp.
	 */
	readonly requestId?: string;
	/** The host-owned session id, when the producer knows it. */
	readonly sessionId?: string;
	/** The host-owned task id, when the producer knows it. */
	readonly taskId?: string;
	/** The runtime run id, when the producer knows it. */
	readonly runId?: string;
	/** The runtime iteration, when the producer knows it. */
	readonly iteration?: number;
	/**
	 * The HTTP attempt ordinal WITHIN one logical request.
	 *
	 * A single logical model request can produce SEVERAL serialized HTTP
	 * attempts: the transport retries an all-empty turn and a mid-stream
	 * network interruption (`retry-empty-response.ts`). Every attempt of
	 * ONE request carries the SAME `requestId`; the attempt ordinal
	 * distinguishes them.
	 *
	 * The ordinal is 1-based. It is ABSENT when the producer cannot
	 * attribute the attempt to a request.
	 */
	readonly attempt?: number;
	/** The provider the request was routed to. */
	readonly providerId?: string;
	/** The model id the request was addressed to. */
	readonly modelId?: string;
	/** The HTTP method of the serialized request, when known. */
	readonly httpMethod?: string;
	/**
	 * The serialized thinking mode ("adaptive", "disabled", "enabled"), or
	 * absent when the body carries none.
	 */
	readonly wireThinkingMode?: string;
	/** The serialized reasoning effort, or absent. */
	readonly wireReasoningEffort?: string;
	/** The serialized reasoning enabled flag, or absent. */
	readonly wireReasoningEnabled?: boolean;
	/** The serialized reasoning exclude flag, or absent. */
	readonly wireReasoningExcluded?: boolean;
	/**
	 * The Anthropic-compatible `output_config.effort`, or absent.
	 */
	readonly wireOutputConfigEffort?: string;
	/** The serialized output-token cap, when present. */
	readonly wireOutputTokenLimit?: number;
}

/**
 * A read-only observer of serialized provider wire controls.
 *
 * The observer receives ONE observation and returns nothing. It is never
 * consulted for a decision.
 */
export type ModelBehaviorWireReasoningObserver = (
	observation: ModelBehaviorWireReasoningObservation,
) => void;

/**
 * The private capability token that guards the registry.
 *
 * The token's identity — not any string key — is what authorizes a
 * registry to live in the slot.
 *
 * IT MUST BE `Symbol.for`, NOT `Symbol`.
 *
 * `@cline/shared` is bundled more than once (the `@cline/llms` bundle and
 * the `apps/vscode` bundle each carry their own copy). With a plain
 * `Symbol(...)`, every copy would compute a DIFFERENT capability, so the
 * SECOND copy to resolve the slot would see a capability mismatch, decide
 * the slot was forged, and REPLACE the registry — silently dropping every
 * observer the first copy had registered. The extension host would then
 * never see the provider's wire observations, and the failure would look
 * like "the provider simply did not report anything".
 *
 * `Symbol.for` makes the token realm-wide, so every copy of this module
 * computes the SAME token and therefore AGREES that the slot's registry is
 * legitimate.
 *
 * The token is still not a secret: it is only a guard against a foreign
 * object being planted in the slot, and the slot itself is a
 * non-enumerable property on `globalThis`. It is never exported.
 */
const REGISTRY_CAPABILITY = Symbol.for(
	"cline.modelBehaviorWireReasoningRegistry",
);

interface WireReasoningRegistry {
	/** The private capability. Never exposed outside this module. */
	readonly capability: symbol;
	/** The registered observers, in registration order. */
	readonly observers: Set<ModelBehaviorWireReasoningObserver>;
}

/**
 * The global slot key.
 *
 * `Symbol.for` makes the name realm-wide so every bundled copy of this
 * module resolves the SAME slot.
 */
const REGISTRY_SLOT = Symbol.for(
	"@cline/model-behavior/wire-reasoning-registry",
) as unknown as string;

type GlobalWithRegistry = typeof globalThis & {
	[REGISTRY_SLOT]?: WireReasoningRegistry;
};

/**
 * Resolve the realm-wide registry, creating it on first use.
 *
 * Every bundled copy of this module resolves the SAME slot and computes
 * the SAME capability token (both via `Symbol.for`), so a registry found
 * in the slot is REUSED — the observer registered by the extension host is
 * visible to the provider bundle.
 *
 * A slot whose capability does not match was planted by something other
 * than this module, so it is replaced with a fresh, locally-owned
 * registry.
 */
function resolveRegistry(): WireReasoningRegistry {
	const holder = globalThis as GlobalWithRegistry;
	const existing = holder[REGISTRY_SLOT];
	if (
		existing &&
		typeof existing === "object" &&
		existing.capability === REGISTRY_CAPABILITY &&
		existing.observers instanceof Set
	) {
		return existing;
	}
	const created: WireReasoningRegistry = {
		capability: REGISTRY_CAPABILITY,
		observers: new Set<ModelBehaviorWireReasoningObserver>(),
	};
	Object.defineProperty(holder, REGISTRY_SLOT, {
		value: created,
		enumerable: false,
		configurable: true,
		writable: true,
	});
	return created;
}

/**
 * Register an observer of serialized provider wire controls.
 *
 * The returned function unregisters the observer.
 *
 * Registration is INDEPENDENT of the full provider-request capture: the
 * observer fires whether or not `CLINE_CAPTURE_PROVIDER_REQUEST` /
 * `CLINE_CAPTURE_WIRE` are set, and it never causes a capture file to be
 * written.
 */
export function registerModelBehaviorWireReasoningObserver(
	observer: ModelBehaviorWireReasoningObserver,
): () => void {
	if (typeof observer !== "function") {
		return () => {
			// Nothing to unregister.
		};
	}
	const registry = resolveRegistry();
	registry.observers.add(observer);
	return () => {
		registry.observers.delete(observer);
	};
}

/**
 * Remove EVERY registered observer.
 *
 * Used by tests to guarantee a clean registry between cases. Production
 * code unregisters via the function returned by
 * {@link registerModelBehaviorWireReasoningObserver}.
 */
export function unregisterModelBehaviorWireReasoningObserver(): void {
	resolveRegistry().observers.clear();
}

/**
 * True when at least one observer is registered.
 *
 * The provider seam checks this BEFORE reading the request body, so the
 * disabled path performs no body read and no allocation.
 */
export function hasModelBehaviorWireReasoningObserver(): boolean {
	return resolveRegistry().observers.size > 0;
}

/**
 * Report ONE serialized provider request to the registered observers.
 *
 * Failure-isolated: a throwing observer is swallowed so it can never affect
 * the model call. The observation is passed by value, so an observer cannot
 * mutate what the next observer sees.
 */
export function notifyModelBehaviorWireReasoningObservers(
	observation: ModelBehaviorWireReasoningObservation,
): void {
	let registry: WireReasoningRegistry;
	try {
		registry = resolveRegistry();
	} catch {
		return;
	}
	if (registry.observers.size === 0) {
		return;
	}
	// Copy first: an observer may unregister itself during the notification.
	for (const observer of [...registry.observers]) {
		try {
			observer({ ...observation });
		} catch {
			// An observer failure must never affect the model call.
		}
	}
}
