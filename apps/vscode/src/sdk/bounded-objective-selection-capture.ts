/**
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01)
 *
 * The PRODUCTION delivery of the R2 bounded-objective SELECTION RESPONSE
 * capture.
 *
 * ## What this module is
 *
 * The changeset that introduced `boundedObjectiveSelectionTraceSink` added
 * the sink to the SDK and tested it by DIRECT INJECTION into
 * `AgentRuntime`. It added NO production host wiring, so the INSTALLED
 * extension could not actually supply and forward the sink: the live
 * selector's RESPONSE was never captured, and the historical rejection
 * cause could not be recovered.
 *
 * This module is the missing activation seam. It is the SMALLEST
 * connection that makes the EXISTING opt-in provider-request capture
 * infrastructure observe the selector's RESPONSE.
 *
 * ## What it REUSES (no new subsystem)
 *
 *   - The EXISTING provider-request capture (`CLINE_CAPTURE_PROVIDER_REQUEST`
 *     in `sdk/packages/llms/src/providers/provider-request-capture.ts`),
 *     which already captures the selector's REQUEST and names its file
 *     after the EXISTING `correlation.captureId` correlation key.
 *   - The EXISTING `captureId` correlation key: the runtime mints ONE id
 *     per selection inference, puts it in the selection request's
 *     transport metadata, and reports it in the observation. The captured
 *     REQUEST file and the captured RESPONSE therefore share ONE EXACT
 *     identity.
 *   - The EXISTING extension-owned writable storage root
 *     (`ExtensionContext.globalStorageUri`), the same convention the
 *     sibling diagnostics use.
 *
 * There is NO new capture registry, NO telemetry subsystem and NO public
 * wire protocol.
 *
 * ## Activation contract (frozen)
 *
 *   - OPERATOR-ACCESSIBLE OPT-IN: the capture is armed ONLY when the
 *     operator exports `CLINE_CAPTURE_SELECTION_RESPONSE=1` (or
 *     `=true`) in the extension-host process environment.
 *   - DEFAULT OFF: with the variable unset (or set to anything else) the
 *     sink is NOT installed at all. The disabled path has ZERO
 *     state-semantic delta: no sink is constructed, no directory is
 *     created, no file is written, and the runtime pays a single null
 *     check at the selection boundary.
 *   - The opt-in is an ENVIRONMENT opt-in rather than a persisted
 *     setting, for the same reason the R2 dogfood opt-in is: it is a
 *     per-invocation deliberate choice that a workspace file cannot
 *     enable by accident.
 *
 * ## Privacy (frozen)
 *
 * The captured RESPONSE contains:
 *
 *   - the selector request identity (`selectorRequestId`),
 *   - the run / agent / parent-task identity,
 *   - the model's OWN generated text (its reply to the selector request),
 *   - the parsed proposal,
 *   - the exact validation disposition and the failing field/reference.
 *
 * It NEVER contains provider-owned reasoning text, provider signatures,
 * credentials, or unrelated transcript contents. The model's own reply is
 * not provider-owned reasoning; it is the artifact the operator needs.
 *
 * The artifact is written with RESTRICTIVE permissions (0700 directory,
 * 0600 file) because the generated text is the model's own output for the
 * operator's task.
 *
 * ## Failure isolation (frozen)
 *
 * A capture failure CANNOT change the selection, the validation or the
 * parent continuation: every write is wrapped, and the sink never throws
 * and never rejects.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { BoundedObjectiveSelectionObservation, BoundedObjectiveSelectionTraceSink } from "@cline/shared"

/**
 * The OPERATOR opt-in for the R2 selection-RESPONSE capture.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01).
 *
 * The value must be exactly "1" or "true" (case-insensitive). Any other
 * value — including an empty string — leaves the capture OFF.
 */
export const SELECTION_RESPONSE_CAPTURE_ENV = "CLINE_CAPTURE_SELECTION_RESPONSE"

/**
 * The directory (under the operator-local capture root) that holds the
 * captured selection RESPONSES.
 *
 * It is a SIBLING of the existing `provider-request-captures/` directory,
 * so the operator finds the captured REQUEST and the captured RESPONSE in
 * ONE place — and the two are joined by the SAME selector-request id.
 */
export const SELECTION_RESPONSE_CAPTURE_DIR = "selection-response-captures"

/**
 * Resolve the OPERATOR-LOCAL capture root.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01).
 *
 * The resolution REUSES the EXISTING provider-request capture's root
 * rules verbatim (`sdk/packages/llms/src/providers/provider-request-capture.ts`
 * `resolveCaptureDir`):
 *
 *   1. `CLINE_CAPTURE_DIR` (explicit operator root) -> the root itself,
 *   2. `CLINE_DATA_DIR` -> the root itself,
 *   3. otherwise -> `undefined` (NO capture root, so NO capture).
 *
 * The response capture then writes into `<root>/selection-response-captures/`.
 * When neither variable is set the capture has NO root and therefore
 * writes NOTHING — the DEFAULT OFF path.
 */
export function resolveSelectionResponseCaptureRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const explicit = env.CLINE_CAPTURE_DIR?.trim()
	if (explicit) {
		return resolve(explicit)
	}
	const dataDir = env.CLINE_DATA_DIR?.trim()
	if (dataDir) {
		return resolve(dataDir)
	}
	return undefined
}

/**
 * Whether the operator has opted into the selection-RESPONSE capture.
 *
 * DEFAULT OFF: an unset (or non-`1`/`true`) variable leaves the capture
 * disabled.
 */
export function isSelectionResponseCaptureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env[SELECTION_RESPONSE_CAPTURE_ENV]
	return typeof raw === "string" && (raw.trim() === "1" || raw.trim().toLowerCase() === "true")
}

/**
 * The FILE-NAME-SAFE form of a selector request id.
 *
 * The captured REQUEST file is named after the EXACT `captureId` the
 * runtime minted (sanitised by the provider-request capture's own
 * `safeFilePart`). The captured RESPONSE uses the SAME sanitisation, so
 * the two artifacts are joined by the SAME id in both directions.
 */
function safeFilePart(value: unknown): string | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined
	const raw = String(value).trim()
	if (!raw) return undefined
	const safe = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")
	return safe || undefined
}

/**
 * The captured RESPONSE artifact for ONE selection boundary.
 *
 * It is a self-contained JSON document: the operator can read it without
 * any other tool, and it carries the EXACT correlation to the captured
 * REQUEST file.
 */
export interface BoundedObjectiveSelectionResponseCapture {
	/** The artifact schema version. */
	readonly kind: "bounded_objective_selection_response"
	readonly schemaVersion: 1
	/** When the response was observed. */
	readonly observedAt: string
	/**
	 * The EXACT identity of the selector request.
	 *
	 * It is the SAME id the captured provider-request file is named after,
	 * so the response joins to its request by EXACT IDENTITY.
	 */
	readonly selectorRequestId?: string
	readonly runId?: string
	readonly agentId?: string
	readonly parentTaskId: string
	readonly selectionOrdinal: number
	/** The model's OWN reply to the selector request. */
	readonly generatedText: string
	/** The parsed proposal, when the runtime could parse one. */
	readonly parsedProposal?: unknown
	/** The EXACT validation disposition. */
	readonly disposition: string
	/** The failing field, ONLY when the validator established one. */
	readonly failingField?: string
	/** The failing reference, when the validator established one. */
	readonly failingReference?: string
}

/**
 * Build the captured RESPONSE artifact from an observation.
 *
 * The observation is COPIED field by field: the capture never holds a
 * live reference to the runtime's own objects, so the observer cannot
 * mutate runtime-owned state through it.
 */
export function buildSelectionResponseCapture(
	observation: BoundedObjectiveSelectionObservation,
): BoundedObjectiveSelectionResponseCapture {
	return {
		kind: "bounded_objective_selection_response",
		schemaVersion: 1,
		observedAt: new Date().toISOString(),
		...(observation.selectorRequestId !== undefined ? { selectorRequestId: observation.selectorRequestId } : {}),
		...(observation.runId !== undefined ? { runId: observation.runId } : {}),
		...(observation.agentId !== undefined ? { agentId: observation.agentId } : {}),
		parentTaskId: observation.parentTaskId,
		selectionOrdinal: observation.selectionOrdinal,
		generatedText: observation.generatedText,
		...(observation.parsedProposal !== undefined ? { parsedProposal: observation.parsedProposal } : {}),
		disposition: observation.disposition,
		...(observation.failingField !== undefined ? { failingField: observation.failingField } : {}),
		...(observation.failingReference !== undefined ? { failingReference: observation.failingReference } : {}),
	}
}

/**
 * Write ONE captured response to the operator-local capture directory.
 *
 * The write is ATOMIC (temp file + rename), so a reader never observes a
 * half-written artifact, and RESTRICTIVE (0700 directory, 0600 file).
 *
 * It NEVER throws: a capture failure must not change the selection, the
 * validation or the parent continuation.
 */
export function writeSelectionResponseCapture(
	storageRoot: string,
	observation: BoundedObjectiveSelectionObservation,
): string | undefined {
	try {
		const dir = join(storageRoot, SELECTION_RESPONSE_CAPTURE_DIR)
		mkdirSync(dir, { recursive: true, mode: 0o700 })
		const id = safeFilePart(observation.selectorRequestId) ?? `selection-${observation.selectionOrdinal}`
		const finalPath = join(dir, `${id}.selection-response.json`)
		const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`
		const payload = buildSelectionResponseCapture(observation)
		writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		})
		renameSync(tempPath, finalPath)
		// The rename consumed the temp file; a defensive removal keeps a
		// stale temp file from accumulating when the rename raced.
		try {
			rmSync(tempPath, { force: true })
		} catch {
			// A leftover temp file is harmless.
		}
		return finalPath
	} catch {
		// Capture failure must never affect the selection, the validation or
		// the parent continuation.
		return undefined
	}
}

/**
 * The installed sink for the CURRENT session.
 *
 * It is installed at the SAME seam that installs the extension's existing
 * `modelBehaviorTraceSink`
 * (`VscodeSessionHost.prepareStartSessionInput`), which is the REAL SDK
 * runtime construction path.
 */
let installedSink: BoundedObjectiveSelectionTraceSink | undefined
let installedStorageRoot: string | undefined

/**
 * Install the selection-RESPONSE capture sink for the current session.
 *
 * Returns `undefined` when the capture is OFF (the default) or when there
 * is no operator-local capture root. In BOTH cases the caller installs
 * NOTHING and the runtime pays a single null check at the selection
 * boundary.
 *
 * Idempotent: installing twice for the same root is a no-op.
 */
export function installSelectionResponseCaptureSink(
	env: NodeJS.ProcessEnv = process.env,
): BoundedObjectiveSelectionTraceSink | undefined {
	if (!isSelectionResponseCaptureEnabled(env)) {
		return undefined
	}
	const root = resolveSelectionResponseCaptureRoot(env)
	if (root === undefined) {
		return undefined
	}
	if (installedSink && installedStorageRoot === root) {
		return installedSink
	}
	installedStorageRoot = root
	installedSink = {
		onSelectionObservation: (observation) => {
			// The write NEVER throws and NEVER rejects: the observation is
			// fire-and-forget, and a capture failure must not change the
			// selection, the validation or the parent continuation.
			writeSelectionResponseCapture(root, observation)
		},
	}
	return installedSink
}

/**
 * Test seam: drop the installed sink. Production code MUST NOT call this.
 */
export function __resetSelectionResponseCaptureSinkForTests(): void {
	installedSink = undefined
	installedStorageRoot = undefined
}
