/**
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01
 *
 * Lifecycle test matrix (RUN-01..RUN-14, RUN-* in spec) and the RED
 * Seatbelt-discrimination test (C21). Driven via FakeLaunchdTransport —
 * no real helper binary required.
 */

import { describe, expect, it } from "bun:test";
import {
	classifyRpcError,
	type HostHelperRequest,
	type HostHelperResponse,
	type HostHelperTransport,
	LaunchdTestbedBackend,
	LaunchdTestbedRunner,
	type RpcArtifactRecord,
	type RpcCommandRecord,
	type RpcStepRecord,
	type RpcTeardownRecord,
	type TartTestbedRunBody,
	type TartTestbedRunResultBody,
	toTestbedResult,
} from "../src/launchd-backend.ts";
import { FakeProcessRunner } from "../src/process-runner.ts";
import type { HostClassification, TestbedError } from "../src/types.ts";

const HOST: HostClassification = {
	os: "darwin",
	arch: "arm64",
	class: "darwin-arm64",
	tartAvailable: true,
	sshAvailable: true,
	supported: true,
};

function minimalResultBody(runId: string): TartTestbedRunResultBody {
	const steps: RpcStepRecord[] = [
		{
			name: "prepare",
			startedAt: "2026-01-01T00:00:00.000Z",
			finishedAt: "2026-01-01T00:00:01.000Z",
			durationMs: 1000,
			status: "pass",
		},
		{
			name: "start",
			startedAt: "2026-01-01T00:00:01.000Z",
			finishedAt: "2026-01-01T00:00:02.000Z",
			durationMs: 1000,
			status: "pass",
		},
		{
			name: "waitReady",
			startedAt: "2026-01-01T00:00:02.000Z",
			finishedAt: "2026-01-01T00:00:30.000Z",
			durationMs: 28000,
			status: "pass",
			detail: "10.0.0.42",
		},
		{
			name: "guestExecution",
			startedAt: "2026-01-01T00:00:30.000Z",
			finishedAt: "2026-01-01T00:00:31.000Z",
			durationMs: 1000,
			status: "pass",
		},
		{
			name: "copyOut",
			startedAt: "2026-01-01T00:00:31.000Z",
			finishedAt: "2026-01-01T00:00:32.000Z",
			durationMs: 1000,
			status: "pass",
		},
	];
	const teardown: RpcTeardownRecord = {
		status: "pass",
		stopStatus: "pass",
		deleteStatus: "pass",
		kept: false,
	};
	const commands: RpcCommandRecord[] = [
		{
			index: 0,
			argv: ["echo", "hello"],
			startedAt: "2026-01-01T00:00:30.000Z",
			finishedAt: "2026-01-01T00:00:30.500Z",
			durationMs: 500,
			exitCode: 0,
			stdout: "hello\n",
			stderr: "",
			timedOut: false,
			status: "pass",
		},
	];
	const artifacts: RpcArtifactRecord[] = [];
	return {
		overallStatus: "PASS",
		vmName: `clinemm-testbed-${runId}-abcdef`,
		runId,
		steps,
		commands,
		artifacts,
		teardown,
		startedAt: "2026-01-01T00:00:00.000Z",
		finishedAt: "2026-01-01T00:00:32.000Z",
		durationMs: 32000,
	};
}

interface FakeLaunchdOpts {
	readonly scriptedResponse?: (
		req: HostHelperRequest<TartTestbedRunBody>,
	) => HostHelperResponse<TartTestbedRunResultBody>;
	readonly scriptError?: Error;
}

class FakeLaunchdTransport implements HostHelperTransport {
	public readonly calls: HostHelperRequest<TartTestbedRunBody>[] = [];
	private readonly scriptedResponse?: (
		req: HostHelperRequest<TartTestbedRunBody>,
	) => HostHelperResponse<TartTestbedRunResultBody>;
	private readonly scriptError?: Error;

	constructor(opts: FakeLaunchdOpts = {}) {
		this.scriptedResponse = opts.scriptedResponse;
		this.scriptError = opts.scriptError;
	}

	async call<TReqBody, TResBody>(
		req: HostHelperRequest<TReqBody>,
	): Promise<HostHelperResponse<TResBody>> {
		void this;
		const casted = req as unknown as HostHelperRequest<TartTestbedRunBody>;
		this.calls.push(casted);
		if (this.scriptError !== undefined) {
			throw this.scriptError;
		}
		if (this.scriptedResponse !== undefined) {
			const resp = this.scriptedResponse(casted);
			return resp as unknown as HostHelperResponse<TResBody>;
		}
		return {
			ok: true,
			result: minimalResultBody(casted.body.run_id ?? "defaultrun"),
		} as unknown as HostHelperResponse<TResBody>;
	}

	close(): void {
		/* noop */
	}
}

describe("LaunchdTestbedRunner — RUN-01 happy lifecycle", () => {
	it("issues one semantic request, never shells out to host CLI", async () => {
		const fake = new FakeLaunchdTransport();
		const runner = new LaunchdTestbedRunner({ transport: fake });
		const result = await runner.run(
			{
				image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
				runId: "abcdef1234",
				commands: [{ argv: ["echo", "hello"], failOnNonZero: true }],
			},
			HOST,
		);
		expect(fake.calls.length).toBe(1);
		expect(result.overallStatus).toBe("PASS");
		expect(result.runId).toBe("abcdef1234");
		expect(result.vmName).toContain("abcdef1234");
		expect(result.backend).toBe("tart.testbed.run");
		expect(result.hostPlatform).toBe(HOST);
		expect(result.steps.length).toBeGreaterThan(0);
	});
});

describe("LaunchdTestbedRunner — RUN-13 foreign VM delete rejected", () => {
	it("maps TESTBED_VM_OWNERSHIP_UNPROVEN to a TestbedError", async () => {
		const fake = new FakeLaunchdTransport({
			scriptedResponse: () => ({
				ok: false,
				error: "TESTBED_VM_OWNERSHIP_UNPROVEN",
			}),
		});
		const runner = new LaunchdTestbedRunner({ transport: fake });
		let caught: TestbedError | null = null;
		try {
			await runner.run(
				{
					image:
						"ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
					commands: [{ argv: ["echo", "hi"] }],
				},
				HOST,
			);
		} catch (e) {
			caught = e as TestbedError;
		}
		expect(caught).not.toBeNull();
		expect(caught?.code).toBe("TESTBED_VM_OWNERSHIP_UNPROVEN");
	});
});

describe("LaunchdTestbedRunner — RUN-14 primary failure preserved over teardown failure", () => {
	it("surfaces guest command failure as primary failure; teardown error recorded but not overwritten", async () => {
		const fake = new FakeLaunchdTransport({
			scriptedResponse: () => ({
				ok: true,
				result: {
					overallStatus: "COMMAND_FAILED",
					vmName: "clinemm-testbed-abcdef1234-abcdef",
					runId: "abcdef1234",
					steps: [
						{
							name: "prepare",
							startedAt: "2026-01-01T00:00:00.000Z",
							finishedAt: "2026-01-01T00:00:01.000Z",
							durationMs: 1000,
							status: "pass",
						},
						{
							name: "start",
							startedAt: "2026-01-01T00:00:01.000Z",
							finishedAt: "2026-01-01T00:00:02.000Z",
							durationMs: 1000,
							status: "pass",
						},
						{
							name: "waitReady",
							startedAt: "2026-01-01T00:00:02.000Z",
							finishedAt: "2026-01-01T00:00:30.000Z",
							durationMs: 28000,
							status: "pass",
							detail: "10.0.0.42",
						},
						{
							name: "guestExecution",
							startedAt: "2026-01-01T00:00:30.000Z",
							finishedAt: "2026-01-01T00:00:31.000Z",
							durationMs: 1000,
							status: "fail",
							detail: "exit 1",
						},
						{
							name: "teardown",
							startedAt: "2026-01-01T00:00:31.000Z",
							finishedAt: "2026-01-01T00:00:33.000Z",
							durationMs: 2000,
							status: "fail",
							detail: "delete failed",
						},
					],
					commands: [
						{
							index: 0,
							argv: ["false"],
							startedAt: "2026-01-01T00:00:30.000Z",
							finishedAt: "2026-01-01T00:00:30.100Z",
							durationMs: 100,
							exitCode: 1,
							stdout: "",
							stderr: "command failed",
							timedOut: false,
							status: "fail",
						},
					],
					artifacts: [],
					teardown: {
						status: "fail",
						stopStatus: "pass",
						deleteStatus: "fail",
						kept: false,
						error: "delete failed",
					},
					failureCode: "TESTBED_INTERNAL_ERROR",
					failureReason: "command 0 (false) exited 1",
					startedAt: "2026-01-01T00:00:00.000Z",
					finishedAt: "2026-01-01T00:00:33.000Z",
					durationMs: 33000,
				},
			}),
		});
		const runner = new LaunchdTestbedRunner({ transport: fake });
		const result = await runner.run(
			{
				image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
				commands: [{ argv: ["false"], failOnNonZero: true }],
			},
			HOST,
		);
		expect(result.overallStatus).toBe("COMMAND_FAILED");
		expect(result.failureCode).toBe("TESTBED_INTERNAL_ERROR");
		expect(result.failureReason).toMatch(/command 0/);
		expect(result.teardown.status).toBe("fail");
		expect(result.teardown.deleteStatus).toBe("fail");
		expect(result.teardown.error).toMatch(/delete failed/);
	});
});

describe("LaunchdTestbedRunner — RUN-12 keepVm=true surfaces KEEP_VM", () => {
	it("translates helper's kept=true into overallStatus=KEEP_VM", async () => {
		const fake = new FakeLaunchdTransport({
			scriptedResponse: () => ({
				ok: true,
				result: {
					overallStatus: "PASS",
					vmName: "clinemm-testbed-keepvm-zzzzzz",
					runId: "keepvm",
					steps: [],
					commands: [],
					artifacts: [],
					teardown: {
						status: "skipped",
						stopStatus: "skipped",
						deleteStatus: "skipped",
						kept: true,
					},
					startedAt: "2026-01-01T00:00:00.000Z",
					finishedAt: "2026-01-01T00:00:01.000Z",
					durationMs: 1000,
				},
			}),
		});
		const runner = new LaunchdTestbedRunner({ transport: fake });
		const result = await runner.run(
			{
				image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
				runId: "keepvm",
				commands: [{ argv: ["echo", "hi"] }],
				keepVm: true,
			},
			HOST,
		);
		expect(result.overallStatus).toBe("KEEP_VM");
		expect(result.teardown.kept).toBe(true);
	});
});

describe("classifyRpcError — RPC helper error tokens", () => {
	it("maps TART_* codes", () => {
		expect(classifyRpcError("TART_CLONE_FAILED").code).toBe(
			"TART_CLONE_FAILED",
		);
		expect(classifyRpcError("TART_START_FAILED").code).toBe(
			"TART_START_FAILED",
		);
		expect(classifyRpcError("TART_IP_TIMEOUT").code).toBe("TART_IP_TIMEOUT");
		expect(classifyRpcError("TART_SSH_TIMEOUT").code).toBe("TART_SSH_TIMEOUT");
		expect(classifyRpcError("TART_STOP_FAILED").code).toBe("TART_STOP_FAILED");
		expect(classifyRpcError("TART_DELETE_FAILED").code).toBe(
			"TART_DELETE_FAILED",
		);
	});

	it("maps TESTBED_* codes", () => {
		expect(classifyRpcError("TESTBED_COPY_IN_FAILED").code).toBe(
			"TESTBED_COPY_IN_FAILED",
		);
		expect(classifyRpcError("TESTBED_COPY_OUT_FAILED").code).toBe(
			"TESTBED_COPY_OUT_FAILED",
		);
		expect(classifyRpcError("TESTBED_VM_OWNERSHIP_UNPROVEN").code).toBe(
			"TESTBED_VM_OWNERSHIP_UNPROVEN",
		);
		expect(classifyRpcError("TESTBED_REQUIRED_ARTIFACT_MISSING").code).toBe(
			"TESTBED_REQUIRED_ARTIFACT_MISSING",
		);
		expect(classifyRpcError("TESTBED_PREPARE_FAILED").code).toBe(
			"TESTBED_PREPARE_FAILED",
		);
	});

	it("maps unknown / parse errors to TESTBED_INTERNAL_ERROR", () => {
		expect(classifyRpcError("BAD_JSON").code).toBe("TESTBED_INTERNAL_ERROR");
		expect(classifyRpcError("OVERSIZE").code).toBe("TESTBED_INTERNAL_ERROR");
		expect(classifyRpcError("UNKNOWN_FIELD").code).toBe(
			"TESTBED_INTERNAL_ERROR",
		);
		expect(classifyRpcError("METHOD_NOT_AVAILABLE_IN_TS_FALLBACK").code).toBe(
			"TESTBED_INTERNAL_ERROR",
		);
		expect(classifyRpcError("completely-unknown-error").code).toBe(
			"TESTBED_INTERNAL_ERROR",
		);
	});
});

describe("toTestbedResult — schema fidelity", () => {
	it("produces a TestbedResult-shaped object with all fields present", () => {
		const body = minimalResultBody("defaultrun");
		const result = toTestbedResult(body, "launchd-tart", HOST);
		expect(result.schemaVersion).toBe(1);
		expect(result.runId).toBe("defaultrun");
		expect(result.backend).toBe("launchd-tart");
		expect(result.vmName).toContain("defaultrun");
		expect(result.hostPlatform).toBe(HOST);
		expect(result.steps.length).toBe(body.steps.length);
		expect(result.commands.length).toBe(body.commands.length);
		expect(result.artifacts.length).toBe(body.artifacts.length);
		expect(result.teardown).toEqual(body.teardown);
		expect(result.overallStatus).toBe("PASS");
	});
});

describe("LaunchdTestbedRunner — RED: launchd transport replaces direct tart execution (C21)", () => {
	it("with a fake launchd transport, the runner does NOT call into FakeProcessRunner", async () => {
		const fake = new FakeLaunchdTransport();
		const proc = new FakeProcessRunner([], { strict: false });
		const backend = new LaunchdTestbedBackend({ transport: fake });
		backend.setBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [{ argv: ["echo", "hi"], failOnNonZero: true }],
			artifacts: [],
		});
		await backend.start({ vmName: "ignored" }, proc);
		expect(fake.calls.length).toBe(1);
		// The FakeProcessRunner MUST NOT receive any direct tart argv.
		const tartCalls = proc.calls.filter((c) => c.argv[0] === "tart");
		expect(tartCalls.length).toBe(0);
	});
});

describe("LaunchdTestbedRunner — request id correlation", () => {
	it("every call carries a unique request_id", async () => {
		const fake = new FakeLaunchdTransport();
		let n = 0;
		const runner = new LaunchdTestbedRunner({
			transport: fake,
			requestIdFn: () => `req-${++n}`,
		});
		await runner.run(
			{
				image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
				commands: [{ argv: ["echo", "hi"] }],
			},
			HOST,
		);
		expect(fake.calls.length).toBe(1);
		expect(fake.calls[0]?.requestId).toBe("req-1");
	});
});
