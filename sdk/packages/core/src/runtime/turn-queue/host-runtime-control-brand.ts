/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION03-PROVIDER-BOUNDARY:
 * Closed-brand discriminator for messages stamped by the host's trusted
 * runtime-control seams (e.g. the completion-continuation BCB01 turn).
 *
 * Why this exists
 * ----------------
 * The CORRECTION02 model-privilege repair promoted
 * `metadata.runtimeAuthority === "host_runtime_control"` to the
 * privileged `role: "system"` channel. The metadata discriminator is a
 * string value — and string values can be forged by ANY user-supplied
 * envelope that reaches `SessionRuntime.run(AgentMessage)`. The
 * reviewer's P0-2 halt (HALT_MODEL_PRIVILEGE_EVIDENCE_NOT_EXECUTED)
 * established that the metadata-only check is NOT a security boundary.
 *
 * This module replaces the metadata-only check with a Symbol-keyed brand
 * that only the trusted host seam (`LocalRuntimeHost.executeAgentTurn`)
 * can attach. The orchestrator checks for the BRAND, not for the metadata
 * string. A user-supplied envelope cannot construct this Symbol without
 * going through the trusted seam (the Symbol is module-internal: the
 * `@cline/core` barrel does NOT export `HOST_RUNTIME_CONTROL_BRAND`, only
 * the trusted seam imports it via a relative filesystem path).
 *
 * How the brand survives
 * -----------------
 * The trusted seam attaches the brand via `Object.defineProperty`
 * (non-enumerable by default in this project). The brand survives into
 * `SessionRuntime.executeRunInternal` (which inspects the symbol) but
 * is NOT preserved into the persisted `MessageWithMetadata` (JSON
 * serialization drops symbol properties by definition). This is
 * intentional: the brand is a TEMPORARY in-process marker that exists
 * only on the wire from the trusted seam to the orchestrator's
 * execution seam.
 *
 * Mirror: ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * uses the same `Symbol.for` identity pattern for its W-trace observer
 * (`@cline/agents/src/internal-w-trace.ts`).
 */

/**
 * Symbol-keyed brand on AgentMessage that the trusted
 * `LocalRuntimeHost.executeAgentTurn` seam sets when it builds an envelope
 * for the host's runtime-control continuations.
 *
 * The orchestrator's `SessionRuntime.executeRunInternal` reads this
 * brand. The brand is module-internal: this module is the ONLY exporter
 * of the symbol, and the trusted seam is the ONLY caller. External
 * callers (CLI, JetBrains) cannot reach `HOST_RUNTIME_CONTROL_BRAND` via
 * the `@cline/core` barrel and therefore cannot construct a branded
 * AgentMessage.
 *
 * NOTE: declared `unique symbol` (TS 4.4+) so type-system uses see the
 * brand as a private property whose only producer is the trusted seam.
 * The runtime check is `message[HOST_RUNTIME_CONTROL_BRAND] === true`.
 */
export const HOST_RUNTIME_CONTROL_BRAND: unique symbol = Symbol.for(
	"@cline/agent-runtime-control-brand",
);

/**
 * Type-level alias: AgentMessage stamped by the trusted seam. The
 * `unique symbol` brand makes this type impossible to construct from
 * outside the @cline/core internal seams (the only consumer is the
 * orchestrator, which downcasts to verify the brand at execution time).
 *
 * The brand does NOT survive serialization or clone-by-structured-clone;
 * it is purely an in-process marker for the duration of one
 * SessionRuntime.run enqueue. The orchestrator checks it BEFORE the
 * message is appended to the conversation store, so persistence is
 * unaffected.
 */
export type HostRuntimeControlMessage = AgentMessage & {
	readonly [HOST_RUNTIME_CONTROL_BRAND]: true;
};

/**
 * Runtime guard for a trusted-seam-stamped AgentMessage. Returns true
 * iff the message carries the brand. The orchestrator uses this guard
 * to decide whether to persist on the privileged `role: "system"`
 * channel.
 */
export function isHostRuntimeControlMessage(
	message: AgentMessage,
): message is HostRuntimeControlMessage {
	return (
		(message as unknown as Record<symbol, unknown>)[
			HOST_RUNTIME_CONTROL_BRAND
		] === true
	);
}

// Local type import — see the import ladder: this file does NOT import
// AgentMessage from @cline/shared at the top so external module
// resolution stays transparent. The shape is narrowed to AgentMessage
// structurally inside isHostRuntimeControlMessage.
import type { AgentMessage } from "@cline/shared";
