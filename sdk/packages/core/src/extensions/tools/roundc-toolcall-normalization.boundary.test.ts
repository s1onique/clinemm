/**
 * ACT-CLINEMM-ROUND-C-HARNESS-02 — Phase 1 D4: the object-entry
 * normalization boundary.
 *
 * ## The defect
 *
 * `canonicalizeObjectCommandEntries` checked the shape of each MEMBER of
 * the `commands` list — exactly one key, `command` — but it never
 * checked the TOP-LEVEL object's keys.
 *
 * So a payload like:
 *
 *   { "commands": [{ "command": "ls" }], "timeout": 500 }
 *
 * was canonicalized to `{ "commands": ["ls"] }`. The `timeout` sibling
 * was SILENTLY DROPPED, and the payload was ACCEPTED.
 *
 * That is two problems at once:
 *
 *  1. The accepted schema was BROADENED: a payload the strict schema
 *     rejects (`additionalProperties: false`) was accepted, and a field
 *     the caller supplied was lost.
 *  2. The loss is invisible: nothing reports that `timeout` was
 *     discarded, so the model and the operator cannot tell that the
 *     command's timeout was not what they asked for.
 *
 * The ACT requires the payload to be REJECTED UNCHANGED, without
 * broadening the accepted schema.
 *
 * The sibling check must not affect the eight previously repaired Round C
 * payloads, whose top-level object has exactly one key.
 */

import { describe, expect, it } from "vitest";
import {
	canonicalizeObjectCommandEntries,
	normalizeRunCommandsToolInput,
} from "./helpers";

describe("D4 — object-entry normalization boundary", () => {
	it("rejects an object-entry payload with an unexpected top-level sibling", () => {
		// The defect: the sibling was accepted and silently dropped.
		expect(
			canonicalizeObjectCommandEntries({
				commands: [{ command: "ls" }],
				timeout: 500,
			}),
		).toBeNull();
	});

	it("leaves the payload UNCHANGED rather than rewriting it", () => {
		const input = {
			commands: [{ command: "ls" }],
			timeout: 500,
		};
		// The normalization path must return the input untouched, so the
		// strict schema produces its normal, authoritative rejection.
		expect(normalizeRunCommandsToolInput(input)).toEqual(input);
	});

	it("rejects every unexpected sibling key", () => {
		for (const sibling of [
			"timeout",
			"cwd",
			"notifyOnCompletion",
			"shell",
			"env",
			"description",
		]) {
			expect(
				canonicalizeObjectCommandEntries({
					commands: [{ command: "ls" }],
					[sibling]: "anything",
				}),
			).toBeNull();
		}
	});

	it("still accepts the canonical single-key object-entry payload", () => {
		expect(
			canonicalizeObjectCommandEntries({
				commands: [{ command: "ls" }, { command: "pwd" }],
			}),
		).toEqual(["ls", "pwd"]);
	});

	it("still rejects a member with an extra key", () => {
		// The existing member-level check must keep working.
		expect(
			canonicalizeObjectCommandEntries({
				commands: [{ command: "ls", args: ["-la"] }],
			}),
		).toBeNull();
	});

	it("still rejects a member that is not an object", () => {
		expect(canonicalizeObjectCommandEntries({ commands: ["ls"] })).toBeNull();
		expect(canonicalizeObjectCommandEntries({ commands: [null] })).toBeNull();
	});

	it("still rejects a non-string command", () => {
		expect(
			canonicalizeObjectCommandEntries({ commands: [{ command: 42 }] }),
		).toBeNull();
	});

	it("still rejects an empty command string", () => {
		expect(
			canonicalizeObjectCommandEntries({ commands: [{ command: "   " }] }),
		).toBeNull();
	});

	it("still rejects an empty list", () => {
		expect(canonicalizeObjectCommandEntries({ commands: [] })).toBeNull();
	});
});
