import { describe, expect, it } from "vitest";
import { fingerprintToolInput, fingerprintToolFailure, isSameFailureFamily, isSameExactFailure } from "./fingerprint";

describe("failure-fingerprint", () => {
	describe("fingerprintToolInput", () => {
		it("generates consistent fingerprints for same input", () => {
			const fp1 = fingerprintToolInput("run_commands", { command: "ls" });
			const fp2 = fingerprintToolInput("run_commands", { command: "ls" });
			expect(fp1.inputFingerprint).toBe(fp2.inputFingerprint);
		});

		it("produces different fingerprints for different inputs", () => {
			const fp1 = fingerprintToolInput("run_commands", { command: "ls" });
			const fp2 = fingerprintToolInput("run_commands", { command: "cat" });
			expect(fp1.inputFingerprint).not.toBe(fp2.inputFingerprint);
		});

		it("is deterministic regardless of object key order", () => {
			const fp1 = fingerprintToolInput("run_commands", { a: 1, b: 2 });
			const fp2 = fingerprintToolInput("run_commands", { b: 2, a: 1 });
			expect(fp1.inputFingerprint).toBe(fp2.inputFingerprint);
		});
	});

	describe("fingerprintToolFailure", () => {
		it("generates family based on tool + class + code", () => {
			const fp1 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 1, "call_1");
			const fp2 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 2, "call_2");
			expect(fp1.failureFamily).toBe(fp2.failureFamily);
		});

		it("produces different families for different codes", () => {
			const fp1 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 1, "call_1");
			const fp2 = fingerprintToolFailure("run_commands", "tool_execution_error", "EACCES", 1, "call_2");
			expect(fp1.failureFamily).not.toBe(fp2.failureFamily);
		});

		it("exact fingerprint includes input", () => {
			const fp1 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 1, "call_1", { command: "ls" });
			const fp2 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 2, "call_2", { command: "cat" });
			expect(fp1.failureFingerprint).not.toBe(fp2.failureFingerprint);
		});
	});

	describe("isSameFailureFamily", () => {
		it("returns true for same family", () => {
			const fp1 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 1, "call_1");
			const fp2 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 2, "call_2");
			expect(isSameFailureFamily(fp1, fp2)).toBe(true);
		});

		it("returns false for different families", () => {
			const fp1 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 1, "call_1");
			const fp2 = fingerprintToolFailure("read_files", "tool_execution_error", "ENOENT", 1, "call_2");
			expect(isSameFailureFamily(fp1, fp2)).toBe(false);
		});
	});

	describe("isSameExactFailure", () => {
		it("returns true for exact same failure", () => {
			const fp1 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 1, "call_1", { command: "ls" });
			const fp2 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 2, "call_2", { command: "ls" });
			expect(isSameExactFailure(fp1, fp2)).toBe(true);
		});

		it("returns false for same family but different input", () => {
			const fp1 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 1, "call_1", { command: "ls" });
			const fp2 = fingerprintToolFailure("run_commands", "tool_execution_error", "ENOENT", 2, "call_2", { command: "cat" });
			expect(isSameExactFailure(fp1, fp2)).toBe(false);
		});
	});
});
import { attemptDiagnosticId, familyDiagnosticId, createAttemptIdentity, createFamilyIdentity } from "./fingerprint";

describe("fingerprint / cross-helper consistency", () => {
	it("attemptDiagnosticId matches createAttemptIdentity().diagnosticId", () => {
		const a = createAttemptIdentity("run_commands", { command: "ls" });
		expect(attemptDiagnosticId("run_commands", { command: "ls" })).toBe(a.diagnosticId);
	});
	it("familyDiagnosticId matches createFamilyIdentity().diagnosticFamily", () => {
		const f = createFamilyIdentity("run_commands", "tool_execution_error", "ENOENT");
		expect(familyDiagnosticId("run_commands", "tool_execution_error", "ENOENT")).toBe(f.diagnosticFamily);
	});
	it("encoding uses \\0 separator (not ::)", () => {
		// Regression pin: the historical `attemptDiagnosticId` used `::`
		// while `createAttemptIdentity` used `\0`. The two paths must
		// produce the same diagnostic ID for the same canonical input.
		const a = createAttemptIdentity("tool", { v: 1 });
		const legacy = attemptDiagnosticId("tool", { v: 1 });
		expect(a.diagnosticId).toBe(legacy);
	});
});
