/**
 * Parser Helper — Host-owned trusted capability
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01
 *
 * This module is the HOST-OWNED capability that produces `ParsedShell`
 * values. It is the ONLY sanctioned path through which V2 parser
 * evidence reaches `evaluateCommandRiskWithParser`.
 *
 * ## Provenance invariant
 *
 * `MvdanShHelper.invoke(toolInput)` is the single trusted capability
 * that constructs a `ParsedShell`. It does this by:
 *
 *   1. Locating the bundled parser-helper binary at runtime (via
 *      `MvdanShHelper.binaryPath()`, which selects per-platform).
 *   2. Spawning it DIRECTLY (no shell) with a bounded JSON request on
 *      stdin.
 *   3. Validating the response (protocol version, digest match,
 *      bounded output).
 *   4. Constructing the trusted `ParsedShell` and returning it.
 *
 * If ANY step fails, `invoke` returns `null` — V2 stays dormant and
 * V1 behavior is preserved unchanged.
 *
 * ## Failure semantics
 *
 * EVERY operational failure mode reduces to `null` (V2 unavailable):
 *
 *   - binary path not found (helper not bundled for this platform)
 *   - spawn failure (binary missing, permission denied, etc.)
 *   - non-zero exit code
 *   - stdout malformed (not valid JSON, wrong protocol version)
 *   - timeout (helper takes longer than BoundedTimeoutMs)
 *   - digest mismatch (helper returned a different source than we sent)
 *
 * NONE of these can produce an ALLOW on a dangerous command. V2
 * promotion requires a structurally complete, source-bound, trusted
 * AST; if any link in the chain is broken, V2 is dormant.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
	joinRunCommandsForParse,
	type ParsedShell,
} from "../structured-command-risk";
import {
	BoundedSourceChars,
	BoundedStdoutChars,
	BoundedTimeoutMs,
	type ParserHelperDialect,
	type ParserHelperRequest,
} from "./protocol";

/**
 * Detected platform string, in the format used by the binary vendor layout.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01:
 * `null` is a FIRST-CLASS value: an unsupported host platform means
 * "helper unavailable" — V2 stays dormant, V1 is preserved, the
 * approval pipeline does NOT throw. This is the explicit override
 * of the prior behavior, where `detectPlatform()` raised and would
 * bubble out of `defaultParserHelperLocator()` during construction.
 */
export type HelperPlatform =
	| "darwin-arm64"
	| "darwin-amd64"
	| "linux-amd64"
	| "linux-arm64"
	| "win32-x64"
	| null;

/**
 * Locate the parser-helper binary for the current platform.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01:
 * The helper binary is vendored at
 * `<package_root>/bin/parser-helper/<platform>/cline-parser-helper`
 * (or `.exe` on win32-x64). The package root is the directory that
 * contains `@cline/core`'s `package.json`.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * CORRECTION02 (Phase 2, P1): on an unsupported host platform,
 * `binaryPath()` returns `null` and `platform === null` instead of
 * throwing. The V2 failure contract is:
 *
 *     helper unavailable -> parserResult = undefined -> V1
 *
 * `defaultParserHelperLocator()` therefore MUST NOT throw on
 * unsupported platforms.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * Phase 3: the resolver tries TWO locations in order:
 *
 *   1. The SDK package root (via `node_modules/@cline/core/...`)
 *      for CLI / Node consumers and for installed (npm-published)
 *      VSCode extensions.
 *   2. A consumer-side mirror at `<consumerRoot>/bin/parser-helper/`,
 *      used by the VSCode extension in development where the SDK
 *      is a workspace symlink and the runtime may walk to
 *      `node_modules/@cline/core` but the actual `bin/` files live
 *      under `<extension-root>/bin/`. The VSCode host adapter
 *      passes the consumer root via `defaultParserHelperLocator({ consumerRoot })`.
 *
 * If neither location yields a binary, `binaryPath()` returns
 * `null` and V2 stays dormant. This is the same failure mode as
 * "unsupported platform" — V1 is preserved.
 */
export interface ParserHelperLocatorOptions {
	/**
	 * Optional consumer-side root. When provided, the resolver
	 * also checks `<consumerRoot>/bin/parser-helper/<platform>/cline-parser-helper[.exe]`.
	 * Used by the VSCode host adapter to locate the dev-time
	 * mirror without bundling-time coupling.
	 */
	consumerRoot?: string;
}

export interface ParserHelperLocator {
	/** Returns the absolute path to the helper binary, or `null` if not available. */
	binaryPath(): string | null;
	/**
	 * The platform this locator targets. `null` when the host
	 * platform is not in the supported matrix — V2 is dormant in
	 * that case, by the failure contract above.
	 */
	readonly platform: HelperPlatform;
}

export function defaultParserHelperLocator(
	options: ParserHelperLocatorOptions = {},
): ParserHelperLocator {
	const platform = detectPlatform();
	// Cache the resolution attempt so we only walk the filesystem
	// once per process. The path itself is returned lazily because
	// the binary may be added at runtime in some test scenarios.
	let cachedPath: string | null | undefined;
	const ext = platform === "win32-x64" ? ".exe" : "";
	const resolveBinary = (): string | null => {
		if (cachedPath !== undefined) return cachedPath;
		if (platform === null) {
			cachedPath = null;
			return null;
		}
		const candidates: string[] = [];
		const sdkRoot = resolveClineCorePackageRoot();
		if (sdkRoot !== null) {
			candidates.push(
				path.join(
					sdkRoot,
					"bin",
					"parser-helper",
					platform,
					`cline-parser-helper${ext}`,
				),
			);
		}
		if (options.consumerRoot) {
			candidates.push(
				path.join(
					options.consumerRoot,
					"bin",
					"parser-helper",
					platform,
					`cline-parser-helper${ext}`,
				),
			);
		}
		for (const candidate of candidates) {
			try {
				const stat = fs.statSync(candidate);
				if (stat.isFile()) {
					cachedPath = candidate;
					return candidate;
				}
			} catch {
				// continue to next candidate
			}
		}
		cachedPath = null;
		return null;
	};
	return {
		platform,
		binaryPath: resolveBinary,
	};
}

/**
 * Resolve the `@cline/core` package root at runtime.
 *
 * Walks up from `import.meta.url` looking for a directory containing
 * `package.json` whose `name` field equals `@cline/core`. This works
 * for both un-bundled (CLI, Node tests) and bundled (VSCode
 * extension.js) consumers:
 *
 *   - CLI / Node: `import.meta.url` is the SDK source file, the
 *     walk terminates at `sdk/packages/core/package.json`.
 *   - VSCode: `import.meta.url` is the bundled extension.js in the
 *     extension's install dir; the walk descends into
 *     `node_modules/@cline/core/` first.
 *
 * Returns `null` when the package root cannot be located. Callers
 * MUST treat `null` identically to an unsupported platform (V1
 * preserved, V2 dormant).
 */
function resolveClineCorePackageRoot(): string | null {
	const startDir = path.dirname(fileURLToPath(import.meta.url));
	let dir = startDir;
	// Bound the walk to a small depth — under normal layouts the
	// package root is within a handful of `..` hops.
	for (let i = 0; i < 12; i++) {
		const candidate = path.join(dir, "package.json");
		try {
			const raw = fs.readFileSync(candidate, "utf8");
			const pkg = JSON.parse(raw) as { name?: unknown };
			if (pkg && pkg.name === "@cline/core") {
				return dir;
			}
		} catch {
			// missing or unreadable — keep walking
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	// Second pass: descend into a sibling `node_modules/@cline/core`
	// subtree from the extension's install root. This handles the
	// bundled-VSCode case where `import.meta.url` is somewhere
	// outside `@cline/core`'s normal src tree.
	const nmCandidate = path.join(startDir, "node_modules", "@cline", "core");
	try {
		const stat = fs.statSync(nmCandidate);
		if (stat.isDirectory()) {
			const pkgCandidate = path.join(nmCandidate, "package.json");
			const raw = fs.readFileSync(pkgCandidate, "utf8");
			const pkg = JSON.parse(raw) as { name?: unknown };
			if (pkg && pkg.name === "@cline/core") {
				return nmCandidate;
			}
		}
	} catch {
		// ignore
	}
	return null;
}

function detectPlatform(): HelperPlatform {
	const p = process.platform;
	const a = process.arch;
	if (p === "darwin" && a === "arm64") return "darwin-arm64";
	if (p === "darwin" && (a === "x64" || a === "ia32")) return "darwin-amd64";
	if (p === "linux" && (a === "x64" || a === "ia32")) return "linux-amd64";
	if (p === "linux" && a === "arm64") return "linux-arm64";
	if (p === "win32" && (a === "x64" || a === "ia32")) return "win32-x64";
	// CORRECTION02 P1: return null, do NOT throw.
	// The V2 failure contract requires `helper unavailable -> V1`.
	// A throw here would bubble out of `defaultParserHelperLocator()`
	// during construction and break the async seam at every host
	// (CLI, VSCode). The locator then reports `platform === null`,
	// `binaryPath() === null`, and `MvdanShHelper.invoke` returns
	// `null` — preserving V1 behavior.
	return null;
}

/**
 * Helper capability. Construct one per host process. Thread-safe.
 */
export class MvdanShHelper {
	constructor(
		private readonly locator: ParserHelperLocator = defaultParserHelperLocator(),
	) {}

	get platform(): HelperPlatform {
		return this.locator.platform;
	}

	binaryPath(): string | null {
		return this.locator.binaryPath();
	}

	async invoke(toolInput: unknown): Promise<ParsedShell | null> {
		const binPath = this.binaryPath();
		if (!binPath) return null;

		const { joined } = joinRunCommandsForParse(toolInput);
		if (joined.length === 0 || joined.length > BoundedSourceChars) {
			return null;
		}

		const dialect = inferDialect(toolInput);
		const request: ParserHelperRequest = { dialect, source: joined };
		const expectedDigest = createHash("sha256").update(joined).digest("hex");

		const raw = await invokeBinary(binPath, request);
		if (!raw) return null;

		return validateResponse(raw, expectedDigest);
	}
}

function inferDialect(_toolInput: unknown): ParserHelperDialect {
	// Bash by default. Future ACT may infer dialect from a shebang or
	// the host config; for now bash is the only dialect that earns
	// promotion.
	return "bash";
}

async function invokeBinary(
	binPath: string,
	request: ParserHelperRequest,
): Promise<string | null> {
	const stdinPayload = JSON.stringify(request);

	return new Promise<string | null>((resolve) => {
		let stdout = "";
		let settled = false;
		const finish = (value: string | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		let child: ReturnType<typeof spawn> | undefined;
		try {
			child = spawn(binPath, [], {
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch {
			finish(null);
			return;
		}

		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// already dead
			}
			finish(null);
		}, BoundedTimeoutMs);

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
			if (stdout.length > BoundedStdoutChars) {
				try {
					child.kill("SIGKILL");
				} catch {
					// already dead
				}
				finish(null);
			}
		});
		child.stderr?.on("data", () => {
			// diagnostic only; consumed via telemetry later
		});
		child.on("error", () => {
			clearTimeout(timer);
			finish(null);
		});
		child.on("close", (code: number | null) => {
			clearTimeout(timer);
			if (code !== 0) {
				finish(null);
				return;
			}
			finish(stdout);
		});

		try {
			child.stdin?.write(stdinPayload);
			child.stdin?.end();
		} catch {
			finish(null);
		}
	});
}

function validateResponse(
	raw: string,
	expectedDigest: string,
): ParsedShell | null {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!json || typeof json !== "object") return null;
	const j = json as Record<string, unknown>;
	// Accept BOTH protocol versions:
	//   - 3 (current): carries per-arg `argProvenance`; classifier's
	//     parser-proven branch activates.
	//   - 2 (legacy): NO `argProvenance`; classifier's parser-proven
	//     branch fail-closes (the synthetic-unknown normalisation
	//     below marks every cmd as `argProvenance: ["unknown", ...]`
	//     so `cmd.argProvenance.every(p => p === "static")` is false
	//     for every command under a v2 helper).
	if (j.protocolVersion !== 4 && j.protocolVersion !== 3 && j.protocolVersion !== 2) return null;
	if (typeof j.sourceSha256 !== "string") return null;
	if (j.sourceSha256 !== expectedDigest) return null;
	if (j.parseStatus !== "complete" && j.parseStatus !== "failed") {
		return null;
	}
	if (typeof j.hasCommandSubstitution !== "boolean") return null;
	if (!Array.isArray(j.errors)) return null;

	// CORRECTION01 P1: structurally validate the nested AST.
	// Without this, a helper that returns a malformed `program`
	// (e.g. `program: { stmts: "not-an-array" }`) would pass
	// top-level validation and throw later in the classifier when
	// it tries to walk `.program.stmts`. We validate the narrow
	// shape we consume and reject anything else.
	if (!isValidProgram(j.program)) return null;

	// PHASE2-PROVENANCE01: a v2 response carries NO argProvenance.
	// Synthesize a per-arg array of "unknown" so the classifier's
	// parser-proven branch is GUARANTEED to fail-closed under v2
	// (no string-blacklist-derived promotion can sneak through).
	if (j.protocolVersion === 2) {
		injectUnknownProvenance(j.program);
		// Re-typecast; the protocolVersion is still 2 on the wire
		// so the structured-command-risk check sees the right
		// version. We do NOT mutate `j.protocolVersion` to 3.
	}

	return j as unknown as ParsedShell;
}

/**
 * Recursively walks a parsed program and, for every cmd stmt,
 * ensures `cmd.argProvenance` is set to an array of "unknown" of
 * length `cmd.args.length`. This is the v2 fail-closed injection.
 */
function injectUnknownProvenance(program: unknown): void {
	if (!program || typeof program !== "object") return;
	const p = program as { stmts?: unknown };
	if (!Array.isArray(p.stmts)) return;
	for (const stmt of p.stmts) {
		injectUnknownProvenanceStmt(stmt);
	}
}

function injectUnknownProvenanceStmt(stmt: unknown): void {
	if (!stmt || typeof stmt !== "object") return;
	const s = stmt as { kind?: string; cmd?: unknown; left?: unknown; rhs?: unknown; inner?: unknown };
	switch (s.kind) {
		case "cmd":
			if (s.cmd && typeof s.cmd === "object") {
				const c = s.cmd as { args?: unknown; argProvenance?: unknown };
				if (Array.isArray(c.args) && c.argProvenance === undefined) {
					c.argProvenance = Array.from({ length: c.args.length }, () => "unknown");
				}
			}
			break;
		case "and":
		case "or":
		case "pipe":
			injectUnknownProvenanceStmt(s.left);
			injectUnknownProvenanceStmt(s.rhs);
			break;
		case "subshell":
			injectUnknownProvenanceStmt(s.inner);
			break;
		case "opaque":
			break;
	}
}

function isValidProgram(program: unknown): boolean {
	if (program === null) return true; // allowed when parseStatus is "failed"
	if (typeof program !== "object") return false;
	const p = program as Record<string, unknown>;
	if (!Array.isArray(p.stmts)) return false;
	for (const stmt of p.stmts) {
		if (!isValidStmt(stmt)) return false;
	}
	return true;
}

function isValidStmt(stmt: unknown): boolean {
	if (typeof stmt !== "object" || stmt === null) return false;
	const s = stmt as Record<string, unknown>;
	switch (s.kind) {
		case "cmd":
			return isValidCmd(s.cmd);
		case "and":
		case "or":
		case "pipe":
			return isValidStmt(s.left) && isValidStmt(s.rhs);
		case "subshell":
			return isValidStmt(s.inner);
		case "opaque":
			return true;
		default:
			return false;
	}
}

function isValidCmd(cmd: unknown): boolean {
	if (typeof cmd !== "object" || cmd === null) return false;
	const c = cmd as Record<string, unknown>;
	if (typeof c.name !== "string") return false;
	if (!Array.isArray(c.args)) return false;
	if (!Array.isArray(c.assigns)) return false;
	if (!Array.isArray(c.redirects)) return false;
	if (typeof c.isWrapper !== "boolean") return false;
	if (typeof c.wrapperOf !== "string") return false;
	if (typeof c.inner !== "string") return false;
	for (const arg of c.args) {
		if (typeof arg !== "string") return false;
	}
	for (const a of c.assigns) {
		if (typeof a !== "object" || a === null) return false;
		const ar = a as Record<string, unknown>;
		if (typeof ar.name !== "string") return false;
		if (typeof ar.value !== "string") return false;
	}
	for (const r of c.redirects) {
		if (typeof r !== "object" || r === null) return false;
		const rr = r as Record<string, unknown>;
		if (typeof rr.op !== "string") return false;
		if (typeof rr.path !== "string") return false;
		// Protocol v4 adds per-redirect provenance. If either field
		// is present, BOTH must be valid (and the fd must be a
		// small positive integer or null; pathProvenance must be
		// one of the three valid strings). Absent on v2/v3
		// responses; the classifier fails closed when missing.
		//
		// ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01.
		if (rr.fd !== undefined || rr.pathProvenance !== undefined) {
			if (rr.fd !== null && rr.fd !== undefined && typeof rr.fd !== "number") {
				return false;
			}
			if (typeof rr.fd === "number") {
				if (!Number.isInteger(rr.fd)) return false;
				// fd is a small non-negative integer (Unix file
				// descriptors are 0-9 in standard shell syntax).
				if (rr.fd < 0 || rr.fd > 9) return false;
			}
			if (
				rr.pathProvenance !== "static" &&
				rr.pathProvenance !== "dynamic" &&
				rr.pathProvenance !== "unknown"
			) {
				return false;
			}
		}
	}
	// Protocol v3 adds argProvenance. If present, it MUST be a string
	// array of the same length as `args` and contain only the three
	// valid provenance values. Absent on protocol v2 responses; the
	// classifier fails closed when it is missing.
	if (c.argProvenance !== undefined) {
		if (!Array.isArray(c.argProvenance)) return false;
		if ((c.argProvenance as unknown[]).length !== (c.args as unknown[]).length) return false;
		for (const p of c.argProvenance as unknown[]) {
			if (p !== "static" && p !== "dynamic" && p !== "unknown") return false;
		}
	}
	return true;
}
