/**
 * ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01
 *
 * Validation matrix (RPC-01..RPC-04) for `buildTestbedRunBody`.
 */

import { describe, expect, it } from "bun:test";
import {
	buildTestbedRunBody,
	TESTBED_RUN_BOUNDS,
} from "../src/launchd-backend.ts";

describe("buildTestbedRunBody — RPC-01 valid minimal testbed spec", () => {
	it("accepts a minimal valid spec", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [{ argv: ["echo", "hi"], failOnNonZero: true }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.runId.length).toBeGreaterThan(0);
		expect(r.value.vmName.startsWith("clinemm-testbed-")).toBe(true);
		expect(r.value.body.image).toMatch(/@sha256:[0-9a-f]{64}$/);
		expect(r.value.body.commands).toHaveLength(1);
	});
});

describe("buildTestbedRunBody — RPC-02 malformed spec rejected", () => {
	it("rejects missing image", () => {
		const r = buildTestbedRunBody({
			commands: [{ argv: ["echo", "hi"] }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/image/);
	});

	it("rejects empty commands array", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [],
		});
		expect(r.ok).toBe(false);
	});

	it("rejects argv containing NUL", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [{ argv: ["echo", "evil\x00rm"] }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/NUL or newline/);
	});

	it("rejects argv containing newline", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [{ argv: ["echo", "evil\nrm"] }],
		});
		expect(r.ok).toBe(false);
	});

	it("rejects image without sha256 digest", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base:latest",
			commands: [{ argv: ["echo", "hi"] }],
		});
		expect(r.ok).toBe(false);
	});

	it("rejects image too long", () => {
		const r = buildTestbedRunBody({
			image: "x".repeat(TESTBED_RUN_BOUNDS.imageMaxLen + 1),
			commands: [{ argv: ["echo", "hi"] }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/image/);
	});
});

describe("buildTestbedRunBody — RPC-03 unknown extra host-exec field rejected", () => {
	it("does NOT expose caller-side host-exec fields", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [{ argv: ["echo", "hi"] }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const body = r.value.body as unknown as Record<string, unknown>;
		expect(body["tart_executable"]).toBeUndefined();
		expect(body["tartExecutable"]).toBeUndefined();
		expect(body["tart_path"]).toBeUndefined();
		expect(body["host_command"]).toBeUndefined();
		expect(body["host_argv"]).toBeUndefined();
		expect(body["shell"]).toBeUndefined();
		expect(body["cwd"]).toBeUndefined();
		expect(body["env"]).toBeUndefined();
		expect(body["socket_path"]).toBeUndefined();
		expect(body["vm_path"]).toBeUndefined();
		expect(body["home_path"]).toBeUndefined();
		expect(body["cache_path"]).toBeUndefined();
		expect(body["registry_username"]).toBeUndefined();
		expect(body["registry_password"]).toBeUndefined();
		expect(body["token"]).toBeUndefined();
		expect(body["docker_config"]).toBeUndefined();
	});
});

describe("buildTestbedRunBody — RPC-04 unauthorized peer rejected", () => {
	it("does not accept peer identity claims in the spec", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [{ argv: ["echo", "hi"] }],
		} as Record<string, unknown>);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const body = r.value.body as unknown as Record<string, unknown>;
		expect(body["peer_uid"]).toBeUndefined();
		expect(body["peer_pid"]).toBeUndefined();
	});
});

describe("buildTestbedRunBody — RPC-05 invalid image reference rejected", () => {
	it("rejects non-string image", () => {
		const r = buildTestbedRunBody({
			image: 42,
			commands: [{ argv: ["echo", "hi"] }],
		});
		expect(r.ok).toBe(false);
	});

	it("rejects empty image", () => {
		const r = buildTestbedRunBody({
			image: "",
			commands: [{ argv: ["echo", "hi"] }],
		});
		expect(r.ok).toBe(false);
	});
});

describe("buildTestbedRunBody — RPC-06 invalid runId rejected", () => {
	it("rejects run id that sanitizes to empty", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			run_id: "___",
			commands: [{ argv: ["echo", "hi"] }],
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/sanitizes to empty/);
	});

	it("accepts run id with alnum + dashes and derives an owned VM name", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			run_id: "abc-def-1234",
			commands: [{ argv: ["echo", "hi"] }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.runId).toBe("abcdef1234");
		expect(r.value.vmName).toContain("abcdef1234");
	});
});

describe("buildTestbedRunBody — RPC-07 command count bound enforced", () => {
	it("rejects too many commands", () => {
		const commands = Array.from(
			{ length: TESTBED_RUN_BOUNDS.commandsMax + 1 },
			() => ({
				argv: ["echo", "hi"],
			}),
		);
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands,
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/commands count exceeds/);
	});

	it("accepts exactly the bound count", () => {
		const commands = Array.from(
			{ length: TESTBED_RUN_BOUNDS.commandsMax },
			() => ({
				argv: ["echo", "hi"],
			}),
		);
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands,
		});
		expect(r.ok).toBe(true);
	});
});

describe("buildTestbedRunBody — RPC-08 artifact count bound enforced", () => {
	it("rejects too many artifacts", () => {
		const artifacts = Array.from(
			{ length: TESTBED_RUN_BOUNDS.artifactsMax + 1 },
			() => ({
				guestPath: "/tmp/x",
				hostDestination: "/tmp/y",
				required: false,
			}),
		);
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [{ argv: ["echo", "hi"] }],
			artifacts,
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/artifacts count exceeds/);
	});

	it("accepts artifact paths within length bounds", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [{ argv: ["echo", "hi"] }],
			artifacts: [
				{
					guestPath: "/var/log/syslog",
					hostDestination: "/tmp/out/syslog",
					required: true,
				},
			],
		});
		expect(r.ok).toBe(true);
	});

	it("rejects artifact hostDestination with newline", () => {
		const r = buildTestbedRunBody({
			image: "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64),
			commands: [{ argv: ["echo", "hi"] }],
			artifacts: [
				{
					guestPath: "/x",
					hostDestination: "/tmp/../escape\npath",
					required: false,
				},
			],
		});
		expect(r.ok).toBe(false);
	});
});
