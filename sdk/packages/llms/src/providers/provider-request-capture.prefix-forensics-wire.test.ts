/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01.
 *
 * The WIRE-SEAM forensic capture: the REAL HTTP boundary.
 *
 * ## THE DEFECT (P0)
 * --------------------
 * `recordPrefixForensics({stage: "wire_request"})` was placed INSIDE the
 * provider-request capture callback, BEHIND two guards:
 *
 *   1. `wrapFetchForProviderRequestCapture()` returned the UNWRAPPED fetch
 *      when neither the full wire capture nor the wire-reasoning observer
 *      was active. The forensic capture was NOT part of that decision.
 *   2. Inside the wrapper, the callback returned EARLY when the ordinary
 *      wire capture was disabled. The forensic capture was NOT part of that
 *      decision either.
 *
 * The consequence: setting ONLY `CLINEMM_PREFIX_FORENSICS=1` did NOT cause
 * the wire forensic capture to run. The ACT's independent opt-in contract was
 * violated — the eight capture-writer witnesses called
 * `recordPrefixForensics()` DIRECTLY, so they never exercised the real HTTP
 * boundary and could not detect the defect.
 *
 * ## THE CORRECTION
 * -----------------
 * The forensic capture participates in BOTH decisions:
 *
 *   - the WRAP decision (does the gateway need a wrapper at all?), and
 *   - the PER-REQUEST observation decision (is a body read warranted?).
 *
 * The DEFAULT-OFF behaviour is preserved exactly: with no capture armed and
 * no observer registered, the base fetch is returned UNCHANGED, the request
 * body is never read and the delegate's own promise is returned by reference.
 *
 * ## THE CONTROLS
 * ---------------
 *   PF-WIRE-01  forensic-only activation reaches the REAL HTTP boundary
 *   PF-WIRE-02  the default-OFF path is byte-identical (no wrap, no read)
 *   PF-WIRE-03  an INVALID wire body never yields `complete: true`
 *   PF-WIRE-04  forensic-only activation does NOT enable the full capture
 *   PF-WIRE-05  a forensic-only wrap is still a non-async, by-reference
 *               delegation
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	_resetPrefixForensicsCohortForTests,
	type GatewayStreamRequest,
	isPrefixForensicsEnabled,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetPrefixForensicsAttemptCountersForTests } from "./prefix-forensics-capture";
import { wrapFetchForProviderRequestCapture } from "./provider-request-capture";

/** A serialized provider request body with a real message list. */
const WIRE_BODY = JSON.stringify({
	model: "test-model",
	messages: [
		{ role: "user", content: "hello" },
		{
			role: "tool",
			content: [{ type: "tool-result", toolCallId: "c1", output: "x" }],
		},
	],
});

/** A minimal gateway request carrying the correlation identities. */
function makeGatewayRequest(): GatewayStreamRequest {
	return {
		providerId: "test-provider",
		modelId: "test-model",
		messages: [],
		metadata: {
			sessionId: "session-wire-1",
			modelRequestId: "attempt-wire-1",
			iteration: 7,
		},
	} as unknown as GatewayStreamRequest;
}

/** Wait until `predicate` holds, or fail after a bounded budget. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 400; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error(`timed out waiting for ${label}`);
}

describe("ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01 — the wire seam", () => {
	const savedForensics = process.env.CLINEMM_PREFIX_FORENSICS;
	const savedForensicsDir = process.env.CLINEMM_PREFIX_FORENSICS_DIR;
	const savedForensicsKey = process.env.CLINEMM_PREFIX_FORENSICS_KEY;
	const savedWire = process.env.CLINE_CAPTURE_WIRE;
	const savedMode = process.env.CLINE_CAPTURE_PROVIDER_REQUEST;
	const savedCaptureDir = process.env.CLINE_CAPTURE_DIR;
	let tempDirs: string[] = [];

	beforeEach(() => {
		delete process.env.CLINEMM_PREFIX_FORENSICS;
		delete process.env.CLINEMM_PREFIX_FORENSICS_DIR;
		delete process.env.CLINEMM_PREFIX_FORENSICS_KEY;
		delete process.env.CLINE_CAPTURE_WIRE;
		delete process.env.CLINE_CAPTURE_PROVIDER_REQUEST;
		delete process.env.CLINE_CAPTURE_DIR;
		tempDirs = [];
		_resetPrefixForensicsCohortForTests();
		_resetPrefixForensicsAttemptCountersForTests();
	});

	afterEach(() => {
		for (const [name, value] of [
			["CLINEMM_PREFIX_FORENSICS", savedForensics],
			["CLINEMM_PREFIX_FORENSICS_DIR", savedForensicsDir],
			["CLINEMM_PREFIX_FORENSICS_KEY", savedForensicsKey],
			["CLINE_CAPTURE_WIRE", savedWire],
			["CLINE_CAPTURE_PROVIDER_REQUEST", savedMode],
			["CLINE_CAPTURE_DIR", savedCaptureDir],
		] as const) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
		_resetPrefixForensicsCohortForTests();
		_resetPrefixForensicsAttemptCountersForTests();
		vi.restoreAllMocks();
	});

	it("PF-WIRE-01: forensic-only activation reaches the REAL HTTP boundary", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pf-wire-on-"));
		tempDirs.push(dir);
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS_KEY = "a-fixed-test-key";

		// The ordinary wire capture is NOT enabled. Only the forensic
		// capture is armed. This is the exact activation the ACT promises.
		expect(process.env.CLINE_CAPTURE_WIRE).toBeUndefined();
		expect(process.env.CLINE_CAPTURE_PROVIDER_REQUEST).toBeUndefined();

		const delegate = vi.fn(() => Promise.resolve(new Response("ok")));
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);

		// The forensic activation must cause the gateway to be wrapped:
		// otherwise the forensic capture can never observe the wire body.
		expect(wrapped).toBeDefined();
		expect(wrapped).not.toBe(delegate);

		await (wrapped as typeof fetch)("https://provider.test/v1/chat", {
			method: "POST",
			body: WIRE_BODY,
			headers: { "content-type": "application/json" },
		});

		await waitFor(
			() =>
				readdirSync(dir).some((name) =>
					name.endsWith(".prefix-forensics.json"),
				),
			"the wire forensic capture artifact",
		);

		const files = readdirSync(dir).filter((name) =>
			name.endsWith(".prefix-forensics.json"),
		);
		expect(files.length).toBeGreaterThan(0);
		const record = JSON.parse(
			readFileSync(join(dir, files[0]!), "utf8"),
		) as Record<string, unknown>;
		expect(record.source).toBe("wire_request");
		expect(record.providerId).toBe("test-provider");
		expect(record.modelId).toBe("test-model");
		expect(record.sessionId).toBe("session-wire-1");
		expect(record.providerAttemptId).toBe("attempt-wire-1");
		expect(record.iteration).toBe(7);
		// The wire stage observed the REAL message list.
		const representation = record.representation as Record<string, unknown>;
		expect(representation.messageCount).toBe(2);
		expect(representation.complete).toBe(true);
	});

	it("PF-WIRE-02: the default-OFF path is byte-identical (no wrap, no body read)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pf-wire-off-"));
		tempDirs.push(dir);
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		// The forensic capture is NOT armed.
		expect(isPrefixForensicsEnabled()).toBe(false);

		const delegatePromise = Promise.resolve(new Response("ok"));
		const delegate = vi.fn(
			(_input: RequestInfo | URL, _init?: RequestInit) => delegatePromise,
		);
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);

		// The base fetch is returned UNCHANGED.
		expect(wrapped).toBe(delegate);

		const request = new Request("https://provider.test/v1/chat", {
			method: "POST",
			body: WIRE_BODY,
		});
		const cloneSpy = vi.spyOn(request, "clone");
		const returned = (wrapped as typeof fetch)(request);
		await returned;

		// No body read, no clone, no artifact.
		expect(cloneSpy).not.toHaveBeenCalled();
		expect(request.bodyUsed).toBe(false);
		expect(readdirSync(dir)).toHaveLength(0);
	});

	it("PF-WIRE-03: an INVALID wire body never yields `complete: true`", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pf-wire-invalid-"));
		tempDirs.push(dir);
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS_KEY = "a-fixed-test-key";

		const delegate = vi.fn(() => Promise.resolve(new Response("ok")));
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);
		expect(wrapped).toBeDefined();

		// A body that is NOT a parseable provider request: no `messages`,
		// no `prompt`, no `contents`.
		await (wrapped as typeof fetch)("https://provider.test/v1/chat", {
			method: "POST",
			body: JSON.stringify({ model: "test-model", temperature: 0.7 }),
			headers: { "content-type": "application/json" },
		});

		await waitFor(
			() =>
				readdirSync(dir).some((name) =>
					name.endsWith(".prefix-forensics.json"),
				),
			"the invalid-body forensic capture artifact",
		);

		const files = readdirSync(dir).filter((name) =>
			name.endsWith(".prefix-forensics.json"),
		);
		expect(files.length).toBeGreaterThan(0);
		const record = JSON.parse(
			readFileSync(join(dir, files[0]!), "utf8"),
		) as Record<string, unknown>;
		const representation = record.representation as Record<string, unknown>;
		// The observation is INCOMPLETE — never a complete zero-message
		// representation, which would be a fabricated structural claim.
		expect(representation.complete).toBe(false);
		expect(representation.incompleteReason).toBeTruthy();
		expect(representation.messageCount).toBe(0);
	});

	it("PF-WIRE-04: forensic-only activation does NOT enable the full provider capture", async () => {
		const forensicsDir = mkdtempSync(join(tmpdir(), "pf-wire-only-"));
		const captureDir = mkdtempSync(join(tmpdir(), "pf-wire-capture-"));
		tempDirs.push(forensicsDir, captureDir);
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = forensicsDir;
		process.env.CLINEMM_PREFIX_FORENSICS_KEY = "a-fixed-test-key";
		// The full capture's directory is set, but the full capture is OFF.
		process.env.CLINE_CAPTURE_DIR = captureDir;

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

		await waitFor(
			() =>
				readdirSync(forensicsDir).some((name) =>
					name.endsWith(".prefix-forensics.json"),
				),
			"the wire forensic capture artifact",
		);

		// The full provider-request capture must NOT have been written: the
		// forensic activation is INDEPENDENT and must not widen the
		// ordinary capture's surface.
		expect(
			readdirSync(captureDir).some((name) =>
				name.endsWith(".provider-request.json"),
			),
		).toBe(false);
	});

	it("PF-WIRE-05: a forensic-only wrap still delegates BY REFERENCE", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pf-wire-byref-"));
		tempDirs.push(dir);
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS_KEY = "a-fixed-test-key";

		const delegatePromise = Promise.resolve(new Response("ok"));
		const delegate = vi.fn(
			(_input: RequestInfo | URL, _init?: RequestInit) => delegatePromise,
		);
		const wrapped = wrapFetchForProviderRequestCapture(
			delegate as unknown as typeof fetch,
			makeGatewayRequest(),
		);
		expect(wrapped).toBeDefined();

		const returned = (wrapped as typeof fetch)(
			"https://provider.test/v1/chat",
			{ method: "POST", body: WIRE_BODY },
		);
		await returned;

		// The delegate's OWN promise is returned — no promise assimilation.
		expect(returned).toBe(delegatePromise);
		expect(delegate).toHaveBeenCalledTimes(1);
	});
});
