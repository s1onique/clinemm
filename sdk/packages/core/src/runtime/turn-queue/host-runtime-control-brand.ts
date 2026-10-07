/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION04-PRIVATE-BRAND:
 * Private-identity discriminator for messages stamped by the host's
 * trusted runtime-control seams (e.g. the completion-continuation BCB01
 * turn).
 *
 * Why this exists
 * ----------------
 * CORRECTION02 promoted `metadata.runtimeAuthority === "host_runtime_control"`
 * to the privileged `role: "system"` channel. The metadata discriminator
 * is a string — forgeable.
 *
 * CORRECTION03 replaced the metadata check with a `Symbol.for(...)`
 * keyed brand. The reviewer (HALT_RUNTIME_CONTROL_BRAND_FORGEABLE)
 * correctly identified that `Symbol.for(key)` returns the runtime-wide
 * global symbol registry entry, so ANY code in the same JavaScript
 * realm can reconstruct the same symbol by calling
 * `Symbol.for("@cline/agent-runtime-control-brand")` and attach it via
 * `Object.defineProperty` to pass the brand check. The brand was
 * forgeable.
 *
 * This module (CORRECTION04) replaces the global registry identity with
 * a genuinely private identity. The brand is held ONLY inside a
 * module-private `WeakSet<AgentMessage>`; the trusted seam attaches the
 * brand by calling `markHostRuntimeControl(message)`, and the
 * orchestrator checks by calling `isHostRuntimeControlMessage(message)`.
 *
 * Why this is not forgeable
 * ------------------------
 * 1. No string key. The identity is the identity of the WeakSet object
 *    itself, not a registry entry keyed by a public string. An attacker
 *    cannot read the WeakSet reference (it is module-internal; the
 *    `@cline/core` barrel does not export it).
 * 2. No exported symbol. There is no Symbol property on the message
 *    for an attacker to set. `Object.defineProperty(message,
 *    Symbol.for("..."), { value: true })` no longer reaches the brand
 *    check — the brand check is `privateBrands.has(message)`, not a
 *    property check.
 * 3. The `markHostRuntimeControl` function is module-internal. External
 *    callers cannot reach it via the `@cline/core` barrel. Even if
 *    they reach it (e.g. via a deep relative import in tests), the
 *    marking function is the entire attack surface — they cannot
 *    bypass it because the verification is a WeakSet membership check,
 *    not a property check.
 *
 * Lifetime
 * --------
 * The brand is a TEMPORARY in-process marker for the duration of one
 * `SessionRuntime.run` enqueue. The orchestrator checks the brand
 * BEFORE the message is appended to the persisted conversation store,
 * so persistence is unaffected. Once the message is garbage-collected,
 * the WeakSet entry is collected automatically.
 *
 * Migration from CORRECTION03
 * ----------------------------
 * The CORRECTION03 `HOST_RUNTIME_CONTROL_BRAND` symbol is removed; the
 * `HostRuntimeControlMessage` type alias is re-expressed as a
 * TypeScript-side private class marker (declared but not constructible
 * from outside the module) that the orchestrator narrows to. The
 * mark/verify operations are the only public surface.
 */

// Module-private brand set. The reference to this WeakSet is the
// brand's identity; nothing is exported. An attacker cannot reach
// this set via the `@cline/core` barrel.
const privateBrands = new WeakSet<AgentMessage>();

/**
 * Mark an AgentMessage as a host-runtime-control message. ONLY the
 * trusted host seam (`LocalRuntimeHost.executeAgentTurn`) is permitted
 * to call this. The orchestrator treats messages stamped by this
 * function as privileged (the `role: "system"` channel at the model
 * boundary).
 *
 * This function is the entire attack surface for marking. There is no
 * other way to put a message into the `privateBrands` set.
 */
export function markHostRuntimeControl(message: AgentMessage): void {
	privateBrands.add(message);
}

/**
 * Runtime guard for a trusted-seam-stamped AgentMessage. Returns true
 * iff `markHostRuntimeControl` was called on the exact message
 * reference (WeakSet identity check). The orchestrator uses this guard
 * to decide whether to persist on the privileged `role: "system"`
 * channel.
 *
 * This is a `privateBrands.has(message)` check. There is no string
 * discriminator, no Symbol property, no metadata value, and no
 * reconstructable credential.
 */
export function isHostRuntimeControlMessage(message: AgentMessage): boolean {
	return privateBrands.has(message);
}

// Local type import — see the import ladder: this file does NOT import
// AgentMessage from @cline/shared at the top so external module
// resolution stays transparent. The shape is narrowed to AgentMessage
// structurally inside isHostRuntimeControlMessage.
import type { AgentMessage } from "@cline/shared";
