// EVIDENCE-LEVEL QUALIFICATION HARNESS for
// ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01-CORRECTION01.
//
// Classification: REAL_PRODUCTION_SEAM.
//
// This script drives the user's exact live command through the rebuilt
// SDK's internal entry point, with the AST supplied by the REAL
// parser-helper binary (not hand-constructed). This closes the gap
// from the prior ACT where the AST was a hand-constructed fixture
// that embedded literal quote characters in `cmd.args`.
//
// The chain raw shell string -> real parser-helper binary ->
// rebuilt SDK -> verdict is the load-bearing seam. The prior ACT
// stopped at raw string -> fixture -> verdict, which masked the
// bug: real parser strips quotes before assigning the argv.
//
// Run after `bun run build` in sdk/packages/core:
//   bun .factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01-CORRECTION01/live-qualification.mjs

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const sdkRoot = path.join(REPO_ROOT, "sdk", "packages", "core");

const internalEntry = path.join(
	sdkRoot,
	"dist",
	"runtime",
	"command-policy",
	"command-risk-internal.js",
);
if (!existsSync(internalEntry)) {
	console.error(
		`Cannot find SDK bundle at ${internalEntry}. Run 'bun run build' in sdk/packages/core first.`,
	);
	process.exit(1);
}

const parserBin = path.join(
	sdkRoot,
	"bin",
	"parser-helper",
	"darwin-arm64",
	"cline-parser-helper",
);
if (!existsSync(parserBin)) {
	console.error(
		`Cannot find parser-helper binary at ${parserBin}. Run the prepublish vendoring step.`,
	);
	process.exit(1);
}

const { evaluateCommandRiskWithParser } = await import(
	pathToFileURL(internalEntry).href
);

/**
 * Drive the real parser-helper binary. This is what V2's host
 * adapter would do at runtime.
 */
async function invokeRealParser(source) {
	const req = JSON.stringify({ dialect: "bash", source });
	return new Promise((resolve, reject) => {
		const child = spawn(parserBin, [], { stdio: ["pipe", "pipe", "pipe"] });
		const chunks = [];
		const errs = [];
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("parser helper timed out"));
		}, 2000);
		child.stdout.on("data", (c) => chunks.push(c));
		child.stderr.on("data", (c) => errs.push(c));
		child.on("error", (e) => {
			clearTimeout(timer);
			reject(e);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				reject(
					new Error(
						`parser helper exited with ${code}; stderr: ${Buffer.concat(errs).toString()}`,
					),
				);
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString()));
			} catch (e) {
				reject(e);
			}
		});
		child.stdin.write(req);
		child.stdin.end();
	});
}

/**
 * Compute the source-binding SHA-256 the way V2 expects.
 */
function sha256Hex(s) {
	return createHash("sha256").update(s).digest("hex");
}

/**
 * The exact LIVE 5-leaf && chain from the user's chat. Drives the
 * real parser; then exercises the rebuilt SDK; asserts V2
 * promotion.
 */
const LIVE_CMD =
	"git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v";

const SENTINEL_CMD =
	"git status --short && git branch -D __CLINEMM_SENTINEL__";

const safeAuth = {
	mode: "safe-only",
	explicitAllowRules: [],
};

let pass = true;

console.log(
	"=== REAL_PRODUCTION_SEAM QUALIFICATION (CORRECTION01) ===\n",
);
console.log("Classification: REAL_PARSER_HELPER + REAL_PRODUCTION_BUNDLE");
console.log(
	"AST comes from the vendored mvdan/sh helper, NOT a hand-built fixture.\n",
);

// 1. LIVE 5-leaf && chain through the real parser.
console.log(`[1] LIVE 5-leaf && chain through the real parser:\n  ${LIVE_CMD}\n`);
let liveResult;
try {
	const parsed = await invokeRealParser(LIVE_CMD);
	if (parsed.parseStatus !== "complete") {
		console.error(
			`  FAIL: parser returned parseStatus=${parsed.parseStatus}; errors=${JSON.stringify(parsed.errors)}`,
		);
		pass = false;
	} else {
		// Bind the parser's reported source to our joined source.
		parsed.sourceSha256 = sha256Hex(LIVE_CMD);
		liveResult = evaluateCommandRiskWithParser({
			toolInput: LIVE_CMD,
			hostAuthorization: safeAuth,
			parserResult: parsed,
		});
		console.log(`  decision:    ${liveResult.decision}`);
		console.log(`  disposition: ${liveResult.disposition}`);
		console.log(`  source:      ${liveResult.source}`);
		console.log(`  reasons:     ${JSON.stringify(liveResult.reasons)}\n`);
		if (
			liveResult.decision !== "allow" ||
			liveResult.disposition !== "auto-approve-eligible" ||
			liveResult.source !== "risk_v2_structured_promotion"
		) {
			console.error(
				"  FAIL: expected allow / auto-approve-eligible / risk_v2_structured_promotion",
			);
			pass = false;
		} else {
			console.log(
				"  PASS: V2 promotion fires for the LIVE command (real parser)",
			);
		}
	}
} catch (e) {
	console.error(`  FAIL: ${e.message}`);
	pass = false;
}

// 2. LIVE sentinel (mixed-risk control).
console.log(`\n[2] LIVE mixed-risk sentinel:\n  ${SENTINEL_CMD}\n`);
try {
	const parsed = await invokeRealParser(SENTINEL_CMD);
	if (parsed.parseStatus !== "complete") {
		console.error(
			`  FAIL: parser returned parseStatus=${parsed.parseStatus}; errors=${JSON.stringify(parsed.errors)}`,
		);
		pass = false;
	} else {
		parsed.sourceSha256 = sha256Hex(SENTINEL_CMD);
		const sentinelResult = evaluateCommandRiskWithParser({
			toolInput: SENTINEL_CMD,
			hostAuthorization: safeAuth,
			parserResult: parsed,
		});
		console.log(`  decision:    ${sentinelResult.decision}`);
		console.log(`  disposition: ${sentinelResult.disposition}`);
		console.log(`  source:      ${sentinelResult.source}\n`);
		if (
			sentinelResult.decision !== "ask" ||
			sentinelResult.disposition === "auto-approve-eligible"
		) {
			console.error(
				"  FAIL: expected ASK + non-auto-approve-eligible (mutating leaf must block)",
			);
			pass = false;
		} else {
			console.log(
				"  PASS: sentinel stays ASK (mutating leaf blocks promotion)",
			);
		}
	}
} catch (e) {
	console.error(`  FAIL: ${e.message}`);
	pass = false;
}

// 3. Bundle presence: the new argv-semantic echo classifier
// marker is in the rebuilt SDK dist.
console.log("\n[3] BUNDLE PRESENCE CHECK\n");
const bundlePath = path.join(sdkRoot, "dist", "runtime", "command-policy", "command-risk-internal.js");
if (existsSync(bundlePath)) {
	const buf = await import("node:fs").then((m) => m.readFileSync(bundlePath));
	const txt = buf.toString("utf8");
	const hasEchoMarker = txt.includes("host_safe_echo_parsed_argv");
	console.log(`  bundle path:    ${bundlePath}`);
	console.log(`  bundle size:    ${buf.length} bytes`);
	console.log(`  bundle sha256:  ${sha256Hex(txt)}`);
	console.log(`  contains host_safe_echo_parsed_argv: ${hasEchoMarker}\n`);
	if (!hasEchoMarker) {
		console.error(
			"  FAIL: rebuilt bundle does NOT contain the new argv-semantic echo marker",
		);
		pass = false;
	} else {
		console.log(
			"  PASS: rebuilt SDK bundle contains the argv-semantic echo classifier",
		);
	}
} else {
	console.error(`  FAIL: cannot find SDK bundle at ${bundlePath}`);
	pass = false;
}

console.log("\n=== VERDICT ===");
if (pass) {
	console.log(
		"PASS - REAL_PRODUCTION_SEAM QUALIFICATION SUCCEEDED",
	);
	console.log(
		"NEXT STEP for true LIVE: dogfood the rebuilt VSIX in the user's installed VSCodium",
	);
	console.log(
		"and verify no approval card is shown for the exact live command above.",
	);
} else {
	console.log("FAIL - see diagnostics above");
	process.exit(1);
}
