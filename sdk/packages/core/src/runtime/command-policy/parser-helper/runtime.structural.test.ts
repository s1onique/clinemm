/**
 * Parser Helper Runtime — structural validation tests.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01-CORRECTION01 P1.
 *
 * Validates the runtime response validator rejects malformed nested
 * ASTs. Without this, a helper that returns
 * `program: { stmts: "not-an-array" }` would pass top-level
 * validation and throw later in the classifier when it tries to
 * walk `.program.stmts.map(...)`.
 *
 * Uses `vi.mock` to replace `node:child_process` so the spawn path
 * can be exercised without a real helper binary.
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeChild extends EventEmitter {
	stdout: EventEmitter & { setEncoding: (enc: string) => void };
	stderr: EventEmitter;
	stdin: { write: (s: string) => void; end: () => void };
	kill: (sig: string) => void;
	stdio: ["pipe", "pipe", "pipe"];
	windowsHide: boolean;
}

function makeFakeChild(stdoutPayload: string, exitCode: number = 0): FakeChild {
	const stdout = new EventEmitter() as EventEmitter & {
		setEncoding: (enc: string) => void;
	};
	stdout.setEncoding = () => undefined;
	const child = new EventEmitter() as FakeChild;
	child.stdout = stdout;
	child.stderr = new EventEmitter();
	child.stdin = { write: () => undefined, end: () => undefined };
	child.kill = () => undefined;
	child.stdio = ["pipe", "pipe", "pipe"];
	child.windowsHide = true;

	setImmediate(() => {
		child.stdout.emit("data", stdoutPayload);
		setImmediate(() => {
			child.emit("close", exitCode);
		});
	});
	return child;
}

let currentPayload: string = "";
let currentExitCode: number = 0;

vi.mock("node:child_process", () => ({
	spawn: () => makeFakeChild(currentPayload, currentExitCode),
}));

const fakeHelperLocator = () =>
	({
		platform: "darwin-arm64",
		binaryPath: () => "/fake/path",
	}) as const;

describe("parser-helper/runtime structural validation — CORRECTION01 P1", () => {
	beforeEach(() => {
		currentPayload = "";
		currentExitCode = 0;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("rejects a top-level object that is not valid JSON", async () => {
		currentPayload = "not json {";
		const { MvdanShHelper } = await import("./runtime");
		const helper = new MvdanShHelper(fakeHelperLocator() as never);
		const r = await helper.invoke("pwd");
		expect(r).toBeNull();
	});

	it("rejects program with stmts that is not an array", async () => {
		currentPayload = JSON.stringify({
			protocolVersion: 2,
			dialect: "bash",
			sourceSha256:
				"0000000000000000000000000000000000000000000000000000000000000000",
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: "not-an-array" },
			errors: [],
		});
		const { MvdanShHelper } = await import("./runtime");
		const helper = new MvdanShHelper(fakeHelperLocator() as never);
		const r = await helper.invoke("pwd");
		expect(r).toBeNull();
	});

	it("rejects a stmt with an unknown kind", async () => {
		currentPayload = JSON.stringify({
			protocolVersion: 2,
			dialect: "bash",
			sourceSha256:
				"0000000000000000000000000000000000000000000000000000000000000000",
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [{ kind: "wtf", x: 1 }] },
			errors: [],
		});
		const { MvdanShHelper } = await import("./runtime");
		const helper = new MvdanShHelper(fakeHelperLocator() as never);
		const r = await helper.invoke("pwd");
		expect(r).toBeNull();
	});

	it("rejects a cmd with non-string args", async () => {
		currentPayload = JSON.stringify({
			protocolVersion: 2,
			dialect: "bash",
			sourceSha256:
				"0000000000000000000000000000000000000000000000000000000000000000",
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: {
				stmts: [
					{
						kind: "cmd",
						cmd: {
							name: "pwd",
							args: [123],
							assigns: [],
							redirects: [],
							isWrapper: false,
							wrapperOf: "",
							inner: "",
						},
					},
				],
			},
			errors: [],
		});
		const { MvdanShHelper } = await import("./runtime");
		const helper = new MvdanShHelper(fakeHelperLocator() as never);
		const r = await helper.invoke("pwd");
		expect(r).toBeNull();
	});

	it("rejects when non-zero exit code", async () => {
		currentPayload = "";
		currentExitCode = 1;
		const { MvdanShHelper } = await import("./runtime");
		const helper = new MvdanShHelper(fakeHelperLocator() as never);
		const r = await helper.invoke("pwd");
		expect(r).toBeNull();
	});

	it("rejects when digest does not match joined source", async () => {
		const wrongDigest =
			"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
		currentPayload = JSON.stringify({
			protocolVersion: 2,
			dialect: "bash",
			sourceSha256: wrongDigest,
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [] },
			errors: [],
		});
		const { MvdanShHelper } = await import("./runtime");
		const helper = new MvdanShHelper(fakeHelperLocator() as never);
		const r = await helper.invoke("pwd");
		expect(r).toBeNull();
	});

	it("rejects when protocolVersion is not the current value", async () => {
		currentPayload = JSON.stringify({
			protocolVersion: 1,
			dialect: "bash",
			sourceSha256:
				"0000000000000000000000000000000000000000000000000000000000000000",
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [] },
			errors: [],
		});
		const { MvdanShHelper } = await import("./runtime");
		const helper = new MvdanShHelper(fakeHelperLocator() as never);
		const r = await helper.invoke("pwd");
		expect(r).toBeNull();
	});

	it("admits a structurally valid response and returns ParsedShell", async () => {
		const { createHash } = await import("node:crypto");
		const { joinRunCommandsForParse } = await import(
			"../structured-command-risk"
		);
		const { joined } = joinRunCommandsForParse("pwd");
		const digest = createHash("sha256").update(joined).digest("hex");
		currentPayload = JSON.stringify({
			protocolVersion: 2,
			dialect: "bash",
			sourceSha256: digest,
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: {
				stmts: [
					{
						kind: "cmd",
						cmd: {
							name: "pwd",
							args: [],
							assigns: [],
							redirects: [],
							isWrapper: false,
							wrapperOf: "",
							inner: "",
						},
					},
				],
			},
			errors: [],
		});
		const { MvdanShHelper } = await import("./runtime");
		const helper = new MvdanShHelper(fakeHelperLocator() as never);
		const r = await helper.invoke("pwd");
		expect(r).not.toBeNull();
		expect(r!.protocolVersion).toBe(2);
		expect(r!.dialect).toBe("bash");
		expect(r!.sourceSha256).toBe(digest);
		expect(r!.parseStatus).toBe("complete");
	});
});
