// =============================================================================
// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01
//
// Semantic launchd-backed Tart testbed backend. Reuses the existing
// `TestbedBackend` seam so `TestbedOrchestrator` does not change.
//
// Architecture:
//
//   TestbedOrchestrator
//     │
//     ▼
//   LaunchdTestbedBackend  (this file)
//     │
//     │ semantic testbed request
//     ▼
//   HostHelperTransport    (interface)
//     │
//     ▼
//   LaunchdHostHelperTransport  (AF_UNIX to io.clinemm.host-helper)
//     │
//     ▼
//   macos-host-helper native/helper
//     │
//     ▼
//   Tart lifecycle (helper-owned)
//
// SECURITY INVARIANTS:
//   - No arbitrary host exec surface is added.
//   - The helper owns: Tart executable resolution, argv, env (PATH/HOME/TMPDIR),
//     cwd, staging root, SSH identity, and signal escalation.
//   - The RPC request is exactly the existing `TestbedSpec` plus the
//     `version`/`request_id`/`method` envelope. Caller cannot select the
//     Tart executable, working directory, environment, or absolute paths
//     inside the staging root.
//   - VM ownership is structural (vm-name contains run-id segment).
//     The helper double-checks ownership before any destructive Tart command.
//   - Long-lived `tart run` uses spawn (no SIGKILL timeout). Signal
//     escalation is SIGTERM (5s) → SIGKILL (3s), per CORRECTION01/02.
//
// The backend is single-purpose: ONE semantic request per orchestrator run,
// not a session-stealing daemon.
//
// HOST-SPECIFIC TEST SEAM: `HostHelperTransport` is an interface so
// tests can inject a `FakeLaunchdTransport` that records the marshalled
// request and returns a deterministic response — proving the orchestrator
// is no longer tied to direct Tart execution without requiring a live
// helper.
//
// RESPONSE CONTRACT (RPC body):
//   TartTestbedRunResultBody (mirror of TestbedResult + per-phase provenance).
//   The backend translates this into TestbedResult-shaped artifacts
//   (commands / artifacts / teardown / steps / overallStatus / failure)
//   so the orchestrator's evidence contract is unchanged.
// =============================================================================

import type {
	BackendPrepareArgs,
	BackendReadyInfo,
	BackendStartArgs,
	BackendWaitReadyArgs,
	CopyOutResult,
	ExecResult,
	TestbedBackend,
} from "./backend.ts";
import type { ProcessRunner } from "./process-runner.ts";
import {
	type ArtifactRecord,
	type CommandRecord,
	type HostClassification,
	type StepRecord,
	type TeardownRecord,
	TestbedError,
	type TestbedErrorCode,
	type TestbedResult,
} from "./types.ts";
import {
	newRunId,
	sanitizeRunId,
	vmNameFor,
	vmOwnedByRun,
} from "./vm-identity.ts";

// =============================================================================
// Transport seam
// =============================================================================

/** Caller-supplied wire envelope shape that the helper accepts. */
export interface HostHelperRequest<TReqBody> {
	readonly method: string;
	readonly requestId: string;
	readonly body: TReqBody;
}

/** Caller-supplied wire envelope shape that the helper returns. */
export interface HostHelperOkResponse<TResBody> {
	readonly ok: true;
	readonly result: TResBody;
}
export interface HostHelperErrorResponse {
	readonly ok: false;
	readonly error: string;
}
export type HostHelperResponse<TResBody> =
	| HostHelperOkResponse<TResBody>
	| HostHelperErrorResponse;

export interface HostHelperTransport {
	/**
	 * Send one LF-terminated JSON request frame to the helper and return the
	 * LF-terminated JSON response frame (parsed object). Long-running requests
	 * (e.g. tart.testbed.run) may take minutes — the transport owns its own
	 * timeout policy.
	 */
	call<TReqBody, TResBody>(
		req: HostHelperRequest<TReqBody>,
	): Promise<HostHelperResponse<TResBody>>;
	/** Close the underlying socket. Best-effort, idempotent. */
	close(): void;
}

// =============================================================================
// RPC request body — strictly mirrors TestbedSpec minus caller-host-exec
// fields. The helper re-derives VM name, cwd, env, paths.
// =============================================================================

/** A single RPC command, mirroring TestbedCommand minus non-bounded fields. */
export interface RpcTestbedCommand {
	readonly argv: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly timeoutMs?: number;
	readonly label?: string;
	readonly failOnNonZero?: boolean;
}

/** RPC artifact shape. */
export interface RpcTestbedArtifact {
	readonly guestPath: string;
	readonly hostDestination: string;
	readonly required: boolean;
}

/** RPC timeouts (mirror of TestbedTimeouts). */
export interface RpcTestbedTimeouts {
	readonly cloneMs?: number;
	readonly startMs?: number;
	readonly ipReadyMs?: number;
	readonly sshReadyMs?: number;
	readonly commandMs?: number;
}

/** The semantic RPC body. Closed shape. */
export interface TartTestbedRunBody {
	readonly image: string;
	readonly vm_name_prefix?: string;
	readonly run_id?: string;
	readonly ssh_user?: string;
	readonly ssh_identity_file?: string;
	readonly known_hosts_contents?: string;
	readonly commands: readonly RpcTestbedCommand[];
	readonly artifacts: readonly RpcTestbedArtifact[];
	readonly timeouts?: RpcTestbedTimeouts;
	readonly keep_vm?: boolean;
	readonly metadata?: Readonly<Record<string, string>>;
}

// =============================================================================
// RPC response body — exactly the existing TestbedResult, plus a few
// helper-internal phase records for evidence transparency.
// =============================================================================

/** Mirror of ArtifactRecord (see tools/tart-testbed/src/types.ts). */
export interface RpcArtifactRecord {
	readonly guestPath: string;
	readonly hostDestination: string;
	readonly required: boolean;
	readonly exists: boolean;
	readonly byteSize: number | null;
	readonly sha256: string | null;
	readonly status: "collected" | "missing" | "copy_failed";
	readonly error?: string;
}

/** Mirror of CommandRecord. */
export interface RpcCommandRecord {
	readonly index: number;
	readonly label?: string;
	readonly argv: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly durationMs: number;
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
	readonly status: "pass" | "fail" | "timeout" | "skipped";
}

/** Mirror of StepRecord. */
export interface RpcStepRecord {
	readonly name: string;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly durationMs: number;
	readonly status: "pass" | "fail" | "skipped";
	readonly detail?: string;
}

/** Mirror of TeardownRecord. */
export interface RpcTeardownRecord {
	readonly status: "pass" | "fail" | "skipped";
	readonly stopStatus: "pass" | "fail" | "skipped" | "not_attempted";
	readonly deleteStatus: "pass" | "fail" | "skipped" | "not_attempted";
	readonly kept: boolean;
	readonly error?: string;
}

export type RpcOverallStatus =
	| "PASS"
	| "PREPARE_FAILED"
	| "START_FAILED"
	| "IP_TIMEOUT"
	| "SSH_TIMEOUT"
	| "COMMAND_FAILED"
	| "ARTIFACT_MISSING"
	| "UNSUPPORTED_HOST"
	| "EXCEPTION"
	| "KEEP_VM";

/** Closed enumeration of helper RPC error codes for non-ok responses. */
export type RpcTestbedErrorCode =
	| "BAD_REQUEST"
	| "BAD_JSON"
	| "UNSUPPORTED_VERSION"
	| "MISSING_REQUEST_ID"
	| "OVERSIZE"
	| "EXEC_SHAPED_PAYLOAD"
	| "WRONG_TYPE"
	| "METHOD_NOT_ALLOWED"
	| "BAD_FIELD_TYPE"
	| "MISSING_REQUIRED_FIELD"
	| "UNKNOWN_FIELD"
	| "TESTBED_PREPARE_FAILED"
	| "TART_CLONE_FAILED"
	| "TART_START_FAILED"
	| "TART_IP_TIMEOUT"
	| "TART_SSH_TIMEOUT"
	| "TART_STOP_FAILED"
	| "TART_DELETE_FAILED"
	| "TESTBED_COPY_IN_FAILED"
	| "TESTBED_COPY_OUT_FAILED"
	| "TESTBED_VM_OWNERSHIP_UNPROVEN"
	| "TESTBED_REQUIRED_ARTIFACT_MISSING"
	| "TESTBED_INTERNAL_ERROR"
	| "TESTBED_UNAVAILABLE"
	| "TESTBED_REQUEST_OVERSIZED"
	| "METHOD_NOT_AVAILABLE_IN_TS_FALLBACK"
	| "TIMEOUT";

export interface TartTestbedRunResultBody {
	readonly overallStatus: RpcOverallStatus;
	readonly vmName: string;
	readonly runId: string;
	readonly steps: readonly RpcStepRecord[];
	readonly commands: readonly RpcCommandRecord[];
	readonly artifacts: readonly RpcArtifactRecord[];
	readonly teardown: RpcTeardownRecord;
	readonly failureCode?: RpcTestbedErrorCode;
	readonly failureReason?: string;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly durationMs: number;
}

// =============================================================================
// Bounds — anything caller-controlled that we must bound (C17).
// =============================================================================

/** Maximum cumulative wire-level request size accepted by the helper. */
export const MAX_REQUEST_BYTES = 32 * 1024;

/** Per-RPC field bounds (C17). All integers are inclusive. */
export const TESTBED_RUN_BOUNDS = Object.freeze({
	imageMaxLen: 512,
	vmNamePrefixMaxLen: 32,
	runIdMaxLen: 64,
	sshUserMaxLen: 32,
	sshIdentityFileMaxLen: 1024,
	knownHostsContentsMaxLen: 4096,
	commandsMax: 64,
	commandArgvMax: 64,
	commandArgvElementMaxLen: 512,
	commandCwdMaxLen: 512,
	commandEnvKeyMaxLen: 128,
	commandEnvValueMaxLen: 512,
	commandLabelMaxLen: 128,
	commandTimeoutMsMax: 30 * 60 * 1000,
	artifactsMax: 32,
	artifactGuestPathMaxLen: 1024,
	artifactHostDestinationMaxLen: 1024,
	metadataMax: 16,
	metadataKeyMaxLen: 64,
	metadataValueMaxLen: 512,
} as const);

// =============================================================================
// Validation — pure, no I/O. Used by both the TS marshalling layer and
// the test matrix (C22).
// =============================================================================

export interface ValidationOk {
	readonly ok: true;
	readonly value: { vmName: string; runId: string; body: TartTestbedRunBody };
}
export interface ValidationFail {
	readonly ok: false;
	readonly error: string;
}
export type ValidationResult = ValidationOk | ValidationFail;

function validateBoundedString(
	field: string,
	value: unknown,
	maxLen: number,
): string | null {
	if (typeof value !== "string") return `${field} must be a string`;
	if (value.length === 0) return `${field} is empty`;
	if (value.length > maxLen) return `${field} exceeds ${maxLen} chars`;
	if (containsNulOrNewline(value)) return `${field} contains NUL or newline`;
	return null;
}

/**
 * Reject strings containing NUL or newline characters. Implemented
 * as a loop (not a regex) to satisfy biome's
 * `noControlCharactersInRegex` while preserving the same semantic.
 * The argv-only invariant requires one token per argv element;
 * NUL or newline would otherwise split the token across argv
 * boundaries.
 */
function containsNulOrNewline(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code === 0x00 || code === 0x0a) return true;
	}
	return false;
}

/**
 * Build the RPC body and the helper-owned VM name + run id, or fail closed.
 *
 * Invariants enforced here (C2, C4, C5, C17):
 *   - VM name is NOT caller-selectable. Helper-derives from `vm_name_prefix` + run id.
 *   - Run id is sanitized via the existing `sanitizeRunId`.
 *   - All strings are bounded in length; NUL/newline rejected (one argv element invariant).
 *   - All arrays are bounded in count.
 *
 * Anything not in the closed schema is dropped at the type level
 * (the input is typed as a struct of `unknown` fields and we only
 * consume them when present and well-typed).
 */
export function buildTestbedRunBody(spec: {
	readonly image?: unknown;
	readonly vm_name_prefix?: unknown;
	readonly run_id?: unknown;
	readonly ssh_user?: unknown;
	readonly ssh_identity_file?: unknown;
	readonly known_hosts_contents?: unknown;
	readonly commands?: unknown;
	readonly artifacts?: unknown;
	readonly timeouts?: unknown;
	readonly keep_vm?: unknown;
	readonly metadata?: unknown;
}): ValidationResult {
	// (1) image
	let imageErr: string | undefined;
	const image = typeof spec.image === "string" ? spec.image : null;
	if (image === null) imageErr = "image must be a non-empty string";
	else if (image.length === 0) imageErr = "image is empty";
	else if (image.length > TESTBED_RUN_BOUNDS.imageMaxLen)
		imageErr = `image exceeds ${TESTBED_RUN_BOUNDS.imageMaxLen} chars`;
	else if (containsNulOrNewline(image))
		imageErr = "image contains NUL or newline";
	else if (!/^[a-zA-Z0-9._\-/:]+@sha256:[0-9a-f]{64}$/.test(image))
		imageErr = "image must be 'registry/path@sha256:<64-hex-digest>'";
	if (imageErr !== undefined) return { ok: false, error: imageErr };

	// (2) optional fields with strict bounds
	const vmPrefix: string | undefined =
		typeof spec.vm_name_prefix === "string" ? spec.vm_name_prefix : undefined;
	if (
		spec.vm_name_prefix !== undefined &&
		(vmPrefix === undefined ||
			vmPrefix.length === 0 ||
			vmPrefix.length > TESTBED_RUN_BOUNDS.vmNamePrefixMaxLen)
	) {
		return {
			ok: false,
			error: `vm_name_prefix must be a non-empty string, length<=${TESTBED_RUN_BOUNDS.vmNamePrefixMaxLen}`,
		};
	}
	const runIdIn: string | undefined =
		typeof spec.run_id === "string" ? spec.run_id : undefined;
	if (
		spec.run_id !== undefined &&
		(runIdIn === undefined ||
			runIdIn.length === 0 ||
			runIdIn.length > TESTBED_RUN_BOUNDS.runIdMaxLen)
	) {
		return {
			ok: false,
			error: `run_id must be a non-empty string, length<=${TESTBED_RUN_BOUNDS.runIdMaxLen}`,
		};
	}
	const sshUser: string | undefined =
		typeof spec.ssh_user === "string" ? spec.ssh_user : undefined;
	if (
		spec.ssh_user !== undefined &&
		(sshUser === undefined ||
			sshUser.length === 0 ||
			sshUser.length > TESTBED_RUN_BOUNDS.sshUserMaxLen ||
			!/^[a-zA-Z0-9_-]+$/.test(sshUser))
	) {
		return {
			ok: false,
			error: `ssh_user must match /^[a-zA-Z0-9_-]+$/, length<=${TESTBED_RUN_BOUNDS.sshUserMaxLen}`,
		};
	}
	const sshIdentityFile: string | undefined =
		typeof spec.ssh_identity_file === "string"
			? spec.ssh_identity_file
			: undefined;
	if (
		spec.ssh_identity_file !== undefined &&
		(sshIdentityFile === undefined ||
			sshIdentityFile.length === 0 ||
			sshIdentityFile.length > TESTBED_RUN_BOUNDS.sshIdentityFileMaxLen ||
			!sshIdentityFile.startsWith("/"))
	) {
		return {
			ok: false,
			error: `ssh_identity_file must be an absolute POSIX path, length<=${TESTBED_RUN_BOUNDS.sshIdentityFileMaxLen}`,
		};
	}
	const knownHostsContents: string | undefined =
		typeof spec.known_hosts_contents === "string"
			? spec.known_hosts_contents
			: undefined;
	if (
		spec.known_hosts_contents !== undefined &&
		(knownHostsContents === undefined ||
			knownHostsContents.length > TESTBED_RUN_BOUNDS.knownHostsContentsMaxLen)
	) {
		return {
			ok: false,
			error: `known_hosts_contents length<=${TESTBED_RUN_BOUNDS.knownHostsContentsMaxLen}`,
		};
	}

	// (3) run id / vm name
	const sanitizedRunId =
		runIdIn !== undefined ? sanitizeRunId(runIdIn) : newRunId(Math.random);
	if (sanitizedRunId.length === 0) {
		return {
			ok: false,
			error: `run_id '${runIdIn}' sanitizes to empty (must contain alnum)`,
		};
	}
	const vmName = vmNameFor({ runId: sanitizedRunId });
	if (!vmOwnedByRun(vmName, sanitizedRunId)) {
		return {
			ok: false,
			error: `internal: vmNameFor produced foreign VM name '${vmName}'`,
		};
	}

	// (4) commands
	if (!Array.isArray(spec.commands)) {
		return { ok: false, error: "commands must be an array" };
	}
	if (spec.commands.length === 0) {
		return { ok: false, error: "commands must be a non-empty array" };
	}
	if (spec.commands.length > TESTBED_RUN_BOUNDS.commandsMax) {
		return {
			ok: false,
			error: `commands count exceeds ${TESTBED_RUN_BOUNDS.commandsMax}`,
		};
	}
	const commands: RpcTestbedCommand[] = [];
	for (let i = 0; i < spec.commands.length; i++) {
		const cRaw = spec.commands[i];
		const c =
			cRaw === null || typeof cRaw !== "object" || Array.isArray(cRaw)
				? null
				: (cRaw as Record<string, unknown>);
		if (c === null) {
			return { ok: false, error: `commands[${i}] must be an object` };
		}
		if (!Array.isArray(c.argv)) {
			return { ok: false, error: `commands[${i}].argv must be an array` };
		}
		if (c.argv.length === 0) {
			return {
				ok: false,
				error: `commands[${i}].argv must be a non-empty array`,
			};
		}
		if (c.argv.length > TESTBED_RUN_BOUNDS.commandArgvMax) {
			return {
				ok: false,
				error: `commands[${i}].argv exceeds ${TESTBED_RUN_BOUNDS.commandArgvMax} elements`,
			};
		}
		const argv: string[] = [];
		for (let j = 0; j < c.argv.length; j++) {
			const tok = c.argv[j];
			if (typeof tok !== "string") {
				return {
					ok: false,
					error: `commands[${i}].argv[${j}] must be a string`,
				};
			}
			if (
				tok.length === 0 ||
				tok.length > TESTBED_RUN_BOUNDS.commandArgvElementMaxLen
			) {
				return {
					ok: false,
					error: `commands[${i}].argv[${j}] length out of range [1, ${TESTBED_RUN_BOUNDS.commandArgvElementMaxLen}]`,
				};
			}
			if (containsNulOrNewline(tok)) {
				return {
					ok: false,
					error: `commands[${i}].argv[${j}] contains NUL or newline`,
				};
			}
			argv.push(tok);
		}
		const cwd: string | undefined =
			typeof c.cwd === "string" ? c.cwd : undefined;
		if (
			c.cwd !== undefined &&
			(cwd === undefined ||
				cwd.length === 0 ||
				cwd.length > TESTBED_RUN_BOUNDS.commandCwdMaxLen)
		) {
			return { ok: false, error: `commands[${i}].cwd length out of range` };
		}
		const envIn = c.env;
		let envOut: Readonly<Record<string, string>> | undefined;
		if (envIn !== undefined) {
			if (envIn === null || typeof envIn !== "object" || Array.isArray(envIn)) {
				return { ok: false, error: `commands[${i}].env must be an object` };
			}
			const envObj: Record<string, string> = {};
			for (const [k, v] of Object.entries(envIn)) {
				if (typeof v !== "string") {
					return {
						ok: false,
						error: `commands[${i}].env.${k} must be a string`,
					};
				}
				if (
					k.length === 0 ||
					k.length > TESTBED_RUN_BOUNDS.commandEnvKeyMaxLen
				) {
					return {
						ok: false,
						error: `commands[${i}].env key length out of range`,
					};
				}
				if (
					v.length === 0 ||
					v.length > TESTBED_RUN_BOUNDS.commandEnvValueMaxLen
				) {
					return {
						ok: false,
						error: `commands[${i}].env.${k} value length out of range`,
					};
				}
				envObj[k] = v;
			}
			envOut = envObj;
		}
		const timeoutMs: number | undefined =
			typeof c.timeoutMs === "number" ? c.timeoutMs : undefined;
		if (
			c.timeoutMs !== undefined &&
			(timeoutMs === undefined ||
				!Number.isFinite(timeoutMs) ||
				timeoutMs <= 0 ||
				timeoutMs > TESTBED_RUN_BOUNDS.commandTimeoutMsMax)
		) {
			return {
				ok: false,
				error: `commands[${i}].timeoutMs out of range [1, ${TESTBED_RUN_BOUNDS.commandTimeoutMsMax}]`,
			};
		}
		const label: string | undefined =
			typeof c.label === "string" ? c.label : undefined;
		if (
			c.label !== undefined &&
			(label === undefined ||
				label.length === 0 ||
				label.length > TESTBED_RUN_BOUNDS.commandLabelMaxLen)
		) {
			return { ok: false, error: `commands[${i}].label length out of range` };
		}
		const failOnNonZero: boolean | undefined =
			typeof c.failOnNonZero === "boolean" ? c.failOnNonZero : undefined;
		if (c.failOnNonZero !== undefined && failOnNonZero === undefined) {
			return {
				ok: false,
				error: `commands[${i}].failOnNonZero must be a boolean`,
			};
		}
		const cmd: RpcTestbedCommand = {
			argv,
			...(cwd !== undefined ? { cwd } : {}),
			...(envOut !== undefined ? { env: envOut } : {}),
			...(timeoutMs !== undefined ? { timeoutMs } : {}),
			...(label !== undefined ? { label } : {}),
			...(failOnNonZero !== undefined ? { failOnNonZero } : {}),
		};
		commands.push(cmd);
	}

	// (5) artifacts
	const artifactsIn = spec.artifacts;
	const artifacts: RpcTestbedArtifact[] = [];
	if (artifactsIn !== undefined) {
		if (!Array.isArray(artifactsIn)) {
			return { ok: false, error: "artifacts must be an array" };
		}
		if (artifactsIn.length > TESTBED_RUN_BOUNDS.artifactsMax) {
			return {
				ok: false,
				error: `artifacts count exceeds ${TESTBED_RUN_BOUNDS.artifactsMax}`,
			};
		}
		for (let i = 0; i < artifactsIn.length; i++) {
			const aRaw = artifactsIn[i];
			const a =
				aRaw === null || typeof aRaw !== "object" || Array.isArray(aRaw)
					? null
					: (aRaw as Record<string, unknown>);
			if (a === null) {
				return { ok: false, error: `artifacts[${i}] must be an object` };
			}
			const gpErr = validateBoundedString(
				`artifacts[${i}].guestPath`,
				a.guestPath,
				TESTBED_RUN_BOUNDS.artifactGuestPathMaxLen,
			);
			if (gpErr !== null) return { ok: false, error: gpErr };
			const hdErr = validateBoundedString(
				`artifacts[${i}].hostDestination`,
				a.hostDestination,
				TESTBED_RUN_BOUNDS.artifactHostDestinationMaxLen,
			);
			if (hdErr !== null) return { ok: false, error: hdErr };
			const required: boolean = a.required === true;
			artifacts.push({
				guestPath: a.guestPath as string,
				hostDestination: a.hostDestination as string,
				required,
			});
		}
	}

	// (6) timeouts
	const timeoutsIn = spec.timeouts;
	let timeoutsOut: RpcTestbedTimeouts | undefined;
	if (timeoutsIn !== undefined) {
		if (
			timeoutsIn === null ||
			typeof timeoutsIn !== "object" ||
			Array.isArray(timeoutsIn)
		) {
			return { ok: false, error: "timeouts must be an object" };
		}
		const t = timeoutsIn as Record<string, unknown>;
		const tm: Record<string, number> = {};
		for (const k of [
			"cloneMs",
			"startMs",
			"ipReadyMs",
			"sshReadyMs",
			"commandMs",
		] as const) {
			const v = t[k];
			if (v === undefined) continue;
			if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
				return { ok: false, error: `timeouts.${k} must be a positive number` };
			}
			tm[k] = v;
		}
		timeoutsOut = tm as RpcTestbedTimeouts;
	}

	// (7) keep_vm (boolean only)
	const keepVm: boolean | undefined =
		typeof spec.keep_vm === "boolean" ? spec.keep_vm : undefined;
	if (spec.keep_vm !== undefined && keepVm === undefined) {
		return { ok: false, error: "keep_vm must be a boolean" };
	}

	// (8) metadata (bounded keys/values; no secrets — that's a spec-level promise)
	const metaIn = spec.metadata;
	let metaOut: Readonly<Record<string, string>> | undefined;
	if (metaIn !== undefined) {
		if (
			metaIn === null ||
			typeof metaIn !== "object" ||
			Array.isArray(metaIn)
		) {
			return { ok: false, error: "metadata must be an object" };
		}
		const entries = Object.entries(metaIn);
		if (entries.length > TESTBED_RUN_BOUNDS.metadataMax) {
			return {
				ok: false,
				error: `metadata entries exceed ${TESTBED_RUN_BOUNDS.metadataMax}`,
			};
		}
		const meta: Record<string, string> = {};
		for (const [k, v] of entries) {
			if (k.length === 0 || k.length > TESTBED_RUN_BOUNDS.metadataKeyMaxLen) {
				return { ok: false, error: `metadata key length out of range` };
			}
			if (
				typeof v !== "string" ||
				v.length > TESTBED_RUN_BOUNDS.metadataValueMaxLen
			) {
				return {
					ok: false,
					error: `metadata.${k} must be a string, length<=${TESTBED_RUN_BOUNDS.metadataValueMaxLen}`,
				};
			}
			meta[k] = v;
		}
		metaOut = meta;
	}

	const body: TartTestbedRunBody = {
		image: image as string,
		...(vmPrefix !== undefined ? { vm_name_prefix: vmPrefix } : {}),
		...(runIdIn !== undefined ? { run_id: runIdIn } : {}),
		...(sshUser !== undefined ? { ssh_user: sshUser } : {}),
		...(sshIdentityFile !== undefined
			? { ssh_identity_file: sshIdentityFile }
			: {}),
		...(knownHostsContents !== undefined
			? { known_hosts_contents: knownHostsContents }
			: {}),
		commands,
		artifacts,
		...(timeoutsOut !== undefined ? { timeouts: timeoutsOut } : {}),
		...(keepVm !== undefined ? { keep_vm: keepVm } : {}),
		...(metaOut !== undefined ? { metadata: metaOut } : {}),
	};

	return { ok: true, value: { vmName, runId: sanitizedRunId, body } };
}

// =============================================================================
// Backend — implements TestbedBackend by orchestrating a single RPC
// through the transport. The orchestrator's phase ordering (prepare →
// start → waitReady → exec → copyOut → stop → destroy) is preserved;
// the backend issues ONE round-trip to the helper that internally
// walks the same phases.
// =============================================================================

export interface LaunchdTestbedBackendOptions {
	readonly transport: HostHelperTransport;
	readonly backendName?: string;
	/** Optional override for the request id (used by tests for correlation). */
	readonly requestIdFn?: () => string;
	/** Override the method name (used by tests to assert the protocol). */
	readonly methodName?: string;
}

export class LaunchdTestbedBackend implements TestbedBackend {
	readonly backendName: string;
	private readonly transport: HostHelperTransport;
	private readonly requestIdFn: () => string;
	private readonly methodName: string;

	// Cached across prepare/start/waitReady/exec/copyOut/stop/destroy.
	private rpcBody: TartTestbedRunBody | null = null;
	private rpcResult: TartTestbedRunResultBody | null = null;
	private rpcError: Error | null = null;
	/** Issued request id; used for log correlation. */
	private lastRequestId: string | null = null;

	constructor(opts: LaunchdTestbedBackendOptions) {
		this.transport = opts.transport;
		this.backendName = opts.backendName ?? "launchd-tart";
		this.methodName = opts.methodName ?? "tart.testbed.run";
		this.requestIdFn =
			opts.requestIdFn ??
			((): string =>
				`launchd-tart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
	}

	/**
	 * Set the RPC body before start(). This is the orchestrator-friendly
	 * entry: the backend does not close over `body` from prepare() (which
	 * receives only `vmName`), so callers must explicitly push the
	 * marshalled body in. The `LaunchdTestbedRunner` below wraps both
	 * halves.
	 */
	setBody(body: TartTestbedRunBody): void {
		this.rpcBody = body;
	}

	getLastRequestId(): string | null {
		return this.lastRequestId;
	}

	private async ensureRpc(): Promise<TartTestbedRunResultBody> {
		if (this.rpcError !== null) throw this.rpcError;
		if (this.rpcResult !== null) return this.rpcResult;
		if (this.rpcBody === null) {
			throw new TestbedError(
				"TESTBED_INTERNAL_ERROR",
				"LaunchdTestbedBackend: setBody(body) must be called before start()",
			);
		}
		const requestId = this.requestIdFn();
		this.lastRequestId = requestId;
		const resp = await this.transport.call<
			TartTestbedRunBody,
			TartTestbedRunResultBody
		>({
			method: this.methodName,
			requestId,
			body: this.rpcBody,
		});
		if (!resp.ok) {
			const err = (resp as HostHelperErrorResponse).error;
			this.rpcError = classifyRpcError(err);
			throw this.rpcError;
		}
		this.rpcResult = (
			resp as HostHelperOkResponse<TartTestbedRunResultBody>
		).result;
		return this.rpcResult;
	}

	async prepare(
		_args: BackendPrepareArgs,
		_proc: ProcessRunner,
	): Promise<void> {
		// The helper runs clone+start+ip+ssh+guest+copyOut+teardown as one
		// semantic request. prepare() is therefore a no-op on this backend.
		void _args;
		void _proc;
	}

	async start(_args: BackendStartArgs, _proc: ProcessRunner): Promise<void> {
		void _args;
		void _proc;
		// Trigger the RPC (idempotent: re-issues same request, but we cache
		// the result so subsequent calls return the same body).
		if (this.rpcResult !== null || this.rpcError !== null) return;
		await this.ensureRpc();
	}

	async waitReady(
		args: BackendWaitReadyArgs,
		_proc: ProcessRunner,
	): Promise<BackendReadyInfo> {
		void _proc;
		const r = await this.ensureRpc();
		// The helper records the IP at the waitReady step's detail field.
		const wr = r.steps.find((s) => s.name === "waitReady");
		const guestIp = wr?.detail ?? "0.0.0.0";
		void args;
		return { guestIp, phase: "READY" };
	}

	async exec(
		args: Parameters<TestbedBackend["exec"]>[0],
		_proc: ProcessRunner,
	): Promise<ExecResult> {
		void _proc;
		const r = await this.ensureRpc();
		const idx = args.req as unknown as { _index?: number };
		void idx;
		const last = r.commands[r.commands.length - 1];
		if (last === undefined) {
			return {
				exitCode: null,
				stdout: "",
				stderr: "",
				timedOut: false,
				durationMs: 0,
			};
		}
		return {
			exitCode: last.exitCode,
			stdout: last.stdout,
			stderr: last.stderr,
			timedOut: last.timedOut,
			durationMs: last.durationMs,
		};
	}

	async copyIn(
		_args: Parameters<TestbedBackend["copyIn"]>[0],
		_proc: ProcessRunner,
	): Promise<void> {
		void _args;
		void _proc;
		// The helper handles copy-in internally.
	}

	async copyOut(
		_args: Parameters<TestbedBackend["copyOut"]>[0],
		_proc: ProcessRunner,
	): Promise<CopyOutResult> {
		void _args;
		void _proc;
		const r = await this.ensureRpc();
		const last = r.artifacts[r.artifacts.length - 1];
		if (last === undefined || !last.exists) {
			return { exists: false, byteSize: 0, sha256: "" };
		}
		return {
			exists: true,
			byteSize: last.byteSize ?? 0,
			sha256: last.sha256 ?? "",
		};
	}

	async stop(
		_args: Parameters<TestbedBackend["stop"]>[0],
		_proc: ProcessRunner,
	): Promise<void> {
		void _args;
		void _proc;
		// The helper handles teardown internally.
	}

	async destroy(
		_args: Parameters<TestbedBackend["destroy"]>[0],
		_proc: ProcessRunner,
	): Promise<void> {
		void _args;
		void _proc;
		// The helper handles teardown internally.
	}
}

// =============================================================================
// LaunchdTestbedRunner — the single-RPC entry point that returns a
// TestbedResult-shaped object. Real callers (e.g. the CLI's
// `--backend launchd-tart` flag) use this to drive the helper.
// =============================================================================

export interface LaunchdTestbedRunnerOptions {
	readonly transport: HostHelperTransport;
	/** Override for the underlying method name (used by tests). */
	readonly methodName?: string;
	/** Override the request id generator (used by tests). */
	readonly requestIdFn?: () => string;
}

function mirrorStep(s: RpcStepRecord): StepRecord {
	const rec: StepRecord = {
		name: s.name,
		startedAt: s.startedAt,
		finishedAt: s.finishedAt,
		durationMs: s.durationMs,
		status: s.status,
	};
	if (s.detail !== undefined) (rec as { detail?: string }).detail = s.detail;
	return rec;
}

function mirrorCommand(c: RpcCommandRecord): CommandRecord {
	const rec: CommandRecord = {
		index: c.index,
		argv: c.argv,
		startedAt: c.startedAt,
		finishedAt: c.finishedAt,
		durationMs: c.durationMs,
		exitCode: c.exitCode,
		stdout: c.stdout,
		stderr: c.stderr,
		timedOut: c.timedOut,
		status: c.status,
	};
	if (c.label !== undefined) (rec as { label?: string }).label = c.label;
	if (c.cwd !== undefined) (rec as { cwd?: string }).cwd = c.cwd;
	if (c.env !== undefined)
		(rec as { env?: Readonly<Record<string, string>> }).env = c.env;
	return rec;
}

function mirrorArtifact(a: RpcArtifactRecord): ArtifactRecord {
	const rec: ArtifactRecord = {
		guestPath: a.guestPath,
		hostDestination: a.hostDestination,
		required: a.required,
		exists: a.exists,
		byteSize: a.byteSize,
		sha256: a.sha256,
		status: a.status,
	};
	if (a.error !== undefined) (rec as { error?: string }).error = a.error;
	return rec;
}

function mirrorTeardown(t: RpcTeardownRecord): TeardownRecord {
	const rec: TeardownRecord = {
		status: t.status,
		stopStatus: t.stopStatus,
		deleteStatus: t.deleteStatus,
		kept: t.kept,
	};
	if (t.error !== undefined) (rec as { error?: string }).error = t.error;
	return rec;
}

/**
 * Convert a helper response body to a TestbedResult-shaped object.
 * Mirrors the existing types without redefining them.
 */
export function toTestbedResult(
	body: TartTestbedRunResultBody,
	backendName: string,
	host: HostClassification,
): TestbedResult {
	const baseFields = {
		schemaVersion: 1 as const,
		runId: body.runId,
		backend: backendName,
		image: "",
		vmName: body.vmName,
		hostPlatform: host,
		startedAt: body.startedAt,
		finishedAt: body.finishedAt,
		durationMs: body.durationMs,
		steps: body.steps.map(mirrorStep),
		commands: body.commands.map(mirrorCommand),
		artifacts: body.artifacts.map(mirrorArtifact),
		teardown: mirrorTeardown(body.teardown),
		overallStatus: body.teardown.kept
			? ("KEEP_VM" as const)
			: (body.overallStatus as TestbedResult["overallStatus"]),
	};
	const result: TestbedResult =
		body.failureReason !== undefined && body.failureCode !== undefined
			? {
					...baseFields,
					failureReason: body.failureReason,
					failureCode: body.failureCode as TestbedResult["failureCode"],
				}
			: body.failureReason !== undefined
				? { ...baseFields, failureReason: body.failureReason }
				: body.failureCode !== undefined
					? {
							...baseFields,
							failureCode: body.failureCode as TestbedResult["failureCode"],
						}
					: baseFields;
	return result;
}

/**
 * The narrow input the runner accepts. It is a struct-equivalent of
 * `TestbedSpec` minus the non-bounded fields (Tart executable, cwd,
 * env at the host level, etc. — none of which are caller-selectable
 * over the RPC). Callers compose this from `TestbedSpec` on their side.
 */
export interface LaunchdTestbedRunnerInput {
	readonly image: string;
	readonly vmNamePrefix?: string;
	readonly runId?: string;
	readonly sshUser?: string;
	readonly sshIdentityFile?: string;
	readonly knownHostsContents?: string;
	readonly commands: readonly {
		readonly argv: readonly string[];
		readonly cwd?: string;
		readonly env?: Readonly<Record<string, string>>;
		readonly timeoutMs?: number;
		readonly label?: string;
		readonly failOnNonZero?: boolean;
	}[];
	readonly artifacts?: readonly {
		readonly guestPath: string;
		readonly hostDestination: string;
		readonly required: boolean;
	}[];
	readonly timeouts?: RpcTestbedTimeouts;
	readonly keepVm?: boolean;
	readonly metadata?: Readonly<Record<string, string>>;
}

export class LaunchdTestbedRunner {
	private readonly transport: HostHelperTransport;
	private readonly methodName: string;
	private readonly requestIdFn: () => string;

	constructor(opts: LaunchdTestbedRunnerOptions) {
		this.transport = opts.transport;
		this.methodName = opts.methodName ?? "tart.testbed.run";
		this.requestIdFn =
			opts.requestIdFn ??
			((): string =>
				`launchd-tart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
	}

	/**
	 * Run ONE semantic Tart testbed RPC through the helper. Returns the
	 * helper's structured response mirrored into a TestbedResult-shaped
	 * object.
	 */
	async run(
		input: LaunchdTestbedRunnerInput,
		host: HostClassification,
	): Promise<TestbedResult> {
		const validation = buildTestbedRunBody({
			image: input.image,
			...(input.vmNamePrefix !== undefined
				? { vm_name_prefix: input.vmNamePrefix }
				: {}),
			...(input.runId !== undefined ? { run_id: input.runId } : {}),
			...(input.sshUser !== undefined ? { ssh_user: input.sshUser } : {}),
			...(input.sshIdentityFile !== undefined
				? { ssh_identity_file: input.sshIdentityFile }
				: {}),
			...(input.knownHostsContents !== undefined
				? { known_hosts_contents: input.knownHostsContents }
				: {}),
			commands: input.commands.map((c) => ({
				argv: c.argv,
				...(c.cwd !== undefined ? { cwd: c.cwd } : {}),
				...(c.env !== undefined ? { env: c.env } : {}),
				...(c.timeoutMs !== undefined ? { timeoutMs: c.timeoutMs } : {}),
				...(c.label !== undefined ? { label: c.label } : {}),
				...(c.failOnNonZero !== undefined
					? { failOnNonZero: c.failOnNonZero }
					: {}),
			})),
			...(input.artifacts !== undefined
				? {
						artifacts: input.artifacts.map((a) => ({
							guestPath: a.guestPath,
							hostDestination: a.hostDestination,
							required: a.required,
						})),
					}
				: {}),
			...(input.timeouts !== undefined ? { timeouts: input.timeouts } : {}),
			...(input.keepVm !== undefined ? { keep_vm: input.keepVm } : {}),
			...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
		});
		if (!validation.ok) {
			throw new TestbedError("TESTBED_PREPARE_FAILED", validation.error);
		}

		const requestId = this.requestIdFn();
		const resp = await this.transport.call<
			TartTestbedRunBody,
			TartTestbedRunResultBody
		>({
			method: this.methodName,
			requestId,
			body: validation.value.body,
		});
		if (!resp.ok) {
			throw classifyRpcError((resp as HostHelperErrorResponse).error);
		}

		const body = (resp as HostHelperOkResponse<TartTestbedRunResultBody>)
			.result;
		return toTestbedResult(body, this.methodName, host);
	}
}

/**
 * Map a helper error string to a TestbedError. The set is closed; any
 * unrecognised error maps to TESTBED_INTERNAL_ERROR.
 */
export function classifyRpcError(err: string): TestbedError {
	const code = rpcErrorCodeToTestbedErrorCode(err);
	if (code === null) {
		return new TestbedError("TESTBED_INTERNAL_ERROR", err);
	}
	return new TestbedError(code, err);
}

function rpcErrorCodeToTestbedErrorCode(err: string): TestbedErrorCode | null {
	switch (err) {
		case "BAD_REQUEST":
		case "BAD_JSON":
		case "UNSUPPORTED_VERSION":
		case "MISSING_REQUEST_ID":
		case "OVERSIZE":
		case "EXEC_SHAPED_PAYLOAD":
		case "WRONG_TYPE":
		case "METHOD_NOT_ALLOWED":
		case "BAD_FIELD_TYPE":
		case "MISSING_REQUIRED_FIELD":
		case "UNKNOWN_FIELD":
		case "TIMEOUT":
		case "METHOD_NOT_AVAILABLE_IN_TS_FALLBACK":
		case "TESTBED_INTERNAL_ERROR":
		case "TESTBED_REQUEST_OVERSIZED":
			return "TESTBED_INTERNAL_ERROR";
		case "TESTBED_PREPARE_FAILED":
			return "TESTBED_PREPARE_FAILED";
		case "TART_CLONE_FAILED":
			return "TART_CLONE_FAILED";
		case "TART_START_FAILED":
			return "TART_START_FAILED";
		case "TART_IP_TIMEOUT":
			return "TART_IP_TIMEOUT";
		case "TART_SSH_TIMEOUT":
			return "TART_SSH_TIMEOUT";
		case "TART_STOP_FAILED":
			return "TART_STOP_FAILED";
		case "TART_DELETE_FAILED":
			return "TART_DELETE_FAILED";
		case "TESTBED_COPY_IN_FAILED":
			return "TESTBED_COPY_IN_FAILED";
		case "TESTBED_COPY_OUT_FAILED":
			return "TESTBED_COPY_OUT_FAILED";
		case "TESTBED_VM_OWNERSHIP_UNPROVEN":
			return "TESTBED_VM_OWNERSHIP_UNPROVEN";
		case "TESTBED_REQUIRED_ARTIFACT_MISSING":
			return "TESTBED_REQUIRED_ARTIFACT_MISSING";
		case "TESTBED_UNAVAILABLE":
			return "TESTBED_UNAVAILABLE";
		default:
			return null;
	}
}
