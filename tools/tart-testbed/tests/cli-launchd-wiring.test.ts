/**
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01
 *
 * CLI wiring tests for the launchd-tart backend.
 *   - selectLaunchdTartRunner rejects without --allow-vm (fail closed).
 *   - selectLaunchdTartRunner rejects without a discoverable socket.
 *   - selectLaunchdTartRunner returns a transport when both are present.
 */

import { describe, expect, it } from "bun:test";
import { selectCliRunner, selectLaunchdTartRunner } from "../src/cli.ts";
import { FakeTestbedBackend } from "../src/fake-backend.ts";
import { LaunchdHostHelperTransport } from "../src/launchd-transport.ts";
import { FakeProcessRunner, RealProcessRunner } from "../src/process-runner.ts";
import { TartBackend } from "../src/tart-backend.ts";
import type { HostClassification } from "../src/types.ts";

const HOST_SUPPORTED: HostClassification = {
	os: "darwin",
	arch: "arm64",
	class: "darwin-arm64",
	tartAvailable: true,
	sshAvailable: true,
	supported: true,
};

describe("CLI runner wiring — launchd-tart backend", () => {
	it("selectLaunchdTartRunner rejects without --allow-vm (fail closed)", () => {
		const w = selectLaunchdTartRunner(false, "/tmp/fake.sock");
		expect(w.kind).toBe("rejected");
		if (w.kind !== "rejected") return;
		expect(w.rejectReason).toMatch(/--allow-vm/);
	});

	it("selectLaunchdTartRunner rejects when socket path is undiscoverable", () => {
		const w = selectLaunchdTartRunner(true, null);
		expect(w.kind).toBe("rejected");
		if (w.kind !== "rejected") return;
		expect(w.rejectReason).toMatch(/socket path/);
	});

	it("selectLaunchdTartRunner returns a LaunchdHostHelperTransport when both are present", () => {
		const w = selectLaunchdTartRunner(true, "/tmp/fake.sock");
		expect(w.kind).toBe("launchd-tart");
		if (w.kind !== "launchd-tart") return;
		expect(w.transport).toBeInstanceOf(LaunchdHostHelperTransport);
		expect(w.transport.socketPath).toBe("/tmp/fake.sock");
	});

	it("selectCliRunner still returns fake/tart kinds unchanged (conservation)", () => {
		const fake = selectCliRunner("fake", false, HOST_SUPPORTED);
		expect(fake.kind).toBe("fake");
		if (fake.kind !== "fake") return;
		expect(fake.backend).toBeInstanceOf(FakeTestbedBackend);
		expect(fake.proc).toBeInstanceOf(FakeProcessRunner);

		const tart = selectCliRunner("tart", true, HOST_SUPPORTED);
		expect(tart.kind).toBe("tart");
		if (tart.kind !== "tart") return;
		expect(tart.backend).toBeInstanceOf(TartBackend);
		expect(tart.proc).toBeInstanceOf(RealProcessRunner);
	});
});
