import { describe, expect, it } from "vitest";
import { RecoveryTracker } from "./tracker";
import {
	createAttemptIdentity,
	createFamilyIdentity,
	type ToolAttemptIdentity,
	type ToolFamilyIdentity,
} from "./fingerprint";
import type { ToolFailureFingerprint } from "./fingerprint";
import type { RecoveryStateChangeEvent } from "@cline/shared";

const SENTINEL_PATH = "/tmp/sentinel-secret-path/file-42";
const SENTINEL_COMMAND = `cat ${SENTINEL_PATH}`;
// Deliberately distinctive sentinel. The privacy test asserts this
// value never leaks into telemetry, snapshot, or event surfaces.
// Lowercase + spaces keeps gitleaks off the entropy rule.
const SENTINEL_TOKEN = "sentinel-canary-secret-value";

function secretInput(): Record<string, string> {
	return { command: SENTINEL_COMMAND, token: SENTINEL_TOKEN };
}

function attempt(): ToolAttemptIdentity {
	return createAttemptIdentity("run_commands", secretInput());
}

function family(): ToolFamilyIdentity {
	return createFamilyIdentity("run_commands", "tool_execution_error", "ENOENT");
}

function fp(iter: number): ToolFailureFingerprint {
	return {
		toolName: "run_commands",
		failureClass: "tool_execution_error",
		failureFamily: "placeholder",
		failureFingerprint: "placeholder",
		stableCode: "ENOENT",
		iteration: iter,
		toolCallId: `call_${iter}`,
	};
}

function assertNoSecretLeak(value: unknown, where: string): void {
	const asString = typeof value === "string" ? value : JSON.stringify(value);
	expect(asString, `${where} must not contain the sentinel path`).not.toContain(SENTINEL_PATH);
	expect(asString, `${where} must not contain the sentinel command`).not.toContain(SENTINEL_COMMAND);
	expect(asString, `${where} must not contain the sentinel token`).not.toContain(SENTINEL_TOKEN);
}

describe("recovery / privacy / two-track identity (production-shaped proof)", () => {
	it("drive warning → interception → circuit_open; assert all telemetry surfaces are secret-free", () => {
		const tracker = new RecoveryTracker({ maxRepairAttempts: 2, warningThreshold: 2 });
		const events: RecoveryStateChangeEvent[] = [];
		tracker.onStateChange((e) => events.push(e));

		const a = attempt();
		const f = family();

		const r1 = tracker.recordFailureIdentity(f, a, fp(1));
		expect(r1.newState).toBe("recovering");

		const r2 = tracker.recordFailureIdentity(f, a, fp(2));
		expect(r2.newState).toBe("recovering");

		// 3rd failure: budget exhausted → state = warning.
		const r3 = tracker.recordFailureIdentity(f, a, fp(3));
		expect(r3.newState).toBe("warning");
		expect(tracker.snapshot().blockedExactKeys).toEqual([]);

		expect(tracker.isExactBlockedIdentity(a)).toBe(true);

		// Production runtime wiring:
		//   1. markExactBlockedIdentity → records the blocked attempt in
		//      the episode's `blockedExactKeys` Set (this is what the
		//      snapshot reads).
		//   2. recordBlockedAttemptIdentity → transitions the family
		//      to `circuit_open` and emits the state-change event.
		tracker.markExactBlockedIdentity(a);
		const block = tracker.recordBlockedAttemptIdentity(a);
		expect(block.newState).toBe("circuit_open");
		expect(tracker.snapshot().state).toBe("circuit_open");

		const snap = tracker.snapshot();

		expect(snap.blockedFamilies.length).toBeGreaterThan(0);
		expect(snap.blockedExactKeys.length).toBeGreaterThan(0);
		expect(snap.currentFailureFamily).toBeDefined();

		assertNoSecretLeak(snap.currentFailureFamily, "RecoverySnapshot.currentFailureFamily");
		assertNoSecretLeak(snap.blockedFamilies, "RecoverySnapshot.blockedFamilies");
		for (const k of snap.blockedExactKeys) {
			assertNoSecretLeak(k, "RecoverySnapshot.blockedExactKeys");
		}

		expect(snap.currentFailureFamily).toMatch(/^[0-9a-f]{8}$/);
		for (const fam of snap.blockedFamilies) {
			expect(fam).toMatch(/^[0-9a-f]{8}$/);
		}
		for (const k of snap.blockedExactKeys) {
			expect(k).toMatch(/^[0-9a-f]{8}$/);
		}

		expect(events.length).toBeGreaterThan(0);
		for (const ev of events) {
			assertNoSecretLeak(ev.failureFamily, "RecoveryStateChangeEvent.failureFamily");
			if (ev.failureFamily !== undefined) {
				expect(ev.failureFamily).toMatch(/^[0-9a-f]{8}$/);
			}
		}

		const block2 = tracker.recordBlockedAttemptIdentity(a);
		assertNoSecretLeak(block2.family, "recordBlockedAttemptIdentity result.family");
	});
});

describe("recovery / privacy / two-track identity (correctness invariant)", () => {
	it("same canonical input → same controlKey → same diagnosticId", () => {
		const a1 = createAttemptIdentity("run_commands", { command: "ls" });
		const a2 = createAttemptIdentity("run_commands", { command: "ls" });
		expect(a1.diagnosticId).toBe(a2.diagnosticId);
		expect(a1.controlKey).toBe(a2.controlKey);
	});

	it("different canonical inputs → different control keys → different diagnostic ids", () => {
		const a1 = createAttemptIdentity("run_commands", { command: "ls /tmp" });
		const a2 = createAttemptIdentity("run_commands", { command: "ls /var" });
		expect(a1.controlKey).not.toBe(a2.controlKey);
		expect(a1.diagnosticId).not.toBe(a2.diagnosticId);
	});

	it("family identity is canonical-form-strict", () => {
		const f1 = createFamilyIdentity("run_commands", "tool_execution_error", "ENOENT");
		const f2 = createFamilyIdentity("run_commands", "tool_execution_error", "EACCES");
		expect(f1.controlFamily).not.toBe(f2.controlFamily);
		expect(f1.diagnosticFamily).not.toBe(f2.diagnosticFamily);
	});

	it("control key contains the canonical tool input verbatim; diagnostic id does not", () => {
		const a = createAttemptIdentity("run_commands", secretInput());
		expect(a.controlKey).toContain(SENTINEL_PATH);
		expect(a.controlKey).toContain(SENTINEL_TOKEN);
		expect(a.diagnosticId).not.toContain(SENTINEL_PATH);
		expect(a.diagnosticId).not.toContain(SENTINEL_TOKEN);
		expect(a.diagnosticId).toMatch(/^[0-9a-f]{8}$/);
	});
});
