/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — C18 (ProcessRunner test seam)
 *
 * Minimal subprocess abstraction. The orchestrator + TartBackend
 * accept a `ProcessRunner` so unit tests don't have to monkeypatch
 * globals. The interface is intentionally narrow.
 *
 * Why argv and not "shell":
 *   - hostile input (`image='a; rm -rf /'`) must remain ONE argv
 *     element (C3 hard rule). Shell strings defeat that.
 *   - cross-platform argv handling is simpler and observable.
 */

export interface ProcessRunRequest {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string | Uint8Array;
  /** ms before the runner forcibly terminates the child. */
  readonly timeoutMs?: number;
  /** Optional: cap captured stdout/stderr bytes (default 1 MiB each). */
  readonly maxOutputBytes?: number;
}

export interface ProcessRunResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** The child pid, when the runner can resolve it before exit. */
  readonly pid?: number;
}

/**
 * Spawn a long-lived (daemon-like) process WITHOUT awaiting its
 * exit. Used for things like `tart run --no-graphics` which are
 * intentionally long-running foreground processes; consumers must
 * call `handle.terminate()` / `handle.kill()` to end them.
 *
 * Why this is separate from `run()`:
 *   - `run()` is bounded: it captures stdout/stderr and resolves
 *     when the child exits (or after `timeoutMs` it SIGKILLs).
 *   - SIGKILLing `tart run` after 1500ms is not a valid lifecycle:
 *     it tears the VM down. So daemon-like processes need a
 *     primitive that does NOT apply a timeout.
 */
export interface SpawnRequest {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Process handle returned by `spawn()`. The owner is responsible
 * for awaiting `exited` (or `terminate`/`kill`) so the runner can
 * release any associated resources.
 */
export interface ProcessHandle {
  readonly pid: number | undefined;
  /** Resolves when the child exits (cleanly or via signal). */
  readonly exited: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>;
  /** Readable stream for the child's stdout, or null if not piped. */
  readonly stdout: ReadableStream<Uint8Array> | null;
  /** Readable stream for the child's stderr, or null if not piped. */
  readonly stderr: ReadableStream<Uint8Array> | null;
  /** Polite termination (default SIGTERM). Resolves when child has exited. */
  terminate(signal?: NodeJS.Signals): Promise<void>;
  /** Forceful kill (default SIGKILL). Resolves when child has exited. */
  kill(signal?: NodeJS.Signals): Promise<void>;
}

export interface ProcessRunner {
  run(req: ProcessRunRequest): Promise<ProcessRunResult>;
  spawn(req: SpawnRequest): Promise<ProcessHandle>;
}

// =============================================================================
// FakeProcessRunner — programmable, deterministic
// =============================================================================

/**
 * A single scripted response. Each request matches a recorded argv
 * prefix (in order) and returns the recorded result. Records with
 * `argvPrefix: undefined` act as the default fallback.
 */
export interface FakeProcessScript {
  /** When undefined, matches any argv (use as fallback). Otherwise
   * the request's argv must start with this prefix exactly. */
  readonly argvPrefix?: readonly string[];
  readonly result: ProcessRunResult;
}

export interface FakeProcessRunnerOptions {
  /**
   * When true, the runner rejects unknown argv with an error
   * instead of returning {exitCode:127}. Default: true.
   */
  readonly strict?: boolean;
  /**
   * Default exitCode when a request falls through and strict=false.
   * Default: 127 (shell "not found").
   */
  readonly defaultExitCode?: number;
}

/**
 * One scripted spawn handle. The mock process never resolves its
 * `exited` promise until `terminate()` or `kill()` is called
 * (or `autoExitMs` elapses). This mirrors the daemon-like
 * behavior of `tart run --no-graphics`.
 */
export interface FakeSpawnScript {
  /** When undefined, matches any argv (fallback). */
  readonly argvPrefix?: readonly string[];
  /** Signal to claim exited with when `terminate()` is called. Default: SIGTERM. */
  readonly terminateSignal?: NodeJS.Signals;
  /** Optional exitCode to claim exited with on terminate. Default: null. */
  readonly terminateExitCode?: number | null;
  /** If > 0, the mock auto-exits after this many ms (simulates a crash). */
  readonly autoExitMs?: number;
  /**
   * Signals the mock should IGNORE. The handle stays alive
   * when these are sent; a later signal (e.g. SIGKILL) can
   * escalate. Used to model the "tart run ignores SIGTERM"
   * containment case.
   */
  readonly ignoreSignals?: readonly NodeJS.Signals[];
}

/**
 * Records every call so tests can assert argv construction.
 * Scripts are matched in declaration order (first match wins).
 */
export class FakeProcessRunner implements ProcessRunner {
  readonly calls: ProcessRunRequest[] = [];
  readonly spawnCalls: SpawnRequest[] = [];
  /** All spawn handles currently alive (not yet exited). */
  readonly liveSpawns: FakeProcessHandle[] = [];
  private readonly scripts: FakeProcessScript[];
  private readonly spawnScripts: FakeSpawnScript[];
  private readonly strict: boolean;
  private readonly defaultExitCode: number;
  private pidSeq = 1000;

  constructor(
    scripts: readonly FakeProcessScript[] = [],
    opts: FakeProcessRunnerOptions & { readonly spawnScripts?: readonly FakeSpawnScript[] } = {},
  ) {
    this.scripts = scripts.slice();
    this.spawnScripts = (opts.spawnScripts ?? []).slice();
    this.strict = opts.strict ?? true;
    this.defaultExitCode = opts.defaultExitCode ?? 127;
  }

  /** Append a script entry at runtime (test ergonomics). */
  addScript(entry: FakeProcessScript): void {
    this.scripts.push(entry);
  }

  /** Append a spawn script at runtime. */
  addSpawnScript(entry: FakeSpawnScript): void {
    this.spawnScripts.push(entry);
  }

  /** Wait for every currently-live spawn to exit. */
  async waitAllSpawns(): Promise<undefined> {
    await Promise.all(this.liveSpawns.map((h) => h.exited));
  }

  private matchSpawnScript(argv: readonly string[]): FakeSpawnScript | null {
    let fallback: FakeSpawnScript | null = null;
    for (const s of this.spawnScripts) {
      if (s.argvPrefix === undefined) {
        fallback = s;
        continue;
      }
      if (this.argvMatchesPrefix(argv, s.argvPrefix)) return s;
    }
    return fallback;
  }

  async run(req: ProcessRunRequest): Promise<ProcessRunResult> {
    this.calls.push(req);

    let fallback: FakeProcessScript | null = null;
    for (const s of this.scripts) {
      if (s.argvPrefix === undefined) {
        fallback = s;
        continue;
      }
      if (this.argvMatchesPrefix(req.argv, s.argvPrefix)) {
        return { ...s.result, durationMs: s.result.durationMs };
      }
    }
    if (fallback !== null) {
      return { ...fallback.result, durationMs: fallback.result.durationMs };
    }
    if (this.strict) {
      throw new Error(
        `FakeProcessRunner (strict): no script for argv ${JSON.stringify([...req.argv])}`,
      );
    }
    return {
      exitCode: this.defaultExitCode,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    };
  }

  async spawn(req: SpawnRequest): Promise<ProcessHandle> {
    this.spawnCalls.push(req);
    const pid = this.pidSeq++;
    const script = this.matchSpawnScript(req.argv);
    if (this.strict && script === null && this.spawnScripts.length > 0) {
      throw new Error(
        `FakeProcessRunner (strict): no spawn script for argv ${JSON.stringify([...req.argv])}`,
      );
    }
    const handle = new FakeProcessHandle(pid, script ?? null);
    this.liveSpawns.push(handle);
    // Auto-cleanup when handle resolves
    void handle.exited.finally(() => {
      const idx = this.liveSpawns.indexOf(handle);
      if (idx >= 0) this.liveSpawns.splice(idx, 1);
    });
    // Schedule auto-exit if requested
    if (script !== null && typeof script.autoExitMs === "number" && script.autoExitMs > 0) {
      setTimeout(() => {
        void handle.terminate("SIGKILL").catch(() => {});
      }, script.autoExitMs);
    }
    return handle;
  }

  private argvMatchesPrefix(
    argv: readonly string[],
    prefix: readonly string[],
  ): boolean {
    if (prefix.length > argv.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (argv[i] !== prefix[i]) return false;
    }
    return true;
  }
}

/**
 * Mock process handle. `exited` does not settle until terminate/kill
 * is invoked, or until `terminate` is called by an `autoExitMs`
 * timer.
 *
 * CORRECTION02: `kill()` is a separate operation from `terminate()`.
 * Each signal call is recorded; the LAST signal is the one the
 * `exited` promise resolves with. This lets tests assert that
 * SIGTERM was sent, ignored, and then SIGKILL was sent, and that
 * the process actually exited on SIGKILL (not on the prior SIGTERM
 * that the test wanted to be a no-op).
 */
class FakeProcessHandle implements ProcessHandle {
  readonly pid: number;
  readonly exited: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>;
  readonly stdout: ReadableStream<Uint8Array> | null = null;
  readonly stderr: ReadableStream<Uint8Array> | null = null;
  /** All signals this handle was sent, in order. Test introspection. */
  readonly signalLog: NodeJS.Signals[] = [];
  /** Per-signal in-flight promises, so duplicate calls dedupe. */
  private readonly inflight = new Map<NodeJS.Signals, Promise<void>>();
  private resolver: ((v: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | null = null;
  private settled = false;
  private readonly script: FakeSpawnScript | null;

  constructor(pid: number, script: FakeSpawnScript | null) {
    this.pid = pid;
    this.script = script;
    this.exited = new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  /** True iff exited has resolved. */
  hasExited(): boolean {
    return this.settled;
  }

  /**
   * Send a polite signal. Records the signal in `signalLog`.
   * Resolves `exited` unless `script.ignoreSignals` includes it
   * (then the handle stays alive for an escalation).
   */
  terminate(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    const existing = this.inflight.get(signal);
    if (existing !== undefined) return existing;
    const p = this.send(signal);
    this.inflight.set(signal, p);
    return p;
  }

  /**
   * Forceful kill. Always a separate operation from `terminate()`.
   * The previous implementation routed kill() -> terminate(), which
   * prevented SIGTERM -> SIGKILL escalation from sending the second
   * signal.
   */
  kill(signal: NodeJS.Signals = "SIGKILL"): Promise<void> {
    const existing = this.inflight.get(signal);
    if (existing !== undefined) return existing;
    const p = this.send(signal);
    this.inflight.set(signal, p);
    return p;
  }

  private send(signal: NodeJS.Signals): Promise<void> {
    this.signalLog.push(signal);
    // Honor script-configured ignoring: if the script says this
    // signal is ignored, do NOT resolve `exited`. Subsequent
    // signals (e.g. SIGKILL after a polite SIGTERM) will
    // resolve it.
    const ignored = this.script?.ignoreSignals ?? [];
    if (ignored.includes(signal) && !this.settled) {
      return Promise.resolve();
    }
    if (this.settled) return Promise.resolve();
    this.settled = true;
    const sig = this.script?.terminateSignal ?? signal;
    const code = this.script?.terminateExitCode ?? null;
    if (this.resolver) this.resolver({ exitCode: code, signal: sig });
    return Promise.resolve();
  }
}
// =============================================================================
// RealProcessRunner — Bun.spawn with truncation + timeout
// =============================================================================

export class RealProcessRunner implements ProcessRunner {
  async run(req: ProcessRunRequest): Promise<ProcessRunResult> {
    if (!Array.isArray(req.argv) || req.argv.length === 0) {
      throw new Error("RealProcessRunner: argv must be a non-empty array of strings");
    }
    for (let i = 0; i < req.argv.length; i++) {
      const el = req.argv[i];
      if (typeof el !== "string") {
        throw new Error(`RealProcessRunner: argv[${i}] is ${typeof el}, expected string`);
      }
    }

    const bun = await import("bun");
    const maxOut = req.maxOutputBytes ?? 1024 * 1024;

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    if (req.env) for (const [k, v] of Object.entries(req.env)) env[k] = v;

    const startedAt = Date.now();

    let proc: ReturnType<typeof bun.spawn>;
    try {
      proc = bun.spawn({
        cmd: req.argv as string[],
        cwd: req.cwd,
        env,
        stdin: req.stdin !== undefined ? "pipe" : null,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (cause) {
      throw new Error(
        `RealProcessRunner: spawn(${JSON.stringify(req.argv[0])}) failed: ${(cause as Error).message}`,
      );
    }

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise: Promise<"timeout"> = req.timeoutMs
      ? new Promise((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            try {
              proc.kill("SIGKILL");
            } catch {
              /* ignore */
            }
            resolve("timeout");
          }, req.timeoutMs);
        })
      : new Promise(() => {
          /* never resolves */
        });

    const stdoutChunks: Uint8Array[] = [];
    let stdoutLen = 0;
    let stdoutTruncated = false;
    const stderrChunks: Uint8Array[] = [];
    let stderrLen = 0;
    let stderrTruncated = false;

    const collect = async (
      stream: ReadableStream<Uint8Array> | undefined,
      sink: Uint8Array[],
      currentLen: { val: number },
      truncated: { val: boolean },
    ): Promise<void> => {
      if (!stream) return;
      const reader = stream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value || value.length === 0) continue;
          if (truncated.val) continue;
          if (currentLen.val + value.length > maxOut) {
            const room = maxOut - currentLen.val;
            if (room > 0) {
              sink.push(value.slice(0, room));
              currentLen.val += room;
            }
            truncated.val = true;
            continue;
          }
          sink.push(value);
          currentLen.val += value.length;
        }
      } finally {
        reader.releaseLock();
      }
    };

    const stdoutPromise = collect(
      proc.stdout as unknown as ReadableStream<Uint8Array>,
      stdoutChunks,
      { val: stdoutLen },
      { val: stdoutTruncated },
    );
    const stderrPromise = collect(
      proc.stderr as unknown as ReadableStream<Uint8Array>,
      stderrChunks,
      { val: stderrLen },
      { val: stderrTruncated },
    );

    if (req.stdin !== undefined && proc.stdin) {
      const writer = proc.stdin as unknown as WritableStreamDefaultWriter<Uint8Array>;
      const enc = new TextEncoder();
      const data = typeof req.stdin === "string" ? enc.encode(req.stdin) : req.stdin;
      try {
        await writer.write(data);
        await writer.close();
      } catch {
        /* ignore */
      }
    }

    const exitInfo = await Promise.race([
      proc.exited.then((code: number) => ({ kind: "exit" as const, code })),
      timeoutPromise.then(() => ({ kind: "timeout" as const })),
    ]);
    if (timer) clearTimeout(timer);

    await Promise.all([stdoutPromise, stderrPromise]);

    const finishedAt = Date.now();
    const decode = (chunks: Uint8Array[]): string => {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      return new TextDecoder("utf-8", { fatal: false }).decode(merged);
    };

    let exitCode: number | null;
    if (exitInfo.kind === "exit") exitCode = exitInfo.code;
    else exitCode = null;
    let signal: NodeJS.Signals | null = null;
    if (exitCode !== null && exitCode < 0) signal = "SIGKILL";

    return {
      exitCode,
      signal,
      stdout: decode(stdoutChunks),
      stderr: decode(stderrChunks),
      timedOut,
      durationMs: finishedAt - startedAt,
      pid: proc.pid,
    };
  }

  /**
   * Spawn a long-lived process WITHOUT awaiting its exit.
   *
   * `terminate()` sends `SIGTERM` and waits up to 5s for exit.
   * `kill()` sends `SIGKILL` and waits for exit.
   *
   * Importantly: this method does NOT apply a timeout on its own.
   * The caller owns the lifecycle (e.g., `tart run --no-graphics`
   * stays alive between `start()` and `stop()`).
   */
  async spawn(req: SpawnRequest): Promise<ProcessHandle> {
    if (!Array.isArray(req.argv) || req.argv.length === 0) {
      throw new Error("RealProcessRunner.spawn: argv must be a non-empty array of strings");
    }
    for (let i = 0; i < req.argv.length; i++) {
      const el = req.argv[i];
      if (typeof el !== "string") {
        throw new Error(`RealProcessRunner.spawn: argv[${i}] is ${typeof el}, expected string`);
      }
    }

    const bun = await import("bun");

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    if (req.env) for (const [k, v] of Object.entries(req.env)) env[k] = v;

    let proc: ReturnType<typeof bun.spawn>;
    try {
      proc = bun.spawn({
        cmd: req.argv as string[],
        cwd: req.cwd,
        env,
        stdin: null,
        // CORRECTION02: do NOT use "pipe" here. If the caller
        // does not drain the streams, Bun keeps the pipe open
        // and `proc.exited` may not resolve after a kill. "ignore"
        // detaches the streams at the OS level and the process
        // can always be reaped. The ProcessHandle interface
        // exposes stdout/stderr as null in that case; the
        // FakeProcessRunner still records calls for testing.
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch (cause) {
      throw new Error(
        `RealProcessRunner.spawn(${JSON.stringify(req.argv[0])}) failed: ${(cause as Error).message}`,
      );
    }

    const exitedPromise = proc.exited.then(
      (code: number) => ({ exitCode: code as number | null, signal: null as NodeJS.Signals | null }),
      () => ({ exitCode: null as number | null, signal: "SIGKILL" as NodeJS.Signals | null }),
    );

    // CORRECTION02: memoize per signal so the SIGTERM → SIGKILL
    // escalation in TartBackend.stop() actually sends the second
    // signal. The previous global `terminateInFlight` would
    // short-circuit the second call and the child could ignore
    // SIGTERM forever without ever receiving SIGKILL.
    const inflight = new Map<NodeJS.Signals, Promise<void>>();

    const send = (signal: NodeJS.Signals): Promise<void> => {
      const existing = inflight.get(signal);
      if (existing !== undefined) return existing;
      const p = (async () => {
        try {
          proc.kill(signal);
        } catch {
          /* already dead */
        }
        // Race against a 5s deadline so we don't hang forever
        // if the child ignores the signal.
        await Promise.race([
          exitedPromise.then(() => undefined),
          new Promise<void>((res) => setTimeout(res, 5000)),
        ]);
      })();
      inflight.set(signal, p);
      return p;
    };

    return {
      pid: proc.pid,
      exited: exitedPromise,
      // stdout/stderr are not exposed; daemon-like processes
      // (tart run) typically stream lots of output and we do
      // not need to capture it. Callers can subclass or wrap
      // this runner if they need stream access.
      stdout: null,
      stderr: null,
      terminate: (signal?: NodeJS.Signals) => send(signal ?? "SIGTERM"),
      kill: (signal?: NodeJS.Signals) => send(signal ?? "SIGKILL"),
    };
  }
}
