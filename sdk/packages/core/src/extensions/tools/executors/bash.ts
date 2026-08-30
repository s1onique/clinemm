/**
 * Bash Executor
 *
 * Built-in implementation for running shell commands using Node.js spawn.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	createWriteStream,
	type Dirent,
	mkdtempSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
	type AgentToolContext,
	getDefaultShell,
	getShellInvocation,
} from "@cline/shared";
import type { EnvironmentSemantics } from "../../../runtime/sandbox/types";
import {
	type ProcessStartTokenProbeResult,
	probeProcessStartTokenAsync,
} from "../../../runtime/process-start-token";
import { TimeoutError } from "../helpers";

/**
 * ACT-CLINEMM-COMMAND-EXECUTOR-BASH-STARTUP-ENV-AUTHORITY01 + -FUNCTION-ENV-AUTHORITY01:
 * Inherited environment variables that bash (or POSIX sh)
 * parses at NON-INTERACTIVE STARTUP BEFORE the supplied
 * command string. If any of these is set in the parent
 * environment, bash sources / uses them BEFORE running
 * `bash -c <command>`, which would let hostile or surprising
 * parent env run arbitrary code before the policy-authorized
 * command.
 *
 * Reference: GNU Bash Reference Manual, Bash Startup Files.
 *   "When Bash is invoked as a non-interactive shell (e.g.,
 *    via bash -c), it looks for BASH_ENV in the environment,
 *    and if it is defined, expands the value of that variable
 *    and uses the expanded value as a file to source BEFORE
 *    executing the supplied command string."
 *
 * `--noprofile` / `--norc` alone is INSUFFICIENT for BASH_ENV;
 * bash documents BASH_ENV separately from profile / rcfile
 * machinery.
 *
 * Reference: GNU Bash Reference Manual, Shell Functions
 * (https://www.gnu.org/s/bash/manual/html_node/Shell-Functions.html).
 *   "When a function is exported using export -f, its body is
 *    encoded and made available to child bash processes via
 *    the BASH_FUNC_funcname%% environment variable. The
 *    imported function shadows any command of the same name
 *    that bash would otherwise find via PATH or builtin
 *    lookup. This includes bare-form commands such as pwd,
 *    ls, git, etc. -- slash-bypass (per GNU Bash, Command
 *    Search and Execution: command names with a slash are
 *    executed as pathnames without function/builtin lookup)
 *    does NOT close this channel because bare commands have
 *    no slash."
 *
 * Variables in this set (exact match):
 *   BASH_ENV   bash sources $BASH_ENV at non-interactive
 *              startup (verified live as load-bearing channel
 *              for P0-4 in red-p0-4-bash-env-startup.txt)
 *   ENV        POSIX sh analogue: sources $ENV at startup
 *              (defensive; bash inherits POSIX semantics)
 *   SHELLOPTS  bash applies each colon-separated option in
 *              SHELLOPTS at startup (e.g. SHELLOPTS=errexit
 *              would change exit-on-error semantics of the
 *              authorized command)
 *   BASHOPTS   analogous to SHELLOPTS for `shopt` options
 *
 * PREFIX-MATCHED (any name starting with the prefix):
 *   BASH_FUNC_ bash encodes exported functions as
 *              `BASH_FUNC_<funcname>%%`. The trailing `%%`
 *              is part of the name, not a separate token;
 *              any name with the `BASH_FUNC_` prefix
 *              participates in function-import at non-
 *              interactive startup. We strip by prefix
 *              rather than enumerate because the funcname
 *              space is unbounded.
 *
 * Variables NOT in this set (deliberately):
 *   PATH, TERM, LANG, LC_ALL, etc. -- ordinary env;
 *     conservative
 *   caller-supplied env (e.g., `env: { SHELL: shell }`
 *     from apps/vscode/src/sdk/command-job-manager.ts:640)
 *     -- caller-controlled, trusted. Provenance: `SHELL`
 *     comes from `getShellInvocation()` which returns a
 *     fixed mapping (`/bin/bash` on Unix, `powershell` on
 *     Windows), not user/tool-controlled values.
 *
 * Under envSemantics: "complete" (sanitized Seatbelt mode),
 * the materialized env already excludes these by construction
 * (they are not in SAFE_ENVIRONMENT_BASELINE or in any
 * default allow list), so this filter is a NO-OP there.
 * The filter is ONLY active under envSemantics: "overlay"
 * or undefined (the DEFAULT_OFF contract).
 */
const BASH_STARTUP_STRIPPABLE_ENV: ReadonlySet<string> = new Set([
  "BASH_ENV",
  "ENV",
  "SHELLOPTS",
  "BASHOPTS",
]);

/**
 * Prefixed names that bash treats specially at non-interactive
 * startup. We strip by prefix rather than enumerating because
 * the function-name space is unbounded (any name following
 * `BASH_FUNC_` participates in function-import).
 *
 * Format: `BASH_FUNC_<funcname>%%` per GNU Bash Reference Manual,
 * Shell Functions. The trailing `%%` is part of the variable
 * name (a separator that cannot legally appear in a shell
 * function name), not a parameter-expansion operator.
 */
const BASH_FUNC_PREFIX = "BASH_FUNC_";

/**
 * Return a copy of `env` with the bash-startup-affecting
 * variables stripped. Caller's `env` (typically config.env)
 * is preserved; only the inherited process.env layer is
 * filtered. This is intentional: the caller is trusted; the
 * parent environment is not.
 *
 * Stripped:
 *   - exact-match names in BASH_STARTUP_STRIPPABLE_ENV
 *     (BASH_ENV, ENV, SHELLOPTS, BASHOPTS)
 *   - any name with the BASH_FUNC_ prefix (exported
 *     function encodings; the funcname space is unbounded
 *     so we strip by prefix)
 */
function stripBashStartupEnvFromParent(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (BASH_STARTUP_STRIPPABLE_ENV.has(key)) {
      continue;
    }
    if (key.startsWith(BASH_FUNC_PREFIX)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}
import type { ShellExecutor } from "../types";
import {
	MAX_COMMAND_OUTPUT_CHARS,
	truncateCommandOutput,
} from "./output-limits";
import type { RunCommandExecutionController } from "./run-command-execution-controller";

const MAX_DETACHED_LOG_BYTES = 10 * 1024 * 1024;
const DEFAULT_DETACHED_LOG_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_ACTIVE_COMMAND_POLL_INTERVAL_MS = 60_000;
const DETACHED_LOG_DIRECTORY_PREFIX = "cline-command-";
const DETACHED_LOG_FILENAME = "output.log";
const DETACHED_LOG_ACTIVE_COMMAND_FILENAME = "active-command.json";
const DETACHED_LOG_COMPLETED_FILENAME = "completed-at";
const COMMAND_PROGRESS_FLUSH_INTERVAL_MS = 48;

type CommandProgressStream = "stdout" | "stderr";

export type ProcessStartTokenProbe = (
	pid: number,
) => ProcessStartTokenProbeResult | Promise<ProcessStartTokenProbeResult>;

export interface DetachedCommandLogCleanupOptions {
	tempDirectory?: string;
	retentionMs?: number;
	nowMs?: number;
	processStartTokenProbe?: ProcessStartTokenProbe;
	activeCommandPollIntervalMs?: number;
}

type DetachedCommandMarker = {
	version: 1;
	executionId: string;
	pid: number;
	processStartToken: string;
	detachedAtMs: number;
};

function resolveDetachedLogRetentionMs(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, value)
		: DEFAULT_DETACHED_LOG_RETENTION_MS;
}

function resolveActiveCommandPollIntervalMs(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(1, value)
		: DEFAULT_ACTIVE_COMMAND_POLL_INTERVAL_MS;
}

type ResolvedDetachedCommandLogCleanupOptions = {
	retentionMs: number;
	nowMs: number;
	probeProcessStartToken: ProcessStartTokenProbe;
	activeCommandPollIntervalMs: number;
};

function parseDetachedCommandMarker(
	text: string,
): DetachedCommandMarker | undefined {
	try {
		const marker = JSON.parse(text) as Partial<DetachedCommandMarker>;
		if (
			marker.version !== 1 ||
			typeof marker.executionId !== "string" ||
			marker.executionId.length === 0 ||
			!Number.isSafeInteger(marker.pid) ||
			(marker.pid ?? 0) <= 0 ||
			typeof marker.processStartToken !== "string" ||
			marker.processStartToken.length === 0 ||
			typeof marker.detachedAtMs !== "number" ||
			!Number.isFinite(marker.detachedAtMs) ||
			marker.detachedAtMs < 0
		) {
			return undefined;
		}
		return marker as DetachedCommandMarker;
	} catch {
		return undefined;
	}
}

function writeLifecycleMarker(path: string, text: string): void {
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporaryPath, text, "utf8");
		try {
			renameSync(temporaryPath, path);
		} catch (error) {
			// Windows does not replace an existing destination atomically. Existing
			// lifecycle markers are only replaced when corrupt, so remove that
			// unusable generation before installing the valid one.
			if (
				error instanceof Error &&
				"code" in error &&
				["EEXIST", "EPERM"].includes(
					String((error as NodeJS.ErrnoException).code),
				)
			) {
				rmSync(path, { force: true });
				renameSync(temporaryPath, path);
			} else {
				throw error;
			}
		}
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

function parseCompletedAtMs(
	text: string | undefined,
	nowMs: number,
): number | undefined {
	const normalized = text?.trim();
	if (!normalized) return undefined;
	const value = Number(normalized);
	if (!Number.isFinite(value) || value < 0) return undefined;
	// Clock rollback or corrupt future timestamps must not retain a log beyond
	// one full inspection window from this reconciliation.
	return Math.min(value, nowMs);
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		) {
			return undefined;
		}
		throw error;
	}
}

async function reconcileDetachedCommandLogDirectory(
	directory: string,
	options: ResolvedDetachedCommandLogCleanupOptions,
): Promise<boolean> {
	const activeCommandPath = join(
		directory,
		DETACHED_LOG_ACTIVE_COMMAND_FILENAME,
	);
	const completedAtPath = join(directory, DETACHED_LOG_COMPLETED_FILENAME);
	const completedAtText = await readOptionalTextFile(completedAtPath);
	let retentionStartedAtMs = parseCompletedAtMs(completedAtText, options.nowMs);
	const activeCommandText = await readOptionalTextFile(activeCommandPath);
	if (retentionStartedAtMs !== undefined) {
		// Completion is written before the active marker is removed. Treat it as
		// authoritative after a host crash between those two operations.
		if (activeCommandText !== undefined) {
			await rm(activeCommandPath, { force: true });
		}
	} else if (activeCommandText !== undefined) {
		const marker = parseDetachedCommandMarker(activeCommandText);
		if (marker) {
			let probe: ProcessStartTokenProbeResult;
			try {
				probe = await options.probeProcessStartToken(marker.pid);
			} catch {
				// Custom identity providers can fail by rejecting instead of returning
				// an explicit unavailable result. Preserve the same conservative
				// lifecycle semantics and keep polling in either case.
				probe = { status: "unavailable" };
			}
			if (
				probe.status === "found" &&
				probe.token === marker.processStartToken
			) {
				// The detached command, rather than the host that launched it, owns the
				// active lifecycle. Matching both PID and kernel start token prevents a
				// later process that reuses the PID from extending this log's lifetime.
				scheduleActiveCommandLogReconciliation(directory, options);
				return false;
			}
			if (probe.status === "unavailable") {
				// An unavailable identity provider is not evidence that the command
				// exited. Keep the advertised log and retry until the provider can
				// prove either the same identity, a replacement process, or absence.
				scheduleActiveCommandLogReconciliation(directory, options);
				return false;
			}
		}
		// A missing process, mismatched identity, or malformed marker begins
		// bounded retention. Never fall back to PID-only polling.
		writeLifecycleMarker(completedAtPath, String(options.nowMs));
		await rm(activeCommandPath, { force: true });
		retentionStartedAtMs = options.nowMs;
	}

	if (retentionStartedAtMs === undefined) {
		// Logs without lifecycle markers use their last write as a best-effort
		// fallback so malformed or interrupted state cannot accumulate forever.
		try {
			retentionStartedAtMs = (
				await stat(join(directory, DETACHED_LOG_FILENAME))
			).mtimeMs;
		} catch {
			retentionStartedAtMs = (await stat(directory)).mtimeMs;
		}
	}
	const cutoffMs = options.nowMs - options.retentionMs;
	if (retentionStartedAtMs > cutoffMs) {
		scheduleDetachedLogCleanup(
			directory,
			Math.max(0, retentionStartedAtMs + options.retentionMs - options.nowMs),
		);
		return false;
	}
	await rm(directory, { recursive: true, force: true });
	return true;
}

function scheduleActiveCommandLogReconciliation(
	directory: string,
	options: ResolvedDetachedCommandLogCleanupOptions,
	delayMs = options.activeCommandPollIntervalMs,
): void {
	const timer = setTimeout(() => {
		void reconcileDetachedCommandLogDirectory(directory, {
			...options,
			nowMs: Date.now(),
		}).catch(() => undefined);
	}, delayMs);
	timer.unref();
}

/**
 * Reaps completed detached command logs outside the retention window,
 * schedules retained logs for their remaining lifetime, and follows active
 * command identities until they exit. Local runtime hosts call this at startup
 * so cleanup survives host exits and restarts instead of depending only on the
 * process that launched the command.
 */
export async function cleanupStaleDetachedCommandLogs(
	options: DetachedCommandLogCleanupOptions = {},
): Promise<number> {
	const tempDirectory = options.tempDirectory ?? tmpdir();
	const retentionMs = resolveDetachedLogRetentionMs(options.retentionMs);
	const nowMs = options.nowMs ?? Date.now();
	const probeProcessStartToken =
		options.processStartTokenProbe ?? probeProcessStartTokenAsync;
	const activeCommandPollIntervalMs = resolveActiveCommandPollIntervalMs(
		options.activeCommandPollIntervalMs,
	);
	let entries: Dirent[];
	try {
		entries = await readdir(tempDirectory, { withFileTypes: true });
	} catch {
		return 0;
	}

	let removed = 0;
	for (const entry of entries) {
		if (
			!entry.isDirectory() ||
			!entry.name.startsWith(DETACHED_LOG_DIRECTORY_PREFIX)
		) {
			continue;
		}
		const directory = join(tempDirectory, entry.name);
		try {
			if (
				await reconcileDetachedCommandLogDirectory(directory, {
					retentionMs,
					nowMs,
					probeProcessStartToken,
					activeCommandPollIntervalMs,
				})
			) {
				removed += 1;
			}
		} catch {
			// Cleanup is best effort: one inaccessible or concurrently removed log
			// must not prevent the Hub from starting or other logs from being reaped.
		}
	}
	return removed;
}

export class CommandExitError extends Error {
	constructor(
		readonly exitCode: number,
		readonly output: string,
	) {
		super(`Command exited with code ${exitCode}`);
		this.name = "CommandExitError";
	}
}

/**
 * Options for the shell executor
 */
export interface ShellExecutorOptions {
	/**
	 * Shell to use for execution
	 * @default "/bin/bash" on Unix, "powershell" on Windows
	 */
	shell?: string;

	/**
	 * Timeout for command execution in milliseconds
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number;

	/**
	 * Maximum output kept, in characters. Output beyond this is
	 * middle-truncated: the head and tail are preserved and the middle is
	 * elided, since build and test failures usually live at the end of the
	 * output.
	 * @default 48_000 — see MAX_COMMAND_OUTPUT_CHARS in output-limits.ts
	 */
	maxOutputChars?: number;

	/**
	 * @deprecated Misnamed — the limit was always enforced in characters,
	 * not bytes. Use {@link maxOutputChars}; this alias is honored when
	 * maxOutputChars is not set.
	 */
	maxOutputBytes?: number;

	/**
	 * Environment variables to add/override
	 */
	env?: Record<string, string>;

	/**
	 * Whether to combine stdout and stderr
	 * @default true
	 */
	combineOutput?: boolean;

	/**
	 * Optional host-scoped controller that can release an in-flight command
	 * from its tool call while continuing to drain output to a bounded log.
	 */
	executionController?: RunCommandExecutionController;

	/**
	 * How long a completed detached command log remains available before its
	 * temporary directory is removed.
	 *
	 * @default 24 hours
	 */
	detachedLogRetentionMs?: number;

	/** Process identity provider used to enable safe command detachment. */
	processStartTokenProbe?: ProcessStartTokenProbe;
}

interface SpawnConfig {
	executable: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
	input?: string;
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Optional env-merging semantics. When `undefined` (the legacy
	 * default), the supervisor spreads `process.env` underneath
	 * `config.env` — preserving exact pre-integration behavior for
	 * every existing caller. When `"complete"`, the supervisor uses
	 * `config.env` AS-IS (no spread) — this is the contract a sandbox
	 * backend produces for sanitized environments and is the
	 * load-bearing property that keeps the parent environment from
	 * leaking into the sandboxed child.
	 *
	 * Existing callers do not need to specify this; the undefined
	 * path preserves byte-equivalent behavior.
	 */
	envSemantics?: EnvironmentSemantics;
}

/**
 * Collects stream output with bounded memory: the first half of the budget
 * is kept verbatim, the rest rolls so the latest output always survives.
 */
function createRollingCollector(maxChars: number) {
	const headLimit = Math.ceil(maxChars / 2);
	const tailLimit = Math.max(1, maxChars - headLimit);
	// StringDecoder keeps multibyte UTF-8 sequences split across stream
	// chunks intact instead of corrupting them at chunk boundaries.
	const decoder = new StringDecoder("utf8");
	let head = "";
	let tail = "";
	let totalChars = 0;

	const appendText = (text: string): void => {
		if (!text) return;
		totalChars += text.length;
		const headRoom = headLimit - head.length;
		if (headRoom > 0) {
			head += text.slice(0, headRoom);
			tail = (tail + text.slice(headRoom)).slice(-tailLimit);
			return;
		}
		tail = (tail + text).slice(-tailLimit);
	};

	return {
		append(data: Buffer): string {
			const text = decoder.write(data);
			appendText(text);
			return text;
		},
		current() {
			return {
				text: head + tail,
				totalChars,
				dropped: totalChars > head.length + tail.length,
			};
		},
		snapshot() {
			// Flush bytes the decoder buffered for an incomplete multibyte
			// sequence at end-of-stream; otherwise the final characters of
			// non-ASCII output are silently dropped.
			const finalChunk = decoder.end();
			appendText(finalChunk);
			return {
				text: head + tail,
				totalChars,
				dropped: totalChars > head.length + tail.length,
				finalChunk,
			};
		},
	};
}

/**
 * Coalesces high-volume process output before it enters the runtime event
 * pipeline. Each stream keeps only a bounded pending tail and produces at
 * most one update per flush interval, preventing a noisy child process from
 * creating an unbounded queue of Hub and websocket events.
 */
function createCommandProgressEmitter(
	context: AgentToolContext,
	executionId: string,
	isDetachable: () => boolean,
	maxOutputChars: number,
) {
	const emitUpdate = context.emitUpdate;
	const maxPendingChars =
		typeof maxOutputChars === "number" && Number.isFinite(maxOutputChars)
			? Math.max(
					1,
					Math.floor(Math.min(MAX_COMMAND_OUTPUT_CHARS, maxOutputChars)),
				)
			: MAX_COMMAND_OUTPUT_CHARS;
	let pending: Partial<
		Record<CommandProgressStream, { chunk: string; droppedChars: number }>
	> = {};
	let streamOrder: CommandProgressStream[] = [];
	let flushTimer: NodeJS.Timeout | undefined;
	let stopped = false;

	const clearFlushTimer = () => {
		if (!flushTimer) return;
		clearTimeout(flushTimer);
		flushTimer = undefined;
	};

	const flush = () => {
		clearFlushTimer();
		if (!emitUpdate) {
			pending = {};
			streamOrder = [];
			return;
		}
		const buffered = pending;
		const order = streamOrder;
		pending = {};
		streamOrder = [];
		for (const stream of order) {
			const entry = buffered[stream];
			if (!entry?.chunk) continue;
			const marker =
				entry.droppedChars > 0
					? `\u001b[0m[${entry.droppedChars} command-output characters skipped while streaming]\n`
					: "";
			const markerFits = marker.length < maxPendingChars;
			const chunk = markerFits
				? marker + entry.chunk.slice(-(maxPendingChars - marker.length))
				: entry.chunk.slice(-maxPendingChars);
			emitUpdate({
				stream,
				chunk,
				executionId,
				detachable: isDetachable(),
				...(entry.droppedChars > 0
					? { truncated: true, droppedChars: entry.droppedChars }
					: {}),
			});
		}
	};

	const scheduleFlush = () => {
		if (!emitUpdate || flushTimer || stopped) return;
		flushTimer = setTimeout(flush, COMMAND_PROGRESS_FLUSH_INTERVAL_MS);
		flushTimer.unref();
	};

	return {
		append(stream: CommandProgressStream, text: string): void {
			if (!emitUpdate || stopped || !text) return;
			let entry = pending[stream];
			if (!entry) {
				entry = { chunk: "", droppedChars: 0 };
				pending[stream] = entry;
				streamOrder.push(stream);
			}
			if (text.length >= maxPendingChars) {
				entry.droppedChars +=
					entry.chunk.length + text.length - maxPendingChars;
				entry.chunk = text.slice(-maxPendingChars);
			} else {
				const overflow = entry.chunk.length + text.length - maxPendingChars;
				if (overflow > 0) {
					entry.droppedChars += overflow;
					entry.chunk = entry.chunk.slice(overflow);
				}
				entry.chunk += text;
			}
			scheduleFlush();
		},
		flush,
		stop(options: { flush?: boolean } = {}): void {
			if (stopped) return;
			if (options.flush) {
				flush();
			} else {
				clearFlushTimer();
				pending = {};
				streamOrder = [];
			}
			stopped = true;
		},
	};
}

function scheduleDetachedLogCleanup(
	directory: string,
	retentionMs: number,
): void {
	const cleanupTimer = setTimeout(() => {
		void rm(directory, { recursive: true, force: true }).catch(() => undefined);
	}, retentionMs);
	cleanupTimer.unref();
}

function createDetachedLog(retentionMs: number, marker: DetachedCommandMarker) {
	const directory = mkdtempSync(join(tmpdir(), DETACHED_LOG_DIRECTORY_PREFIX));
	const path = join(directory, DETACHED_LOG_FILENAME);
	const activeCommandPath = join(
		directory,
		DETACHED_LOG_ACTIVE_COMMAND_FILENAME,
	);
	const completedAtPath = join(directory, DETACHED_LOG_COMPLETED_FILENAME);
	try {
		writeLifecycleMarker(activeCommandPath, `${JSON.stringify(marker)}\n`);
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
	const stream = createWriteStream(path, { encoding: "utf8" });
	let bytesWritten = 0;
	let capped = false;
	let writable = true;
	let streamClosed = false;
	let completed = false;
	let cleanupScheduled = false;
	const scheduleCleanup = () => {
		if (cleanupScheduled) return;
		cleanupScheduled = true;
		scheduleDetachedLogCleanup(directory, retentionMs);
	};
	stream.on("error", () => {
		// The detached command has already released its caller. A late log write
		// failure must not become an unhandled stream error in the hub process.
		writable = false;
	});
	stream.once("close", () => {
		writable = false;
		streamClosed = true;
		if (completed) scheduleCleanup();
	});

	const complete = () => {
		if (completed) return;
		completed = true;
		try {
			writeLifecycleMarker(completedAtPath, String(Date.now()));
		} catch {
			// The startup reaper can fall back to the output timestamp if the
			// completion marker cannot be persisted.
		}
		try {
			rmSync(activeCommandPath, { force: true });
		} catch {
			// Cleanup remains best effort and must not surface from a stream event.
		}
		if (streamClosed) {
			scheduleCleanup();
			return;
		}
		writable = false;
		stream.end();
	};

	return {
		path,
		write(text: string): void {
			if (!text || capped || !writable) return;
			const remaining = MAX_DETACHED_LOG_BYTES - bytesWritten;
			if (remaining <= 0) {
				capped = true;
				writable = false;
				stream.end();
				return;
			}
			const data = Buffer.from(text, "utf8");
			const accepted =
				data.length <= remaining ? data : data.subarray(0, remaining);
			stream.write(accepted);
			bytesWritten += accepted.length;
			if (
				accepted.length < data.length ||
				bytesWritten >= MAX_DETACHED_LOG_BYTES
			) {
				capped = true;
				writable = false;
				stream.end();
			}
		},
		complete,
	};
}

/**
 * A long-lived shell process whose lifetime is owned by the caller.
 *
 * Unlike `createShellExecutor` — which kills the process when its internal
 * timer fires — this primitive lets the caller decide when to terminate
 * the child. The caller is responsible for any wait-budget race and any
 * execution-deadline timer. The wait-budget race must NOT call
 * `killTree()`; only the deadline (or an explicit cancel) may do so.
 *
 * Process-tree ownership mirrors the bash executor's
 * (`spawn(..., { detached: !isWindows })`); `killTree()` terminates the
 * entire group on POSIX (`process.kill(-pid, "SIGKILL")`) and uses
 * `taskkill /T /F` on Windows.
 */
export interface SupervisableShellProcess {
	/** Resolves when the child exits; rejects on spawn failure. */
	readonly exit: Promise<{
		exitCode: number | null;
		signal: NodeJS.Signals | null;
	}>;
	/** Terminate the owned process tree. Idempotent. */
	killTree(): Promise<void>;
	/**
	 * Send `gracefulSignal` to the OWNED PROCESS TREE (POSIX: the
	 * process group whose leader is the spawned shell; Windows: the
	 * shell + descendants reachable via `taskkill /T /F`), wait up
	 * to `graceMs` for the entire tree to terminate, then escalate
	 * to SIGKILL on the tree if any descendant is still alive.
	 *
	 * Resolves only after the entire owned tree is gone (or escalation
	 * completed and a hard deadline elapsed). The result reports
	 * whether escalation to a forceful signal was needed.
	 *
	 * The grace race watches PROCESS GROUP EXISTENCE, not just the
	 * shell's exit promise. This is the CORRECTION03 invariant: a
	 * child that exits but leaves a SIGTERM-ignoring descendant in
	 * the owned process group MUST NOT suppress the SIGKILL escalation.
	 *
	 * Idempotent. Calling `terminateTree` while another is in flight
	 * returns the existing promise.
	 *
	 * ACT-CLINEMM-TRUSTED-BOUNDED-COMMAND-EXECUTION01-CORRECTION03:
	 * This primitive exists because the higher-level supervisor
	 * previously raced against `exit` (the shell's exit promise) and
	 * skipped the SIGKILL escalation whenever the shell cooperated,
	 * even if descendants remained alive.
	 */
	terminateTree(opts: {
		gracefulSignal: NodeJS.Signals;
		graceMs: number;
	}): Promise<TerminateTreeResult>;
	/** Snapshot of retained stdout (truncated to maxOutputChars). */
	stdoutSnapshot(): { text: string; totalChars: number; dropped: boolean };
	/** Snapshot of retained stderr (truncated to maxOutputChars). */
	stderrSnapshot(): { text: string; totalChars: number; dropped: boolean };
	/** PID of the spawned child, or undefined if spawn failed. */
	readonly pid: number | undefined;
}

/**
 * Result of a `terminateTree` call.
 *
 * - `treeTerminated` is true when the entire owned process tree was
 *   observed gone (POSIX: ESRCH on PGID probe; Windows: taskkill
 *   completed) within `graceMs`.
 * - `escalatedToKill` is true when the grace expired and a forceful
 *   signal had to be issued to the tree.
 *
 * Both flags are observable to callers; the supervisor does not
 * silently swallow tree state.
 */
export interface TerminateTreeResult {
	treeTerminated: boolean;
	escalatedToKill: boolean;
}

function buildShellProcess(
	config: SpawnConfig,
	maxOutputChars: number,
	// Reserved for callers that need to expose stderr separately. The
	// current callers always combine stdout/stderr at the snapshot
	// boundary, so the per-stream collectors are exposed as-is but
	// composed externally — the supervisable primitive keeps the
	// "stdout and stderr, separately retained" invariant simple.
	_combineOutput: boolean,
): SupervisableShellProcess {
	const isWindows = process.platform === "win32";

	// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	// Honor `config.envSemantics`. When undefined (legacy callers) or
	// "overlay", spread process.env underneath config.env — preserving
	// byte-equivalent pre-integration behavior. When "complete", use
	// config.env AS-IS — this is the CORRECTION01-P1 contract: a
	// sandbox backend producing "complete" semantics has already
	// computed the entire environment the child should see, including
	// a sanitized allowlist, and spreading process.env underneath
	// would silently re-introduce leaked secrets.
	//
	// ACT-CLINEMM-COMMAND-EXECUTOR-BASH-STARTUP-ENV-AUTHORITY01 + -FUNCTION-ENV-AUTHORITY01:
	// Under overlay semantics, the spread-merge inherits ALL of
	// process.env including bash-startup-affecting variables
	// (BASH_ENV, ENV, SHELLOPTS, BASHOPTS, BASH_FUNC_*). Bash
	// sources $BASH_ENV at non-interactive startup BEFORE parsing
	// -c <command>; inherited SHELLOPTS / BASHOPTS apply colon-
	// separated options at startup; inherited BASH_FUNC_<name>%%
	// exports import functions that shadow any command of the
	// same name (function > builtin > PATH lookup per GNU Bash).
	// This lets hostile or surprising parent env run arbitrary
	// code before / instead of the policy-authorized command.
	// We strip those variables from the inherited process.env
	// layer BEFORE the spread-merge. Caller's config.env is
	// preserved (caller-trusted).
	//
	// Under "complete" semantics, this filter is a NO-OP because
	// the materialized env is built from SAFE_ENVIRONMENT_BASELINE
	// + caller allow list (which does not include the bash-startup
	// variables by default).
	const childEnv =
		config.envSemantics === "complete"
			? config.env
			: { ...stripBashStartupEnvFromParent(process.env), ...config.env };

	const child = spawn(config.executable, config.args, {
		cwd: config.cwd,
		env: childEnv,
		stdio: ["pipe", "pipe", "pipe"],
		detached: !isWindows,
		windowsHide: true,
	});
	const childPid = child.pid;

	const stdout = createRollingCollector(maxOutputChars);
	const stderr = createRollingCollector(maxOutputChars);
	let killed = false;

	let exitResolve!: (value: {
		exitCode: number | null;
		signal: NodeJS.Signals | null;
	}) => void;
	let exitReject!: (error: Error) => void;

	const exitPromise = new Promise<{
		exitCode: number | null;
		signal: NodeJS.Signals | null;
	}>((resolve, reject) => {
		exitResolve = resolve;
		exitReject = reject;
	});

	const killProcessTree = async (): Promise<void> => {
		if (!childPid) return;
		if (isWindows) {
			await new Promise<void>((done) => {
				let finished = false;
				let killer: ReturnType<typeof spawn>;
				const finish = () => {
					if (finished) return;
					finished = true;
					clearTimeout(watchdog);
					done();
				};
				try {
					killer = spawn(
						"taskkill.exe",
						["/PID", String(childPid), "/T", "/F"],
						{ stdio: "ignore", shell: false, windowsHide: true },
					);
				} catch {
					child.kill();
					done();
					return;
				}
				const watchdog = setTimeout(() => {
					killer.kill();
					child.kill();
					finish();
				}, 5_000);
				killer.once("error", () => {
					child.kill();
					finish();
				});
				killer.once("close", (code) => {
					if (code !== 0) child.kill();
					finish();
				});
			});
			return;
		}
		try {
			process.kill(-childPid, "SIGKILL");
		} catch {
			child.kill("SIGKILL");
		}
	};

	/**
	 * POSIX: probe whether a process group with the given PGID still
	 * exists. Uses `process.kill(-pgid, 0)` which returns:
	 *   - no error   → group exists
	 *   - ESRCH      → group does not exist (every member terminated)
	 *   - EPERM      → group exists but we cannot signal it
	 *
	 * PGID-reuse safety: a PGID is freed only when ALL processes in
	 * that group have terminated, by POSIX semantics. So observing
	 * ESRCH on `-pgid` is a sound "tree is gone" signal for the
	 * duration of our ownership window (the OS will not reassign a
	 * freed PGID while any descendant remains).
	 *
	 * Note: this does not detect a descendant that has called
	 * `setpgid()` to escape into a different process group. The
	 * supervisor does not attempt to follow such a child — once a
	 * child opts out of our group, the host cannot reclaim it
	 * without explicit PID tracking, which is out of scope here.
	 */
	const probePgidExists = (pgid: number): boolean => {
		try {
			process.kill(-pgid, 0);
			return true;
		} catch (err: unknown) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ESRCH") return false;
			// EPERM, EINVAL, etc.: treat as "still exists" so we
			// don't prematurely stop waiting on the grace window.
			return true;
		}
	};

	/**
	 * Send `signal` to the owned process group. No-op if the group is
	 * already gone. Never throws.
	 */
	const signalGroup = (signal: NodeJS.Signals): void => {
		if (!childPid) return;
		try {
			process.kill(-childPid, signal);
		} catch {
			// Group already gone, or we lack permission; both are
			// best-effort for the graceful signal.
		}
	};

	/**
	 * Wait up to `graceMs` for the PG to vanish, polling every 50ms.
	 * Resolves with `true` if the group was observed gone within the
	 * window, `false` otherwise.
	 */
	const waitForGroupGone = async (
		pgid: number,
		graceMs: number,
	): Promise<boolean> => {
		const startMs = Date.now();
		while (Date.now() - startMs < graceMs) {
			if (!probePgidExists(pgid)) return true;
			await new Promise((r) => setTimeout(r, 50));
		}
		return !probePgidExists(pgid);
	};

	let terminateInFlight: Promise<TerminateTreeResult> | undefined;
	const terminateTree = async (opts: {
		gracefulSignal: NodeJS.Signals;
		graceMs: number;
	}): Promise<TerminateTreeResult> => {
		if (terminateInFlight) return terminateInFlight;
		terminateInFlight = (async () => {
			if (!childPid) {
				return { treeTerminated: true, escalatedToKill: false };
			}
			// POSIX: race PGID existence against the grace window.
			// Windows: defer to taskkill + wait via the existing path.
			if (isWindows) {
				// On Windows there is no portable PGID probe. Issue
				// the graceful signal directly to the shell, then
				// wait for the exit promise, then escalate via the
				// existing killTree path. The shell's descendants
				// will be torn down by the taskkill /T flag in
				// killProcessTree.
				try {
					child.kill(opts.gracefulSignal);
				} catch {
					// Already gone.
				}
				const exited = await Promise.race([
					exitPromise.then(
						() => true,
						() => true,
					),
					new Promise<boolean>((resolve) =>
						setTimeout(() => resolve(false), opts.graceMs),
					),
				]);
				if (exited) {
					return { treeTerminated: true, escalatedToKill: false };
				}
				await killProcessTree();
				return { treeTerminated: true, escalatedToKill: true };
			}
			// POSIX: send to the owned PG, not just the leader.
			signalGroup(opts.gracefulSignal);
			const treeTerminated = await waitForGroupGone(childPid, opts.graceMs);
			if (treeTerminated) {
				return { treeTerminated: true, escalatedToKill: false };
			}
			// Grace expired: escalate. SIGKILL on the PG, then wait
			// again (up to graceMs) for the group to vanish.
			signalGroup("SIGKILL");
			const finalGone = await waitForGroupGone(childPid, opts.graceMs);
			return { treeTerminated: finalGone, escalatedToKill: true };
		})();
		return terminateInFlight;
	};

	child.stdout?.on("data", (data: Buffer) => {
		stdout.append(data);
	});
	child.stderr?.on("data", (data: Buffer) => {
		stderr.append(data);
	});

	child.on("close", (code, signal) => {
		exitResolve({ exitCode: code, signal });
	});

	child.on("error", (error) => {
		if (killed) return;
		exitReject(new Error(`Failed to execute command: ${error.message}`));
	});

	child.stdin?.on("error", () => {
		// Mirror bash executor: input errors abort the process. The caller
		// observes failure through `exit`.
	});
	child.stdin?.end(config.input, "utf8");

	let treeKilled = false;
	return {
		exit: exitPromise,
		pid: childPid,
		stdoutSnapshot: () => stdout.snapshot(),
		stderrSnapshot: () => stderr.snapshot(),
		killTree: async () => {
			if (treeKilled) return;
			treeKilled = true;
			killed = true;
			await killProcessTree();
		},
		terminateTree,
	};
}

function spawnAndCollect(
	config: SpawnConfig,
	context: AgentToolContext,
	timeoutMs: number,
	maxOutputChars: number,
	combineOutput: boolean,
	detachedLogRetentionMs: number,
	executionController?: RunCommandExecutionController,
	processStartTokenProbe: ProcessStartTokenProbe = probeProcessStartTokenAsync,
): Promise<string> {
	if (context.signal?.aborted) {
		return Promise.reject(new Error("Command was aborted"));
	}
	return new Promise((resolve, reject) => {
		const isWindows = process.platform === "win32";

		const child = spawn(config.executable, config.args, {
			cwd: config.cwd,
			env: { ...process.env, ...config.env },
			stdio: ["pipe", "pipe", "pipe"],
			detached: !isWindows,
			// Prevent a console window from flashing on Windows when the
			// parent process has no console (or a different console).
			// No-op on non-Windows platforms.
			windowsHide: true,
		});
		const childPid = child.pid;

		const stdout = createRollingCollector(maxOutputChars);
		const stderr = createRollingCollector(maxOutputChars);
		const executionId = randomUUID();
		const supportsDetachment = Boolean(
			executionController && context.sessionId,
		);
		let detachable = false;
		let processStartToken: string | undefined;
		let killed = false;
		let settled = false;
		let detached = false;
		let detachedLog: ReturnType<typeof createDetachedLog> | undefined;
		let unregisterExecution = () => {};
		const progress = createCommandProgressEmitter(
			context,
			executionId,
			() => detachable,
			maxOutputChars,
		);

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			fn();
		};

		const killProcessTree = async (): Promise<void> => {
			if (!childPid) return;
			if (isWindows) {
				await new Promise<void>((done) => {
					let finished = false;
					let killer: ReturnType<typeof spawn>;
					const finish = () => {
						if (finished) return;
						finished = true;
						clearTimeout(watchdog);
						done();
					};
					try {
						killer = spawn(
							"taskkill.exe",
							["/PID", String(childPid), "/T", "/F"],
							{ stdio: "ignore", shell: false, windowsHide: true },
						);
					} catch {
						child.kill();
						done();
						return;
					}
					const watchdog = setTimeout(() => {
						killer.kill();
						child.kill();
						finish();
					}, 5_000);
					killer.once("error", () => {
						child.kill();
						finish();
					});
					killer.once("close", (code) => {
						if (code !== 0) child.kill();
						finish();
					});
				});
				return;
			}
			try {
				process.kill(-childPid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		};

		let timeout: NodeJS.Timeout;
		const abortHandler = () => killAndReject(new Error("Command was aborted"));
		const cleanup = () => {
			clearTimeout(timeout);
			context.signal?.removeEventListener("abort", abortHandler);
			unregisterExecution();
		};
		const killAndReject = (error: Error) => {
			if (killed || settled) return;
			killed = true;
			progress.stop({ flush: true });
			cleanup();
			void killProcessTree().finally(() => settle(() => reject(error)));
		};

		timeout = setTimeout(
			() =>
				killAndReject(
					new TimeoutError(`Command timed out after ${timeoutMs}ms`, timeoutMs),
				),
			timeoutMs,
		);

		if (context.signal) {
			context.signal.addEventListener("abort", abortHandler, { once: true });
			if (context.signal.aborted) abortHandler();
		}

		const detach = (): boolean => {
			if (
				!detachable ||
				killed ||
				settled ||
				!childPid ||
				child.exitCode !== null ||
				child.signalCode !== null
			) {
				return false;
			}
			if (!processStartToken) return false;
			const log = createDetachedLog(detachedLogRetentionMs, {
				version: 1,
				executionId,
				pid: childPid,
				processStartToken,
				detachedAtMs: Date.now(),
			});
			progress.stop({ flush: true });
			detached = true;
			detachedLog = log;
			const currentOut = stdout.current();
			const currentErr = stderr.current();
			detachedLog.write(currentOut.text);
			if (currentErr.text) {
				detachedLog.write(`\n[stderr]\n${currentErr.text}`);
			}
			cleanup();
			child.unref();
			(
				child.stdout as (typeof child.stdout & { unref?: () => void }) | null
			)?.unref?.();
			(
				child.stderr as (typeof child.stderr & { unref?: () => void }) | null
			)?.unref?.();
			const notice = [
				`[Command is still running. Output will continue in ${detachedLog.path}]`,
				combineOutput
					? currentOut.text +
						(currentErr.text ? `\n[stderr]\n${currentErr.text}` : "")
					: currentOut.text,
			]
				.filter(Boolean)
				.join("\n");
			settle(() => resolve(notice));
			return true;
		};

		child.once("spawn", () => {
			if (killed) return;
			context.emitUpdate?.({
				stream: "stdout",
				chunk: "",
				executionId,
				detachable: false,
			});
			const sessionId = context.sessionId;
			if (
				!supportsDetachment ||
				!childPid ||
				!sessionId ||
				!executionController
			) {
				return;
			}
			void (async () => {
				const probe = await processStartTokenProbe(childPid);
				if (
					probe.status !== "found" ||
					killed ||
					settled ||
					child.exitCode !== null ||
					child.signalCode !== null
				) {
					return;
				}
				processStartToken = probe.token;
				detachable = true;
				unregisterExecution = executionController.register({
					executionId,
					sessionId,
					toolCallId: context.toolCallId,
					detach,
				});
				context.emitUpdate?.({
					stream: "stdout",
					chunk: "",
					executionId,
					detachable: true,
				});
			})().catch(() => undefined);
		});

		child.stdout?.on("data", (data: Buffer) => {
			const chunk = stdout.append(data);
			if (!chunk) return;
			if (detached) {
				detachedLog?.write(chunk);
				return;
			}
			progress.append("stdout", chunk);
		});

		child.stderr?.on("data", (data: Buffer) => {
			const chunk = stderr.append(data);
			if (!chunk) return;
			if (detached) {
				detachedLog?.write(chunk);
				return;
			}
			progress.append("stderr", chunk);
		});

		child.on("close", (code) => {
			if (killed) return;

			const out = stdout.snapshot();
			const err = stderr.snapshot();
			if (detached) {
				detachedLog?.write(out.finalChunk);
				detachedLog?.write(err.finalChunk);
				detachedLog?.write(`\n[Command exited with code ${code ?? 1}]\n`);
				detachedLog?.complete();
				return;
			}
			if (out.finalChunk) {
				progress.append("stdout", out.finalChunk);
			}
			if (err.finalChunk) {
				progress.append("stderr", err.finalChunk);
			}
			progress.stop({ flush: true });
			cleanup();

			if (code !== 0) {
				const exitCode = code ?? 1;
				let failureOutput = combineOutput
					? out.text + (err.text ? `\n[stderr]\n${err.text}` : "")
					: out.text;
				const dropped = out.dropped || (combineOutput && err.dropped);
				const totalChars = combineOutput
					? out.totalChars + err.totalChars
					: out.totalChars;
				if (dropped || failureOutput.length > maxOutputChars) {
					failureOutput = truncateCommandOutput(failureOutput, {
						maxChars: maxOutputChars,
						totalChars,
					});
				}
				const result =
					failureOutput.length > 0
						? `[Command exited with code ${exitCode}]\n${failureOutput}`
						: `[Command exited with code ${exitCode}]`;
				settle(() => reject(new CommandExitError(exitCode, result)));
			} else {
				let output = combineOutput
					? out.text + (err.text ? `\n[stderr]\n${err.text}` : "")
					: out.text;
				const dropped = out.dropped || (combineOutput && err.dropped);
				if (dropped || output.length > maxOutputChars) {
					const totalChars = combineOutput
						? out.totalChars + err.totalChars
						: out.totalChars;
					output = truncateCommandOutput(output, {
						maxChars: maxOutputChars,
						totalChars,
					});
				}
				settle(() => resolve(output));
			}
		});

		child.on("error", (error) => {
			if (killed) return;
			if (detached) {
				detachedLog?.write(`\n[Command failed: ${error.message}]\n`);
				detachedLog?.complete();
				return;
			}
			progress.stop({ flush: true });
			cleanup();
			settle(() =>
				reject(new Error(`Failed to execute command: ${error.message}`)),
			);
		});

		child.stdin?.on("error", (error) => {
			if (killed || settled) return;
			killAndReject(
				new Error(`Failed to write command input: ${error.message}`),
			);
		});
		child.stdin?.end(config.input, "utf8");
	});
}

/**
 * Create a shell executor using Node.js spawn
 *
 * @example
 * ```typescript
 * const shell = createShellExecutor({
 *   timeoutMs: 60000, // 1 minute timeout
 *   shell: "/bin/zsh",
 * })
 *
 * const output = await shell("ls -la", "/path/to/project", context)
 * ```
 */
export function createShellExecutor(
	options: ShellExecutorOptions = {},
): ShellExecutor {
	const {
		shell = getDefaultShell(process.platform),
		timeoutMs = 30000,
		env = {},
		combineOutput = true,
		executionController,
		processStartTokenProbe = probeProcessStartTokenAsync,
	} = options;
	const detachedLogRetentionMs = resolveDetachedLogRetentionMs(
		options.detachedLogRetentionMs,
	);
	const maxOutputChars =
		options.maxOutputChars ??
		options.maxOutputBytes ??
		MAX_COMMAND_OUTPUT_CHARS;

	return (command, cwd, context) => {
		// Spawn without a shell only when the args key is present (even
		// empty), marking input the caller already split. An object with no
		// args key, like { command: "echo hello" }, holds a full command
		// line, and spawning that string as an executable fails with ENOENT.
		// Same key-presence rule as the VS Code host's formatCommandForTerminal.
		const directExec = typeof command !== "string" && "args" in command;
		const invocation = directExec
			? { args: command.args ?? [] }
			: getShellInvocation(
					shell,
					typeof command === "string" ? command : command.command,
				);
		return spawnAndCollect(
			{
				executable: directExec ? command.command : shell,
				args: invocation.args,
				cwd,
				env,
				input: invocation.input,
			},
			context,
			timeoutMs,
			maxOutputChars,
			combineOutput,
			detachedLogRetentionMs,
			executionController,
			processStartTokenProbe,
		);
	};
}

/**
 * Spawn a shell process whose lifetime is owned by the caller.
 *
 * Use this when the host needs to separate the *wait* budget from the
 * *execution* deadline. `createShellExecutor` couples the two: its
 * internal setTimeout fires `killTree()` on its own. This primitive
 * exposes `killTree()` so the caller can ignore the wait budget and only
 * enforce the (larger) execution deadline.
 *
 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
 * `envSemantics` may be supplied directly on `config` OR via `options`
 * (for backward-compatible option ergonomics). When either is `"complete"`,
 * the supervisor uses `config.env` AS-IS and does NOT spread `process.env`
 * underneath. This is the CORRECTION01-P1 contract a sandbox backend
 * produces for sanitized environments.
 */
export function spawnSupervisableShellCommand(
	config: SpawnConfig,
	options: {
		maxOutputChars?: number;
		combineOutput?: boolean;
		/**
		 * Optional env-merging semantics override. When set, takes
		 * precedence over `config.envSemantics`. Useful when the caller
		 * holds an immutable prepared invocation (e.g. a sandbox backend's
		 * `SandboxPreparedInvocation`) and wants to thread the semantics
		 * through the option surface instead of mutating the config.
		 */
		envSemantics?: EnvironmentSemantics;
	} = {},
): SupervisableShellProcess {
	const maxOutputChars = options.maxOutputChars ?? MAX_COMMAND_OUTPUT_CHARS;
	const combineOutput = options.combineOutput ?? true;
	const effective: SpawnConfig =
		options.envSemantics !== undefined ? { ...config, envSemantics: options.envSemantics } : config;
	return buildShellProcess(effective, maxOutputChars, combineOutput);
}

/**
 * Format a final shell-process snapshot into the same output shape that
 * `createShellExecutor` returns: success → stdout; failure →
 * `[Command exited with code N]\n<output>`.
 */
export function formatShellProcessOutput(
	process: SupervisableShellProcess,
	exitCode: number | null,
	maxOutputChars: number,
	combineOutput: boolean,
): { ok: true; output: string } | { ok: false; output: string } {
	const out = process.stdoutSnapshot();
	const err = process.stderrSnapshot();
	let output = combineOutput
		? out.text + (err.text ? `\n[stderr]\n${err.text}` : "")
		: out.text;
	const dropped = out.dropped || (combineOutput && err.dropped);
	if (dropped || output.length > maxOutputChars) {
		const totalChars = combineOutput
			? out.totalChars + err.totalChars
			: out.totalChars;
		output = truncateCommandOutput(output, {
			maxChars: maxOutputChars,
			totalChars,
		});
	}
	if (exitCode === 0) {
		return { ok: true, output };
	}
	const code = exitCode ?? 1;
	return {
		ok: false,
		output:
			output.length > 0
				? `[Command exited with code ${code}]\n${output}`
				: `[Command exited with code ${code}]`,
	};
}
