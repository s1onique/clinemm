/**
 * ACT-CLINEMM-FLINT-TOOLCALL-RED-01-CORRECTION01 — WITNESS VERIFIER
 *
 * The CORRECTION01 report claims that the seven live-rejected `run_commands`
 * calls are replayed **VERBATIM** from the live transcript
 * `1794593797996_r48lj.messages.json`. That claim was FALSE: two of the
 * fixtures had been re-transcribed (not copied) and drifted from the real
 * payloads — the `find` command lost four `-not -path` clauses and its
 * `| sort | head -300` tail, and the accepted JSON-array payload lost its
 * `| head -150` tail.
 *
 * A prose claim of "VERBATIM" is not evidence. This test makes the claim
 * **machine-checkable**: it reads the LIVE transcript from disk and asserts
 * byte-equality between every fixture constant and the corresponding live
 * `tool_use.input` payload.
 *
 * ## Why this is a test and not a script
 *
 * The transcript is a local artifact of a live session. It is NOT committed
 * (it lives in the user's VSCodium profile and contains absolute paths from
 * the original machine). If the transcript is absent, this test SKIPS rather
 * than fails: the committed regression suite must stay green on any machine,
 * including CI, where the transcript does not exist.
 *
 * When the transcript IS present — which is the case on the machine that
 * produced the live evidence — the test is a hard gate. A drifted fixture
 * fails with a byte-level diff naming the message index, the expected live
 * payload and the actual fixture.
 *
 * ## Locating the transcript
 *
 * Resolution order (first hit wins):
 *   1. `CLINE_FLINT_WITNESS_TRANSCRIPT` — explicit path override.
 *   2. `~/.vscodium-<profile>/cline-data/sessions/1794593797996_r48lj/`
 *      — the VSCodium profile(s) on the machine that ran the live session.
 *
 * This mirrors how the evidence was originally obtained (the session ran in a
 * VSCodium profile), and keeps the committed suite portable.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	LIVE_ACCEPTED_COMMAND_JSON_ARRAY,
	LIVE_REJECTED_COMMAND_KEYED,
	LIVE_REJECTED_COMMANDS_KEYED,
} from "./flint-toolcall-red01-witness-fixtures";

const SESSION_ID = "1794593797996_r48lj";

interface TranscriptToolUse {
	name?: string;
	input?: Record<string, unknown>;
}

interface TranscriptMessage {
	content?: unknown;
}

interface Transcript {
	messages?: TranscriptMessage[];
}

/**
 * Resolve the live transcript, or `undefined` when it is not present on
 * this machine.
 */
function resolveTranscript(): string | undefined {
	const override = process.env.CLINE_FLINT_WITNESS_TRANSCRIPT;
	if (override && existsSync(override)) {
		return override;
	}
	const home = homedir();
	let entries: string[];
	try {
		entries = readdirSync(home);
	} catch {
		return undefined;
	}
	for (const entry of entries) {
		if (!entry.startsWith(".vscodium")) {
			continue;
		}
		const candidate = join(
			home,
			entry,
			"cline-data",
			"sessions",
			SESSION_ID,
			`${SESSION_ID}.messages.json`,
		);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function loadTranscript(path: string): Transcript {
	return JSON.parse(readFileSync(path, "utf8")) as Transcript;
}

/**
 * Every `run_commands` tool call in the transcript, in message order.
 */
function runCommandsCalls(transcript: Transcript): Array<{
	messageIndex: number;
	callIndex: number;
	input: Record<string, unknown>;
}> {
	const calls: Array<{
		messageIndex: number;
		callIndex: number;
		input: Record<string, unknown>;
	}> = [];
	const messages = transcript.messages ?? [];
	messages.forEach((message, messageIndex) => {
		const content = message.content;
		if (!Array.isArray(content)) {
			return;
		}
		content.forEach((block, callIndex) => {
			if (
				typeof block !== "object" ||
				block === null ||
				(block as { type?: unknown }).type !== "tool_use"
			) {
				return;
			}
			const candidate = block as TranscriptToolUse;
			if (candidate.name !== "run_commands") {
				return;
			}
			calls.push({
				messageIndex,
				callIndex,
				input: candidate.input ?? {},
			});
		});
	});
	return calls;
}

/**
 * The message indices of the seven calls the live transcript records as
 * REJECTED, together with the argument key each one used.
 *
 * Derived from the transcript's own `tool_result` blocks: a rejected call
 * has a tool result whose text contains `Invalid input for tool
 * run_commands`. The expected indices below are asserted against the
 * transcript so that a re-captured transcript cannot silently change the
 * witness set.
 */
const EXPECTED_REJECTED: ReadonlyArray<{
	messageIndex: number;
	callIndex: number;
	key: "command" | "commands";
}> = [
	{ messageIndex: 2, callIndex: 2, key: "command" },
	{ messageIndex: 5, callIndex: 2, key: "commands" },
	{ messageIndex: 8, callIndex: 1, key: "commands" },
	{ messageIndex: 11, callIndex: 1, key: "commands" },
	{ messageIndex: 14, callIndex: 1, key: "commands" },
	{ messageIndex: 18, callIndex: 1, key: "commands" },
	{ messageIndex: 21, callIndex: 2, key: "command" },
];

/**
 * The accepted JSON-array payload (the predecessor's repaired shape).
 */
const EXPECTED_ACCEPTED_JSON_ARRAY = {
	messageIndex: 35,
	callIndex: 1,
	key: "command" as const,
};

const transcriptPath = resolveTranscript();

describe.skipIf(!transcriptPath)(
	"ACT-CLINEMM-FLINT-TOOLCALL-RED-01-CORRECTION01 — live witness fidelity",
	() => {
		// The transcript is loaded LAZILY, inside the test bodies. The
		// `describe.skipIf` guard skips the test bodies when the transcript
		// is absent, but the describe callback itself still runs at
		// collection time — reading the file there would throw on a
		// machine (or CI runner) that has no live transcript.
		function payloadAt(
			messageIndex: number,
			callIndex: number,
		): Record<string, unknown> {
			const calls = runCommandsCalls(loadTranscript(transcriptPath as string));
			const match = calls.find(
				(c) => c.messageIndex === messageIndex && c.callIndex === callIndex,
			);
			if (!match) {
				throw new Error(
					`No run_commands call at message ${messageIndex} block ${callIndex}`,
				);
			}
			return match.input;
		}

		it("THE_TRANSCRIPT_PRESENTS_THE_EXPECTED_CALL_LAYOUT", () => {
			// Guards the witness set itself: if the transcript is re-captured
			// with a different call layout, the expected indices must be
			// updated deliberately rather than by accident.
			const calls = runCommandsCalls(loadTranscript(transcriptPath as string));
			expect(calls.length).toBeGreaterThanOrEqual(12);
			for (const expected of EXPECTED_REJECTED) {
				const payload = payloadAt(expected.messageIndex, expected.callIndex);
				expect(Object.keys(payload)).toEqual([expected.key]);
				expect(typeof payload[expected.key]).toBe("string");
			}
		});

		it("THE_REJECTED_CALLS_KEYED_BY_COMMANDS_MATCH_THE_LIVE_PAYLOADS_BYTE_FOR_BYTE", () => {
			// This is the assertion that the CORRECTION01 fixture drifted
			// from. Each fixture is compared against the LIVE payload; any
			// difference in whitespace, quoting, path filters or pipeline
			// tails fails here.
			const commandsKeyed = EXPECTED_REJECTED.filter(
				(e) => e.key === "commands",
			);
			expect(commandsKeyed).toHaveLength(5);

			expect(LIVE_REJECTED_COMMANDS_KEYED).toHaveLength(5);

			commandsKeyed.forEach((expected, index) => {
				const live = payloadAt(
					expected.messageIndex,
					expected.callIndex,
				).commands;
				const actual = LIVE_REJECTED_COMMANDS_KEYED[index]?.commands;
				expect(typeof actual, `fixture ${index} must be a string`).toBe(
					"string",
				);
				expect(
					actual,
					`fixture ${index} (live msgIdx ${expected.messageIndex}) must equal the live payload byte for byte`,
				).toBe(live);
			});
		});

		it("THE_REJECTED_CALLS_KEYED_BY_COMMAND_MATCH_THE_LIVE_PAYLOADS_BYTE_FOR_BYTE", () => {
			const commandKeyed = EXPECTED_REJECTED.filter((e) => e.key === "command");
			expect(commandKeyed).toHaveLength(2);

			expect(LIVE_REJECTED_COMMAND_KEYED).toHaveLength(2);

			commandKeyed.forEach((expected, index) => {
				const live = payloadAt(
					expected.messageIndex,
					expected.callIndex,
				).command;
				const actual = LIVE_REJECTED_COMMAND_KEYED[index]?.command;
				expect(typeof actual, `fixture ${index} must be a string`).toBe(
					"string",
				);
				expect(
					actual,
					`fixture ${index} (live msgIdx ${expected.messageIndex}) must equal the live payload byte for byte`,
				).toBe(live);
			});
		});

		it("THE_ACCEPTED_JSON_ARRAY_PAYLOAD_MATCHES_THE_LIVE_PAYLOAD_BYTE_FOR_BYTE", () => {
			const live = payloadAt(
				EXPECTED_ACCEPTED_JSON_ARRAY.messageIndex,
				EXPECTED_ACCEPTED_JSON_ARRAY.callIndex,
			).command;
			expect(
				LIVE_ACCEPTED_COMMAND_JSON_ARRAY.command,
				`live msgIdx ${EXPECTED_ACCEPTED_JSON_ARRAY.messageIndex} must equal the live payload byte for byte`,
			).toBe(live);
		});
	},
);
