/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01
 *
 * PRODUCTION-SEAM SUITE for the acquisition-time evidence capture.
 *
 * WHAT THIS SUITE IS
 * ------------------
 *
 * The correction moved the acquisition-time provenance record from an
 * in-memory map to the CANONICAL HISTORY, because an in-memory map answers
 * "what did this evidence refer to?" only while the process lives. The
 * record now rides ON the canonical tool-result block, which is the DURABLE
 * authority a recreated session restores from.
 *
 * This suite drives the PRODUCTION seams:
 *
 *   captureAcquisitionEvidence (the capture)
 *     -> attachAcquisitionsToAgentMessages (the attachment)
 *     -> agentMessagesToMessagesWithMetadata (the persistence projection)
 *     -> buildAcquisitionEvidenceLedger (the restoration)
 *
 * and proves three things the reviewer required:
 *
 *   1. The capture reflects the EFFECTIVE, POST-HOOK result. An
 *      `afterTool` hook is a result-transforming hook, so a record derived
 *      from the pre-hook result would describe content that was never
 *      persisted.
 *   2. The record is DURABLE: it survives a persistence round-trip and is
 *      restored by a completely recreated reader with NO caller-supplied
 *      in-memory ledger and NO workspace re-read.
 *   3. A result that establishes no source identity produces NO record.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * Every finding, number, path and phrase in this file is SYNTHETIC.
 */

import type { AgentMessage, MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	agentMessagesToMessagesWithMetadata,
	attachAcquisitionsToAgentMessages,
} from "../config/agent-message-codec";
import {
	buildAcquisitionEvidenceLedger,
	captureAcquisitionEvidence,
	renderAcquisitionRecord,
	type SourceRevision,
} from "../../extensions/context/adjudication-continuity";

const SOURCE_PATH = "/synthetic/workspace/synthetic-pool-config.yaml";

const SYNTHETIC_REVISION: SourceRevision = {
	repositoryIdentity: "synthetic-repo",
	workspaceRootIdentity: "synthetic-root",
	revision: "9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd",
	contentIdentity:
		"3b1f0c9a7d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a",
	clean: true,
};

const RESOLVER = {
	resolve: ({ sourcePath }: { sourcePath: string }) =>
		sourcePath === SOURCE_PATH ? SYNTHETIC_REVISION : undefined,
};

const SOURCE_PAYLOAD = [
	{
		query: SOURCE_PATH,
		result: "maxWorkers: 36\ndocumentedBudget: 400",
		success: true,
	},
];

/**
 * An agent message carrying one tool result.
 */
function toolMessage(
	toolCallId: string,
	output: unknown,
): AgentMessage {
	return {
		id: "m1",
		role: "tool",
		createdAt: 1,
		content: [
			{
				type: "tool-result",
				toolCallId,
				toolName: "read_files",
				output,
			},
		],
	} as AgentMessage;
}

/**
 * The PRODUCTION conversion boundary, with the acquisition records
 * attached.
 *
 * The canonical history carries BOTH the tool call and its result, exactly
 * as the production transcript does: the ledger's call/result join is
 * fail-closed, so a result without its call establishes nothing.
 */
async function convertWithAcquisition(
	messages: readonly AgentMessage[],
	toolCallId: string,
	output: unknown,
): Promise<{
	canonical: MessageWithMetadata[];
	acquisitions: ReturnType<typeof buildAcquisitionEvidenceLedger>;
}> {
	const record = await captureAcquisitionEvidence({
		toolUseId: toolCallId,
		toolName: "read_files",
		content: output,
		resolver: RESOLVER,
	});
	// The PERSISTED record is FLAT: plain strings and a plain object, so it
	// is exactly what survives the persistence round-trip.
	const acquisitions = new Map(
		record
			? [[toolCallId, renderAcquisitionRecord(record)]]
			: ([] as [string, never][]),
	);
	const attached = attachAcquisitionsToAgentMessages(messages, acquisitions);
	const canonical = agentMessagesToMessagesWithMetadata(attached);
	// The tool CALL is part of the canonical history too.
	const withCall: MessageWithMetadata[] = [
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: toolCallId,
					name: "read_files",
					input: { path: SOURCE_PATH },
				},
			],
		},
		...canonical,
	];
	return {
		canonical: withCall,
		acquisitions: buildAcquisitionEvidenceLedger(withCall),
	};
}

describe("the acquisition-time capture is on the EFFECTIVE result", () => {
	it("records the result the host's afterTool hook PRODUCED", async () => {
		// The host's `afterTool` hook replaced the result. The EFFECTIVE
		// result is the replacement, so the acquisition record must describe
		// the replacement's content — not the pre-hook content.
		const preHookOutput = [
			{ query: SOURCE_PATH, result: "PRE-HOOK CONTENT", success: true },
		];
		const postHookOutput = [
			{ query: SOURCE_PATH, result: "POST-HOOK CONTENT", success: true },
		];
		const { canonical, acquisitions } = await convertWithAcquisition(
			[toolMessage("call_1", postHookOutput)],
			"call_1",
			postHookOutput,
		);
		expect(acquisitions.records.size).toBe(1);
		const record = acquisitions.records.get("call_1");
		expect(record?.sourcePaths).toEqual([SOURCE_PATH]);
		// The content identity is the hash of the EFFECTIVE content.
		const effective = await captureAcquisitionEvidence({
			toolUseId: "call_1",
			toolName: "read_files",
			content: postHookOutput,
			resolver: RESOLVER,
		});
		expect(record?.contentIdentities.get(SOURCE_PATH)).toBe(
			effective?.contentIdentities.get(SOURCE_PATH),
		);
		// The PRE-HOOK content is NOT what was pinned.
		const preHook = await captureAcquisitionEvidence({
			toolUseId: "call_1",
			toolName: "read_files",
			content: preHookOutput,
			resolver: RESOLVER,
		});
		expect(record?.contentIdentities.get(SOURCE_PATH)).not.toBe(
			preHook?.contentIdentities.get(SOURCE_PATH),
		);
		// And the record is PERSISTED onto the canonical block.
		expect(JSON.stringify(canonical)).toContain("acquisition");
	});
});

describe("the acquisition record is DURABLE", () => {
	it("survives a persistence round-trip and is restored by a fresh reader", async () => {
		const { canonical } = await convertWithAcquisition(
			[toolMessage("call_1", SOURCE_PAYLOAD)],
			"call_1",
			SOURCE_PAYLOAD,
		);
		// The PERSISTENCE ROUND TRIP: written to disk and read back.
		const persisted = JSON.parse(
			JSON.stringify(canonical),
		) as MessageWithMetadata[];

		// A COMPLETELY RECREATED READER: no in-memory ledger, no workspace
		// re-read. The record is restored from the persisted transcript.
		const restored = buildAcquisitionEvidenceLedger(persisted);
		expect(restored.records.size).toBe(1);
		const record = restored.records.get("call_1");
		expect(record?.sourcePaths).toEqual([SOURCE_PATH]);
		expect(record?.revision.revision).toBe(SYNTHETIC_REVISION.revision);
		expect(record?.revision.repositoryIdentity).toBe(
			SYNTHETIC_REVISION.repositoryIdentity,
		);
		expect(record?.contentIdentities.get(SOURCE_PATH)).toBeTruthy();
	});

	it("produces NO record for a result that establishes no source identity", async () => {
		const { canonical, acquisitions } = await convertWithAcquisition(
			[toolMessage("call_1", "plain text output")],
			"call_1",
			"plain text output",
		);
		expect(acquisitions.records.size).toBe(0);
		expect(JSON.stringify(canonical)).not.toContain("acquisition");
	});

	it("produces NO record for a NON-READ tool", async () => {
		const record = await captureAcquisitionEvidence({
			toolUseId: "call_1",
			toolName: "run_commands",
			content: [
				{ query: "cat config.yaml", result: "value=A", success: true },
			],
			resolver: RESOLVER,
		});
		expect(record).toBeUndefined();
	});
});
