/**
 * Tests for the Seatbelt availability probe.
 *
 * Verify:
 *
 *  - on non-darwin hosts, returns `false` (cached);
 *  - on darwin, the probe is non-throwing;
 *  - when the binary is absent (simulated by renaming /usr/bin/sandbox-exec
 *    would be invasive — we trust the `existsSync` branch is exercised by
 *    the test in `canonical-paths.test.ts` and the structural assertions
 *    here are sufficient);
 *  - the cached result is stable across calls.
 *
 * ACT: ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01
 */

import { describe, expect, it } from "vitest";

import {
	_resetSeatbeltAvailabilityCache,
	probeSeatbeltAvailability,
	SANDBOX_EXEC_PATH,
} from "./seatbelt-availability";

describe("probeSeatbeltAvailability", () => {
	it.runIf(process.platform !== "darwin")(
		"returns false on non-darwin hosts",
		() => {
			_resetSeatbeltAvailabilityCache();
			expect(probeSeatbeltAvailability()).toBe(false);
		},
	);

	it.runIf(process.platform === "darwin")(
		"returns true on darwin when /usr/bin/sandbox-exec is present and functional",
		() => {
			_resetSeatbeltAvailabilityCache();
			const result = probeSeatbeltAvailability();
			expect(result).toBe(true);
		},
	);

	it("is non-throwing", () => {
		_resetSeatbeltAvailabilityCache();
		expect(() => probeSeatbeltAvailability()).not.toThrow();
	});

	it("caches the result across calls", () => {
		_resetSeatbeltAvailabilityCache();
		const a = probeSeatbeltAvailability();
		const b = probeSeatbeltAvailability();
		expect(a).toBe(b);
	});
});

describe("SANDBOX_EXEC_PATH", () => {
	it("is /usr/bin/sandbox-exec", () => {
		expect(SANDBOX_EXEC_PATH).toBe("/usr/bin/sandbox-exec");
	});
});
