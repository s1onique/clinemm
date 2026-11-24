/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C2 — the SOURCE-PREFIX READER for the semantic oracle.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It prints a labelled, index-addressable view of an EXACT source prefix of a
 * REAL session, so that the semantic oracle can be built from the source
 * evidence and not from any candidate's output.
 *
 * The printed view is OPERATOR-LOCAL: the caller redirects it into the
 * GITIGNORED `tmp/` tree. It contains the session's own material, so it must
 * never be committed.
 *
 * ============================================================================
 * USAGE
 * ============================================================================
 *
 *   bun knowledge-loss-discriminator.dump-prefix.ts <sessionId> <boundary>
 *
 * `boundary` is the compaction decision's `source_message_count`: the number
 * of CANONICAL messages that the compaction consumed. Messages AFTER the
 * boundary are NOT printed, so a post-boundary discovery can never leak into
 * the oracle.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { canonicalSourceMessages } from "../src/session/models/session-compaction";

const sessionId = process.argv[2];
const boundary = Number(process.argv[3]);
if (!sessionId || !Number.isInteger(boundary) || boundary <= 0) {
	console.error(
		"usage: knowledge-loss-discriminator.dump-prefix.ts <sessionId> <boundary>",
	);
	process.exit(2);
}

const sessionsRoot =
	process.argv[4] ?? join(homedir(), ".vscodium-roz", "cline-data", "sessions");

const sessionDir = join(sessionsRoot, sessionId);
const persisted = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.messages.json`), "utf8"),
) as { messages: MessageWithMetadata[] };
const canonical = canonicalSourceMessages(persisted.messages);

if (boundary > canonical.length) {
	console.error(
		`the boundary ${boundary} exceeds the canonical message count ${canonical.length}`,
	);
	process.exit(2);
}

const prefix = canonical.slice(0, boundary);

for (const [index, message] of prefix.entries()) {
	const blocks = Array.isArray(message.content) ? message.content : [];
	for (const block of blocks) {
		if (block.type === "text") {
			console.log(
				`\n### [${index}] ${message.role} TEXT\n${(block as { text?: string }).text ?? ""}`,
			);
			continue;
		}
		if (block.type === "thinking") {
			// The private reasoning is EXCLUDED from the oracle source: the
			// production summarizer input excludes it too, so it can never be
			// provider-visible knowledge.
			console.log(`\n### [${index}] ${message.role} THINKING (excluded)`);
			continue;
		}
		if (block.type === "tool_use") {
			const input = (block as { input?: { commands?: unknown } }).input;
			const commands = input?.commands;
			const list = Array.isArray(commands)
				? commands
				: typeof commands === "string"
					? [commands]
					: [];
			console.log(
				`\n### [${index}] ${message.role} TOOL_USE ${(block as { name?: string }).name ?? ""}\nCOMMAND: ${list.map((c) => String(c)).join("\nCOMMAND: ")}`,
			);
			continue;
		}
		if (block.type === "tool_result") {
			const content = (block as { content?: unknown }).content;
			const list = Array.isArray(content) ? content : [];
			console.log(`\n### [${index}] ${message.role} TOOL_RESULT`);
			for (const entry of list) {
				if (!entry || typeof entry !== "object") {
					continue;
				}
				const payload = entry as {
					query?: string;
					result?: unknown;
					success?: unknown;
				};
				console.log(`  QUERY: ${payload.query ?? ""}`);
				console.log(`  SUCCESS: ${String(payload.success)}`);
				console.log(`  RESULT: ${String(payload.result ?? "")}`);
			}
		}
	}
}
