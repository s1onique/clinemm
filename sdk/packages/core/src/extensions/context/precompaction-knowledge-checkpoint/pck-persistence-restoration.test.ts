/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
 *
 * G6.5 — the PERSISTED RESTORATION control.
 *
 * ============================================================================
 * WHAT IS EXERCISED
 * ============================================================================
 *
 * The REAL session-compaction persistence builder
 * (`createSessionCompactionState`) and the REAL projection
 * (`projectSessionCompactionState`) are exercised over a compacted message
 * list that carries an accepted checkpoint section.
 *
 * The ACT distinguishes EXERCISING A PERSISTENCE BUILDER from OBSERVING A
 * REAL DISK WRITE. This test exercises the builder and inspects its output;
 * it does NOT claim that an on-disk write was observed.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
} from "../../../session/models/session-compaction";
import { applyCheckpointToCompactedMessages } from "./projection";
import { gateClosedProposals } from "./publication-gate";

const VALID_TOOL_CALL_ID = "tool_call_r4";

function canonicalHistory(): MessageWithMetadata[] {
	return [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_call",
			content: [
				{
					type: "tool_use",
					id: VALID_TOOL_CALL_ID,
					name: "run_commands",
					input: { command: "deploy.sh build" },
				},
			],
		} as unknown as MessageWithMetadata,
	];
}

function compactedMessages(): MessageWithMetadata[] {
	return [
		{
			role: "user",
			id: "msg_summary",
			content: [
				{ type: "text", text: "Context summary:\n\n## Goal\nInspect." },
			],
			metadata: { kind: "compaction_summary", summary: "## Goal\nInspect." },
		} as unknown as MessageWithMetadata,
	];
}

describe("ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01 — persistence restoration", () => {
	it("G6.5: the checkpoint SURVIVES the persistence builder and the restoration", () => {
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_INVOKED",
					argument: "build",
					evidenceRefs: [VALID_TOOL_CALL_ID],
				},
			],
			evidence: {
				canonicalReferences: [VALID_TOOL_CALL_ID],
				maximumAssuranceFor: () => "tool_observed",
			},
			sourcePrefixKey: "prefix-1",
		});
		expect(gate.records.length).toBe(1);
		const projected = applyCheckpointToCompactedMessages(
			compactedMessages(),
			gate.records.map((record) => ({
				id: record.id,
				kind: record.kind,
				assurance: record.assurance,
				status: record.status,
				statement: record.statement,
				qualifications: record.qualifications,
				evidenceRefs: record.evidenceRefs,
			})),
		);
		expect(projected.applied).toBe(true);

		// The REAL persistence builder.
		const state = createSessionCompactionState({
			sourceMessages: canonicalHistory(),
			compactedMessages: projected.messages,
			conversationId: "conv-1",
		});
		const persisted = JSON.stringify(state);
		// The checkpoint remains in the summary.
		expect(persisted).toContain("Working knowledge checkpoint");
		// EXACTLY ONE section. The sidecar stores the summary in BOTH the
		// message CONTENT and the message METADATA, so the string appears
		// twice for the SAME single section. The section COUNT is measured
		// on the section markers, which are the section's own structure.
		expect(
			(persisted.match(/cline-knowledge-checkpoint:begin/g) ?? []).length,
		).toBe(2);
		// The SUMMARY TEXT itself carries exactly ONE section.
		const summaryText = (
			projected.messages.find(
				(message) =>
					(message.metadata as { kind?: string } | undefined)?.kind ===
					"compaction_summary",
			) as { metadata?: { summary?: string } } | undefined
		)?.metadata?.summary;
		expect(summaryText).toBeDefined();
		expect(
			(summaryText?.match(/Working knowledge checkpoint/g) ?? []).length,
		).toBe(1);
		// The record PROVENANCE labels are retained.
		expect(persisted).toContain("pck-0");
		expect(persisted).toContain("kind=observation");
		expect(persisted).toContain("assurance=tool_observed");
		expect(persisted).toContain("status=active");
		expect(persisted).toContain("operation invoked: build");

		// The REAL restoration projection.
		const restored = projectSessionCompactionState(state, canonicalHistory());
		expect(restored).toBeDefined();
		const restoredText = JSON.stringify(restored);
		expect(restoredText).toContain("Working knowledge checkpoint");
		expect(
			(restoredText.match(/Working knowledge checkpoint/g) ?? []).length,
		).toBe(2);
		expect(restoredText).toContain("pck-0");
		// No NEW model call is needed to restore it: the section is part of
		// the persisted message content.
		expect(restoredText).toContain("operation invoked: build");
	});

	it("G6.5b: NO cross-session data is introduced by the restoration", () => {
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_INVOKED",
					evidenceRefs: [VALID_TOOL_CALL_ID],
				},
			],
			evidence: {
				canonicalReferences: [VALID_TOOL_CALL_ID],
				maximumAssuranceFor: () => "tool_observed",
			},
			sourcePrefixKey: "prefix-1",
		});
		const projected = applyCheckpointToCompactedMessages(
			compactedMessages(),
			gate.records.map((record) => ({
				id: record.id,
				kind: record.kind,
				assurance: record.assurance,
				status: record.status,
				statement: record.statement,
				qualifications: record.qualifications,
				evidenceRefs: record.evidenceRefs,
			})),
		);
		const state = createSessionCompactionState({
			sourceMessages: canonicalHistory(),
			compactedMessages: projected.messages,
			conversationId: "conv-1",
		});
		const restored = projectSessionCompactionState(state, canonicalHistory());
		const restoredText = JSON.stringify(restored);
		expect(restoredText).not.toContain("tool_call_from_another_session");
		expect(restoredText).not.toContain("conversation-2");
	});

	it("G6.5c: a session WITHOUT a checkpoint restores WITHOUT one", () => {
		const state = createSessionCompactionState({
			sourceMessages: canonicalHistory(),
			compactedMessages: compactedMessages(),
			conversationId: "conv-1",
		});
		const restored = projectSessionCompactionState(state, canonicalHistory());
		const restoredText = JSON.stringify(restored);
		expect(restoredText).not.toContain("Working knowledge checkpoint");
	});
});
