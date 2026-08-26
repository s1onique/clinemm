/**
 * Tests for the SandboxBackend dispatcher.
 *
 * Verify:
 *
 *  - `DEFAULT_SANDBOX_MODE === "disabled"` (DEFAULT_OFF invariant);
 *  - `getSandboxBackend("disabled")` returns the `NoSandboxBackend`
 *    instance (never `undefined`);
 *  - `getSandboxBackend("seatbelt-experimental")` without opt-in
 *    returns `undefined` (opt-in gate);
 *  - `readExperimentalSandboxOptIn` returns the structured opt-in
 *    only when the env var is set to `"seatbelt"`;
 *  - on a non-darwin host with opt-in, the dispatcher returns
 *    `undefined` for Seatbelt (fail-closed — the executor must not run
 *    unsandboxed).
 *
 * ACT: ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01
 */

import { afterEach, describe, expect, it } from "vitest";

import { noSandboxBackend } from "./no-sandbox-backend";
import {
	DEFAULT_SANDBOX_MODE,
	getSandboxBackend,
	readExperimentalSandboxOptIn,
} from "./sandbox-backend";
import {
	_resetSeatbeltAvailabilityCache,
} from "./macos/seatbelt-availability";

describe("DEFAULT_SANDBOX_MODE", () => {
	it("is 'disabled'", () => {
		expect(DEFAULT_SANDBOX_MODE).toBe("disabled");
	});
});

describe("getSandboxBackend — disabled mode", () => {
	it("returns the noSandboxBackend instance", async () => {
		const b = await getSandboxBackend("disabled");
		expect(b).toBe(noSandboxBackend);
		expect(b?.id).toBe("no-sandbox");
	});

	it("returns noSandboxBackend even when optIn is provided (opt-in is moot in disabled mode)", async () => {
		const b = await getSandboxBackend("disabled", {
			mode: "seatbelt-experimental",
		});
		expect(b).toBe(noSandboxBackend);
	});
});

describe("getSandboxBackend — seatbelt-experimental WITHOUT opt-in", () => {
	it("returns undefined (opt-in gate)", async () => {
		const b = await getSandboxBackend("seatbelt-experimental");
		expect(b).toBeUndefined();
	});
});

describe("readExperimentalSandboxOptIn (ACT-CLINEMM-SEATBELT-DEFAULT-ON01 CORRECTION02)", () => {
	const originalEnv = process.env.CLINEMM_EXPERIMENTAL_SANDBOX;
	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX;
		} else {
			process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalEnv;
		}
	});

	// ACT-CLINEMM-SEATBELT-DEFAULT-ON01 CORRECTION02: this helper
	// preserves its HISTORICAL opt-in-only semantics. The "default-on"
	// behavior lives in `apps/vscode/src/sdk/sandbox-policy.ts`.
	// These tests pin the conservation contract: shared SDK helper
	// behavior is unchanged for ALL consumers.

	it("returns undefined when env var is unset (shared SDK conservation)", () => {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX;
		expect(readExperimentalSandboxOptIn()).toBeUndefined();
	});

	it("returns undefined when env var is empty", () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "";
		expect(readExperimentalSandboxOptIn()).toBeUndefined();
	});

	it("returns undefined when env var is 'off'", () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off";
		expect(readExperimentalSandboxOptIn()).toBeUndefined();
	});

	it("returns undefined when env var is set to an unsupported value", () => {
		for (const v of ["vm", "1", "true", "Seatbelt", "ALLOW", "offish"]) {
			process.env.CLINEMM_EXPERIMENTAL_SANDBOX = v;
			expect(readExperimentalSandboxOptIn()).toBeUndefined();
		}
	});

	it("returns the seatbelt-experimental opt-in when env var is 'seatbelt'", () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt";
		expect(readExperimentalSandboxOptIn()).toEqual({
			mode: "seatbelt-experimental",
		});
	});
});

describe("getSandboxBackend — seatbelt-experimental WITH opt-in", () => {
	const originalEnv = process.env.CLINEMM_EXPERIMENTAL_SANDBOX;
	const originalPlatform = process.platform;
	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX;
		} else {
			process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalEnv;
		}
		_resetSeatbeltAvailabilityCache();
		// Restore process.platform descriptor if we replaced it.
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			configurable: true,
		});
	});

	it("returns undefined on non-darwin even with opt-in (fail-closed)", async () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt";
		Object.defineProperty(process, "platform", {
			value: "linux",
			configurable: true,
		});
		_resetSeatbeltAvailabilityCache();
		const b = await getSandboxBackend("seatbelt-experimental", {
			mode: "seatbelt-experimental",
		});
		expect(b).toBeUndefined();
	});

	it.runIf(process.platform === "darwin")(
		"on darwin with opt-in and substrate present, returns the SeatbeltSandboxBackendExperimental instance",
		async () => {
			process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt";
			_resetSeatbeltAvailabilityCache();
			const b = await getSandboxBackend("seatbelt-experimental", {
				mode: "seatbelt-experimental",
			});
			expect(b).not.toBeUndefined();
			expect(b?.id).toBe("seatbelt-experimental");
		},
	);

	it("caches the Seatbelt backend across calls", async () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt";
		_resetSeatbeltAvailabilityCache();
		const a = await getSandboxBackend("seatbelt-experimental", {
			mode: "seatbelt-experimental",
		});
		const b = await getSandboxBackend("seatbelt-experimental", {
			mode: "seatbelt-experimental",
		});
		// Identity equality is the cache signal — we are not rebuilding.
		expect(a).toBe(b);
	});
});
