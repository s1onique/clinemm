/**
 * Internal exports for the command-risk classifier.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
 *
 * The PUBLIC `@cline/core` index does NOT re-export this module.
 * Only trusted host adapters (CLI, VSCode) import from here. This
 * narrows the attack surface: external callers — model, MCP, webview,
 * proto, remote — can ONLY use the public `evaluateCommandRisk(input)`
 * shape, which has no `parserResult` field and is V1-only by
 * construction. There is no type-level path for an untrusted caller
 * to inject a fake safe AST.
 *
 * Trusted host adapters that opt in to V2 parser-assisted classification
 * import the internal `evaluateCommandRiskWithParser(...)` here, which
 * accepts an OPTIONAL `parserResult` of type `ParsedShell`. The
 * `parserResult` MUST be constructed by the host-owned
 * `MvdanShHelper` capability (or equivalent trusted parser); never
 * accepted from any model/MCP/webview/proto payload.
 *
 * PROVENANCE INVARIANT (load-bearing for safety):
 *
 *   raw toolInput (host-owned)
 *     ↓
 *   trusted host adapter (CLI / VSCode)
 *     ↓
 *   MvdanShHelper.invoke(toolInput)   ← only trusted host can call this
 *     ↓
 *   locally launched pinned helper binary
 *     ↓
 *   host constructs ParsedShell
 *     ↓
 *   evaluateCommandRiskWithParser({ toolInput, hostAuthorization, parserResult })
 *
 *   NO path exists from:
 *     - model payload
 *     - MCP tool result
 *     - webview postMessage
 *     - gRPC / proto field
 *     - remote CLI caller
 *   to a `ParsedShell` consumed by `evaluateCommandRiskWithParser`.
 *   `ParsedShell` is a HOST-OWNED CAPABILITY, not a data type.
 */

export {
	type EvaluateCommandRiskInternalInput,
	evaluateCommandRiskWithParser,
} from "./command-risk";
export {
	evaluateStructuredCommandRisk,
	joinRunCommandsForParse,
	type ParsedShell,
	type ShellDialect,
	STRUCTURED_PROTO_VERSION,
	type StructuredAnalysis,
	type StructuredCmd,
	type StructuredProgram,
	type StructuredRisk,
	type StructuredStmt,
	type StructuredStmtRisk,
	sha256Hex,
} from "./structured-command-risk";
