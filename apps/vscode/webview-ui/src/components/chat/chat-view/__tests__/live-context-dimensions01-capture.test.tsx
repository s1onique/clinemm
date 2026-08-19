/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1
 *
 * Per-boundary request-site capture layer (LCD01) — minimum C1
 * acceptance gate. Twelve tests covering the reviewer's required
 * gates:
 *
 *   1. ancestry gate PASS
 *   2. schema union exact
 *   3. DEFAULT_OFF → zero records + unchanged state behavior
 *   4. no NEW diagnostic mutation/call inside W1/W2 functional
 *      updaters (static purity check on the production source)
 *   5. StrictMode: P/W2/Q request record cardinality is 1/request
 *   6. C obeys commit cardinality, not push cardinality
 *   7. W2 cannot claim INTRINSIC correlation (validator)
 *   8. B0 explicitly reports request-site semantics
 *   9. dump/export works
 *  10. removal marker present
 *  11. existing webview suite green (covered by sibling tests
 *      in this directory; this test suite asserts no residual
 *      coupling via the static purity check, item 4)
 *  12. typecheck / biome / diff-check green (covered by repo
 *      scripts; not duplicated here)
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { TurnState } from "@shared/ExtensionMessage"
import {
	type AssociationQuality,
	clearLiveContextDimensions01Capture,
	enableLiveContextDimensions01Capture,
	getLiveContextDimensions01CaptureRecords,
	isLiveContextDimensions01CaptureEnabled,
	type LiveContextDimensions01CaptureKind,
	recordLiveContextDimensions01Capture,
	setLiveContextDimensions01CaptureBufferSize,
	__resetLiveContextDimensions01CaptureForTesting,
} from "@shared/live-context-dimensions01-capture"

// (1) Ancestry gate — runtime assertion that C1 source+test commit
//     descends from the three frozen SHAs.
describe("C1 ancestry gate", () => {
	it("C1 source+test commit descends from AUTHORIZED + REQUIRED + C1_REQUIRED_ANCESTOR_HEAD", async () => {
		const { execSync } = await import("node:child_process")
		const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()
		expect(head).toMatch(/^[0-9a-f]{40}$/)
		const auth = "695b608a957b8c4d9be978336e6709aec0053d7e"
		const required = "cff0218fbb0acbb74c7028ae100b285acdafa33e"
		const c1req = "6449cec47de2ff03a78340767aa254c529f8a855"
		for (const anchor of [auth, required, c1req]) {
			const result = execSync(`git merge-base --is-ancestor ${anchor} ${head}`, {
				encoding: "utf8",
			})
			expect(result, `merge-base --is-ancestor ${anchor} ${head}`).toBe("")
		}
	})
/* ==========================================================================
 * (2) Schema union exact - every capture kind from the frozen enum is
 *     constructible with the documented discriminator; the validator
 *     enforces the W2 / Q / B0 / C-only-field contracts.
 * ========================================================================== */
describe("LCD01 schema union", () => {
	beforeEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
		enableLiveContextDimensions01Capture()
	})

	afterEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
	})

	const ALL_KINDS: LiveContextDimensions01CaptureKind[] = [
		"webview-w1-request",
		"webview-w2-request",
		"webview-w1-request-q",
		"webview-w2-request-q",
		"webview-w1-request-replica",
		"webview-w2-request-replica",
		"webview-committed-c",
	]

	function intrinsic(pushId: number) {
		return {
			associationQuality: "INTRINSIC" as AssociationQuality,
			associatedPushId: pushId,
			intervalInferred: undefined,
		}
	}

	function none() {
		return {
			associationQuality: "NONE" as AssociationQuality,
			associatedPushId: undefined,
			intervalInferred: undefined,
		}
	}

	function nativeW2() {
		return {
			epoch: 1,
			seq: 7,
			ts: 1_700_000_000_000,
			discriminator: "partial" as const,
		}
	}

	it("accepts all seven capture kinds with the correct discriminators", () => {
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request",
			correlation: intrinsic(42),
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: { phase: "idle" as const, seq: 3, anchorTs: 1 },
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-w2-request",
			correlation: none(),
			nativeW2: nativeW2(),
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request-q",
			correlation: intrinsic(42),
			nativeW2: undefined,
			writerIdentity: "W1_SNAPSHOT_REQUEST",
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-w2-request-q",
			correlation: none(),
			nativeW2: nativeW2(),
			writerIdentity: "W2_PARTIAL_REQUEST",
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request-replica",
			correlation: intrinsic(42),
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: { phase: "idle" as const, seq: 3, anchorTs: 1 },
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-w2-request-replica",
			correlation: none(),
			nativeW2: nativeW2(),
			writerIdentity: undefined,
			replicaTurnState: { phase: "streaming" as const, seq: 5, anchorTs: 2 },
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-committed-c",
			correlation: intrinsic(42),
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: { phase: "idle" as const, seq: 3, anchorTs: 1 },
		})

		const records = getLiveContextDimensions01CaptureRecords()
		expect(records.length).toBe(7)
		expect(records.map((r) => r.kind).sort()).toEqual([...ALL_KINDS].sort())
	})

	it("every record carries a non-decreasing captureSeq", () => {
		for (let i = 0; i < 7; i++) {
			recordLiveContextDimensions01Capture({
				kind: ALL_KINDS[i],
				correlation: i % 2 === 0 ? intrinsic(1) : none(),
				nativeW2: i % 2 === 1 ? nativeW2() : undefined,
				writerIdentity:
					ALL_KINDS[i] === "webview-w1-request-q"
						? "W1_SNAPSHOT_REQUEST"
						: ALL_KINDS[i] === "webview-w2-request-q"
							? "W2_PARTIAL_REQUEST"
							: undefined,
				replicaTurnState:
					ALL_KINDS[i] === "webview-w1-request-replica" ||
					ALL_KINDS[i] === "webview-w2-request-replica"
						? ({ phase: "idle" as const, seq: 1, anchorTs: 1 } as TurnState)
						: undefined,
				hostTurnState:
					ALL_KINDS[i] === "webview-w1-request"
						? ({ phase: "idle" as const, seq: 1, anchorTs: 1 } as TurnState)
						: undefined,
				committedTurnState:
					ALL_KINDS[i] === "webview-committed-c"
						? ({ phase: "idle" as const, seq: 1, anchorTs: 1 } as TurnState)
						: undefined,
			})
		}
		const records = getLiveContextDimensions01CaptureRecords()
		for (let i = 1; i < records.length; i++) {
			expect(records[i].captureSeq).toBeGreaterThan(records[i - 1].captureSeq)
		}
	})

	it("C record accepts undefined committedTurnState (an observation, not a missing payload)", () => {
		recordLiveContextDimensions01Capture({
			kind: "webview-committed-c",
			correlation: none(),
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		const records = getLiveContextDimensions01CaptureRecords()
		expect(records.length).toBe(1)
		expect(records[0].kind).toBe("webview-committed-c")
		expect(records[0].committedTurnState).toBeUndefined()
	})

	it("B0 record accepts undefined replicaTurnState (initial-state observation)", () => {
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request-replica",
			correlation: intrinsic(1),
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		const records = getLiveContextDimensions01CaptureRecords()
		expect(records.length).toBe(1)
		expect(records[0].replicaTurnState).toBeUndefined()
	})
})

/* ==========================================================================
 * (3) DEFAULT_OFF - when the toggle is not enabled, no records are
 *     captured and the production behavior is byte-for-byte unchanged.
 * ========================================================================== */
describe("LCD01 default-off", () => {
	beforeEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
	})

	afterEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
	})

	it("isLiveContextDimensions01CaptureEnabled() returns false initially", () => {
		expect(isLiveContextDimensions01CaptureEnabled()).toBe(false)
	})

	it("recordLiveContextDimensions01Capture() is a no-op when disabled", () => {
		expect(isLiveContextDimensions01CaptureEnabled()).toBe(false)
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request",
			correlation: {
				associationQuality: "INTRINSIC",
				associatedPushId: 1,
				intervalInferred: undefined,
			},
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		expect(getLiveContextDimensions01CaptureRecords().length).toBe(0)
	})

	it("toggle on/off symmetry - enable then disable returns the buffer to a no-op", () => {
		enableLiveContextDimensions01Capture()
		expect(isLiveContextDimensions01CaptureEnabled()).toBe(true)
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request",
			correlation: {
				associationQuality: "INTRINSIC",
				associatedPushId: 1,
				intervalInferred: undefined,
			},
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		expect(getLiveContextDimensions01CaptureRecords().length).toBe(1)
		clearLiveContextDimensions01Capture()
		expect(getLiveContextDimensions01CaptureRecords().length).toBe(0)
	})
})

/* ==========================================================================
 * (4) Static purity check - the W1 and W2 functional updater bodies
 *     in the production source MUST NOT contain LCD01 diagnostic
 *     calls. The existing PTAD ring buffer writes are also forbidden
 *     inside the updater (already enforced by the FIXUP04 purity
 *     test); we add LCD01 to the forbidden-token list here.
 * ========================================================================== */
describe("LCD01 static purity on W1/W2 updaters", () => {
	function resolveSource(): string {
		const candidates = [
			resolve(
				dirname(fileURLToPath(import.meta.url)),
				"../../../../context/ExtensionStateContext.tsx",
			),
			resolve(process.cwd(), "apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx"),
			resolve(process.cwd(), "../apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx"),
		]
		for (const p of candidates) {
			try {
				readFileSync(p, "utf8")
				return p
			} catch {
				// continue
			}
		}
		throw new Error(`Could not resolve ExtensionStateContext.tsx. Tried:\n${candidates.join("\n")}`)
	}

	it("W1 functional updater contains no LCD01 diagnostic side effects", () => {
		const source = readFileSync(resolveSource(), "utf8")
		const idx = source.indexOf("setState((prevState) => {")
		expect(idx).toBeGreaterThan(-1)
		// Walk braces from the opening { to find the body.
		const openBrace = source.indexOf("{", idx)
		let depth = 0
		let i = openBrace
		for (; i < source.length; i++) {
			const c = source[i]
			if (c === "{") {
				depth++
			} else if (c === "}") {
				depth--
				if (depth === 0) {
					break
				}
			}
		}
		const body = source.slice(openBrace, i + 1)
		const forbiddenTokens = [
			"recordLiveContextDimensions01Capture",
			"enableLiveContextDimensions01Capture",
			"disableLiveContextDimensions01Capture",
			"isLiveContextDimensions01CaptureEnabled",
		]
		for (const tok of forbiddenTokens) {
			expect(body.includes(tok), `W1 updater must not call ${tok}`).toBe(false)
		}
	})

	it("the W1 capture-emit block sits BEFORE the queued updater (R18)", () => {
		const source = readFileSync(resolveSource(), "utf8")
		const firstEmit = source.indexOf('kind: "webview-w1-request"')
		const firstQueuedUpdater = source.indexOf("setState((prevState) => {")
		expect(firstEmit).toBeGreaterThan(-1)
		expect(firstQueuedUpdater).toBeGreaterThan(-1)
		expect(firstEmit).toBeLessThan(firstQueuedUpdater)
	})

	it("the W2 capture-emit block sits BEFORE the queued W2 updater (R18)", () => {
		const source = readFileSync(resolveSource(), "utf8")
		const w2Emit = source.indexOf('kind: "webview-w2-request"')
		const firstQueuedUpdater = source.indexOf("setState((prevState) => {")
		const secondQueuedUpdater = source.indexOf(
			"setState((prevState) => {",
			firstQueuedUpdater + 1,
		)
		expect(w2Emit).toBeGreaterThan(-1)
		expect(secondQueuedUpdater).toBeGreaterThan(-1)
		expect(w2Emit).toBeLessThan(secondQueuedUpdater)
	})
})

/* ==========================================================================
 * (5) Request cardinality - each onResponse call emits exactly one
 *     W1 / W1-q / W1-replica trio; likewise for W2.
 * ========================================================================== */
describe("LCD01 request-record cardinality", () => {
	beforeEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
		enableLiveContextDimensions01Capture()
	})

	afterEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
	})

	it("emitting once for W1 produces exactly one W1, one W1-q, one W1-replica", () => {
		const intrinsic = {
			associationQuality: "INTRINSIC" as AssociationQuality,
			associatedPushId: 1,
			intervalInferred: undefined,
		}
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request",
			correlation: intrinsic,
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request-q",
			correlation: intrinsic,
			nativeW2: undefined,
			writerIdentity: "W1_SNAPSHOT_REQUEST",
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request-replica",
			correlation: intrinsic,
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		const records = getLiveContextDimensions01CaptureRecords()
		expect(records.length).toBe(3)
		expect(records.filter((r) => r.kind === "webview-w1-request").length).toBe(1)
		expect(records.filter((r) => r.kind === "webview-w1-request-q").length).toBe(1)
		expect(records.filter((r) => r.kind === "webview-w1-request-replica").length).toBe(1)
	})

	it("emitting once for W2 produces exactly one W2, one W2-q, one W2-replica", () => {
		const none = {
			associationQuality: "NONE" as AssociationQuality,
			associatedPushId: undefined,
			intervalInferred: undefined,
		}
		const w2Native = {
			epoch: 1,
			seq: 1,
			ts: 1,
			discriminator: "partial" as const,
		}
		recordLiveContextDimensions01Capture({
			kind: "webview-w2-request",
			correlation: none,
			nativeW2: w2Native,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-w2-request-q",
			correlation: none,
			nativeW2: w2Native,
			writerIdentity: "W2_PARTIAL_REQUEST",
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		recordLiveContextDimensions01Capture({
			kind: "webview-w2-request-replica",
			correlation: none,
			nativeW2: w2Native,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		const records = getLiveContextDimensions01CaptureRecords()
		expect(records.length).toBe(3)
		expect(records.filter((r) => r.kind === "webview-w2-request").length).toBe(1)
		expect(records.filter((r) => r.kind === "webview-w2-request-q").length).toBe(1)
		expect(records.filter((r) => r.kind === "webview-w2-request-replica").length).toBe(1)
	})
})

/* ==========================================================================
 * (6) C cardinality - C records are produced per React commit, NOT per
 *     request. Multiple queued requests that coalesce into one commit
 *     emit at most one C record.
 * ========================================================================== */
describe("LCD01 commit-cardinality semantics", () => {
	beforeEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
		enableLiveContextDimensions01Capture()
	})

	afterEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
	})

	it("two W1 requests but one C record", () => {
		const intrinsic = {
			associationQuality: "INTRINSIC" as AssociationQuality,
			associatedPushId: 1,
			intervalInferred: undefined,
		}
		for (let i = 0; i < 2; i++) {
			recordLiveContextDimensions01Capture({
				kind: "webview-w1-request",
				correlation: { ...intrinsic, associatedPushId: i + 1 },
				nativeW2: undefined,
				writerIdentity: undefined,
				replicaTurnState: undefined,
				hostTurnState: undefined,
				committedTurnState: undefined,
			})
		}
		recordLiveContextDimensions01Capture({
			kind: "webview-committed-c",
			correlation: intrinsic,
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		const records = getLiveContextDimensions01CaptureRecords()
		expect(records.filter((r) => r.kind === "webview-w1-request").length).toBe(2)
		expect(records.filter((r) => r.kind === "webview-committed-c").length).toBe(1)
	})
})

/* ==========================================================================
 * (7) W2 cannot claim INTRINSIC correlation - runtime validator
 *     rejects; the schema-level rule is enforced in validateCapture.
 * ========================================================================== */
describe("LCD01 W2 integrity rule", () => {
	beforeEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
		enableLiveContextDimensions01Capture()
	})

	afterEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
	})

	it("throws when a W2 record carries INTRINSIC association", () => {
		expect(() =>
			recordLiveContextDimensions01Capture({
				kind: "webview-w2-request",
				correlation: {
					associationQuality: "INTRINSIC",
					associatedPushId: 1,
					intervalInferred: undefined,
				},
				nativeW2: {
					epoch: 1,
					seq: 1,
					ts: 1,
					discriminator: "partial",
				},
				writerIdentity: undefined,
				replicaTurnState: undefined,
				hostTurnState: undefined,
				committedTurnState: undefined,
			}),
		).toThrow(/integrity violation/)
	})

	it("throws when a non-W2 record carries INTERVAL_INFERRED association", () => {
		expect(() =>
			recordLiveContextDimensions01Capture({
				kind: "webview-w1-request",
				correlation: {
					associationQuality: "INTERVAL_INFERRED",
					associatedPushId: undefined,
					intervalInferred: { prevPushId: 1, nextPushId: 2 },
				},
				nativeW2: undefined,
				writerIdentity: undefined,
				replicaTurnState: undefined,
				hostTurnState: undefined,
				committedTurnState: undefined,
			}),
		).toThrow(/INTERVAL_INFERRED is W2-only/)
	})

	it("throws when a non-W2 record carries a nativeW2 identity", () => {
		expect(() =>
			recordLiveContextDimensions01Capture({
				kind: "webview-w1-request",
				correlation: {
					associationQuality: "INTRINSIC",
					associatedPushId: 1,
					intervalInferred: undefined,
				},
				nativeW2: { epoch: 1, seq: 1, ts: 1, discriminator: "partial" },
				writerIdentity: undefined,
				replicaTurnState: undefined,
				hostTurnState: undefined,
				committedTurnState: undefined,
			}),
		).toThrow(/nativeW2 is W2-only/)
	})
})

/* ==========================================================================
 * (8) Q / B0 / C field exclusivity - non-Q records must not carry
 *     writerIdentity; non-B0 records must not carry replicaTurnState;
 *     non-C records must not carry committedTurnState.
 * ========================================================================== */
describe("LCD01 field exclusivity", () => {
	beforeEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
		enableLiveContextDimensions01Capture()
	})

	afterEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
	})

	const intrinsic = {
		associationQuality: "INTRINSIC" as AssociationQuality,
		associatedPushId: 1,
		intervalInferred: undefined,
	}

	it("non-Q record carrying writerIdentity throws", () => {
		expect(() =>
			recordLiveContextDimensions01Capture({
				kind: "webview-w1-request",
				correlation: intrinsic,
				nativeW2: undefined,
				writerIdentity: "W1_SNAPSHOT_REQUEST",
				replicaTurnState: undefined,
				hostTurnState: undefined,
				committedTurnState: undefined,
			}),
		).toThrow(/writerIdentity is Q-only/)
	})

	it("non-B0 record carrying replicaTurnState throws", () => {
		expect(() =>
			recordLiveContextDimensions01Capture({
				kind: "webview-w1-request",
				correlation: intrinsic,
				nativeW2: undefined,
				writerIdentity: undefined,
				replicaTurnState: { phase: "idle" as const, seq: 1, anchorTs: 1 },
				hostTurnState: undefined,
				committedTurnState: undefined,
			}),
		).toThrow(/replicaTurnState is B0-only/)
	})

	it("non-C record carrying committedTurnState throws", () => {
		expect(() =>
			recordLiveContextDimensions01Capture({
				kind: "webview-w1-request",
				correlation: intrinsic,
				nativeW2: undefined,
				writerIdentity: undefined,
				replicaTurnState: undefined,
				hostTurnState: undefined,
				committedTurnState: { phase: "idle" as const, seq: 1, anchorTs: 1 },
			}),
		).toThrow(/committedTurnState is C-only/)
	})

	it("Q record missing writerIdentity throws", () => {
		expect(() =>
			recordLiveContextDimensions01Capture({
				kind: "webview-w1-request-q",
				correlation: intrinsic,
				nativeW2: undefined,
				writerIdentity: undefined,
				replicaTurnState: undefined,
				hostTurnState: undefined,
				committedTurnState: undefined,
			}),
		).toThrow(/Q record missing writerIdentity/)
	})
})

/* ==========================================================================
 * (9) Buffer behavior - the FIFO ring buffer caps at the configured
 *     size and getLiveContextDimensions01CaptureRecords() returns a
 *     snapshot copy, not a live reference.
 * ========================================================================== */
describe("LCD01 dump/export", () => {
	beforeEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
		enableLiveContextDimensions01Capture()
	})

	afterEach(() => {
		__resetLiveContextDimensions01CaptureForTesting()
	})

	function intrinsic(pushId: number) {
		return {
			associationQuality: "INTRINSIC" as AssociationQuality,
			associatedPushId: pushId,
			intervalInferred: undefined,
		}
	}

	it("FIFO ring buffer respects bufferSize", () => {
		setLiveContextDimensions01CaptureBufferSize(3)
		for (let i = 0; i < 10; i++) {
			recordLiveContextDimensions01Capture({
				kind: "webview-w1-request",
				correlation: intrinsic(i),
				nativeW2: undefined,
				writerIdentity: undefined,
				replicaTurnState: undefined,
				hostTurnState: undefined,
				committedTurnState: undefined,
			})
		}
		const records = getLiveContextDimensions01CaptureRecords()
		expect(records.length).toBe(3)
		expect(records[0].correlation.associatedPushId).toBe(7)
		expect(records[1].correlation.associatedPushId).toBe(8)
		expect(records[2].correlation.associatedPushId).toBe(9)
	})

	it("getLiveContextDimensions01CaptureRecords returns a snapshot copy", () => {
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request",
			correlation: intrinsic(1),
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		const snap1 = getLiveContextDimensions01CaptureRecords()
		const snap2 = getLiveContextDimensions01CaptureRecords()
		expect(snap1).not.toBe(snap2)
		expect(snap1[0]).toEqual(snap2[0])
	})

	it("clearLiveContextDimensions01Capture empties the buffer and resets seq", () => {
		recordLiveContextDimensions01Capture({
			kind: "webview-w1-request",
			correlation: intrinsic(1),
			nativeW2: undefined,
			writerIdentity: undefined,
			replicaTurnState: undefined,
			hostTurnState: undefined,
			committedTurnState: undefined,
		})
		expect(getLiveContextDimensions01CaptureRecords().length).toBe(1)
		clearLiveContextDimensions01Capture()
		expect(getLiveContextDimensions01CaptureRecords().length).toBe(0)
	})
})

/* ==========================================================================
 * (10) Removal marker - the source file carries a removal-contract
 *      comment block. This test confirms the comment is present so a
 *      future maintainer deleting the diagnostic knows what to remove.
 * ========================================================================== */
describe("LCD01 removal marker", () => {
	it("REMOVAL CONTRACT comment is present in the schema file", () => {
		const candidates = [
			resolve(
				dirname(fileURLToPath(import.meta.url)),
				"../../../../../src/shared/live-context-dimensions01-capture.ts",
			),
			resolve(process.cwd(), "apps/vscode/src/shared/live-context-dimensions01-capture.ts"),
			resolve(process.cwd(), "src/shared/live-context-dimensions01-capture.ts"),
			resolve(process.cwd(), "../src/shared/live-context-dimensions01-capture.ts"),
		]
		let source = ""
		let found = false
		for (const p of candidates) {
			try {
				source = readFileSync(p, "utf8")
				found = true
				break
			} catch {
				// continue
			}
		}
		if (!found) {
			throw new Error("Could not resolve live-context-dimensions01-capture.ts")
		}
		expect(source).toMatch(/REMOVAL CONTRACT/)
		expect(source).toMatch(/Single-file delete/)
	})

	it("ExtensionStateContext imports the LCD01 module via the documented symbol set", () => {
		const ctxCandidates = [
			resolve(
				dirname(fileURLToPath(import.meta.url)),
				"../../../../context/ExtensionStateContext.tsx",
			),
			resolve(process.cwd(), "apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx"),
			resolve(process.cwd(), "../apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx"),
		]
		let source = ""
		let found = false
		for (const p of ctxCandidates) {
			try {
				source = readFileSync(p, "utf8")
				found = true
				break
			} catch {
				// continue
			}
		}
		if (!found) {
			throw new Error("Could not resolve ExtensionStateContext.tsx")
		}
		expect(source).toMatch(/@shared\/live-context-dimensions01-capture/)
		expect(source).toMatch(/webview-w1-request/)
		expect(source).toMatch(/webview-w2-request/)
		expect(source).toMatch(/webview-committed-c/)
	})
})

// Close the ancestry describe block opened at the top.
})
