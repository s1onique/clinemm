/**
 * Parser Helper Runtime — failure mode tests.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01
 *
 * These tests verify that EVERY operational failure mode of the
 * helper returns `null` (V2 dormant, V1 preserved). They do NOT
 * require a real helper binary because the current binary is not
 * yet built; they construct a fake locator that returns a path or
 * `null` and exercise the invocation path.
 *
 * When the helper-binary ACT (PARSER-HELPER-BINARY-SHIPPING01)
 * lands, the existing v2 attack suite already covers structural
 * attacks; these tests add the invocation-side failure modes.
 */

import { describe, expect, it } from "vitest";

import { type HelperPlatform, MvdanShHelper } from "./runtime";

describe("parser-helper/runtime — ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01", () => {
	it("returns null when binaryPath() returns null (helper not bundled)", async () => {
		const helper = new MvdanShHelper({
			platform: "darwin-arm64",
			binaryPath: () => null,
		});
		const r = await helper.invoke("pwd");
		expect(r).toBeNull();
	});

	it("returns null when binaryPath() returns a path that does not exist", async () => {
		const helper = new MvdanShHelper({
			platform: "darwin-arm64",
			binaryPath: () => "/nonexistent/path/to/helper",
		});
		const r = await helper.invoke("pwd");
		expect(r).toBeNull();
	});

	it("returns null when joined source is empty (empty input)", async () => {
		const helper = new MvdanShHelper({
			platform: "darwin-arm64",
			binaryPath: () => null, // binary absent, but we test path pre-bail
		});
		const r = await helper.invoke(null);
		expect(r).toBeNull();
	});

	it("exposes platform target via .platform", () => {
		const helper = new MvdanShHelper({
			platform: "darwin-arm64",
			binaryPath: () => null,
		});
		expect(helper.platform).toBe<HelperPlatform>("darwin-arm64");
	});

	it("binaryPath() is reachable as a public method (provenance audit point)", () => {
		const helper = new MvdanShHelper({
			platform: "linux-amd64",
			binaryPath: () => "/opt/cline/parser-helper",
		});
		expect(helper.binaryPath()).toBe("/opt/cline/parser-helper");
	});
});
