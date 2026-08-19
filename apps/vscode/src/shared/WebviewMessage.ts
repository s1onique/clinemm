export interface WebviewMessage {
	type: "grpc_request" | "grpc_request_cancel" | "clinemm.appendPostTerminalAuthorityDiagnostic"
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
