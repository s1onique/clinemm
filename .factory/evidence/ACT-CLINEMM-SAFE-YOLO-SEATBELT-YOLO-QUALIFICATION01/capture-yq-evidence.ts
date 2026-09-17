#!/usr/bin/env bun
/**
 * Capture live YQ evidence: run the adversarial corpus under A and B
 * via the production CommandJobManager and record byte-equality of
 * kernel decisions. Output: yq-evidence.json in this evidence dir.
 */
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt";
process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow";

const { getSandboxBackend } = (await import(
	"/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/dist/index.js"
)) as any;

const darwinUserTempDir = "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/";
let canonicalDarwinRoot: string | undefined;
try {
	canonicalDarwinRoot = realpathSync(darwinUserTempDir);
} catch {}

const homeRoot = join(
	process.env.HOME!,
	`.cline-safe-yolo-lab-${randomBytes(4).toString("hex")}`,
);
mkdirSync(join(homeRoot, "nested"), { recursive: true });
writeFileSync(join(homeRoot, "sentinel.txt"), "HOME_SENTINEL\n", "utf8");
writeFileSync(join(homeRoot, "nested", "sentinel-2.txt"), "NESTED_SENTINEL\n", "utf8");
writeFileSync(join(homeRoot, "secret.txt"), "SYNTHETIC_SECRET\n", "utf8");

const wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-yq-ev-")));
writeFileSync(join(wsRoot, "ws-sentinel.txt"), "WS_ORIGINAL\n", "utf8");

const backend = await getSandboxBackend("seatbelt-experimental", {
	mode: "seatbelt-experimental",
});

function sha(p: string): string {
	try {
		const buf = readFileSync(p);
		return createHash("sha256").update(buf).digest("hex");
	} catch {
		return "ABSENT";
	}
}

const script = (h: string) =>
	[
		`if printf 'BAD' > ${h}/sentinel.txt 2>/dev/null; then echo HW_OK; else echo HW_DENIED; fi`,
		`if printf 'BAD' >> ${h}/sentinel.txt 2>/dev/null; then echo HAP_OK; else echo HAP_DENIED; fi`,
		`: > ${h}/sentinel.txt 2>/dev/null && echo HTR_OK || echo HTR_DENIED`,
		`if rm -f ${h}/sentinel.txt 2>/dev/null; then echo HD_OK; else echo HD_DENIED; fi`,
		`if mv ${h}/sentinel.txt ${h}/sentinel.mv 2>/dev/null; then echo HR_OK; else echo HR_DENIED; fi`,
		`if rm -rf ${h} 2>/dev/null; then echo HRD_OK; else echo HRD_DENIED; fi`,
		`/bin/sh -c "printf CHILD > ${h}/sentinel.txt 2>/dev/null && echo HCH_OK || echo HCH_DENIED"`,
		`/bin/sh -c "/bin/sh -c \\"printf GC > ${h}/sentinel.txt 2>/dev/null && echo HGC_OK || echo HGC_DENIED\\""`,
		`ln -sf ${h}/sentinel.txt /tmp/.canary-symlink 2>/dev/null`,
		`if printf 'VIA_SYM' > /tmp/.canary-symlink 2>/dev/null; then echo HS_OK; else echo HS_DENIED; fi`,
		`if chmod 000 ${h}/sentinel.txt 2>/dev/null; then echo HC_OK; else echo HC_DENIED; fi`,
		`if (cd ${h} && rm -f sentinel.txt) 2>/dev/null; then echo HCWD_OK; else echo HCWD_DENIED; fi`,
		`echo DONE`,
	].join("\n");

async function runOnce(network: "allow" | "deny", capabilityOverride?: any) {
	const cap = {
		readonlyRoots: [],
		writableRoots: [wsRoot],
		denyReadSubpaths: [],
		network,
		environment: { mode: "inherit" },
		cwd: wsRoot,
		...(capabilityOverride ? capabilityOverride : {}),
	};
	const scriptPath = join(wsRoot, `script-${randomBytes(4).toString("hex")}.sh`);
	writeFileSync(scriptPath, `#!/bin/bash\n${script(homeRoot)}\n`, { mode: 0o755 });
	const prepared = await backend.prepare({
		capability: cap,
		command: {
			executable: "/bin/bash",
			args: [scriptPath],
			cwd: wsRoot,
			env: {},
		},
	});
	const profilePath = prepared.args[1] as string;
	const profile = readFileSync(profilePath, "utf8");
	const r = await new Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}>((resolve) => {
		const child = spawn(prepared.executable, [...prepared.args], {
			cwd: prepared.cwd,
			env: prepared.env,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
		child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
		child.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
	});
	await prepared.cleanup?.();
	try {
		rmSync(scriptPath, { force: true });
	} catch {}
	try {
		rmSync("/tmp/.canary-symlink", { force: true });
	} catch {}
	return { profile, ...r };
}

console.log("=== A (override=none, network=allow) ===");
const A = await runOnce("allow");
console.log("profile network rule:", A.profile.includes("(allow network*)") ? "(allow network*)" : A.profile.includes("(deny network*)") ? "(deny network*)" : "MISSING");
console.log("stdout:", A.stdout);
console.log("canary sentinel SHA post:", sha(join(homeRoot, "sentinel.txt")));
console.log("canary nested SHA post:", sha(join(homeRoot, "nested", "sentinel-2.txt")));
console.log("canary secret SHA post:", sha(join(homeRoot, "secret.txt")));

const canaryASentinel = sha(join(homeRoot, "sentinel.txt"));
const canaryANested = sha(join(homeRoot, "nested", "sentinel-2.txt"));
const canaryASecret = sha(join(homeRoot, "secret.txt"));
const canaryHomeStillExists = existsSync(homeRoot);

// Restore canary for B run
mkdirSync(homeRoot, { recursive: true });
writeFileSync(join(homeRoot, "sentinel.txt"), "HOME_SENTINEL\n", "utf8");
writeFileSync(join(homeRoot, "nested", "sentinel-2.txt"), "NESTED_SENTINEL\n", "utf8");
writeFileSync(join(homeRoot, "secret.txt"), "SYNTHETIC_SECRET\n", "utf8");

console.log("");
console.log("=== B (YOLO worst-case: perCommandExecCap on canonical Darwin temp root) ===");
const B = await runOnce("allow", {
	createOnlyRoots: canonicalDarwinRoot ? [canonicalDarwinRoot] : [],
});
console.log("profile network rule:", B.profile.includes("(allow network*)") ? "(allow network*)" : B.profile.includes("(deny network*)") ? "(deny network*)" : "MISSING");
console.log("stdout:", B.stdout);
console.log("canary sentinel SHA post:", sha(join(homeRoot, "sentinel.txt")));
console.log("canary nested SHA post:", sha(join(homeRoot, "nested", "sentinel-2.txt")));
console.log("canary secret SHA post:", sha(join(homeRoot, "secret.txt")));

const canaryBSentinel = sha(join(homeRoot, "sentinel.txt"));
const canaryBNested = sha(join(homeRoot, "nested", "sentinel-2.txt"));
const canaryBSecret = sha(join(homeRoot, "secret.txt"));
const canaryBHomeStillExists = existsSync(homeRoot);

const evidence = {
	ACT: "ACT-CLINEMM-SAFE-YOLO-SEATBELT-YOLO-QUALIFICATION01",
	phase: "PRODUCTION SEAM LIVE EVIDENCE",
	date: new Date().toISOString(),
	A: {
		profileNetworkRule: A.profile.includes("(allow network*)") ? "(allow network*)" : A.profile.includes("(deny network*)") ? "(deny network*)" : "MISSING",
		stdout: A.stdout,
		canarySentinelSha: canaryASentinel,
		canaryNestedSha: canaryANested,
		canarySecretSha: canaryASecret,
		homeDirStillExists: canaryHomeStillExists,
	},
	B: {
		profileNetworkRule: B.profile.includes("(allow network*)") ? "(allow network*)" : B.profile.includes("(deny network*)") ? "(deny network*)" : "MISSING",
		stdout: B.stdout,
		canarySentinelSha: canaryBSentinel,
		canaryNestedSha: canaryBNested,
		canarySecretSha: canaryBSecret,
		homeDirStillExists: canaryBHomeStillExists,
	},
	invariant: {
		stdoutByteEqual: A.stdout === B.stdout,
		canarySentinelIdentical: canaryASentinel === canaryBSentinel,
		canaryNestedIdentical: canaryANested === canaryBNested,
		canarySecretIdentical: canaryASecret === canaryBSecret,
		homeDirExistsInBoth: canaryHomeStillExists && canaryBHomeStillExists,
	},
	verdict:
		A.stdout === B.stdout &&
		canaryASentinel === canaryBSentinel &&
		canaryANested === canaryBNested &&
		canaryASecret === canaryBSecret &&
		canaryHomeStillExists &&
		canaryBHomeStillExists
			? "PASS_SAFE_YOLO_MUTATION_CONFINEMENT"
			: "INVARIANT_BROKEN",
};

mkdirSync("/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-SAFE-YOLO-SEATBELT-YOLO-QUALIFICATION01", { recursive: true });
writeFileSync(
	"/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-SAFE-YOLO-SEATBELT-YOLO-QUALIFICATION01/yq-evidence.json",
	JSON.stringify(evidence, null, 2),
);
console.log("");
console.log("=== VERDICT:", evidence.verdict, "===");

try {
	rmSync(homeRoot, { recursive: true, force: true });
} catch {}
try {
	rmSync(wsRoot, { recursive: true, force: true });
} catch {}
