// ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01-CORRECTION02 RED witness.
// Classification: REAL_PRODUCTION_SEAM.
//
// These tests document the ATTACK matrix that exposes the unsoundness
// of CORRECTION01's string-blacklist approach. Every test in this file
// MUST go RED on the CORRECTION01 repair (or any successor that uses
// string-blacklist on parser-projected argv).
//
// Until CORRECTION02 introduces parser-proven static-literal provenance,
// these tests are the contract: every shape here must ASK.

import { existsSync } from "node:fs";
import { arch as processArch, platform as processPlatform } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { commandHostAuthorization } from "./command-policy-types";
import { evaluateCommandRiskWithParser } from "./command-risk-internal";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import { MvdanShHelper } from "./parser-helper/runtime";

type HelperPlatform = "darwin-arm64" | "darwin-amd64" | "linux-amd64" | "linux-arm64" | "win32-x64" | null;

function detectHelperPlatform(): HelperPlatform {
	const p = processPlatform;
	const a = processArch;
	if (p === "darwin" && a === "arm64") return "darwin-arm64";
	if (p === "darwin" && (a === "x64" || a === "ia32")) return "darwin-amd64";
	if (p === "linux" && (a === "x64" || a === "ia32")) return "linux-amd64";
	if (p === "linux" && a === "arm64") return "linux-arm64";
	if (p === "win32" && (a === "x64" || a === "ia32")) return "win32-x64";
	return null;
}

function resolveSdkRoot(startDir: string): string {
	let dir = startDir;
	for (let i = 0; i < 12; i++) {
		const candidate = join(dir, "package.json");
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const pkg = require(candidate) as { name?: string };
			if (pkg && pkg.name === "@cline/core") return dir;
		} catch {}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return startDir;
}

const sdkRoot = resolveSdkRoot(dirname(fileURLToPath(import.meta.url)));
const HELPER_PLATFORM = detectHelperPlatform();
const HELPER_PATH = (() => {
	if (!HELPER_PLATFORM) return null;
	const ext = HELPER_PLATFORM === "win32-x64" ? ".exe" : "";
	const candidate = join(sdkRoot, "bin", "parser-helper", HELPER_PLATFORM, `cline-parser-helper${ext}`);
	return existsSync(candidate) ? candidate : null;
})();

const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

describe("V2 echo authority RED witness (CORRECTION02) -- parser-projected argv authority matrix", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
		if (!HELPER_PATH || !HELPER_PLATFORM) return;
		helper = new MvdanShHelper({
			platform: HELPER_PLATFORM,
			binaryPath: () => HELPER_PATH,
		});
	});

	// Quoted process substitution: parser projects literal text,
	// no `$`/backtick/`?` in argv -> string-blacklist ALLOWs this
	// even though shell would execute `touch` at runtime.
	it("echo '<(touch /tmp/nope)' -> ASK (quoted process substitution)", async () => {
		if (!HELPER_PATH) return;
		const src = "echo '<(touch /tmp/nope)'";
		const parsed = await helper.invoke({ command: src });
		const r = evaluateCommandRiskWithParser({
			toolInput: src,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	// Quoted process substitution with dangerous inner command
	it("echo '<(/bin/rm -rf $HOME)' -> ASK (quoted process sub, dangerous inner)", async () => {
		if (!HELPER_PATH) return;
		const src = "echo '<(/bin/rm -rf $HOME)'";
		const parsed = await helper.invoke({ command: src });
		const r = evaluateCommandRiskWithParser({
			toolInput: src,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	// Brace expansion -- even though parser preserves literal
	// characters, shell will enumerate at runtime.
	it("echo {a,b,c} -> ASK (brace expansion)", async () => {
		if (!HELPER_PATH) return;
		const src = "echo {a,b,c}";
		const parsed = await helper.invoke({ command: src });
		const r = evaluateCommandRiskWithParser({
			toolInput: src,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	// Brace sequence expansion
	it("echo {1..5} -> ASK (brace sequence)", async () => {
		if (!HELPER_PATH) return;
		const src = "echo {1..5}";
		const parsed = await helper.invoke({ command: src });
		const r = evaluateCommandRiskWithParser({
			toolInput: src,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	// Bare glob -- carries filesystem enumeration authority at runtime
	it("echo /etc/passwd* -> ASK (glob expansion authority)", async () => {
		if (!HELPER_PATH) return;
		const src = "echo /etc/passwd*";
		const parsed = await helper.invoke({ command: src });
		const r = evaluateCommandRiskWithParser({
			toolInput: src,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	// Compound: user's LIVE shape + glob injection
	it("echo '---BRANCH---' && echo * -> ASK (compound with glob leaf)", async () => {
		if (!HELPER_PATH) return;
		const src = "echo '---BRANCH---' && echo *";
		const parsed = await helper.invoke({ command: src });
		const r = evaluateCommandRiskWithParser({
			toolInput: src,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	// Compound: LIVE shape + process sub injection
	it("echo '---BRANCH---' && echo '<(touch /tmp/nope)' -> ASK (compound with quoted procsub leaf)", async () => {
		if (!HELPER_PATH) return;
		const src = "echo '---BRANCH---' && echo '<(touch /tmp/nope)'";
		const parsed = await helper.invoke({ command: src });
		const r = evaluateCommandRiskWithParser({
			toolInput: src,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	// Compound: LIVE shape + brace expansion
	it("echo '---BRANCH---' && echo '{a,b}' -> ASK (compound with brace leaf)", async () => {
		if (!HELPER_PATH) return;
		const src = "echo '---BRANCH---' && echo '{a,b}'";
		const parsed = await helper.invoke({ command: src });
		const r = evaluateCommandRiskWithParser({
			toolInput: src,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	// The user's own LIVE chain + dangerous quoted procsub trailing leaf
	it("user's 5-leaf LIVE chain + trailing '<(...)' leaf -> ASK", async () => {
		if (!HELPER_PATH) return;
		const src = "git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v && echo '<(touch /tmp/CLINEMM_SENTINEL)'";
		const parsed = await helper.invoke({ command: src });
		const r = evaluateCommandRiskWithParser({
			toolInput: src,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});
});
