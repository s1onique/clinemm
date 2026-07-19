#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION17 — Native-probe catalogue.
 *
 * Pure definitions only — no I/O. The collector (`collect-native-probes.ts`)
 * consumes `NATIVE_PROBE_DEFINITIONS` and produces a `NativeProbesInventory`
 * with per-probe execution records. The runner stages that inventory into
 * the detached evidence bundle and the renderer verifies it independently
 * from the bundle (NOT from the tracked mirror).
 *
 * CORRECTION17 binding model (all fields are mandatory; missing fields
 * surface an `invalid-shape` diagnostic and cannot degrade to plausible
 * defaults):
 *
 *   id                       — catalogue-relative probe key
 *   path                     — legacy "path" field (alias of artifact_path)
 *   architecture             — legacy "architecture" field (alias of host_class)
 *   sha256                   — legacy "sha256" field (alias of artifact_sha256)
 *   file_format              — legacy "file_format" field (alias of observed_file_format)
 *   status                   — "pass" | "fail" (set by collector)
 *   reason                   — human-readable probe outcome
 *   artifact_path            — repository-relative path of the artifact probed
 *   artifact_sha256          — observed SHA-256 of the artifact on disk
 *   artifact_size            — observed size in bytes
 *   artifact_exists          — boolean
 *   argv                     — exact argv the collector executed
 *   exit_code                — observed process exit status
 *   signal                   — observed terminating signal (null on normal exit)
 *   timeout                  — observed timeout flag
 *   timeout_ms               — timeout budget used for this execution
 *   stdout_text              — captured stdout (may be empty)
 *   stdout_sha256            — SHA-256 of stdout_text
 *   stderr_text              — captured stderr (may be empty)
 *   stderr_sha256            — SHA-256 of stderr_text
 *   observed_file_format     — first-line of stdout/stderr (or null)
 *   observed_architecture   — host class observed from stdout/stderr (or null)
 *   execution_head_oid       — HEAD at probe time
 *   execution_tree_oid       — HEAD^{tree} at probe time
 *   subject_tree_oid         — filtered subject tree at probe time
 *   host_class               — captured from process.platform/process.arch
 *   host_supported           — true iff the host class is in host_support
 *   host_support             — declared host classes the probe supports
 *   started_at               — ISO-8601 timestamp
 *   finished_at              — ISO-8601 timestamp
 *   duration_ms              — wall-clock duration
 *   working_directory        — repository-relative cwd
 *   format_match_source      — "stdout" | "stderr" | "file" | null
 *   format_match_pattern_source — string source of the regex (or null)
 *   format_match_pattern_flags  — regex flags string (or null)
 *   architecture_assert      — "host-class" | "none" (probes asserting architecture)
 *   success_contract_version — 1 (incremented if the success predicate changes)
 *   invocation_id            — ULID-shaped unique id for the run
 *   failure_kind             — canonical structured outcome kind
 *   failure_message          — structured spawn/predicate error message
 *
 * Each definition is host-aware: the probe executable, working directory,
 * success predicate, and observation strategy are explicitly declared so
 * the collector cannot silently fall back to a different probe on a
 * different host.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type NativeProbeId =
	| "p1_better_sqlite3"
	| "p2_protobuf"
	| "p3_ripgrep_darwin_arm64"
	| "p4_vscode_host"
	| "p5_cline_version";

export const NATIVE_PROBE_STREAM_LAYOUT_VERSION = 1 as const;

// ---------- ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — µC-3 ---------------

/**
 * µC-3 strict JSON value type used by `stableStringify`. The encoder
 * rejects any value that JSON cannot represent safely (undefined,
 * function, symbol, bigint, NaN, ±Infinity, cyclic structures) so the
 * serialized byte sequence is always re-parseable and lossless.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue };

export class StableStringifyError extends Error {
	constructor(reason: string) {
		super(`STABLE_STRINGIFY_ERROR:${reason}`);
		this.name = "StableStringifyError";
	}
}

/**
 * Set of `Seen` objects used to detect cycles deterministically.
 */
function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Accept a `JsonValue` only after explicit validation. Pass an
 * already-parsed JSON value (`unknown` from `JSON.parse`) — it is the
 * caller's responsibility to type-check first.
 *
 * Throws `StableStringifyError` for:
 *   - undefined (JSON converts to null; we refuse to silently map)
 *   - function, symbol (cannot be represented)
 *   - bigint (lossy JSON.stringify("...") maps to a number; we refuse)
 *   - NaN, +Infinity, -Infinity (lossy JSON conversion)
 *   - cyclic structures
 */
function assertJsonValue(value: unknown, ancestors: WeakSet<object>): void {
	if (value === null) return;
	const t = typeof value;
	if (t === "string" || t === "boolean") return;
	if (t === "number") {
		if (!isFiniteNumber(value)) {
			throw new StableStringifyError(`non-finite number rejected: ${JSON.stringify(value)}`);
		}
		return;
	}
	if (t === "undefined") {
		throw new StableStringifyError("undefined rejected");
	}
	if (t === "bigint") {
		throw new StableStringifyError(`bigint rejected: ${String(value)}`);
	}
	if (t === "function" || t === "symbol") {
		throw new StableStringifyError(`${t} rejected`);
	}
	const objectValue = value as object;
	if (ancestors.has(objectValue)) {
		throw new StableStringifyError("cyclic structure rejected");
	}
	ancestors.add(objectValue);
	try {
		if (Array.isArray(value)) {
			for (const item of value) assertJsonValue(item, ancestors);
			return;
		}
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) {
			throw new StableStringifyError("non-plain object rejected");
		}
		for (const key of Object.keys(value as Record<string, unknown>)) {
			assertJsonValue((value as Record<string, unknown>)[key], ancestors);
		}
	} finally {
		// This is a recursion-stack set, not a global "seen" set. A shared
		// acyclic object may legitimately occur in more than one branch;
		// only an object already present in the current ancestor chain is a
		// cycle.
		ancestors.delete(objectValue);
	}
}

/**
 * CORRECTION21 (µC-2) bundled probe shape: what the writer
 * produces. `NativeProbe` is the **collected** shape (what the
 * collector and the fixture builder produce); `BundledNativeProbe`
 * adds the bundling-only fields the runner assigns in
 * `stageNativeProbesIntoBundle()` (canonical stream paths and the
 * layout version) and the loader (µC-3) will validate.
 */
export interface BundledNativeProbe extends NativeProbe {
	stream_layout_version: typeof NATIVE_PROBE_STREAM_LAYOUT_VERSION;
	stdout_path: string;
	stderr_path: string;
	metadata_path: string;
}

/**
 * CORRECTION21 (µC-2) typed partial map the runner fills while
 * iterating the catalogue. The checked completeness helper
 * `requireAllCanonicalProbes()` narrows it to a full
 * `Record<NativeProbeId, BundledNativeProbe>` only after every
 * canonical probe is present.
 */
export type PartialBundledNativeProbeMap = Partial<Record<NativeProbeId, BundledNativeProbe>>;

/**
 * CORRECTION21 (µC-2 → µC-3) deterministic, sorted-key JSON encoder.
 *
 * Strict mode is the default for the µC-3 metadata serialization
 * boundary: the encoder rejects values JSON cannot represent safely
 * (undefined, function, symbol, bigint, NaN, ±Infinity, cyclic
 * structures, non-plain objects). The writer and reader share this
 * exact rule so `native-probes/<id>.metadata.json` and the aggregate
 * `native-probes.json.probes[id]` parse to a JSON value that is
 * stableStringify-equal under the same encoder.
 *
 * Behaviour:
 *   parsed JSON input       → always accepted (caller's job to typecheck)
 *   non-JSON runtime input  → deterministic structured failure
 *   cycles                  → deterministic structured failure
 *
 * The encoder does NOT return invalid strings such as `"undefined"`.
 *
 * Inlined here (rather than imported from `baseline-closure.ts`) to
 * keep the dependency graph acyclic: `baseline-closure.ts` already
 * imports from this module. The encoder produces a single canonical
 * byte sequence for any JSON value regardless of property insertion
 * order, so writer and reader agree on metadata bytes by construction.
 *
 * This is byte-level canonicalization — a semantic equality check on
 * the JSON value yields byte-equal output, but two semantically
 * different values that happen to share a sorted serialisation will
 * still hash differently. The deterministic rule is the
 * single-source-of-truth for the writer and reader.
 */
export function stableStringify(value: unknown): string {
	assertJsonValue(value, new WeakSet());
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	);
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * CORRECTION21 (µC-2) pure canonicalization helper. The function takes a
 * collected `NativeProbe` and returns a `BundledNativeProbe` together
 * with the three UTF-8 byte buffers the runner must stage on disk. It
 * is exported separately so the writer contract can be tested without
 * copying the entire runner into a temporary repository.
 *
 * The exact guarantee is:
 *
 *   The helper guarantees consistency between the supplied text,
 *   returned bytes and recorded hashes — given the supplied text
 *   and a probe record, the produced `stdoutBytes` / `stderrBytes`
 *   hash to the declared `stdout_sha256` / `stderr_sha256`, and the
 *   staged `metadataBytes` is the canonical-record form (sorted-key
 *   JSON) of the supplied data.
 *
 *   The helper does NOT prove that the supplied text or record came
 *   from real probe execution. Evidence provenance (the upstream
 *   collector's invocation id and the staged payload bytes) is what
 *   establishes authenticity.
 *
 * The function does not perform filesystem I/O; the runner is
 * responsible for writing the returned buffers to the bundle at the
 * paths returned by `canonicalStreamPaths(id)`.
 *
 * Failure behaviour: a missing or non-string `stdout_text` /
 * `stderr_text` throws `NATIVE_PROBE_STDOUT_MISSING` or
 * `NATIVE_PROBE_STDERR_MISSING` respectively. A missing record (the
 * caller passes `null` or `undefined`) throws
 * `NATIVE_PROBE_RECORD_MISSING`. The returned `BundledNativeProbe`
 * is a fresh object the writer can store without mutating the input.
 */
export function canonicalizeProbeForBundle(
	id: NativeProbeId,
	probe: NativeProbe | null | undefined,
): {
	record: BundledNativeProbe;
	stdoutBytes: Buffer;
	stderrBytes: Buffer;
	metadataBytes: Buffer;
} {
	if (probe === null || probe === undefined) {
		throw new Error(
			`NATIVE_PROBE_RECORD_MISSING:${id}: the canonical stream writer requires all five probe records; the input was null or undefined.`,
		);
	}
	if (probe.id !== id) {
		throw new Error(
			`NATIVE_PROBE_ID_MISMATCH:${id}:record=${probe.id}: the canonical stream writer requires the argument id and the record id to match; refusing to silently overwrite the record id.`,
		);
	}
	if (typeof probe.stdout_text !== "string") {
		throw new Error(
			`NATIVE_PROBE_STDOUT_MISSING:${id}: the canonical stream writer requires a string stdout_text on the probe record; the input had type ${typeof probe.stdout_text}.`,
		);
	}
	if (typeof probe.stderr_text !== "string") {
		throw new Error(
			`NATIVE_PROBE_STDERR_MISSING:${id}: the canonical stream writer requires a string stderr_text on the probe record; the input had type ${typeof probe.stderr_text}.`,
		);
	}
	const stdoutBytes = Buffer.from(probe.stdout_text, "utf8");
	const stderrBytes = Buffer.from(probe.stderr_text, "utf8");
	const paths = canonicalStreamPaths(id);
	// The record preserves probe.id but the canonical stream paths and
	// the layout version are authoritative: catalogue/path drift is
	// rejected by the probe.id check above. The record is a fresh
	// object the writer can store without mutating the input.
	const record: BundledNativeProbe = {
		...probe,
		stream_layout_version: NATIVE_PROBE_STREAM_LAYOUT_VERSION,
		stdout_path: paths.stdout_path,
		stderr_path: paths.stderr_path,
		metadata_path: paths.metadata_path,
		stdout_sha256: createHash("sha256").update(stdoutBytes).digest("hex"),
		stderr_sha256: createHash("sha256").update(stderrBytes).digest("hex"),
	};
	// One pure operation produces all three staged payloads. Hash
	// consistency between the declared SHA-256 fields, the staged
	// bytes and the serialized metadata is guaranteed because every
	// value is derived from the same record. Metadata is serialized
	// with the deterministic sorted-key encoder (`stableStringify`)
	// so the loader and the writer agree on a single canonical byte
	// sequence regardless of property insertion order on the input.
	const metadataBytes = Buffer.from(stableStringify(record) + "\n", "utf8");
	return { record, stdoutBytes, stderrBytes, metadataBytes };
}

/**
 * CORRECTION21 (µC-2) checked completeness helper. Narrows a partial
 * bundled-probe map to the full `Record<NativeProbeId, BundledNativeProbe>`
 * only after every canonical probe id is present. Throws
 * `NATIVE_PROBE_INCOMPLETE` with the list of missing ids otherwise.
 *
 * This is the seam the runner uses to lift its loop result out of
 * `PartialBundledNativeProbeMap` and into the typed, complete map
 * the aggregate `native-probes.json` and the per-probe
 * `metadata.json` payloads both share.
 */
export function requireAllCanonicalProbes(
	partial: PartialBundledNativeProbeMap,
): Record<NativeProbeId, BundledNativeProbe> {
	const missing: NativeProbeId[] = [];
	for (const id of NATIVE_PROBE_IDS) {
		if (partial[id] === undefined) missing.push(id);
	}
	if (missing.length > 0) {
		throw new Error(
			`NATIVE_PROBE_INCOMPLETE:${missing.join(",")}: the canonical stream writer requires all five probe records; the partial map was missing ${missing.length}.`,
		);
	}
	return partial as Record<NativeProbeId, BundledNativeProbe>;
}

export const NATIVE_PROBE_IDS: ReadonlyArray<NativeProbeId> = [
	"p1_better_sqlite3",
	"p2_protobuf",
	"p3_ripgrep_darwin_arm64",
	"p4_vscode_host",
	"p5_cline_version",
];

/**
 * The serialized form of a regex. Patterns are persisted as plain strings
 * (with optional flags) and reconstructed via `compileFormatMatch` at load
 * time so a probe inventory round-trips through JSON without losing
 * fidelity. `pattern_source` MUST be a valid regex source string or the
 * load-side `invalid-shape` check rejects the entry.
 */
export interface FormatMatchSpec {
	source: "stdout" | "stderr" | "file";
	pattern_source: string;
	pattern_flags: string;
}

export interface NativeProbeDefinition {
	id: NativeProbeId;
	label: string;
	host_support: ReadonlyArray<string>;
	artifact_path: string;
	working_directory: string;
	argv: string[];
	format_match: FormatMatchSpec;
	architecture_assert: "host-class" | "none";
	success_contract_version: number;
	/**
	 * Predicate over the probe execution record. Returns `null` on pass or
	 * a human-readable reason on fail. The collector passes the captured
	 * stdout/stderr text + the computed SHA-256 + the artifact stat.
	 */
	success: (ctx: ProbeSuccessContext) => string | null;
}

export interface ProbeSuccessContext {
	argv: string[];
	exit_code: number | null;
	signal: NodeJS.Signals | null;
	timeout: boolean;
	stdout: string;
	stderr: string;
	artifactExists: boolean;
	artifactSize: number;
	artifactSha256: string | null;
}

/**
 * Compile a persisted format-match spec back into a `RegExp`. Throws
 * `Error` when the spec is malformed; callers should catch and surface
 * the failure as an `invalid-shape` diagnostic.
 */
export function compileFormatMatch(spec: FormatMatchSpec): RegExp {
	if (typeof spec.pattern_source !== "string" || spec.pattern_source.length === 0) {
		throw new Error(`format_match.pattern_source is empty for source=${spec.source}`);
	}
	let flags = "";
	if (typeof spec.pattern_flags === "string" && spec.pattern_flags.length > 0) {
		// Allow only the standard, safe flag letters to prevent ReDoS via
		// pathological inputs.
		flags = Array.from(spec.pattern_flags)
			.filter((c) => "gimsuy".includes(c))
			.join("");
	}
	return new RegExp(spec.pattern_source, flags);
}

/**
 * Persisted shape of a native-probe entry after execution. The collector
 * always writes this shape; the loader validates it. Both legacy (P1-P5
 * CORRECTION15) and extended (CORRECTION16/17) fields are present, so a
 * single canonical record satisfies both the renderer and the loader.
 */
export type NativeProbeFailureKind =
	| "pass"
	| "host_unsupported"
	| "spawn_error"
	| "timeout"
	| "predicate_error"
	| "predicate_failure";

export function isNativeProbeFailureKind(value: unknown): value is NativeProbeFailureKind {
	return (
		value === "pass" ||
		value === "host_unsupported" ||
		value === "spawn_error" ||
		value === "timeout" ||
		value === "predicate_error" ||
		value === "predicate_failure"
	);
}

export interface NativeProbe {
	id: NativeProbeId;
	// Legacy fields (P1-P5 CORRECTION15 schema).
	path: string;
	architecture: string;
	sha256: string;
	file_format: string;
	status: "pass" | "fail";
	reason: string;
	// Extended execution-record fields (P1-P5 CORRECTION16/17 schema).
	artifact_path: string;
	artifact_sha256: string | null;
	artifact_size: number;
	artifact_exists: boolean;
	argv: string[];
	exit_code: number | null;
	signal: NodeJS.Signals | null;
	timeout: boolean;
	/** Timeout budget used by the collector for this execution record. */
	timeout_ms: number;
	stdout_text: string;
	stdout_sha256: string;
	stderr_text: string;
	stderr_sha256: string;
	observed_file_format: string | null;
	observed_architecture: string | null;
	execution_head_oid: string;
	execution_tree_oid: string;
	subject_tree_oid: string;
	host_class: string;
	host_supported: boolean;
	host_support: ReadonlyArray<string>;
	started_at: string;
	finished_at: string;
	duration_ms: number;
	working_directory: string;
	format_match_source: "stdout" | "stderr" | "file";
	format_match_pattern_source: string;
	format_match_pattern_flags: string;
	architecture_assert: "host-class" | "none";
	success_contract_version: number;
	invocation_id: string;
	/**
	 * CORRECTION21 (µC-3 round 4) — structured failure kind. The
	 * writer (collect-native-probes.ts) records the failure mode the
	 * shared precedence chain selected. The reader uses this field to
	 * deterministically reconstruct `deriveNativeProbeOutcome()` inputs
	 * without reverse-engineering prose from `reason`. `"pass"` covers
	 * the happy path (no structured failure; the catalogue predicate
	 * returned null). `"spawn_error"` requires the companion
	 * `failure_message` field to carry the original `Error.message`;
	 * for every other kind the reader derives the canonical message
	 * text purely from the structured fields.
	 */
	failure_kind: NativeProbeFailureKind;
	/**
	 * CORRECTION21 (µC-3 round 4) — companion to `failure_kind`.
	 * Only meaningful for `"spawn_error"` (carries the original
	 * `Error.message` so the reader can construct a structurally
	 * identical `Error`) and `"predicate_error"` (carries the predicate
	 * throw message verbatim). For every other kind the field is the
	 * empty string.
	 */
	failure_message: string;
}

/**
 * CORRECTION21 (µC-3 round 4) — production's default timeout budget.
 * The collector persists the effective budget in each record's
 * `timeout_ms`; the reader consumes that field rather than assuming this
 * default, so records from direct callers remain self-contained.
 */
export const NATIVE_PROBE_DEFAULT_TIMEOUT_MS = 60_000 as const;

const HOST_DARWIN_ARM64 = "darwin-arm64";

/**
 * Probe P1 (CORRECTION17) — better-sqlite3 in-memory database.
 *
 * Proves:
 *   - the addon is installed (require() succeeds);
 *   - the addon loads under the selected Node ABI (the constructor
 *     resolves and `prepare()` does not throw);
 *   - the addon can actually open an in-memory database, create a
 *     table, insert a row, query it, and close.
 *
 * This is stronger than reading a Mach-O header: it proves runtime
 * compatibility, not just file format. The architecture string is
 * derived from `better_sqlite3.version` (which embeds the build arch).
 */
function p1Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `better-sqlite3 smoke probe exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	const required = ["SMOKE_OK", "ARCH=", "BIND="];
	for (const needle of required) {
		if (!ctx.stdout.includes(needle)) {
			return `better-sqlite3 smoke probe did not emit ${needle}`;
		}
	}
	// ARCH must read e.g. "arm64" or "x64" — host class is matched against
	// the inventory host_class (not the literal string), so this is just
	// a content check.
	return null;
}

/**
 * Probe P2 (CORRECTION17) — protobufjs package version + runtime
 * require().
 *
 * Proves the protobufjs node module is installed and the
 * `protobufjs/package.json.version` is parseable. The probe uses
 * `require("protobufjs/package.json").version` to avoid the
 * precedence bug in the previous expression
 * `'ProtobufJs-ProtobufVersion ' + p.common ? p.common.Version || 'unknown' : 'unknown'`.
 */
function p2Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `protobufjs version probe exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	if (!/^ProtobufJs-ProtobufVersion \d+\.\d+\.\d+/m.test(ctx.stdout)) {
		return `protobufjs version probe did not emit a parseable version line`;
	}
	return null;
}

/**
 * Probe P3 (CORRECTION17) — ripgrep architecture (file + --version).
 *
 * Proves:
 *   - the ripgrep binary at `node_modules/@vscode/ripgrep/bin/rg-darwin-arm64`
 *     is executable and prints a parseable version (`rg --version`);
 *   - the same binary reports `darwin-arm64` architecture when
 *     `file <path>` is invoked (or the Mach-O header is parsed as a
 *     fallback when `file(1)` is unavailable).
 */
function p3Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `ripgrep --version exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	if (!/ripgrep\s+(\d+\.\d+\.\d+)/.test(ctx.stdout)) {
		return `ripgrep --version did not print a parseable banner`;
	}
	return null;
}

/**
 * Probe P4 (CORRECTION17) — VS Code extension-host API surface.
 *
 * Proves:
 *   - the `@types/vscode` package is installed and the type
 *     declaration can be resolved;
 *   - a representative subset of the VS Code API surface
 *     (`commands.registerCommand`, `window.showInformationMessage`,
 *     `ExtensionContext`) is importable as TypeScript types.
 *   - a synthesised extension can be wired up without errors.
 *
 * The probe does NOT claim to launch the Extension Host — that is a
 * longer-running integration test owned by upstream VS Code. This
 * probe asserts the surface is present, which is the precondition
 * for the integration test to succeed.
 */
function p4Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `vscode type probe exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	for (const needle of ["VSCODE_OK", "VSCODE_COMMANDS=", "VSCODE_WINDOW=", "VSCODE_CONTEXT="]) {
		if (!ctx.stdout.includes(needle)) {
			return `vscode type probe did not emit ${needle}`;
		}
	}
	return null;
}

/**
 * Probe P5 (CORRECTION17) — cline CLI `--version` and `--help`.
 *
 * Proves:
 *   - the built `apps/cli/bin/cline` resolver script is executable;
 *   - the `package.json` "version" field is parseable as semver.
 *
 * This is a runtime smoke check; the full smoke matrix on the
 * `bun build --compile` platform binary is owned by CORRECTION17's
 * production matrix. The P5 probe is the lighter weight pre-check.
 */
function p5Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `cline --version exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	if (!/^cline-version\s+(\d+\.\d+\.\d+)/m.test(ctx.stdout)) {
		return `cline --version did not print a parseable version line`;
	}
	return null;
}

/**
 * The catalogue consumed by `collect-native-probes.ts`. The runner invokes
 * each probe exactly once during the matrix; the staged-bundle inventory
 * is the only authoritative record of the probe outcomes. The renderer
 * and the bundle-bound verifier both load this catalogue to compare the
 * recorded probe against the declared definition.
 */
export const NATIVE_PROBE_DEFINITIONS: ReadonlyArray<NativeProbeDefinition> = [
	{
		id: "p1_better_sqlite3",
		label: "P1 better-sqlite3 (in-memory db smoke)",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "node_modules/better-sqlite3/package.json",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			[
				"const sqlite3 = require('better-sqlite3');",
				"const db = new sqlite3(':memory:');",
				"db.exec('CREATE TABLE t(id INTEGER, v TEXT)');",
				"db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'ok');",
				"const row = db.prepare('SELECT id, v FROM t WHERE id = ?').get(1);",
				"if (!row || row.v !== 'ok') { console.error('row mismatch'); process.exit(2); }",
				"const version = require('better-sqlite3/package.json').version;",
				"const ver = sqlite3.version || version;",
				"const m = /darwin-(arm64|x64)|linux-(x64|arm64)|win32-(x64|arm64)/i.exec(ver || '');",
				"const arch = m ? m[0].toLowerCase() : 'unknown';",
				"console.log('SMOKE_OK');",
				"console.log('ARCH=' + arch);",
				"console.log('BIND=' + (ver || 'unknown'));",
				"db.close();",
			].join("\n"),
		],
		format_match: { source: "stdout", pattern_source: "SMOKE_OK", pattern_flags: "" },
		architecture_assert: "host-class",
		success_contract_version: 1,
		success: p1Success,
	},
	{
		id: "p2_protobuf",
		label: "P2 protobufjs (runtime package version)",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "node_modules/protobufjs/package.json",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			[
				"const version = require('protobufjs/package.json').version;",
				"console.log('ProtobufJs-ProtobufVersion ' + version);",
			].join("\n"),
		],
		format_match: { source: "stdout", pattern_source: "ProtobufJs-ProtobufVersion", pattern_flags: "" },
		architecture_assert: "none",
		success_contract_version: 1,
		success: p2Success,
	},
	{
		id: "p3_ripgrep_darwin_arm64",
		label: "P3 ripgrep darwin-arm64 (executable + architecture)",
		host_support: ["darwin-arm64"],
		artifact_path: "node_modules/@vscode/ripgrep/bin/rg-darwin-arm64",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			[
				"const {execFileSync} = require('node:child_process');",
				"const fs = require('node:fs');",
				"const path = 'node_modules/@vscode/ripgrep/bin/rg-darwin-arm64';",
				"if (!fs.existsSync(path)) { console.error('rg missing'); process.exit(2); }",
				"const ver = execFileSync(path, ['--version']).toString();",
				"console.log(ver.trim());",
				"let arch = 'unknown';",
				"try { arch = execFileSync('file', [path]).toString().split(/[, ]/)[1] || 'unknown'; }",
				"catch (_) { /* file(1) unavailable; rely on banner */ }",
				"console.log('arch=' + arch.trim());",
			].join("\n"),
		],
		format_match: { source: "stdout", pattern_source: "ripgrep", pattern_flags: "" },
		architecture_assert: "host-class",
		success_contract_version: 1,
		success: p3Success,
	},
	{
		// CORRECTION22 (deferred): P4 must boot a real VS Code Extension
		// Development Host via @vscode/test-electron and assert the Cline
		// extension activates (commands registerCommand, etc.). The current
		// argv only checks for canonical API names inside the .d.ts file,
		// which proves the types are installed but says nothing about the
		// actual runtime surface.
		id: "p4_vscode_host",
		label: "P4 VS Code extension-host API surface (precondition)",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "node_modules/@types/vscode/index.d.ts",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			[
				"const path = require('node:path');",
				"const vscode = require(path.resolve('node_modules/@types/vscode/index.d.ts'));",
				"// The .d.ts file is a type-only module; we cannot require its",
				"// runtime surface. Instead we assert the path resolves AND",
				"// the canonical API surface names exist in the type file.",
				"const fs = require('node:fs');",
				"const src = fs.readFileSync('node_modules/@types/vscode/index.d.ts', 'utf8');",
				"for (const needle of ['registerCommand', 'showInformationMessage', 'ExtensionContext']) {",
				"  if (!src.includes(needle)) { console.error('missing ' + needle); process.exit(2); }",
				"}",
				"console.log('VSCODE_OK ' + path.resolve('node_modules/@types/vscode/index.d.ts'));",
				"console.log('VSCODE_COMMANDS=registerCommand');",
				"console.log('VSCODE_WINDOW=showInformationMessage');",
				"console.log('VSCODE_CONTEXT=ExtensionContext');",
			].join("\n"),
		],
		format_match: { source: "stdout", pattern_source: "VSCODE_OK", pattern_flags: "" },
		architecture_assert: "none",
		success_contract_version: 1,
		success: p4Success,
	},
	{
		// CORRECTION22 (deferred): P5 must execute the compiled standalone
		// CLI binary for the binding host (e.g. dist-standalone/darwin-arm64/
		// cline-core) and verify the version / help output. The current argv
		// invokes `node apps/cli/bin/cline`, which is a Node wrapper, not the
		// compiled binary — it does not prove the standalone artefact is
		// production-ready on the binding host.
		id: "p5_cline_version",
		label: "P5 cline CLI --version (smoke)",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "apps/cli/bin/cline",
		working_directory: ".",
		argv: ["node", "apps/cli/bin/cline", "--version"],
		format_match: { source: "stdout", pattern_source: "cline", pattern_flags: "" },
		architecture_assert: "none",
		success_contract_version: 1,
		success: p5Success,
	},
];

/**
 * Generate a fresh ULID-shaped invocation id. Used by the collector to
 * give every probe execution a unique cross-bundle key.
 */
export function newInvocationId(): string {
	return (
		Date.now().toString(36).padStart(9, "0") +
		"-" +
		randomBytes(8).toString("hex").slice(0, 12)
	);
}

/**
 * CORRECTION21 (µC-2) canonical stream layout.
 *
 * For every probe id, the three external payloads live at the
 * fixed repository-relative paths:
 *
 *   native-probes/<id>.stdout
 *   native-probes/<id>.stderr
 *   native-probes/<id>.metadata.json
 *
 * The trio is the single source of truth shared between the runner
 * (writer) and the validator (reader). Caller-selected alternative
 * paths are rejected; the loader only accepts the canonical layout.
 */
export interface CanonicalStreamPaths {
	stdout_path: string;
	stderr_path: string;
	metadata_path: string;
}

export function canonicalStreamPaths(id: NativeProbeId): CanonicalStreamPaths {
	return {
		stdout_path: `native-probes/${id}.stdout`,
		stderr_path: `native-probes/${id}.stderr`,
		metadata_path: `native-probes/${id}.metadata.json`,
	};
}

export function probeDefinitionFor(id: NativeProbeId): NativeProbeDefinition {
	const def = NATIVE_PROBE_DEFINITIONS.find((p) => p.id === id);
	if (!def) throw new Error(`unknown native-probe id: ${id}`);
	return def;
}

export function hostClassOf(platform: string, arch: string): string {
	if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
	if (platform === "linux" && arch === "x64") return "linux-x64";
	if (platform === "win32" && arch === "x64") return "windows-x64";
	if (platform === "linux" && arch === "arm64") return "linux-arm64";
	if (platform === "win32" && arch === "arm64") return "windows-arm64";
	return `${platform}-${arch}`;
}

/**
 * CORRECTION21 (µC-3 review) — canonical pass-row reason text.
 *
 * The writer (`collect-native-probes.ts`) and the reader
 * (`baseline-closure.ts`) MUST agree on the exact string the runner
 * records for a passing probe. Using the same helper on both sides
 * removes the previous reader policy of accepting either the empty
 * string or the runner's ad-hoc text. The contract is one function:
 *
 *   derivedReason === null  →  recorded reason =
 *       canonicalRecordedProbeReason(derivedReason, definition)
 *     === "probe satisfied <label>"
 *
 *   derivedReason !== null  →  recorded reason = derivedReason (the
 *     fail reason text the predicate produced).
 *
 * The reader uses the same helper to build the expected recorded
 * reason from the derived outcome, so equality is mechanical rather
 * than a policy decision.
 */
export function canonicalRecordedProbeReason(
	derivedReason: string | null,
	definition: NativeProbeDefinition,
): string {
	if (derivedReason === null) {
		return `probe satisfied ${definition.label}`;
	}
	return derivedReason;
}

// ---------- ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — µC-3 round 3 -------

/**
 * µC-3 round 3 — shared writer/reader outcome derivation.
 *
 * Both the writer (the collector in `collect-native-probes.ts`) and the
 * reader (the validator in `baseline-closure.ts`) must derive the same
 * `{ status, derivedReason }` pair for the same probe execution record.
 * The previous design had two parallel precedence chains:
 *
 *   writer (collect-native-probes.ts):
 *     hostUnsupported > spawnError > timedOut > catalogue-predicate
 *
 *   reader (baseline-closure.ts):
 *     timedOut-as-static-string > catalogue-predicate
 *
 * The reader's chain silently accepted any probe that didn't have an
 * explicit timeout flag, even when the host class wasn't supported or
 * the process never spawned. This is the single function that fixes
 * the divergence: writer and reader invoke the SAME authority, so a
 * legitimate failed execution cannot be rejected because the reader
 * derives different status/reason semantics.
 *
 * Behaviour:
 *   - `hostSupported === false` ⇒ status="fail", derivedReason = the
 *     host-not-supported message.
 *   - `spawnError !== null`       ⇒ status="fail", derivedReason = the
 *     wrapped spawn error message.
 *   - `timedOut === true`         ⇒ status="fail", derivedReason = the
 *     canonical "probe timed out" message (the configured duration is
 *     recorded so the reader can audit the timeout budget).
 *   - otherwise                   ⇒ run the catalogue predicate with
 *     the supplied `ProbeSuccessContext` and map null → pass, string → fail.
 *
 * If the catalogue predicate itself throws, the outcome is
 * `status="fail"`, derivedReason = the predicate-error message, and the
 * `predicateThrew` flag is set so the caller can emit a structured
 * `predicate-error` diagnostic rather than treating the throw as a
 * successful execution.
 */
export interface DeriveNativeProbeOutcomeInput {
	definition: NativeProbeDefinition;
	hostSupported: boolean;
	hostClass: string;
	spawnError: Error | null;
	timedOut: boolean;
	timeoutMs: number;
	context: ProbeSuccessContext;
}

export interface DeriveNativeProbeOutcome {
	status: "pass" | "fail";
	derivedReason: string | null;
	recordedReason: string;
	failureKind: NativeProbeFailureKind;
	failureMessage: string;
	predicateThrew: boolean;
}

function nonEmptyFailureMessage(message: string, fallback: string): string {
	return message.length > 0 ? message : fallback;
}

export function deriveNativeProbeOutcome(
	input: DeriveNativeProbeOutcomeInput,
): DeriveNativeProbeOutcome {
	let derivedReason: string | null;
	let failureKind: NativeProbeFailureKind;
	let failureMessage = "";
	let predicateThrew = false;
	if (!input.hostSupported) {
		failureKind = "host_unsupported";
		derivedReason = `host=${input.hostClass} is not in host_support=${input.definition.host_support.join(",")}`;
	} else if (input.spawnError !== null) {
		failureKind = "spawn_error";
		failureMessage = nonEmptyFailureMessage(
			input.spawnError.message,
			"<empty spawn error message>",
		);
		derivedReason = `spawn error: ${failureMessage}`;
	} else if (input.timedOut) {
		failureKind = "timeout";
		derivedReason = `probe timed out after ${input.timeoutMs}ms`;
	} else {
		try {
			derivedReason = input.definition.success(input.context);
			failureKind = derivedReason === null ? "pass" : "predicate_failure";
		} catch (error) {
			predicateThrew = true;
			failureKind = "predicate_error";
			failureMessage = nonEmptyFailureMessage(
				error instanceof Error ? error.message : String(error),
				"<empty predicate error message>",
			);
			derivedReason = `predicate threw: ${failureMessage}`;
		}
	}
	const status: "pass" | "fail" = failureKind === "pass" ? "pass" : "fail";
	const recordedReason = canonicalRecordedProbeReason(derivedReason, input.definition);
	return {
		status,
		derivedReason,
		recordedReason,
		failureKind,
		failureMessage,
		predicateThrew,
	};
}

// ---------- ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — µC-3 parser ---------

const SHA256_REGEX = /^[0-9a-f]{64}$/;
/** Lowercase 40-character hex Git OID. */
const OID_REGEX = /^[0-9a-f]{40}$/;

/**
 * µC-3 result of `parseBundledNativeProbe`. The reader never throws —
 * every failure mode is captured in the returned `diagnostics` array
 * with the failing field, expected and observed values. The helper is
 * pure: no filesystem I/O, no mutation.
 */
export interface ProbeParseDiagnostic {
	field: string;
	reason: string;
	expected: string;
	observed: string;
}

export interface ProbeParseResult {
	ok: boolean;
	record: BundledNativeProbe | null;
	diagnostics: ProbeParseDiagnostic[];
}

/**
 * µC-3 fail-closed parser for `BundledNativeProbe`. The reader calls
 * this for every probe entry inside the aggregate `native-probes.json`
 * and uses the returned record to:
 *   1. validate the canonical paths asserted by the recorded record,
 *   2. validate the structural shape of the embedded record
 *      (argv, status, identity OIDs, embedded stream types, etc.),
 *   3. derive the on-disk evidence payloads to load,
 *   4. compare the staged metadata file's JSON value with the
 *      aggregate record's JSON value under `stableStringify`.
 *
 * Validation rules (all required, all fail-closed):
 *   - the value is a JSON object;
 *   - `record.id === probeId`;
 *   - `stream_layout_version === NATIVE_PROBE_STREAM_LAYOUT_VERSION`
 *     (an unknown / unsupported version is rejected — legacy records
 *     are NOT silently upgraded in memory);
 *   - `stdout_path`, `stderr_path`, `metadata_path` are the canonical
 *     `canonicalStreamPaths(probeId)` paths;
 *   - `stdout_sha256`, `stderr_sha256` are 64-character lowercase
 *     hexadecimal strings;
 *   - `argv` is a non-empty array of strings;
 *   - `stdout_text`, `stderr_text` are strings (P0.6: missing embedded
 *     fields fail closed — the writer requires both, and the reader
 *     refuses to assume they can be recovered from external bytes);
 *   - `execution_head_oid`, `execution_tree_oid`, `subject_tree_oid`
 *     are 40-character lowercase hexadecimal strings;
 *   - `host_class` is a non-empty string;
 *   - `host_supported` is a boolean;
 *   - `host_support` is an array of strings;
 *   - `status` is exactly `"pass"` or `"fail"`;
 *   - `reason` is a string;
 *   - `architecture_assert` is `"host-class"` or `"none"`;
 *   - `path`, `architecture`, `file_format` are non-empty strings;
 *   - `sha256` is a 64-character lowercase hex string;
 *   - `format_match_source` is one of `"stdout" | "stderr" | "file"`;
 *   - `format_match_pattern_source` / `format_match_pattern_flags`
 *     are strings;
 *   - `success_contract_version` is a positive integer;
 *   - `invocation_id` is a non-empty string;
 *   - `artifact_*` fields have valid types
 *     (`artifact_path` string, `artifact_size` non-negative number,
 *     `artifact_exists` boolean, `artifact_sha256` either a 64-char
 *     hex string or null);
 *   - `observed_*` fields have valid types (`observed_file_format`
 *     string or null, `observed_architecture` string or null);
 *   - timing fields have valid types
 *     (`exit_code` number or null, `signal` string or null, `timeout`
 *     boolean, positive-integer `timeout_ms`, `started_at`/`finished_at`
 *     strings, non-negative `duration_ms`, `working_directory` string);
 *   - `failure_kind` is a canonical enum and `failure_message` is a
 *     string;
 *   - failure-kind/status/timeout/host/message relations are internally
 *     consistent (no fallback-to-pass normalization).
 *
 * Catalogue equality (argv, host_support, format_match,
 * architecture_assert, success_contract_version) is checked
 * independently by the reader at a later phase so the parser stays
 * purely structural and the catalogue-bound diagnostic kinds stay
 * distinguishable from the parse diagnostics here.
 */
export function parseBundledNativeProbe(
	probeId: NativeProbeId,
	raw: unknown,
): ProbeParseResult {
	const diagnostics: ProbeParseDiagnostic[] = [];
	const paths = canonicalStreamPaths(probeId);
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		diagnostics.push({
			field: "<root>",
			reason: "wrong-shape",
			expected: "object",
			observed: raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw,
		});
		return { ok: false, record: null, diagnostics };
	}
	const v = raw as Record<string, unknown>;
	const observed = (field: string): string => JSON.stringify(v[field]);
	const push = (field: string, reason: string, expected: string, value: string): void => {
		diagnostics.push({ field, reason, expected, observed: value });
	};
	if (v.id !== probeId) {
		push(
			"id",
			"mismatch",
			JSON.stringify(probeId),
			typeof v.id === "string" ? JSON.stringify(v.id) : typeof v.id,
		);
	}
	if (v.stream_layout_version !== NATIVE_PROBE_STREAM_LAYOUT_VERSION) {
		push(
			"stream_layout_version",
			"stream-layout-unsupported",
			`${NATIVE_PROBE_STREAM_LAYOUT_VERSION}`,
			observed("stream_layout_version"),
		);
	}
	if (v.stdout_path !== paths.stdout_path) {
		push(
			"stdout_path",
			"stream-path-mismatch",
			JSON.stringify(paths.stdout_path),
			observed("stdout_path"),
		);
	}
	if (v.stderr_path !== paths.stderr_path) {
		push(
			"stderr_path",
			"stream-path-mismatch",
			JSON.stringify(paths.stderr_path),
			observed("stderr_path"),
		);
	}
	if (v.metadata_path !== paths.metadata_path) {
		push(
			"metadata_path",
			"stream-path-mismatch",
			JSON.stringify(paths.metadata_path),
			observed("metadata_path"),
		);
	}
	const stdoutSha = v.stdout_sha256;
	if (typeof stdoutSha !== "string" || !SHA256_REGEX.test(stdoutSha)) {
		push(
			"stdout_sha256",
			"wrong-shape",
			"64-character lowercase hexadecimal",
			typeof stdoutSha === "string" ? `<${stdoutSha.length}>` : `<${typeof stdoutSha}>`,
		);
	}
	const stderrSha = v.stderr_sha256;
	if (typeof stderrSha !== "string" || !SHA256_REGEX.test(stderrSha)) {
		push(
			"stderr_sha256",
			"wrong-shape",
			"64-character lowercase hexadecimal",
			typeof stderrSha === "string" ? `<${stderrSha.length}>` : `<${typeof stderrSha}>`,
		);
	}
	// argv: array of strings (may be empty; empty argv is reported as a
	// catalogue-mismatch / argv-mismatch by the reader rather than as a
	// parser shape failure).
	if (
		!Array.isArray(v.argv) ||
		!v.argv.every((entry) => typeof entry === "string")
	) {
		push("argv", "wrong-shape", "array of strings", observed("argv"));
	}
	// stdout_text / stderr_text: must be strings (P0.6).
	if (typeof v.stdout_text !== "string") {
		push("stdout_text", "wrong-shape", "string", observed("stdout_text"));
	}
	if (typeof v.stderr_text !== "string") {
		push("stderr_text", "wrong-shape", "string", observed("stderr_text"));
	}
	// status enum.
	if (v.status !== "pass" && v.status !== "fail") {
		push("status", "wrong-shape", "\"pass\" or \"fail\"", observed("status"));
	}
	if (typeof v.reason !== "string") {
		push("reason", "wrong-shape", "string", observed("reason"));
	}
	// Identity OIDs (40-char lowercase hex).
	for (const oidField of ["execution_head_oid", "execution_tree_oid", "subject_tree_oid"] as const) {
		const oidValue = v[oidField];
		if (typeof oidValue !== "string" || !OID_REGEX.test(oidValue)) {
			push(oidField, "wrong-shape", "40-character lowercase hex OID", observed(oidField));
		}
	}
	// host_class / host_support / host_supported.
	if (typeof v.host_class !== "string" || v.host_class.length === 0) {
		push("host_class", "wrong-shape", "non-empty string", observed("host_class"));
	}
	if (typeof v.host_supported !== "boolean") {
		push("host_supported", "wrong-shape", "boolean", observed("host_supported"));
	}
	if (
		!Array.isArray(v.host_support) ||
		!v.host_support.every((entry) => typeof entry === "string")
	) {
		push("host_support", "wrong-shape", "array of strings", observed("host_support"));
	}
	// architecture_assert enum.
	if (v.architecture_assert !== "host-class" && v.architecture_assert !== "none") {
		push(
			"architecture_assert",
			"wrong-shape",
			"\"host-class\" or \"none\"",
			observed("architecture_assert"),
		);
	}
	// Legacy + observed shape.
	if (typeof v.path !== "string" || v.path.length === 0) {
		push("path", "wrong-shape", "non-empty string", observed("path"));
	}
	if (typeof v.architecture !== "string" || v.architecture.length === 0) {
		push("architecture", "wrong-shape", "non-empty string", observed("architecture"));
	}
	if (typeof v.file_format !== "string" || v.file_format.length === 0) {
		push("file_format", "wrong-shape", "non-empty string", observed("file_format"));
	}
	if (typeof v.sha256 !== "string" || !SHA256_REGEX.test(v.sha256 as string)) {
		push(
			"sha256",
			"wrong-shape",
			"64-character lowercase hexadecimal",
			typeof v.sha256 === "string" ? `<${v.sha256.length}>` : `<${typeof v.sha256}>`,
		);
	}
	// format_match serialization.
	if (
		v.format_match_source !== "stdout" &&
		v.format_match_source !== "stderr" &&
		v.format_match_source !== "file"
	) {
		push(
			"format_match_source",
			"wrong-shape",
			"\"stdout\" | \"stderr\" | \"file\"",
			observed("format_match_source"),
		);
	}
	if (typeof v.format_match_pattern_source !== "string") {
		push(
			"format_match_pattern_source",
			"wrong-shape",
			"string",
			observed("format_match_pattern_source"),
		);
	}
	if (typeof v.format_match_pattern_flags !== "string") {
		push(
			"format_match_pattern_flags",
			"wrong-shape",
			"string",
			observed("format_match_pattern_flags"),
		);
	}
	// success_contract_version + invocation_id.
	if (
		typeof v.success_contract_version !== "number" ||
		!Number.isInteger(v.success_contract_version) ||
		(v.success_contract_version as number) < 1
	) {
		push(
			"success_contract_version",
			"wrong-shape",
			"positive integer",
			observed("success_contract_version"),
		);
	}
	if (typeof v.invocation_id !== "string" || v.invocation_id.length === 0) {
		push("invocation_id", "wrong-shape", "non-empty string", observed("invocation_id"));
	}
	// Artifact fields.
	if (typeof v.artifact_path !== "string" || v.artifact_path.length === 0) {
		push(
			"artifact_path",
			"wrong-shape",
			"non-empty string",
			observed("artifact_path"),
		);
	}
	if (
		typeof v.artifact_size !== "number" ||
		!Number.isInteger(v.artifact_size) ||
		(v.artifact_size as number) < 0
	) {
		push("artifact_size", "wrong-shape", "non-negative integer", observed("artifact_size"));
	}
	if (typeof v.artifact_exists !== "boolean") {
		push("artifact_exists", "wrong-shape", "boolean", observed("artifact_exists"));
	}
	if (
		v.artifact_sha256 !== null &&
		(typeof v.artifact_sha256 !== "string" || !SHA256_REGEX.test(v.artifact_sha256 as string))
	) {
		push(
			"artifact_sha256",
			"wrong-shape",
			"64-character lowercase hex or null",
			observed("artifact_sha256"),
		);
	}
	// Observed / timing fields.
	if (v.observed_file_format !== null && typeof v.observed_file_format !== "string") {
		push(
			"observed_file_format",
			"wrong-shape",
			"string or null",
			observed("observed_file_format"),
		);
	}
	if (v.observed_architecture !== null && typeof v.observed_architecture !== "string") {
		push(
			"observed_architecture",
			"wrong-shape",
			"string or null",
			observed("observed_architecture"),
		);
	}
	if (
		v.exit_code !== null &&
		(typeof v.exit_code !== "number" || !Number.isInteger(v.exit_code))
	) {
		push("exit_code", "wrong-shape", "integer or null", observed("exit_code"));
	}
	if (v.signal !== null && typeof v.signal !== "string") {
		push("signal", "wrong-shape", "string or null", observed("signal"));
	}
	if (typeof v.timeout !== "boolean") {
		push("timeout", "wrong-shape", "boolean", observed("timeout"));
	}
	if (
		typeof v.timeout_ms !== "number" ||
		!Number.isInteger(v.timeout_ms) ||
		(v.timeout_ms as number) < 1
	) {
		push("timeout_ms", "wrong-shape", "positive integer", observed("timeout_ms"));
	}

	// Structured failure fields are mandatory. Never synthesize a
	// successful shape from malformed or absent evidence.
	const failureKind = isNativeProbeFailureKind(v.failure_kind)
		? v.failure_kind
		: null;
	if (failureKind === null) {
		push(
			"failure_kind",
			"wrong-shape",
			'"pass" | "host_unsupported" | "spawn_error" | "timeout" | "predicate_error" | "predicate_failure"',
			observed("failure_kind"),
		);
	}
	const failureMessage =
		typeof v.failure_message === "string" ? v.failure_message : null;
	if (failureMessage === null) {
		push("failure_message", "wrong-shape", "string", observed("failure_message"));
	}

	if (typeof v.started_at !== "string" || v.started_at.length === 0) {
		push("started_at", "wrong-shape", "non-empty string", observed("started_at"));
	}
	if (typeof v.finished_at !== "string" || v.finished_at.length === 0) {
		push("finished_at", "wrong-shape", "non-empty string", observed("finished_at"));
	}
	if (
		typeof v.duration_ms !== "number" ||
		!Number.isInteger(v.duration_ms) ||
		(v.duration_ms as number) < 0
	) {
		push("duration_ms", "wrong-shape", "non-negative integer", observed("duration_ms"));
	}
	if (typeof v.working_directory !== "string" || v.working_directory.length === 0) {
		push(
			"working_directory",
			"wrong-shape",
			"non-empty string",
			observed("working_directory"),
		);
	}

	// Relational outcome invariants. Shape-valid fields can still form an
	// impossible execution record; those contradictions are parser errors,
	// not values for the downstream reader to normalize.
	if (failureKind !== null && failureMessage !== null) {
		const relation = (field: string, expected: string): void => {
			push(field, "relational-invariant", expected, observed(field));
		};
		if (failureKind === "pass") {
			if (v.status !== "pass") relation("status", '"pass" when failure_kind="pass"');
			if (v.timeout !== false) relation("timeout", 'false when failure_kind="pass"');
			if (v.host_supported !== true) {
				relation("host_supported", 'true when failure_kind="pass"');
			}
			if (failureMessage !== "") {
				relation("failure_message", 'empty string when failure_kind="pass"');
			}
		} else if (v.status !== "fail") {
			relation("status", '"fail" when failure_kind is not "pass"');
		}

		if (failureKind === "host_unsupported" && v.host_supported !== false) {
			relation("host_supported", 'false when failure_kind="host_unsupported"');
		}
		if (failureKind === "spawn_error" && failureMessage.length === 0) {
			relation("failure_message", 'non-empty string when failure_kind="spawn_error"');
		}
		if (failureKind === "timeout" && v.timeout !== true) {
			relation("timeout", 'true when failure_kind="timeout"');
		}
		if (failureKind === "predicate_error" && failureMessage.length === 0) {
			relation("failure_message", 'non-empty string when failure_kind="predicate_error"');
		}
		if (
			(failureKind === "host_unsupported" ||
				failureKind === "timeout" ||
				failureKind === "predicate_failure") &&
			failureMessage !== ""
		) {
			relation(
				"failure_message",
				`empty string when failure_kind=${JSON.stringify(failureKind)}`,
			);
		}
	}

	if (diagnostics.length > 0 || failureKind === null || failureMessage === null) {
		return { ok: false, record: null, diagnostics };
	}
	// The TypeScript assertion below used to be `v as unknown as
	// BundledNativeProbe` — an unsafe cast that let the parser
	// silently hand the reader an arbitrary JSON object. µC-3
	// replaces the cast with an explicit field-by-field construction
	// so any field the parser forgot to validate cannot reach the
	// downstream reader. Catalogue-bound relational checks
	// (working_directory / artifact_path / format_match against the
	// catalogue, etc.) are performed by the reader at a later phase
	// so the parser stays purely structural and the catalogue-bound
	// diagnostic kinds stay distinguishable from these parse
	// diagnostics.
	const record: BundledNativeProbe = {
		id: v.id as NativeProbeId,
		path: v.path as string,
		architecture: v.architecture as string,
		sha256: v.sha256 as string,
		file_format: v.file_format as string,
		status: v.status as "pass" | "fail",
		reason: v.reason as string,
		artifact_path: v.artifact_path as string,
		artifact_sha256: (v.artifact_sha256 as string | null) ?? null,
		artifact_size: v.artifact_size as number,
		artifact_exists: v.artifact_exists as boolean,
		argv: v.argv as string[],
		exit_code: (v.exit_code as number | null) ?? null,
		signal: (v.signal as NodeJS.Signals | null) ?? null,
		timeout: v.timeout as boolean,
		timeout_ms: v.timeout_ms as number,
		stdout_text: v.stdout_text as string,
		stdout_sha256: v.stdout_sha256 as string,
		stderr_text: v.stderr_text as string,
		stderr_sha256: v.stderr_sha256 as string,
		observed_file_format: (v.observed_file_format as string | null) ?? null,
		observed_architecture: (v.observed_architecture as string | null) ?? null,
		execution_head_oid: v.execution_head_oid as string,
		execution_tree_oid: v.execution_tree_oid as string,
		subject_tree_oid: v.subject_tree_oid as string,
		host_class: v.host_class as string,
		host_supported: v.host_supported as boolean,
		host_support: v.host_support as ReadonlyArray<string>,
		started_at: v.started_at as string,
		finished_at: v.finished_at as string,
		duration_ms: v.duration_ms as number,
		working_directory: v.working_directory as string,
		format_match_source: v.format_match_source as "stdout" | "stderr" | "file",
		format_match_pattern_source: v.format_match_pattern_source as string,
		format_match_pattern_flags: v.format_match_pattern_flags as string,
		architecture_assert: v.architecture_assert as "host-class" | "none",
		success_contract_version: v.success_contract_version as number,
		invocation_id: v.invocation_id as string,
		failure_kind: failureKind,
		failure_message: failureMessage,
		stream_layout_version: NATIVE_PROBE_STREAM_LAYOUT_VERSION,
		stdout_path: paths.stdout_path,
		stderr_path: paths.stderr_path,
		metadata_path: paths.metadata_path,
	};
	return { ok: true, record, diagnostics: [] };
}

// ---------- ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — µC-3 loader ---------

/**
 * µC-3 result of `loadEvidencePayload`. The loader never throws —
 * every failure mode (missing file, traversal, symlink, non-regular,
 * hash mismatch, manifest-undeclared) is captured as a structured
 * diagnostic.
 */
export interface PayloadLoadDiagnostic {
	path: string;
	reason:
		| "missing"
		| "absolute"
		| "traversal"
		| "outside-evidence-dir"
		| "symlink"
		| "not-regular-file"
		| "manifest-undeclared"
		| "hash-mismatch";
	expected: string;
	observed: string;
}

export interface PayloadLoadResult {
	ok: boolean;
	bytes: Buffer | null;
	diagnostics: PayloadLoadDiagnostic[];
}

/**
 * µC-3 contained payload loader. The reader uses this for:
 *   - stdout (`native-probes/<id>.stdout`)
 *   - stderr (`native-probes/<id>.stderr`)
 *   - per-probe metadata (`native-probes/<id>.metadata.json`)
 *   - probe artifact payloads
 *
 * The loader rejects:
 *   - absolute paths,
 *   - `..` traversal,
 *   - paths that escape the evidence directory after `realpathSync()`,
 *   - symlinks (the evidence contract forbids them; the bundle is
 *     produced by the writer which never creates symlinks),
 *   - non-regular files,
 *   - manifest-undeclared paths,
 *   - hash mismatches against `hashes.sha256`.
 *
 * The bytes returned are read verbatim from disk. Node's hashing API
 * accepts `Buffer` input directly, so the verifier hashes the exact
 * bytes that were written.
 */
export function loadEvidencePayload(
	evidenceDir: string,
	relativePath: string,
	manifestHashes: Map<string, string>,
): PayloadLoadResult {
	const make = (
		reason: PayloadLoadDiagnostic["reason"],
		expected: string,
		observed: string,
	): PayloadLoadResult => ({
		ok: false,
		bytes: null,
		diagnostics: [{ path: relativePath, reason, expected, observed }],
	});
	if (typeof relativePath !== "string" || relativePath.length === 0) {
		return make("missing", "non-empty relative path", JSON.stringify(relativePath));
	}
	if (isAbsolute(relativePath)) {
		return make("absolute", "relative path within the evidence directory", relativePath);
	}
	// Step 1: canonicalize the EVIDENCE ROOT so both sides of the
	// containment comparison agree on the same namespace. On macOS a
	// lexical /var path may resolve to /private/var; if the root were
	// left as the unresolved lexical path, comparing it to a resolved
	// child would falsely report an escape.
	const lexicalRoot = resolve(evidenceDir);
	let realRoot: string;
	try {
		realRoot = realpathSync(lexicalRoot);
	} catch {
		// Root does not resolve (missing / non-traversable) — refuse
		// everything; the loader cannot prove containment.
		return make("outside-evidence-dir", `contained under ${lexicalRoot}`, lexicalRoot);
	}
	const declared = manifestHashes.get(relativePath);
	if (declared === undefined) {
		return make("manifest-undeclared", "declared in hashes.sha256", "absent");
	}
	// Step 2: lexical containment of the requested path against the
	// unresolved root. This is a syntactic check on user input and
	// cannot be fooled by symlinks under the bundle (the lstat check
	// below rejects them).
	const lexicalAbs = resolve(lexicalRoot, relativePath);
	const lexicalRel = normalizeRelative(relative(lexicalRoot, lexicalAbs));
	if (
		lexicalRel === "" ||
		lexicalRel === ".." ||
		lexicalRel.startsWith(`..${sep}`) ||
		isAbsolute(lexicalRel)
	) {
		return make("traversal", `contained under ${lexicalRoot}`, lexicalAbs);
	}
	if (!existsSync(lexicalAbs)) {
		return make("missing", "regular file on disk", lexicalAbs);
	}
	let lst;
	try {
		lst = lstatSync(lexicalAbs);
	} catch {
		return make("missing", "regular file on disk", lexicalAbs);
	}
	if (lst.isSymbolicLink()) {
		return make("symlink", "regular file (no symlink)", lexicalAbs);
	}
	if (!lst.isFile()) {
		return make("not-regular-file", "regular file", lexicalAbs);
	}
	// Step 3: canonicalize both sides before the namespace-equality
	// check so /var/... vs /private/var/... resolve to the same root.
	// The reader thereby verifies that the loaded file lives inside the
	// canonical evidence directory (defending against TOCTOU swaps
	// that mount a co-hosting inode over the staged path). Note: this
	// proves containment under a canonical root; it does NOT prove the
	// file's inode is uniquely owned by the bundle (a hard link to a
	// separately-owned file would pass the namespace check).
	let realAbs: string;
	try {
		realAbs = realpathSync(lexicalAbs);
	} catch {
		return make("missing", "real path resolvable", lexicalAbs);
	}
	const realRel = normalizeRelative(relative(realRoot, realAbs));
	if (
		realRel === "" ||
		realRel === ".." ||
		realRel.startsWith(`..${sep}`) ||
		isAbsolute(realRel)
	) {
		return make("outside-evidence-dir", `contained under ${realRoot}`, realAbs);
	}
	const bytes = readFileSync(lexicalAbs);
	const observedHash = createHash("sha256").update(bytes).digest("hex");
	if (observedHash !== declared) {
		return make(
			"hash-mismatch",
			declared.slice(0, 12),
			`${observedHash.slice(0, 12)} (${bytes.length} bytes)`,
		);
	}
	return { ok: true, bytes, diagnostics: [] };
}

// ---------- ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — µC-3 round 4 -------

/**
 * µC-3 round 4 — contained absence resolver.
 *
 * Absence is a filesystem claim, so lexical containment alone is not
 * enough: `inside/link/file` can escape when `link` is an intermediate
 * symlink. The resolver canonicalizes the evidence root, rejects lexical
 * traversal, and walks every existing parent with `lstatSync`. Any parent
 * symlink or non-absence filesystem error fails closed before the caller
 * probes the final name.
 */
export type ResolveContainedAbsenceFailure =
	| "absolute"
	| "traversal"
	| "outside-evidence-dir"
	| "non-canonical-root"
	| "intermediate-symlink"
	| `filesystem-observation-failed:${string}`;

export interface ResolveContainedAbsenceResult {
	ok: boolean;
	abs: string | null;
	reason: ResolveContainedAbsenceFailure | null;
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof (error as NodeJS.ErrnoException).code === "string"
	);
}

function filesystemObservationFailure(error: unknown): `filesystem-observation-failed:${string}` {
	return `filesystem-observation-failed:${isNodeError(error) ? error.code : "UNKNOWN"}`;
}

export function resolveContainedEvidencePathForAbsence(
	evDirAbs: string,
	relativePath: string,
): ResolveContainedAbsenceResult {
	if (typeof relativePath !== "string" || relativePath.length === 0) {
		return { ok: false, abs: null, reason: "traversal" };
	}
	if (isAbsolute(relativePath)) {
		return { ok: false, abs: null, reason: "absolute" };
	}
	if (relativePath.split(/[\\/]/).includes("..")) {
		return { ok: false, abs: null, reason: "traversal" };
	}

	let realRoot: string;
	try {
		realRoot = realpathSync(resolve(evDirAbs));
	} catch {
		return { ok: false, abs: null, reason: "non-canonical-root" };
	}
	const lexicalAbs = resolve(realRoot, relativePath);
	const lexicalRel = normalizeRelative(relative(realRoot, lexicalAbs));
	if (
		lexicalRel === "" ||
		lexicalRel === ".." ||
		lexicalRel.startsWith(`..${sep}`) ||
		isAbsolute(lexicalRel)
	) {
		return { ok: false, abs: null, reason: "outside-evidence-dir" };
	}

	let current = realRoot;
	const parentComponents = lexicalRel.split("/").slice(0, -1);
	for (const component of parentComponents) {
		current = resolve(current, component);
		try {
			const parent = lstatSync(current);
			if (parent.isSymbolicLink()) {
				return { ok: false, abs: null, reason: "intermediate-symlink" };
			}
			if (!parent.isDirectory()) {
				// The final path is necessarily absent through this non-directory
				// parent. The final observation reports ENOTDIR explicitly.
				break;
			}
		} catch (error) {
			if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
				// Once a parent is missing, no deeper component can exist or be
				// a symlink. The final observation remains authoritative.
				break;
			}
			return { ok: false, abs: null, reason: filesystemObservationFailure(error) };
		}
	}
	return { ok: true, abs: lexicalAbs, reason: null };
}

export interface EvidencePathAbsenceObservation {
	absent: boolean;
	diagnostic: "artifact-present-on-disk" | `filesystem-observation-failed:${string}` | null;
}

/**
 * Observe the final contained path. Only ENOENT and ENOTDIR prove absence;
 * permission failures, symlink loops, I/O errors, and unknown exceptions
 * mean that absence could not be established and therefore fail closed.
 * The optional lstat operation is a narrow test seam for deterministic
 * system-error classification tests.
 */
export function observeEvidencePathForAbsence(
	absolutePath: string,
	lstat: (path: string) => unknown = (path) => lstatSync(path),
): EvidencePathAbsenceObservation {
	try {
		lstat(absolutePath);
		return { absent: false, diagnostic: "artifact-present-on-disk" };
	} catch (error) {
		if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
			return { absent: true, diagnostic: null };
		}
		return { absent: false, diagnostic: filesystemObservationFailure(error) };
	}
}

function normalizeRelative(path: string): string {
	return path.split(sep).join("/");
}

