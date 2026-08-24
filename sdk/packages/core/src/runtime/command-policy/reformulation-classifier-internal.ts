/**
 * Internal exports for the reformulation classifier.
 *
 * ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01
 *
 * The PUBLIC `@cline/core` index does NOT re-export this module.
 * Only trusted host adapters (VSCode today; CLI in the future) import
 * from here. The public `@cline/core` package surface does NOT include
 * `isReformulatable` or any reformulation symbol, so external callers
 * — model, MCP, webview, proto, remote — cannot trigger the
 * reformulation short-circuit and cannot observe the bounded prose.
 *
 * The reformulation classifier is host-composition machinery: it
 * short-circuits the ASK fall-through in the host's command-policy
 * coordinator under a narrow, source-level eligible-input class
 * (an unquoted shell pathname-expansion metacharacter in a reviewed
 * `find` pattern predicate position). It MUST NOT be reachable from
 * any payload the model, an MCP server, the webview, the proto
 * boundary, or a remote CLI caller can construct.
 *
 * PROVENANCE INVARIANT (load-bearing for safety):
 *
 *   raw toolInput (host-owned)
 *     ↓
 *   trusted host adapter (VSCode)
 *     ↓
 *   SdkInteractionCoordinator.runRequestToolApproval
 *     ↓
 *   isReformulatable(decision, toolInput, hostAuthorization)
 *
 *   NO path exists from:
 *     - model payload
 *     - MCP tool result
 *     - webview postMessage
 *     - gRPC / proto field
 *     - remote CLI caller
 *     to invoke the reformulation branch. The function is reachable
 *     only via the in-process trusted-host composition layer.
 *
 * Reachability rule (testing): the vitest harness in `apps/vscode`
 * aliases `@cline/core/internal/reformulation-classifier` to the
 * live TypeScript source so unit + production-seam tests can
 * exercise it. Non-host consumers cannot resolve the alias.
 */

/**
 * Re-export ONLY the three symbols the host composition layer needs.
 * The implementation file is private to the SDK; this entrypoint is
 * the narrow public surface that the package's `exports` map exposes
 * under `@cline/core/internal/reformulation-classifier`.
 */
export {
	isReformulatable,
	REFORMULATION_MODEL_FACING_MESSAGE,
	REFORMULATION_REASON_CODE,
} from "./reformulation-classifier";