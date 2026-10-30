/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01 — the provider-fetch
 * OFF fast path.
 *
 * THE DEFECT
 * ----------
 * The extension host installs the wire-reasoning observer UNCONDITIONALLY at
 * activation, so "an observer is registered" is TRUE for the whole process
 * lifetime — including while the model-behavior recorder is DISARMED (its
 * default state).
 *
 * The provider seam therefore decided, at WRAP time, that the fetch wrapper
 * was needed, and then — unconditionally — READ (and, for a `Request`, CLONE)
 * the request body on EVERY provider request. With the observer always
 * registered, the default-OFF path paid a body clone + read + JSON parse for
 * every provider request even when nobody wanted the evidence.
 *
 * The wrapper was also an `async` function, so even the OFF path paid an
 * extra promise-assimilation tick before the delegate's promise was handed
 * back to the caller.
 *
 * THE CORRECTION
 * --------------
 *  - The registry gains a LIVE liveness predicate (`isActive`) that is
 *    consulted at OBSERVATION time — never snapshotted at registration time.
 *  - The provider seam keeps its REGISTRATION-based wrapping (so an
 *    already-wrapped gateway keeps working across an ON/OFF toggle), but at
 *    ACTUAL FETCH INVOCATION it consults the LIVE observer state: when BOTH
 *    the full provider-request capture and the live observer are OFF, it
 *    returns the delegate's result IMMEDIATELY — no body read, no clone, no
 *    parsing, no asynchronous diagnostic work.
 *  - The wrapper is a NON-ASYNC function, so the delegate's OWN promise is
 *    returned unchanged (no extra promise assimilation before delegation).
 *
 * CONSERVATION MATRIX
 * -------------------
 *  OFF · ON · OFF→ON · ON→OFF · independent full-capture ON ·
 *  actual `Request` stream · observer exceptions · default-OFF unchanged.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type GatewayStreamRequest,
	isModelBehaviorWireReasoningObserverActive,
	registerModelBehaviorWireReasoningObserver,
	unregisterModelBehaviorWireReasoningObserver,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wrapFetchForProviderRequestCapture } from "./provider-request-capture";

/** The serialized body a provider would receive for a reasoning request. */
const WIRE_BODY = JSON.stringify({
	thinking: { type: "adaptive" },
	reasoning: { effort: "low", enabled: true },
	output_config: { effort: "low" },
	max_tokens: 4096,
});

/** A minimal gateway request. Only the correlation fields matter here. */
function makeGatewayRequest(): GatewayStreamRequest {
	return {
		providerId: "test-provider",
		modelId: "test-model",
		messages: [],
	};
}

/** Wait until `predicate` holds, or fail after a bounded budget. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error(`timed out waiting for ${label}`);
}

describe("the provider-fetch OFF fast path", () => {
	const savedWire = process.env.CLINE_CAPTURE_WIRE;
	const savedMode = process.env.CLINE_CAPTURE_PROVIDER_REQUEST;
	const savedDir = process.env.CLINE_CAPTURE_DIR;
	let captureDirs: string[] = [];

	beforeEach(() => {
		delete process.env.CLINE_CAPTURE_WIRE;
		delete process.env.CLINE_CAPTURE_PROVIDER_REQUEST;
		delete process.env.CLINE_CAPTURE_DIR;
		captureDirs = [];
		unregisterModelBehaviorWireReasoningObserver();
	});

	afterEach(() => {
		unregisterModelBehaviorWireReasoningObserver();
		if (savedWire === undefined) {
			delete process.env.CLINE_CAPTURE_WIRE;
		} else {
			process.env.CLINE_CAPTURE_WIRE = savedWire;
		}
		if (savedMode === undefined) {
			delete process.env.CLINE_CAPTURE_PROVIDER_REQUEST;
		} else {
			process.env.CLINE_CAPTURE_PROVIDER_REQUEST = savedMode;
		}
		if (savedDir === undefined) {
			delete process.env.CLINE_CAPTURE_DIR;
		} else {
			process.env.CLINE_CAPTURE_DIR = savedDir;
		}
		for (const dir of captureDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		captureDirs = [];
		vi.restoreAllMocks();
	});

	it("OFF-FAST-01: a registered but INACTIVE observer leaves the provider fetch untouched", async () => {
		// The observer is REGISTERED (so the seam wraps the fetch) but its
		// live liveness predicate says it currently wants NOTHING.
		const active = false;
		const observed: unknown[] = [];
		registerModelBehaviorWireReasoningObserver(
			(observation) => {
				observed.push(observation);
			},
			{ isActive: () => active },
		);

		const delegatePromise = Promise.resolve(new Response("ok"));
		const delegate = vi.fn(
			(_input: RequestInfo | URL, _init?: RequestInit) => delegatePromise,
		);
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);
		expect(wrapped).toBeDefined();
		expect(wrapped).not.toBe(delegate);

		// A REAL `Request` carrying a REAL body stream.
		const request = new Request("https://provider.test/v1/chat", {
			method: "POST",
			body: WIRE_BODY,
			headers: { "content-type": "application/json" },
		});
		const cloneSpy = vi.spyOn(request, "clone");

		const returned = (wrapped as typeof fetch)(request);
		await returned;

		// (a) The delegate's OWN promise is returned — the wrapper adds NO
		//     promise assimilation before delegation.
		expect(returned).toBe(delegatePromise);

		// (b) The delegate received the EXACT request object.
		expect(delegate).toHaveBeenCalledTimes(1);
		expect(delegate.mock.calls[0]?.[0]).toBe(request);

		// (c) NO body read, NO clone, NO parsing: the request body was never
		//     touched.
		expect(cloneSpy).not.toHaveBeenCalled();
		expect(request.bodyUsed).toBe(false);

		// (d) No observation was produced.
		expect(observed).toHaveLength(0);
		expect(isModelBehaviorWireReasoningObserverActive()).toBe(false);
	});

	it("OFF-FAST-02: the default-OFF path (no observer) returns the base fetch UNCHANGED", () => {
		const delegate = vi.fn(() => Promise.resolve(new Response("ok")));
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);
		// With nothing registered and no full capture, the seam does not
		// wrap at all — provider request/response behavior is unchanged.
		expect(wrapped).toBe(delegate);
	});

	it("OFF-FAST-03: an ACTIVE observer receives the serialized wire controls", async () => {
		const observed: Array<Record<string, unknown>> = [];
		registerModelBehaviorWireReasoningObserver(
			(observation) => {
				observed.push(observation as unknown as Record<string, unknown>);
			},
			{ isActive: () => true },
		);

		const delegate = vi.fn(() => Promise.resolve(new Response("ok")));
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);
		expect(wrapped).toBeDefined();

		const returned = (wrapped as typeof fetch)(
			"https://provider.test/v1/chat",
			{
				method: "POST",
				body: WIRE_BODY,
				headers: { "content-type": "application/json" },
			},
		);
		const response = await returned;
		expect(response.status).toBe(200);

		await waitFor(() => observed.length > 0, "the wire observation");
		expect(observed[0]).toMatchObject({
			wireThinkingMode: "adaptive",
			wireReasoningEffort: "low",
			wireReasoningEnabled: true,
			wireOutputConfigEffort: "low",
			wireOutputTokenLimit: 4096,
		});
	});

	it("OFF-FAST-04: OFF→ON toggling works for an ALREADY-wrapped gateway", async () => {
		let active = false;
		const observed: unknown[] = [];
		registerModelBehaviorWireReasoningObserver(
			(observation) => {
				observed.push(observation);
			},
			{ isActive: () => active },
		);

		const delegate = vi.fn(() => Promise.resolve(new Response("ok")));
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);
		expect(wrapped).toBeDefined();

		// OFF: no observation, and the request body is never read.
		const offRequest = new Request("https://provider.test/v1/chat", {
			method: "POST",
			body: WIRE_BODY,
		});
		const offCloneSpy = vi.spyOn(offRequest, "clone");
		await (wrapped as typeof fetch)(offRequest);
		expect(offCloneSpy).not.toHaveBeenCalled();
		expect(observed).toHaveLength(0);

		// ON: the SAME wrapped gateway now produces the observation.
		active = true;
		await (wrapped as typeof fetch)("https://provider.test/v1/chat", {
			method: "POST",
			body: WIRE_BODY,
		});
		await waitFor(() => observed.length > 0, "the wire observation after ON");
		expect(observed).toHaveLength(1);
	});

	it("OFF-FAST-05: ON→OFF toggling stops the observation AND stops the body read", async () => {
		let active = true;
		const observed: unknown[] = [];
		registerModelBehaviorWireReasoningObserver(
			(observation) => {
				observed.push(observation);
			},
			{ isActive: () => active },
		);

		const delegate = vi.fn(() => Promise.resolve(new Response("ok")));
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);
		expect(wrapped).toBeDefined();

		await (wrapped as typeof fetch)("https://provider.test/v1/chat", {
			method: "POST",
			body: WIRE_BODY,
		});
		await waitFor(() => observed.length > 0, "the wire observation while ON");
		expect(observed).toHaveLength(1);

		// OFF again: the observation stops, and the body is not read.
		active = false;
		const offRequest = new Request("https://provider.test/v1/chat", {
			method: "POST",
			body: WIRE_BODY,
		});
		const offCloneSpy = vi.spyOn(offRequest, "clone");
		await (wrapped as typeof fetch)(offRequest);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(offCloneSpy).not.toHaveBeenCalled();
		expect(observed).toHaveLength(1);
	});

	it("OFF-FAST-06: an INDEPENDENT full capture still writes its artifact", async () => {
		const dir = mkdtempSync(join(tmpdir(), "provider-capture-"));
		captureDirs.push(dir);
		process.env.CLINE_CAPTURE_WIRE = "true";
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = "summary";
		process.env.CLINE_CAPTURE_DIR = dir;

		// No observer is registered: the full capture is INDEPENDENT.
		const delegate = vi.fn(() => Promise.resolve(new Response("ok")));
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);
		expect(wrapped).toBeDefined();
		expect(wrapped).not.toBe(delegate);

		await (wrapped as typeof fetch)("https://provider.test/v1/chat", {
			method: "POST",
			body: WIRE_BODY,
		});
		await waitFor(
			() =>
				readdirSync(dir).some((name) =>
					name.endsWith(".provider-request.json"),
				),
			"the provider-request capture artifact",
		);
		expect(
			readdirSync(dir).some((name) => name.endsWith(".provider-request.json")),
		).toBe(true);
	});

	it("OFF-FAST-07: a THROWING observer never breaks the provider fetch", async () => {
		registerModelBehaviorWireReasoningObserver(
			() => {
				throw new Error("observer failure");
			},
			{ isActive: () => true },
		);

		const delegate = vi.fn(() => Promise.resolve(new Response("ok")));
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);
		expect(wrapped).toBeDefined();

		const response = await (wrapped as typeof fetch)(
			"https://provider.test/v1/chat",
			{
				method: "POST",
				body: WIRE_BODY,
			},
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
	});
});
