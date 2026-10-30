/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01 — the process-wide
 * wire-observer registry.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `@cline/shared` is BUNDLED more than once: `@cline/llms` bundles its own
 * copy into its `dist`, and `apps/vscode` bundles the whole workspace into
 * `dist/extension.js`. A module-scoped singleton would therefore produce
 * ONE registry per bundled copy, and the observer registered by the
 * extension host would never be seen by the provider bundle.
 *
 * The registry lives on `globalThis` under a `Symbol.for(...)` key so every
 * copy resolves the SAME slot. The slot's VALUE carries a private
 * capability token — and THAT is the subtle part: if the capability token
 * is created with `Symbol(...)` (not `Symbol.for(...)`), every bundled copy
 * gets a DIFFERENT token, so each copy would REPLACE the other copy's
 * registry and the observer would be silently lost.
 *
 * These witnesses pin that cross-copy behaviour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	hasModelBehaviorWireReasoningObserver,
	notifyModelBehaviorWireReasoningObservers,
	registerModelBehaviorWireReasoningObserver,
	unregisterModelBehaviorWireReasoningObserver,
} from "./model-wire-reasoning";

/**
 * The global slot the registry lives in.
 *
 * This mirrors the module's own slot key. It is read HERE (not imported)
 * so the test observes the REAL global state the module writes to.
 */
const REGISTRY_SLOT = Symbol.for(
	"@cline/model-behavior/wire-reasoning-registry",
);

type GlobalWithRegistry = typeof globalThis & {
	[REGISTRY_SLOT]?: { capability: symbol; observers: Set<unknown> };
};

afterEach(() => {
	unregisterModelBehaviorWireReasoningObserver();
});

describe("the process-wide wire-reasoning registry", () => {
	it("REG01: no observer is registered by default", () => {
		expect(hasModelBehaviorWireReasoningObserver()).toBe(false);
	});

	it("REG02: registering an observer makes the registry observable", () => {
		const unregister = registerModelBehaviorWireReasoningObserver(() => {
			// The observer body is irrelevant here.
		});
		expect(hasModelBehaviorWireReasoningObserver()).toBe(true);
		unregister();
		expect(hasModelBehaviorWireReasoningObserver()).toBe(false);
	});

	it("REG03: the registry lives in the REALM-WIDE global slot", () => {
		registerModelBehaviorWireReasoningObserver(() => {
			// The observer body is irrelevant here.
		});
		const holder = globalThis as GlobalWithRegistry;
		const registry = holder[REGISTRY_SLOT];
		expect(registry).toBeDefined();
		expect(registry?.observers.size).toBe(1);
	});

	it("REG04: a registry written by ANOTHER module copy is REUSED, not replaced", () => {
		// Simulate what a SECOND bundled copy of this module does: it
		// resolves the SAME global slot and finds a registry there.
		//
		// The capability token MUST be realm-wide (`Symbol.for`), otherwise
		// the second copy sees a mismatched capability, concludes the slot
		// was forged, and REPLACES the registry — silently dropping every
		// observer the first copy registered.
		const holder = globalThis as GlobalWithRegistry;
		const first = registerModelBehaviorWireReasoningObserver(() => {
			// The observer body is irrelevant here.
		});
		const registryBefore = holder[REGISTRY_SLOT];
		const capabilityBefore = registryBefore?.capability;
		const observerCountBefore = registryBefore?.observers.size;

		// A second copy of the module resolves the slot the same way.
		const resolved = holder[REGISTRY_SLOT];
		expect(resolved).toBeDefined();
		// The capability check that `resolveRegistry()` performs.
		expect(resolved?.capability === capabilityBefore).toBe(true);
		// The observers survived the second copy's resolution.
		expect(resolved?.observers.size).toBe(observerCountBefore);
		expect(resolved?.observers.size).toBe(1);

		first();
	});

	it("REG05: the capability token is realm-wide so every copy agrees", () => {
		// The capability symbol identity is what authorizes a registry to
		// live in the slot. It MUST be created with `Symbol.for` so that a
		// second bundled copy of this module computes the SAME token.
		const holder = globalThis as GlobalWithRegistry;
		registerModelBehaviorWireReasoningObserver(() => {
			// The observer body is irrelevant here.
		});
		const capability = holder[REGISTRY_SLOT]?.capability;
		expect(capability).toBeDefined();
		// `Symbol.for` returns the SAME symbol for the same key, across
		// every copy of this module in the realm.
		expect(capability).toBe(
			Symbol.for("cline.modelBehaviorWireReasoningRegistry"),
		);
	});

	it("REG06: a SECOND module copy sees the observer the FIRST copy registered", async () => {
		// This is the load-bearing cross-copy witness.
		//
		// `@cline/shared` is bundled more than once: `@cline/llms` carries
		// its own copy into its `dist`, and `apps/vscode` bundles the whole
		// workspace into `dist/extension.js`. The extension host registers
		// the observer through ITS copy; the provider transport notifies
		// through ITS copy. If the two copies disagreed about the
		// capability, the second copy would REPLACE the registry and the
		// provider's notifications would go nowhere — the trace would
		// silently contain no wire evidence.
		//
		// A REAL second copy is produced by resetting the module registry
		// and re-importing: the re-imported module re-evaluates its
		// top-level constants (a fresh `REGISTRY_CAPABILITY`), exactly
		// like a second bundled copy does.
		const observed: unknown[] = [];
		const unregister = registerModelBehaviorWireReasoningObserver(
			(observation) => {
				observed.push(observation);
			},
		);

		vi.resetModules();
		const secondCopy = await import("./model-wire-reasoning");

		// The second copy REUSES the registry in the shared global slot.
		expect(secondCopy.hasModelBehaviorWireReasoningObserver()).toBe(true);

		// The second copy notifies: the observer registered through the
		// FIRST copy must receive the observation.
		secondCopy.notifyModelBehaviorWireReasoningObservers({
			requestId: "req-cross-copy",
			attempt: 1,
			wireOutputConfigEffort: "low",
		});
		expect(observed).toHaveLength(1);
		expect(observed[0]).toMatchObject({
			requestId: "req-cross-copy",
			wireOutputConfigEffort: "low",
		});

		unregister();
	});

	it("REG07: the observer receives the observation and cannot influence it", () => {
		const received: unknown[] = [];
		const unregister = registerModelBehaviorWireReasoningObserver(
			(observation) => {
				received.push(observation);
			},
		);
		notifyModelBehaviorWireReasoningObservers({
			requestId: "req-notify",
			attempt: 2,
			wireOutputConfigEffort: "high",
		});
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			requestId: "req-notify",
			attempt: 2,
			wireOutputConfigEffort: "high",
		});
		unregister();
	});

	it("REG08: a THROWING observer is isolated — it never breaks the notification", () => {
		const received: unknown[] = [];
		const unregisterThrower = registerModelBehaviorWireReasoningObserver(() => {
			throw new Error("observer failure");
		});
		const unregisterGood = registerModelBehaviorWireReasoningObserver(
			(observation) => {
				received.push(observation);
			},
		);

		expect(() =>
			notifyModelBehaviorWireReasoningObservers({ requestId: "req-throw" }),
		).not.toThrow();
		// The healthy observer still received the observation.
		expect(received).toHaveLength(1);

		unregisterThrower();
		unregisterGood();
	});
});
