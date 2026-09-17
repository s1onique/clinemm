// EVIDENCE-LEVEL QUALIFICATION HARNESS for
// ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01.
//
// Classification: REAL_PRODUCTION_BUNDLE PROVEN.
//
// This script drives the user's exact live command through the rebuilt
// SDK's internal entry point and asserts V2 promotion. It also drives
// the adversarial sentinel control and verifies both new rules are
// present in the rebuilt bundle.
//
// IMPORTANT — evidence-classification caveat:
//
//   This is NOT a LIVE qualification. The harness:
//     (a) imports the rebuilt SDK dist directly (REAL_PRODUCTION_BUNDLE),
//     (b) drives the internal `evaluateCommandRiskWithParser` entry
//         (the production code that the host adapters call),
//     (c) hands the AST as a hand-constructed `ParsedShell` fixture
//         via `mkParsed()` — the parser helper binary (mvdan/sh) is
//         NOT in the loop here.
//
//   So this proves: "the rebuilt SDK bundle, with the AST supplied
//   as if a parser were bound to the live source string, returns
//   the expected verdict". It does NOT prove: "the rebuilt SDK
//   bundle, given an arbitrary live shell string, parses it correctly
//   and produces the same AST that this fixture assumes".
//
//   The chain from raw shell string -> AST fixture -> verdict is the
//   REAL gap. To upgrade this evidence to TRUE LIVE, a future ACT
//   must wire the parser helper binary into the harness (mvdan/sh
//   v3.12.0, BSD-3, via the existing
//   ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
//   evidence). Until then the SYNTHETIC AST fixture is structurally
//   honest but parser-unbound.
//
// Run after `bun run build` in sdk/packages/core:
//   bun .factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01/live-qualification.mjs

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

// Always resolve relative to this file's location, never the CWD.
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
// .../clinemm/.factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01
const ACT_DIR = SCRIPT_DIR;
// .../clinemm
const REPO_ROOT = path.resolve(ACT_DIR, "..", "..", "..");
const sdkRoot = path.join(REPO_ROOT, "sdk", "packages", "core");
const internalEntry = path.join(
	sdkRoot,
	"dist",
	"runtime",
	"command-policy",
	"command-risk-internal.js",
);

if (!fs.existsSync(internalEntry)) {
	console.error(
		`Cannot find SDK bundle at ${internalEntry}. Run 'bun run build' in sdk/packages/core first.`,
	);
	process.exit(1);
}

const {
	evaluateCommandRiskWithParser,
	joinRunCommandsForParse,
	STRUCTURED_PROTO_VERSION,
	sha256Hex,
} = await import(pathToFileURL(internalEntry).href);

const LIVE_CMD =
	"git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v";

const SENTINEL_CMD =
	"git status --short && git branch -D __CLINEMM_SENTINEL__";

function mkCmd(name, args = []) {
	return {
		name,
		args,
		assigns: [],
		redirects: [],
		isWrapper: false,
		wrapperOf: "",
		inner: "",
	};
}

function mkParsed(toolInput, stmts, overrides = {}) {
	const { joined } = joinRunCommandsForParse(toolInput);
	return {
		protocolVersion: STRUCTURED_PROTO_VERSION,
		dialect: "bash",
		sourceSha256: sha256Hex(joined),
		parseStatus: "complete",
		hasCommandSubstitution: false,
		program: { stmts },
		errors: [],
		...overrides,
	};
}

// AST for the 5-leaf && chain (left-associative tree).
const liveAST = [
	{
		kind: "and",
		left: { kind: "cmd", cmd: mkCmd("git", ["status", "--short"]) },
		rhs: {
			kind: "and",
			left: { kind: "cmd", cmd: mkCmd("echo", ["'---BRANCH---'"]) },
			rhs: {
				kind: "and",
				left: {
					kind: "cmd",
					cmd: mkCmd("git", ["branch", "--show-current"]),
				},
				rhs: {
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("echo", ["'---REMOTES---'"]) },
					rhs: {
						kind: "cmd",
						cmd: mkCmd("git", ["remote", "-v"]),
					},
				},
			},
		},
	},
];

// AST for the sentinel control.
const sentinelAST = [
	{
		kind: "and",
		left: { kind: "cmd", cmd: mkCmd("git", ["status", "--short"]) },
		rhs: {
			kind: "cmd",
			cmd: mkCmd("git", ["branch", "-D", "__CLINEMM_SENTINEL__"]),
		},
	},
];

const safeAuth = {
	mode: "safe-only",
	explicitAllowRules: [], // not used by V2; only V1 consults the rule set
};

let pass = true;

console.log("=== REAL_PRODUCTION_BUNDLE QUALIFICATION ===\n");
console.log("Classification: SYNTHETIC_AST + REAL_PRODUCTION_BUNDLE");
console.log("Caveat: AST is hand-constructed (no parser helper in loop).\n");

// 1. SYNTHETIC PARSER-BOUND EXACT COMMAND
console.log(`[1] SYNTHETIC PARSER-BOUND EXACT COMMAND:\n  ${LIVE_CMD}\n`);
const liveResult = evaluateCommandRiskWithParser({
	toolInput: LIVE_CMD,
	hostAuthorization: safeAuth,
	parserResult: mkParsed(LIVE_CMD, liveAST),
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
	console.error("  FAIL: expected allow / auto-approve-eligible / risk_v2_structured_promotion");
	pass = false;
} else {
	console.log("  PASS: V2 promotion fires for the live command");
}

// 2. SYNTHETIC PARSER-BOUND MIXED-RISK CONTROL
console.log(`\n[2] SYNTHETIC PARSER-BOUND MIXED-RISK CONTROL:\n  ${SENTINEL_CMD}\n`);
const sentinelResult = evaluateCommandRiskWithParser({
	toolInput: SENTINEL_CMD,
	hostAuthorization: safeAuth,
	parserResult: mkParsed(SENTINEL_CMD, sentinelAST),
});

console.log(`  decision:    ${sentinelResult.decision}`);
console.log(`  disposition: ${sentinelResult.disposition}`);
console.log(`  source:      ${sentinelResult.source}\n`);

if (
	sentinelResult.decision !== "ask" ||
	sentinelResult.disposition === "auto-approve-eligible"
) {
	console.error("  FAIL: expected ASK + non-auto-approve-eligible");
	pass = false;
} else {
	console.log("  PASS: sentinel stays ASK (mutating leaf blocks promotion)");
}

// 3. Bundle presence: confirm the new rules are in the SDK dist.
console.log("\n[3] BUNDLE PRESENCE CHECK\n");
const distPath = path.join(sdkRoot, "dist", "index.js");

let bundlePresent = false;
let bundleSha256 = "";
try {
	const distSource = fs.readFileSync(distPath, "utf8");
	bundlePresent =
		distSource.includes("host_safe_git_remote") &&
		distSource.includes("host_safe_echo");
	bundleSha256 = createHash("sha256").update(distSource).digest("hex");
	console.log(`  bundle path:    ${distPath}`);
	console.log(`  bundle size:    ${distSource.length} bytes`);
	console.log(`  bundle sha256:  ${bundleSha256}`);
	console.log(
		`  contains host_safe_git_remote: ${distSource.includes("host_safe_git_remote")}`,
	);
	console.log(
		`  contains host_safe_echo:      ${distSource.includes("host_safe_echo")}\n`,
	);
} catch (err) {
	console.error(`  bundle read error: ${err.message}`);
}

if (!bundlePresent) {
	console.error("  FAIL: rebuilt SDK bundle is missing the new rules");
	pass = false;
} else {
	console.log("  PASS: rebuilt SDK bundle contains the new rules");
}

console.log("\n=== VERDICT ===");
if (pass) {
	console.log(
		"PASS — REAL_PRODUCTION_BUNDLE QUALIFICATION SUCCEEDED (SYNTHETIC AST)",
	);
	console.log(
		"NEXT STEP for true LIVE: dogfood the rebuilt VSIX in the user's installed VSCodium",
	);
	console.log(
		"and verify no approval card is shown for the exact live command above.",
	);
	process.exit(0);
} else {
	console.error("FAIL — REAL_PRODUCTION_BUNDLE QUALIFICATION FAILED");
	process.exit(1);
}
