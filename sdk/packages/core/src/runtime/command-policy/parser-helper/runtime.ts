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

import {
	joinRunCommandsForParse,
	type ParsedShell,
} from "../structured-command-risk";
import {
	BoundedSourceChars,
	BoundedStdoutChars,
	BoundedTimeoutMs,
	PARSER_HELPER_PROTOCOL_VERSION,
	type ParsedShellJSON,
	type ParserHelperDialect,
	type ParserHelperRequest,
} from "./protocol";

/** Detected platform string, in the format used by the binary vendor layout. */
export type HelperPlatform =
	| "darwin-arm64"
	| "darwin-amd64"
	| "linux-amd64"
	| "linux-arm64"
	| "win32-x64";

/**
 * Locate the parser-helper binary for the current platform.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
 * The helper binary is vendored at
 * `<package_root>/bin/parser-helper/<platform>/`.
 * When the helper-binary ACT ships, this is the layout it MUST use.
 *
 * For this ACT the binary is NOT YET BUILT. `binaryPath()` returns
 * `null` and V2 stays dormant. The capability is wired so the next
 * ACT
 * (ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01)
 * only has to drop in the binary files.
 */
export interface ParserHelperLocator {
	/** Returns the absolute path to the helper binary, or `null` if not available. */
	binaryPath(): string | null;
	/** The platform this locator targets. */
	readonly platform: HelperPlatform;
}

export function defaultParserHelperLocator(): ParserHelperLocator {
	const platform = detectPlatform();
	return {
		platform,
		binaryPath() {
			// The next ACT ships binaries at this layout:
			// <package_root>/bin/parser-helper/<platform>/cline-parser-helper
			// (or .exe on win32-x64). Today, this directory does not
			// exist, so we return null and V2 stays dormant.
			return null;
		},
	};
}

function detectPlatform(): HelperPlatform {
	const p = process.platform;
	const a = process.arch;
	if (p === "darwin" && a === "arm64") return "darwin-arm64";
	if (p === "darwin" && (a === "x64" || a === "ia32")) return "darwin-amd64";
	if (p === "linux" && (a === "x64" || a === "ia32")) return "linux-amd64";
	if (p === "linux" && a === "arm64") return "linux-arm64";
	if (p === "win32" && (a === "x64" || a === "ia32")) return "win32-x64";
	throw new Error(`MvdanShHelper: unsupported platform ${p}/${a}; V2 disabled`);
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
	let json: ParsedShellJSON;
	try {
		json = JSON.parse(raw) as ParsedShellJSON;
	} catch {
		return null;
	}
	if (!json || typeof json !== "object") return null;
	if (json.protocolVersion !== PARSER_HELPER_PROTOCOL_VERSION) return null;
	if (typeof json.sourceSha256 !== "string") return null;
	if (json.sourceSha256 !== expectedDigest) return null;
	if (json.parseStatus !== "complete" && json.parseStatus !== "failed") {
		return null;
	}
	if (typeof json.hasCommandSubstitution !== "boolean") return null;
	if (!Array.isArray(json.errors)) return null;

	return json as unknown as ParsedShell;
}
