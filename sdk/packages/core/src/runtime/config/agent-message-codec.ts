import type {
	AgentMessage,
	AgentMessagePart,
	AgentTextPart,
	ContentBlock,
	FileContent,
	ImageContent,
	MediaContent,
	Message,
	MessageWithMetadata,
	RedactedThinkingContent,
	TextContent,
	ThinkingContent,
	ToolResultAcquisition,
	ToolResultContent,
	ToolUseContent,
} from "@cline/shared";
import {
	EMPTY_CONTENT_TEXT,
	toPersistedToolResultContent,
	toProviderVisibleMessages,
} from "@cline/shared";

export function messageToAgentMessages(
	message: MessageWithMetadata,
): AgentMessage[] {
	// Display-only history must never enter agent state or model requests.
	if (message.metadata?.displayOnly === true) return [];
	const blocks = normalizeContentBlocks(message.content);
	const out: AgentMessage[] = [];
	const baseId = message.id ?? generateMessageId();
	let nonToolSegmentCount = 0;
	let nonToolBlocks: Exclude<ContentBlock, ToolResultContent>[] = [];
	const storedUserRunSpan =
		message.role === "user" &&
		typeof message.metadata?.userRunSpan === "number" &&
		Number.isInteger(message.metadata.userRunSpan) &&
		message.metadata.userRunSpan >= 0
			? message.metadata.userRunSpan
			: undefined;
	let userRunSpanAssigned = false;
	const segmentMetadata = (
		representsUserContent: boolean,
	): MessageWithMetadata["metadata"] => {
		if (storedUserRunSpan === undefined) {
			return message.metadata;
		}
		if (representsUserContent && !userRunSpanAssigned) {
			userRunSpanAssigned = true;
			return message.metadata;
		}
		return { ...message.metadata, userRunSpan: 0 };
	};

	const flushNonToolBlocks = () => {
		if (nonToolBlocks.length === 0) {
			return;
		}
		const id =
			nonToolSegmentCount === 0
				? baseId
				: `${baseId}_part_${nonToolSegmentCount}`;
		nonToolSegmentCount += 1;
		out.push({
			id,
			role: message.role,
			content: nonToolBlocks.map(contentBlockToAgentPart),
			createdAt: message.ts ?? Date.now(),
			metadata: segmentMetadata(true),
			modelInfo: message.modelInfo,
			metrics: metricsToAgentMetrics(message.metrics),
		});
		nonToolBlocks = [];
	};

	if (blocks.length === 0) {
		out.push({
			id: baseId,
			role: message.role,
			content: [{ type: "text", text: EMPTY_CONTENT_TEXT }],
			createdAt: message.ts ?? Date.now(),
			metadata: message.metadata,
			modelInfo: message.modelInfo,
			metrics: metricsToAgentMetrics(message.metrics),
		});
		return out;
	}

	// A message that is already a single tool result needs no id
	// disambiguation — the suffix only distinguishes the parts of a split
	// message. Keeping the id verbatim makes restore/persist round-trips
	// byte-stable; ids feed the compaction source-prefix hash, and a
	// re-suffixed id silently invalidates saved compaction state (and grows
	// without bound across restores).
	const isPureToolResult =
		blocks.length === 1 && blocks[0].type === "tool_result";

	for (const block of blocks) {
		if (block.type !== "tool_result") {
			nonToolBlocks.push(block);
			continue;
		}
		flushNonToolBlocks();
		const toolIdSuffix = `_tool_${block.tool_use_id}`;
		out.push({
			id:
				isPureToolResult || baseId.endsWith(toolIdSuffix)
					? baseId
					: `${baseId}${toolIdSuffix}`,
			role: "tool",
			content: [toolResultContentToAgentPart(block)],
			createdAt: message.ts ?? Date.now(),
			metadata: segmentMetadata(false),
		});
	}
	flushNonToolBlocks();

	return out;
}

export function messagesToAgentMessages(
	messages: readonly MessageWithMetadata[],
): AgentMessage[] {
	return messages.flatMap(messageToAgentMessages);
}

export function agentMessageToMessageWithMetadata(
	message: AgentMessage,
): MessageWithMetadata {
	const content = message.content
		.map(agentPartToContentBlock)
		.filter((block): block is ContentBlock => block !== undefined);
	return {
		id: message.id,
		role: message.role === "tool" ? "user" : message.role,
		content,
		ts: message.createdAt,
		metadata: message.metadata,
		modelInfo: message.modelInfo,
		metrics: agentMetricsToMetrics(message.metrics),
	};
}

export function agentMessagesToMessagesWithMetadata(
	messages: readonly AgentMessage[],
): MessageWithMetadata[] {
	return messages.map(agentMessageToMessageWithMetadata);
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * Attach the acquisition-time provenance records to the tool results of an
 * agent-message list.
 *
 * The records are captured at the tool boundary and applied here, at the
 * CONVERSION boundary, because that is where the agent's messages become the
 * canonical history that is persisted. A record attached to the persisted
 * tool-result block is part of the DURABLE canonical history, so a session
 * recreated from that file restores the evidence provenance without any
 * in-memory handover.
 *
 * A tool result with no captured record is left untouched: an absent record
 * is `UNBOUND` downstream, which is the fail-closed direction.
 */
export function attachAcquisitionsToAgentMessages(
	messages: readonly AgentMessage[],
	acquisitions: ReadonlyMap<string, ToolResultAcquisition>,
): AgentMessage[] {
	if (acquisitions.size === 0) {
		return [...messages];
	}
	let changed = false;
	const next = messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		let messageChanged = false;
		const parts = message.content.map((part) => {
			if (part.type !== "tool-result") {
				return part;
			}
			const acquisition = acquisitions.get(part.toolCallId);
			if (!acquisition) {
				return part;
			}
			messageChanged = true;
			return { ...part, acquisition };
		});
		if (!messageChanged) {
			return message;
		}
		changed = true;
		return { ...message, content: parts };
	});
	return changed ? next : [...messages];
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * The PERSISTED shape of an acquisition record.
 *
 * The runtime's internal `AcquisitionEvidence` carries a `SourceRevision`
 * object and a `Map`; neither survives a JSON round-trip in the shape the
 * restoration expects. The PERSISTED shape is therefore FLAT — plain
 * strings and a plain object — so the record that is written to disk is
 * exactly the record that is read back.
 */
export function toPersistedAcquisition(
	acquisition: ToolResultAcquisition,
): ToolResultAcquisition {
	return {
		sourcePaths: [...acquisition.sourcePaths],
		contentIdentities: { ...acquisition.contentIdentities },
		repositoryIdentity: acquisition.repositoryIdentity,
		workspaceRootIdentity: acquisition.workspaceRootIdentity,
		revision: acquisition.revision,
		clean: acquisition.clean === true,
	};
}

export function agentMessagesToMessages(
	messages: readonly AgentMessage[],
): Message[] {
	// ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: the canonical
	// provider-visible projection now lives in `@cline/shared`
	// (`toProviderVisibleMessages`) so that the request-budget authority
	// and the provider codec measure/emit the SAME representation. A
	// divergent copy here would reintroduce exactly the authority-mismatch
	// defect this repair exists to fix.
	return toProviderVisibleMessages(messages);
}

function normalizeContentBlocks(content: Message["content"]): ContentBlock[] {
	if (typeof content === "string") {
		return content.trim().length > 0
			? [{ type: "text", text: content } as TextContent]
			: [];
	}
	return [...content];
}

function contentBlockToAgentPart(block: ContentBlock): AgentMessagePart {
	switch (block.type) {
		case "text":
			return { type: "text", text: block.text };
		case "thinking":
			return {
				type: "reasoning",
				text: block.thinking,
				metadata: block.signature
					? { signature: block.signature, details: block.details }
					: block.details
						? { details: block.details }
						: undefined,
			};
		case "redacted_thinking":
			return {
				type: "reasoning",
				text: "",
				redacted: true,
				metadata: { data: block.data },
			};
		case "image":
			return { type: "image", image: block.data, mediaType: block.mediaType };
		case "media":
			return { type: "media", media: block.media };
		case "file":
			return { type: "file", path: block.path, content: block.content };
		case "tool_use":
			return {
				type: "tool-call",
				toolCallId: block.id,
				toolName: block.name,
				input: block.input,
				metadata: block.signature
					? {
							signature: block.signature,
						}
					: undefined,
			};
		case "tool_result":
			return toolResultContentToAgentPart(block);
	}
}

function toolResultContentToAgentPart(
	block: ToolResultContent,
): AgentMessagePart {
	return {
		type: "tool-result",
		toolCallId: block.tool_use_id,
		toolName: block.name,
		output: block.content,
		isError: block.is_error,
		// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
		// the acquisition-time record rides WITH the result, so it survives
		// the round-trip that persists the canonical history.
		...(block.acquisition ? { acquisition: block.acquisition } : {}),
		// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION03:
		// the trusted ORIGIN of the evidence-handle trailer rides WITH the
		// result too, so the classifier can still tell the runtime's own
		// annotation from a forged line in untrusted output.
		...(block.evidenceHandle ? { evidenceHandle: block.evidenceHandle } : {}),
	};
}

function agentPartToContentBlock(
	part: AgentMessagePart,
): ContentBlock | undefined {
	switch (part.type) {
		case "text":
			return { type: "text", text: (part as AgentTextPart).text };
		case "reasoning": {
			if (part.redacted === true) {
				const data =
					(part.metadata as { data?: string } | undefined)?.data ?? "";
				return {
					type: "redacted_thinking",
					data,
				} satisfies RedactedThinkingContent;
			}
			const metadata = part.metadata as
				| { signature?: string; details?: unknown[] }
				| undefined;
			return {
				type: "thinking",
				thinking: part.text,
				signature: metadata?.signature,
				details: metadata?.details,
			} satisfies ThinkingContent;
		}
		case "image":
			return typeof part.image === "string"
				? ({
						type: "image",
						data: part.image,
						mediaType: part.mediaType ?? "image/png",
					} satisfies ImageContent)
				: undefined;
		case "file":
			return {
				type: "file",
				path: part.path,
				content: part.content,
			} satisfies FileContent;
		case "media":
			return {
				type: "media",
				media: part.media,
			} satisfies MediaContent;
		case "tool-call": {
			const metadata = part.metadata as
				| {
						signature?: string;
						thoughtSignature?: string;
				  }
				| undefined;
			return {
				type: "tool_use",
				id: part.toolCallId,
				name: part.toolName,
				input: (part.input as Record<string, unknown>) ?? {},
				signature: metadata?.thoughtSignature ?? metadata?.signature,
			} satisfies ToolUseContent;
		}
		case "tool-result": {
			return {
				type: "tool_result",
				tool_use_id: part.toolCallId,
				name: part.toolName,
				content: toPersistedToolResultContent(part.output),
				is_error: part.isError,
				// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
				// the acquisition-time record is PERSISTED onto the canonical
				// tool-result block, which is the durable authority a
				// recreated session restores the evidence provenance from.
				//
				// It is written in the FLAT persisted shape, so the record that
				// goes to disk is exactly the record that comes back.
				...(part.acquisition
					? { acquisition: toPersistedAcquisition(part.acquisition) }
					: {}),
				// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION03:
				// the trusted ORIGIN of the evidence-handle trailer is
				// PERSISTED onto the canonical tool-result block, so the
				// origin survives the persistence boundary and a restored
				// session still recognises the runtime's own annotation
				// (and only that one) as a trailer.
				...(part.evidenceHandle ? { evidenceHandle: part.evidenceHandle } : {}),
			} satisfies ToolResultContent;
		}
	}
}

function metricsToAgentMetrics(
	metrics: MessageWithMetadata["metrics"],
): AgentMessage["metrics"] {
	if (!metrics) return undefined;
	return {
		inputTokens: metrics.inputTokens ?? 0,
		outputTokens: metrics.outputTokens ?? 0,
		cacheReadTokens: metrics.cacheReadTokens ?? 0,
		cacheWriteTokens: metrics.cacheWriteTokens ?? 0,
		cost: metrics.cost,
	};
}

function agentMetricsToMetrics(
	metrics: AgentMessage["metrics"],
): MessageWithMetadata["metrics"] {
	if (!metrics) return undefined;
	return {
		inputTokens: metrics.inputTokens,
		outputTokens: metrics.outputTokens,
		cacheReadTokens: metrics.cacheReadTokens,
		cacheWriteTokens: metrics.cacheWriteTokens,
		cost: metrics.cost,
	};
}

let msgSeq = 0;
function generateMessageId(): string {
	msgSeq += 1;
	return `msg_${Date.now().toString(36)}_${msgSeq.toString(36)}`;
}
