/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01 (C5 / C8) +
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY
 *
 * TypeScript adapter for the TaskHeader presentation Elm kernel.
 *
 * Architecture:
 *
 *     raw host facts (already collected by `SdkController.getStateToPostToWebview`)
 *       └─> buildFacts(...)             ← semantic Facts, NOT wire fields
 *       └─> invokeElmKernel(factsJson)  ← single Platform.worker port invocation
 *       └─> decodePresentation(...)     ← fail-closed decode of `kind: "presentation"`
 *       └─> typed TaskHeaderPresentationProjection value
 *
 * The adapter is the THIN BRIDGE between TypeScript and the Elm kernel.
 * It must NEVER:
 *   * re-implement any of the four production rules (R1-R4);
 *   * modify session / task / control state;
 *   * mutate diagnostic refs;
 *   * emit backend telemetry;
 *   * add updater side effects;
 *   * reinterpret Elm decode errors as automatic presentation.
 *
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY: the Elm
 * kernel is the SOLE production authority for `taskHeaderPresentation`.
 * The legacy TS selector
 * (`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:
 *  selectTaskHeaderPresentation`) is retained as a reference helper
 * for invariant fixtures only. The runtime-shadow observer
 * (`observeTaskHeaderElmRuntimeShadow`), observation ring, summary,
 * report, classification taxonomy, and dogfood-profile activation have
 * been REMOVED together — no quiet promotion to architecture.
 */

import type { TaskHeaderPresentationProjection, TurnPhase } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"

export interface TaskHeaderElmFactsJson {
	readonly canonicalShadowPhase: TurnPhase | null
	readonly currentLegacyPhase: TurnPhase
	readonly seq: number
	readonly canonicalShadowObservedTurnSeq: number | null
}

export interface TaskHeaderElmPresentationJson {
	readonly phase: TurnPhase
	readonly source: "host" | "shadow" | "legacy"
	readonly seq: number
}

export type TaskHeaderElmDecision =
	| {
			readonly kind: "presentation"
			readonly value: TaskHeaderPresentationProjection
	  }
	| {
			readonly kind: "decode_error"
			readonly reason: string
			readonly classification: "task_header_elm_decode_error"
	  }
	| {
			readonly kind: "kernel_offline"
			readonly classification: "task_header_elm_kernel_offline"
	  }

/**
 * Build the closed `Facts` JSON shape from the production TS selector's
 * input quadruple. No decision logic here.
 */
export function buildFactsJson(input: {
	readonly canonicalShadowPhase: TurnPhase | undefined
	readonly currentLegacyPhase: TurnPhase
	readonly seq: number
	readonly canonicalShadowObservedTurnSeq: number | undefined
}): TaskHeaderElmFactsJson {
	return {
		canonicalShadowPhase: input.canonicalShadowPhase ?? null,
		currentLegacyPhase: input.currentLegacyPhase,
		seq: input.seq,
		canonicalShadowObservedTurnSeq: input.canonicalShadowObservedTurnSeq ?? null,
	}
}

/**
 * Returns `true` for any string in the closed `TurnPhase` vocabulary
 * (mirror of `Domain.turnPhaseFromString` in Elm).
 */
export function isTurnPhase(s: unknown): s is TurnPhase {
	return (
		s === "idle" ||
		s === "streaming" ||
		s === "awaiting_approval" ||
		s === "awaiting_followup" ||
		s === "compacting" ||
		s === "completed" ||
		s === "error" ||
		s === "resumable"
	)
}

/**
 * Decode a single Elm outbound `Value` to a TS typed decision. Fail-closed.
 */
export function decodeOutMsg(msg: unknown): TaskHeaderElmDecision {
	if (typeof msg !== "object" || msg === null) {
		return {
			kind: "decode_error",
			reason: `expected object, got ${typeof msg}`,
			classification: "task_header_elm_decode_error",
		}
	}
	const rec = msg as Record<string, unknown>
	switch (rec.kind) {
		case "ready":
			return {
				kind: "decode_error",
				reason: "kernel emitted `ready` (no presentation payload)",
				classification: "task_header_elm_decode_error",
			}
		case "presentation": {
			const pres = rec.presentation
			if (typeof pres !== "object" || pres === null) {
				return {
					kind: "decode_error",
					reason: "presentation payload missing or non-object",
					classification: "task_header_elm_decode_error",
				}
			}
			const p = pres as Record<string, unknown>
			const phase = p.phase
			const source = p.source
			const seq = p.seq
			if (typeof phase !== "string" || !isTurnPhase(phase)) {
				return {
					kind: "decode_error",
					reason: `unknown phase tag: ${String(phase)}`,
					classification: "task_header_elm_decode_error",
				}
			}
			if (source !== "host" && source !== "shadow" && source !== "legacy") {
				return {
					kind: "decode_error",
					reason: `unknown source tag: ${String(source)}`,
					classification: "task_header_elm_decode_error",
				}
			}
			if (typeof seq !== "number" || !Number.isFinite(seq) || !Number.isInteger(seq)) {
				return {
					kind: "decode_error",
					reason: `seq must be a finite integer, got ${String(seq)}`,
					classification: "task_header_elm_decode_error",
				}
			}
			return {
				kind: "presentation",
				value: { phase, source, seq },
			}
		}
		case "decode_error":
			return {
				kind: "decode_error",
				reason: typeof rec.error === "string" ? rec.error : "kernel decode_error (no message)",
				classification: "task_header_elm_decode_error",
			}
		default:
			return {
				kind: "decode_error",
				reason: `unknown outbound kind: ${String(rec.kind)}`,
				classification: "task_header_elm_decode_error",
			}
	}
}

export interface CompiledElmKernel {
	sendInbound(value: unknown): void
	recvOutbound(): unknown
}

let cachedKernel: CompiledElmKernel | null = null
const _cachedKernelBundleSig: string | null = null

/**
 * Stable asset identifier the diagnostic surfaces. Mirrors the
 * canonical VSIX path `runtime-assets/task-header-orchestration.js`
 * that `stage_elm_kernel_runtime_asset` writes. NEVER resolves to
 * an absolute path so the bounded diagnostic does not leak user
 * filesystem topology.
 */
export const TASK_HEADER_ELM_RUNTIME_ASSET_ID = "runtime-assets/task-header-orchestration.js" as const

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION03-KERNEL-OFFLINE-DISCRIMINATOR:
 *
 * Module-scope loader-status record. Updated by the loader
 * (production and test set) so the Command Palette diagnostic can
 * surface an EXACT stage + failure class instead of an opaque
 * `kernel_offline` counter.
 *
 * The diagnostic is observable via `getTaskHeaderElmKernelDiagnostic()`
 * and is reset to `not_attempted` by `resetElmKernelForTests()`. The
 * captured record carries NO absolute user paths; the loader sets
 * `assetId` to the stable `runtime-assets/task-header-orchestration.js`
 * identifier in every branch.
 */
let _kernelDiagnostic: TaskHeaderElmKernelDiagnostic = {
	stage: "not_attempted",
	failureClass: null,
	assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
	fileReadable: null,
	bundleByteSize: null,
	errorName: null,
}

/**
 * Bounded error.name captured when the loader throws. The diagnostic
 * stores ONLY the `name` field (e.g. "Error", "TypeError",
 * "SyntaxError"). The full message and stack are intentionally NOT
 * captured so the diagnostic never leaks absolute paths, bundle
 * code, or user filesystem topology.
 */
function errorNameOf(err: unknown): string {
	if (err instanceof Error && typeof err.name === "string" && err.name.length > 0) {
		return err.name
	}
	return "Error"
}

/**
 * Test seam + diagnostic surface. Returns the loader's last stage
 * + bounded error name. The diagnostic is read-only from the
 * caller's perspective; only the loader mutates the underlying
 * module state.
 */
export function getTaskHeaderElmKernelDiagnostic(): TaskHeaderElmKernelDiagnostic {
	return _kernelDiagnostic
}

/**
 * Test seam — reset the loader diagnostic to `not_attempted`.
 * Mirrors the reset semantics of `resetElmKernelForTests`. NEVER
 * touches the TS projection, the observation ring, the enabled
 * flag, or any production state.
 */
export function resetTaskHeaderElmKernelDiagnostic(): void {
	_kernelDiagnostic = {
		stage: "not_attempted",
		failureClass: null,
		assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
		fileReadable: null,
		bundleByteSize: null,
		errorName: null,
	}
}

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION03-KERNEL-OFFLINE-DISCRIMINATOR:
 *
 * Stage taxonomy for the TaskHeader Elm kernel loader. Each stage
 * the runtime can fail at carries an exact `failureClass` so the
 * Command Palette diagnostic can discriminate the cause of `kernel_offline`
 * instead of returning an opaque counter.
 *
 * The closed stage set is ordered to mirror the loader execution
 * order in `ensureElmKernelEvaluated` / `loadCompiledElmKernel` /
 * `invokeElmKernel`. The diagnostic captures the FIRST stage the
 * loader fails at; later stages are not entered.
 *
 * Stage mapping (loader execution order -> diagnostic stage):
 *
 *   not_attempted       : loader not yet entered
 *   path_resolved       : resolveProductionKernelPath() returned non-empty
 *   file_read           : fs.readFileSync(kernelPath) returned non-empty buffer
 *   bundle_evaluated    : new Function(...) executed without throwing
 *   exports_present     : namespace.Elm is truthy
 *   main_init_present   : namespace.Elm.Main.init is a function
 *   app_initialized     : mod.Main.init({}) returned a value with .ports
 *   ports_valid         : ports actually accept inbound.send / outbound.subscribe
 *   failed              : loader short-circuited at some prior stage
 */
export type TaskHeaderElmKernelStage =
	| "not_attempted"
	| "path_resolved"
	| "file_read"
	| "bundle_evaluated"
	| "exports_present"
	| "main_init_present"
	| "app_initialized"
	| "ports_valid"
	| "ready"
	| "failed"

export type TaskHeaderElmKernelFailureClass =
	| "KERNEL_PATH_UNRESOLVED"
	| "KERNEL_FILE_MISSING"
	| "KERNEL_READ_FAILED"
	| "KERNEL_EVAL_FAILED"
	| "KERNEL_EXPORT_MISSING"
	| "KERNEL_MAIN_INIT_MISSING"
	| "KERNEL_APP_INIT_FAILED"
	| "KERNEL_PORTS_INVALID"
	| null

export interface TaskHeaderElmKernelDiagnostic {
	readonly stage: TaskHeaderElmKernelStage
	readonly failureClass: TaskHeaderElmKernelFailureClass
	readonly assetId: "runtime-assets/task-header-orchestration.js"
	readonly fileReadable: boolean | null
	readonly bundleByteSize: number | null
	readonly bundleSha256?: string
	readonly errorName: string | null
}

/**
 * Resolve the absolute path to the compiled Elm kernel JS file.
 *
 * Default returns a source-tree absolute path so the vitest suite
 * (which executes against the in-tree filesystem) can load the
 * kernel without any test-side stub. The packaged extension never
 * ships the source-tree path (see
 * `apps/vscode/elm/task-header-orchestration/.gitignore` and the
 * `.vscodeignore` discovery interaction); the production activation
 * helper in `extension.ts:activate` MUST set the production resolver
 * seam (`setTaskHeaderElmProductionKernelPath(...)`) BEFORE the
 * first `invokeElmKernel` call so the loader reads the staged
 * `runtime-assets/task-header-orchestration.js` file that
 * `stage_elm_kernel_runtime_asset` writes into the packaged VSIX.
 */
export function defaultElmKernelPath(): string {
	const url = new URL("../../elm/task-header-orchestration/vendor/task-header-orchestration.js", import.meta.url)
	return url.pathname
}

let _productionKernelPath: string | null = null

export function setTaskHeaderElmProductionKernelPath(path: string | null): void {
	_productionKernelPath = path
}

export function getTaskHeaderElmProductionKernelPath(): string | null {
	return _productionKernelPath
}

/**
 * Production resolver - returns the staged-runtime-asset path when
 * the activation helper has wired the seam; otherwise returns the
 * source-tree path so existing vitest execution keeps working.
 */
export function resolveProductionKernelPath(): string {
	if (typeof _productionKernelPath === "string" && _productionKernelPath.length > 0) {
		return _productionKernelPath
	}
	return defaultElmKernelPath()
}

let _kernelEvaluatedOnce = false

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING:
 * Sandboxed namespace the TaskHeader Elm kernel writes its `Elm`
 * exports into. Isolation from `globalThis.Elm` is the architectural
 * reason this seam is wired this way (see `ensureElmKernelEvaluated`
 * JSDoc); the completion-authority kernel already occupies
 * `globalThis.Elm`, so the TaskHeader kernel MUST NOT also write there
 * or its `_Platform_export` call crashes with
 * `_Debug_crash(6, 'Elm')` ("Your page is loading multiple Elm
 * scripts with a module named Elm").
 */
interface TaskHeaderElmNamespace {
	readonly Main?: {
		readonly init: (flags: unknown) => {
			readonly ports: {
				readonly inbound: { send: (v: unknown) => void }
				readonly outbound: { subscribe: (cb: (v: unknown) => void) => void }
			}
		}
	}
}
let _taskHeaderKernelNamespace: TaskHeaderElmNamespace | null = null

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING:
 * Ensure the compiled TaskHeader Elm kernel bundle is loaded into a
 * SANDBOXED namespace object. Idempotent.
 *
 * Why sandboxed (the runtime-codec repair):
 *
 * The Elm0.19.2 IIFE pattern at the tail of every compiled kernel is
 * `(function(scope){...}(this))`. The IIFE's parameter `scope`
 * receives `this` from the outer call site, and `_Platform_export`
 * writes the kernel's `Elm` exports to `scope['Elm']`. The original
 * completion-authority loader evaluates with the outer wrapper function
 * in non-strict mode, so `this` resolves to `globalThis` and the
 * IIFE writes the kernel's exports to `globalThis.Elm.Main`. That is
 * fine for the FIRST kernel to load. The SECOND kernel's
 * `_Platform_export` call detects the existing `globalThis.Elm`,
 * walks `_Platform_mergeExportsProd` /
 * `_Platform_mergeExportsDebug`, and trips on `Main.init` —
 * `_Debug_crash(6, 'Elm')`. The TS wrapper around the
 * `evaluateBundleOnce` call swallows the throw, `globalThis.Elm`
 * remains pointing at the FIRST kernel, and `loadCompiledElmKernel`
 * then returns the FIRST kernel's `Elm.Main.init`, which decodes a
 * DIFFERENT message envelope. The 512/512 LIVE "Expecting an OBJECT
 * with a field named `tag`" decode errors are the completion-
 * authority's `Decode.field "tag"` failing on TaskHeader's flat
 * `Facts` quadruple — a fail-closed rejection of the wrong shape by
 * the WRONG kernel, masquerading as a TaskHeader decoder defect.
 *
 * The repair routes the TaskHeader kernel through a per-kernel
 * namespace object that is NEVER `globalThis`. We invoke the wrapper
 * via `evaluator.call(namespace, namespace)` so the outer `this` is
 * `namespace`; the IIFE then receives `namespace` as its `scope`
 * argument and writes `namespace.Elm = exports`. The captured
 * `namespace.Elm` is the TaskHeader kernel's exports — fully
 * isolated from any other kernel that may share the same process.
 *
 * Mechanism (matches the proven
 * `completion-authority-elm-replay.kernel.ts` shape, with the .call
 * binding the OUTER `this` to a private object instead of letting it
 * fall through to `globalThis`):
 *
 *   new Function("scope", code + "; return this;")
 *     .call(namespace, namespace)
 *     -> reads back `namespace.Elm` for `loadCompiledElmKernel`
 *
 * The appended `; return this;` sentinel runs AFTER the IIFE and
 * reads the wrapper's bound `thisArg`. With `.call(namespace, ...)`
 * that is `namespace` — and `namespace.Elm` is the kernel's exports.
 */
export function ensureElmKernelEvaluated(kernelPath: string): boolean {
	if (_kernelEvaluatedOnce && _taskHeaderKernelNamespace) return true
	// Stage: path_resolved. The resolver returned a non-empty
	// path. If the path is empty we treat that as the first failure
	// boundary (KERNEL_PATH_UNRESOLVED).
	if (typeof kernelPath !== "string" || kernelPath.length === 0) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_PATH_UNRESOLVED",
			assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
			fileReadable: null,
			bundleByteSize: null,
			errorName: null,
		}
		Logger.error("[task-header-elm-shadow] kernel path could not be resolved (empty)")
		return false
	}
	_kernelDiagnostic = {
		stage: "path_resolved",
		failureClass: null,
		assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
		fileReadable: null,
		bundleByteSize: null,
		errorName: null,
	}
	let code: string
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs") as typeof import("node:fs")
		if (!fs.existsSync(kernelPath)) {
			_kernelDiagnostic = {
				stage: "failed",
				failureClass: "KERNEL_FILE_MISSING",
				assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
				fileReadable: false,
				bundleByteSize: null,
				errorName: null,
			}
			Logger.error(`[task-header-elm-shadow] kernel bundle missing at expected path`)
			return false
		}
		code = fs.readFileSync(kernelPath, "utf8")
	} catch (err) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_READ_FAILED",
			assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
			fileReadable: null,
			bundleByteSize: null,
			errorName: errorNameOf(err),
		}
		Logger.error(`[task-header-elm-shadow] failed to read Elm kernel bundle: ${errorNameOf(err)}`)
		return false
	}
	if (typeof code !== "string" || code.length === 0) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_READ_FAILED",
			assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
			fileReadable: true,
			bundleByteSize: 0,
			errorName: null,
		}
		Logger.error("[task-header-elm-shadow] kernel bundle is empty")
		return false
	}
	_kernelDiagnostic = {
		stage: "file_read",
		failureClass: null,
		assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
		fileReadable: true,
		bundleByteSize: code.length,
		errorName: null,
	}
	let namespace: Record<string, unknown>
	let kernelExports: TaskHeaderElmNamespace | null
	try {
		namespace = {}
		const evaluator = new Function("scope", code + "; return this;")
		evaluator.call(namespace, namespace)
		// Stage: bundle_evaluated. The wrapper executed; check exports.
		kernelExports = (namespace as { Elm?: TaskHeaderElmNamespace }).Elm ?? null
	} catch (err) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_EVAL_FAILED",
			assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
			fileReadable: true,
			bundleByteSize: code.length,
			errorName: errorNameOf(err),
		}
		Logger.error(`[task-header-elm-shadow] failed to evaluate Elm kernel bundle: ${errorNameOf(err)}`)
		return false
	}
	if (!kernelExports) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_EXPORT_MISSING",
			assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
			fileReadable: true,
			bundleByteSize: code.length,
			errorName: null,
		}
		Logger.error(
			"[task-header-elm-shadow] kernel bundle did not expose TaskHeaderElmNamespace.Elm after sandboxed evaluation",
		)
		return false
	}
	_kernelDiagnostic = {
		stage: "exports_present",
		failureClass: null,
		assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
		fileReadable: true,
		bundleByteSize: code.length,
		errorName: null,
	}
	if (typeof kernelExports.Main?.init !== "function") {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_MAIN_INIT_MISSING",
			assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
			fileReadable: true,
			bundleByteSize: code.length,
			errorName: null,
		}
		Logger.error(
			"[task-header-elm-shadow] kernel bundle did not expose TaskHeaderElmNamespace.Elm.Main.init after sandboxed evaluation",
		)
		return false
	}
	_kernelDiagnostic = {
		stage: "main_init_present",
		failureClass: null,
		assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
		fileReadable: true,
		bundleByteSize: code.length,
		errorName: null,
	}
	_taskHeaderKernelNamespace = kernelExports
	_kernelEvaluatedOnce = true
	return true
}

// Bump when the kernel bundle format changes; ensures stale evaluations
// are re-evaluated. Mirrors the completion-authority convention of
// gating the cache by path.
export const _TASK_HEADER_ELM_KERNEL_BUNDLE_SIG = "v2"

/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING:
 * Construct a fresh TaskHeader Elm app instance via
 * `Elm.Main.init({})` from the SANDBOXED namespace captured by
 * `ensureElmKernelEvaluated`.
 *
 * CRITICAL: this MUST read from `_taskHeaderKernelNamespace`, NOT
 * `globalThis.Elm`. Reading from `globalThis.Elm` is the production
 * bug — the completion-authority kernel already occupies that
 * namespace, so any value read there belongs to the completion-
 * authority kernel, not TaskHeader. See `ensureElmKernelEvaluated`
 * JSDoc for the full causal chain.
 */
export function loadCompiledElmKernel(): CompiledElmKernel | null {
	if (cachedKernel) {
		// Stage: ready (re-entrant load against the cached kernel).
		_kernelDiagnostic = {
			stage: "ready",
			failureClass: null,
			assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
			fileReadable: _kernelDiagnostic.fileReadable,
			bundleByteSize: _kernelDiagnostic.bundleByteSize,
			errorName: null,
		}
		return cachedKernel
	}
	const mod = _taskHeaderKernelNamespace
	if (!mod || typeof mod.Main?.init !== "function") {
		return null
	}
	let app: {
		readonly ports: {
			readonly inbound: { send: (v: unknown) => void }
			readonly outbound: { subscribe: (cb: (v: unknown) => void) => void }
		}
	} | null = null
	try {
		app = mod.Main.init({})
	} catch (err) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_APP_INIT_FAILED",
			assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
			fileReadable: _kernelDiagnostic.fileReadable,
			bundleByteSize: _kernelDiagnostic.bundleByteSize,
			errorName: errorNameOf(err),
		}
		Logger.error(`[task-header-elm-shadow] Main.init threw: ${errorNameOf(err)}`)
		return null
	}
	if (!app || !app.ports || !app.ports.inbound || !app.ports.outbound) {
		_kernelDiagnostic = {
			stage: "failed",
			failureClass: "KERNEL_PORTS_INVALID",
			assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
			fileReadable: _kernelDiagnostic.fileReadable,
			bundleByteSize: _kernelDiagnostic.bundleByteSize,
			errorName: null,
		}
		Logger.error("[task-header-elm-shadow] kernel app is missing inbound/outbound ports")
		return null
	}
	_kernelDiagnostic = {
		stage: "app_initialized",
		failureClass: null,
		assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
		fileReadable: _kernelDiagnostic.fileReadable,
		bundleByteSize: _kernelDiagnostic.bundleByteSize,
		errorName: null,
	}
	let lastOutbound: unknown = null
	app.ports.outbound.subscribe((v: unknown) => {
		lastOutbound = v
	})
	cachedKernel = {
		sendInbound(value: unknown) {
			lastOutbound = null
			app!.ports.inbound.send(value)
		},
		recvOutbound() {
			return lastOutbound
		},
	}
	_kernelDiagnostic = {
		stage: "ports_valid",
		failureClass: null,
		assetId: TASK_HEADER_ELM_RUNTIME_ASSET_ID,
		fileReadable: _kernelDiagnostic.fileReadable,
		bundleByteSize: _kernelDiagnostic.bundleByteSize,
		errorName: null,
	}
	return cachedKernel
}

/**
 * Reset the module-scope caches. Test seam only.
 */
export function resetElmKernelForTests(): void {
	cachedKernel = null
	_taskHeaderKernelNamespace = null
	_kernelEvaluatedOnce = false
	_productionKernelPath = null
	resetTaskHeaderElmKernelDiagnostic()
}

/**
 * Invoke the compiled Elm kernel with the given semantic `Facts`,
 * returning a typed `TaskHeaderElmDecision`. Fail-closed.
 */
export async function invokeElmKernel(factsJson: TaskHeaderElmFactsJson): Promise<TaskHeaderElmDecision> {
	ensureElmKernelEvaluated(resolveProductionKernelPath())
	const kernel = loadCompiledElmKernel()
	if (!kernel) {
		return { kind: "kernel_offline", classification: "task_header_elm_kernel_offline" }
	}
	kernel.sendInbound(factsJson)
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	const out = kernel.recvOutbound()
	if (out === null) {
		return {
			kind: "decode_error",
			reason: "kernel emitted no outbound message",
			classification: "task_header_elm_decode_error",
		}
	}
	return decodeOutMsg(out)
}

// ============================================================================
