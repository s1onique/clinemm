export interface WebviewMessage {
	type:
		| "grpc_request"
		| "grpc_request_cancel"
		| "clinemm.appendPostTerminalAuthorityDiagnostic"
		| "clinemm.appendLiveContextDimensions01"
	grpc_request?: GrpcRequest
	grpc_request_cancel?: GrpcCancel
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01:
	 * The webview flushes its post-terminal-authority-diagnostic ring buffer
	 * to the extension via this message type. The records are typed as
	 * `unknown` to avoid pulling the diagnostic types into the gRPC layer;
	 * the receiving handler validates the shape before persisting.
	 */
	clinemm_postTerminalAuthorityDiagnosticRecords?: readonly unknown[]
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP01:
	 * The webview flushes its LCD01 per-boundary request-site capture
	 * ring buffer to the extension via this message type. Same typing
	 * discipline as the PTAD append: unknown at the wire boundary;
	 * structural validator at the receiving handler.
	 */
	clinemm_liveContextDimensions01Records?: readonly unknown[]
}

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP01:
 * The extension-side message that triggers the webview to flush its
 * LCD01 ring buffer back via `clinemm.appendLiveContextDimensions01`.
 * Mirrors the existing `clinemm.dumpPostTerminalAuthorityDiagnostic`
 * pattern. Used by the `cline.debug.dumpLiveContextDimensions01`
 * command.
 */
export type ExtensionToWebviewLiveContextDimensions01DumpTrigger = {
	type: "clinemm.dumpLiveContextDimensions01"
}

export type GrpcRequest = {
	service: string
	method: string
	message: any // JSON serialized protobuf message
	request_id: string // For correlating requests and responses
	is_streaming: boolean // Whether this is a streaming request
}

export type GrpcCancel = {
	request_id: string // ID of the request to cancel
}

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type ClineCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"

export type TaskFeedbackType = "thumbs_up" | "thumbs_down"
