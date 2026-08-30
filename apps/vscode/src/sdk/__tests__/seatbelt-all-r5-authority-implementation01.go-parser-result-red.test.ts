/**
 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 *
 * C1 / parser-result-presence paired RED (post live-chronology binding).
 *
 * Live chronology (corr=CKR8BY07BH, resolved at the live callback):
 *
 *     resolvedMode=all
 *     sandboxMode=seatbelt-experimental
 *     mandatorySeatbelt=true
 *     pathAuthorityEvidenceOk=true
 *       ↓ parser helper entered
 *       ↓ parser helper success
 *       ↓ validated protocolVersion=4 / parseStatus=complete
 *       ↓ finalDecision=ask
 *       ↓ finalSource=risk_hard_floor
 *       ↓ approval card published
 *
 * The failing request entered the real SdkController callback with the
 * correct Seatbelt-required host authority. Only after the validated
 * parser result was introduced did the live `risk_hard_floor` ASK
 * appear. That makes the parser-aware risk/composition path the
 * highest-value remaining seam.
 *
 * This file holds TWO rounds of discrimination:
 *
 *   (A) Section A: synthetic production-shaped AST RED (4 tests,
 *       all GREEN). The synthetic AST is structurally-shaped to
 *       MATCH what the live mvdan/sh helper would emit for the
 *       exact live stimulus, but is NOT byte-for-byte the AST the
 *       live helper returned. Result: `NOT_REPRODUCED_WITH_SYNTHETIC_AST`.
 *
 *   (B) Section B: real-helper binary RED (this section). Drives
 *       the actual vendored mvdan/sh helper (matching the SHA bound
 *       in VENDORED_ARTIFACTS_BINDING.json) with the live stimulus
 *       so the RED consumes the parser result the live callback
 *       actually produced. Required per reviewer correction: a
 *       synthetic AST that only shares the source-digest cannot be
 *       treated as evidence that "the parser-aware path is
 *       exonerated" because the live AST may diverge from our
 *       hand-constructed approximation in operationally meaningful
 *       ways.
 *
 * Conservation invariant (both sections):
 *
 *   validated parser evidence may increase knowledge about the
 *   command, but under ALL + mandatory Seatbelt it may NOT convert
 *   ALLOW / host_mode_all_seatbelt_required into ASK / risk_hard_floor
 *   unless it has produced an actual DENY-class condition.
 *
 * --------------------------------------------------------------------------
 * EMPIRICAL RESULT — Section A (recorded 2026-08-31):
 *
 *   `NOT_REPRODUCED_WITH_SYNTHETIC_AST`.
 *
 *   Both CONTROL and RED (with the synthetic production-shaped AST)
 *   return:
 *
 *     { approved: true, kind: "allow", source: "host_mode_all_seatbelt_required",
 *       reason: "user enabled execute-all-commands mode with mandatory Seatbelt obligation",
 *       mandatorySeatbeltExecution: true }
 *
 *   PROBE-1 (direct call to `evaluateStructuredCommandRisk` on the
 *   synthetic AST):
 *
 *     parseConfidence: "complete"
 *     aggregate: "ask"
 *     downgradeToNeverAutoApprove: false
 *
 *   This is the structural proof that THIS synthetic AST does not
 *   trigger the V2 strengthen branch. But this only proves:
 *
 *     THIS synthetic AST -> does NOT trigger the live ASK
 *
 *   It does NOT prove:
 *
 *     THE LIVE parser AST -> cannot trigger the live ASK
 *
 *   because the synthetic AST and the live AST may differ in
 *   operationally meaningful ways (argv quote-stripping, shell
 *   expansion handling, wrapper detection, redirect shape
 *   projection, etc.). Section B addresses this gap.
 *
 * --------------------------------------------------------------------------
 * EMPIRICAL RESULT — Section B (recorded 2026-08-31):
 *
 *   **RED_REPRODUCED via REAL helper evidence.**
 *
 *   REAL-HELPER: same live stimulus through the vendored mvdan/sh
 *   helper binary (sha256 874741a3...) — AST fingerprint (no command
 *   text):
 *
 *     {
 *       "stmtKinds": ["and", "cmd", "pipe", "cmd", "cmd"],
 *       "commands": [
 *         { "name": "rm", "argCount": 1, "argProvenance": ["static"], "redirectOps": [], "isWrapper": false },
 *         { "name": "ls", "argCount": 1, "argProvenance": ["static"], "redirectOps": [">&"], "isWrapper": false },
 *         { "name": "head", "argCount": 1, "argProvenance": ["static"], "redirectOps": [], "isWrapper": false }
 *       ]
 *     }
 *
 *   REAL-HELPER verdict (lower composer, same as SdkController.ts:523):
 *
 *     {
 *       approved: false,
 *       kind: "ask",
 *       source: "risk_hard_floor",
 *       reason: "R5 catastrophic hard floor: never auto-approve",
 *       mandatorySeatbeltExecution: false
 *     }
 *
 *   REAL-HELPER V2 probe (direct call to evaluateStructuredCommandRisk
 *   on the LIVE AST):
 *
 *     {
 *       parseConfidence: "complete",
 *       aggregate: "never-auto-approve",
 *       promoteToAllow: false,
 *       downgradeToNeverAutoApprove: true,
 *       perStatementSources: ["aggregated-and"],
 *       perStatementRisks: ["never-auto-approve"],
 *       reasons: ["structured-max-risk:never-auto-approve:aggregated-r5-child"]
 *     }
 *
 *   **Diagnosis** (post-mortem):
 *
 *     V2's `classifyCmd` calls `renderArgv(cmd)` (structured-command-risk.ts:1595)
 *     to reconstruct the literal rendered string for the hard-floor
 *     matcher. For the real AST, the `rm` StructuredCmd has
 *     `args = ["<real /Volumes/.../victim.txt path>"]`, so
 *     `rendered = "rm /Volumes/.../victim.txt"`. This string
 *     positively matches the R5_HARD_FLOOR_RULES entry at
 *     command-risk.ts:229-233:
 *
 *       { family: "root-destruction",
 *         hard: true,
 *         pattern: /rm\s+(?:[-\w]+\s+)*\/Volumes\//u,
 *         description: "destructive removal under /Volumes" }
 *
 *     The R5 floor emits `risk: "never-auto-approve"` for this AST
 *     branch; the aggregate is then "never-auto-approve"; the V2
 *     strengthen path at command-risk.ts:716-720 converts the
 *     otherwise-ALLOW into ASK with `finalSource = "risk_hard_floor"`
 *     (because the canonical lattice is ALLOW under all + seatbelt,
 *     and the structured classifier's `never-auto-approve` aggregate
 *     trips the `if (finalDecision === "allow")` branch).
 *
 *   **Conservation invariant is BROKEN**: under
 *   `mode: "all" + mandatory Seatbelt`, the parser-aware path IS
 *   converting ALLOW into ASK/risk_hard_floor for an in-workspace
 *   deletion. The R5 `/Volumes/` substring fires regardless of whether
 *   the target is INSIDE or OUTSIDE the workspace root, contradicting
 *   the documented "kernel is the gate; user opted in" contract for
 *   Seatbelt-all mode.
 *
 *   **First differing branch**: `classifyCmd` line 1615
 *   (`findCommandRiskHardFloor(rendered)`). The R5 floor's `/Volumes/`
 *   pattern was added (command-risk.ts:227-233) without a Seatbelt
 *   gating check (the same `mandatorySeatbelt` flag the canonical
 *   lattice already consults). Without a Seatbelt-aware skip here, the
 *   R5 floor downgrades the otherwise-ALLOW verdict.
 *
 *   **Repair surface** (cycle 1 reviewer hypothesis): one bounded
 *   production change to `findCommandRiskHardFloor` (or to
 *   `classifyCmd` line 1615) that skips the V2 R5 floor when the
 *   canonical lattice is ALLOW under all + mandatorySeatbelt.
 *
 *   **Repair outcome** (cycle 2 ablation-verified 2026-08-31):
 *   the bounded repair lives at the authority-aware composition
 *   seam in `command-risk.ts` — NOT inside the R5 classifier.
 *   Two gates were necessary, both ablation-verified:
 *
 *     1. V2 R5 strengthen branch (line 709+): added the same
 *        `seatbeltObligationHonored` guard V1's R5 floor uses.
 *     2. Opaque-composition guard (line 520+): added the same
 *        guard. Cycle 2 ablation (V2-only, opaque reverted) re-broke
 *        the live specimen with `risk_opaque_composition` upstream
 *        (then re-skinned to `risk_hard_floor` by the downstream at
 *        `sdk-tool-policies.ts:988`), proving the second gate is
 *        necessary.
 *
 *   Both gates use the SAME predicate:
 *
 *     policy.decision.source === "host_mode_all_seatbelt_required"
 *     && input.hostAuthorization?.mandatorySeatbelt === true
 *
 *   The R5 classifier (`findCommandRiskHardFloor`, `classifyCmd`)
 *   remains context-independent: it still answers "how dangerous is
 *   this command intrinsically" with `risk: "never-auto-approve"`
 *   for `rm /Volumes/...`. The composition seam is where the
 *   authority/containment policy lives.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { arch as processArch, platform as processPlatform } from "node:process"
import { fileURLToPath } from "node:url"
import type { CommandHostAuthorization } from "@cline/core"
import { buildPathAuthorityEvidence, commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
import {
	evaluateStructuredCommandRisk,
	joinRunCommandsForParse,
	type ParsedShell,
	type StructuredCmd,
	type StructuredStmt,
} from "@cline/core/internal/command-risk-internal"
import { MvdanShHelper } from "@cline/core/internal/parser-helper-runtime"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { applySeatbeltAuthorityEnvelope, evaluateCommandToolApprovalWithPlan } from "../sdk-tool-policies"
import { resolveSessionHostAuthorization } from "../session-auto-approval"

/* ---------------------------------------------------------------------- *
 * Helper binary resolution (Section B).
 *
 * The vendored helper at `apps/vscode/bin/parser-helper/<plat>/cline-parser-helper`
 * must match the SHA bound in
 * `sdk/packages/core/parser-helper-src/.factory/oracle/VENDORED_ARTIFACTS_BINDING.json`
 * — this is the load-bearing provenance invariant that lets us claim
 * "this RED consumed the same bytes the production bundle will ship".
 *
 * Resolution strategy mirrors `structured-command-risk.real-binary.test.ts`:
 * walk up from this file to the SDK package root, then locate the binary
 * for the current host platform. Skip the entire Section B describe
 * block on unsupported platforms or when the vendored helper is absent.
 * ---------------------------------------------------------------------- */

type HelperPlatform = "darwin-arm64" | "darwin-amd64" | "linux-amd64" | "linux-arm64" | "win32-x64" | null

function detectHelperPlatform(): HelperPlatform {
	const p = processPlatform
	const a = processArch
	if (p === "darwin" && a === "arm64") return "darwin-arm64"
	if (p === "darwin" && (a === "x64" || a === "ia32")) return "darwin-amd64"
	if (p === "linux" && (a === "x64" || a === "ia32")) return "linux-amd64"
	if (p === "linux" && a === "arm64") return "linux-arm64"
	if (p === "win32" && (a === "x64" || a === "ia32")) return "win32-x64"
	return null
}

function resolveSdkRoot(startDir: string): string {
	let dir = startDir
	for (let i = 0; i < 16; i++) {
		const candidate = join(dir, "package.json")
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const pkg = require(candidate) as { name?: string }
			if (pkg && pkg.name === "@cline/core") {
				return dir
			}
		} catch {
			// ignore
		}
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return startDir
}

const sdkRoot = resolveSdkRoot(dirname(fileURLToPath(import.meta.url)))
const HELPER_PLATFORM = detectHelperPlatform()
// Search the helper binary at several known candidate roots in
// priority order. The first one that exists wins. We can't rely on
// the SDK package-root walker in apps/vscode because the SDK is a
// workspace symlink (`@cline/packages`) and the walk stops before
// reaching `sdk/packages/core`.
//   1. <repo>/sdk/packages/core/bin/parser-helper/<plat>/...  (SDK)
//   2. <repo>/apps/vscode/bin/parser-helper/<plat>/...       (consumer mirror)
const HELPER_PATH = (() => {
	if (!HELPER_PLATFORM) return null
	const ext = HELPER_PLATFORM === "win32-x64" ? ".exe" : ""
	const here = dirname(fileURLToPath(import.meta.url))
	// The test file is at apps/vscode/src/sdk/__tests__/<name>.test.ts
	// so we walk up 5 levels to reach the repo root:
	//   here            = apps/vscode/src/sdk/__tests__
	//   here/../        = apps/vscode/src/sdk
	//   here/../../     = apps/vscode/src
	//   here/../../../  = apps/vscode
	//   here/../../../../= apps
	//   here/../../../../../= <repoRoot>
	const repoRoot = join(here, "..", "..", "..", "..", "..")
	const candidates = [
		join(repoRoot, "sdk", "packages", "core", "bin", "parser-helper", HELPER_PLATFORM, `cline-parser-helper${ext}`),
		join(repoRoot, "apps", "vscode", "bin", "parser-helper", HELPER_PLATFORM, `cline-parser-helper${ext}`),
		join(sdkRoot, "bin", "parser-helper", HELPER_PLATFORM, `cline-parser-helper${ext}`),
	]
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate
	}
	return null
})()

const SUPPORTED_HELPER_PLATFORMS: ReadonlySet<NonNullable<HelperPlatform>> = new Set([
	"darwin-arm64",
	"darwin-amd64",
	"linux-amd64",
	"linux-arm64",
	"win32-x64",
])
const isSupportedHelperPlatform = HELPER_PLATFORM !== null && SUPPORTED_HELPER_PLATFORMS.has(HELPER_PLATFORM)
const describeWithHelper = (isSupportedHelperPlatform ? describe : describe.skip) as typeof describe

/* ---------------------------------------------------------------------- *
 * P1 evidence binding (reviewer directive 2026-08-31).
 *
 * The claim "REAL_HELPER_BYTES = vendored binding" is load-bearing
 * for Section B. To prevent drift between this test and the actual
 * production bytes, we resolve HELPER_PATH and then assert its
 * SHA-256 matches the entry in
 * `sdk/packages/core/parser-helper-src/.factory/oracle/VENDORED_ARTIFACTS_BINDING.json`
 * for the current platform. If the binding file does not contain
 * the current platform's entry, the test fails closed (with a
 * pointer to the binding file) rather than silently using an
 * out-of-band helper binary.
 * ---------------------------------------------------------------------- */

const VENDORED_BINDING_PATH = (() => {
	const here = dirname(fileURLToPath(import.meta.url))
	const repoRoot = join(here, "..", "..", "..", "..", "..")
	return join(repoRoot, "sdk", "packages", "core", "parser-helper-src", ".factory", "oracle", "VENDORED_ARTIFACTS_BINDING.json")
})()

type VendoredBinding = {
	artifacts: Array<{
		bytes: number
		path: string
		sha256: string
		target: HelperPlatform
	}>
}
function loadVendoredBinding(): VendoredBinding | null {
	if (!existsSync(VENDORED_BINDING_PATH)) return null
	try {
		const raw = readFileSync(VENDORED_BINDING_PATH, "utf8")
		return JSON.parse(raw) as VendoredBinding
	} catch {
		return null
	}
}

const VENDORED_BINDING = loadVendoredBinding()
function expectedHelperSha256(): string | null {
	if (!HELPER_PLATFORM || !VENDORED_BINDING) return null
	const entry = VENDORED_BINDING.artifacts.find((a) => a.target === HELPER_PLATFORM)
	return entry?.sha256 ?? null
}

const HELPER_SHA256 = HELPER_PATH ? createHash("sha256").update(readFileSync(HELPER_PATH)).digest("hex") : null
const HELPER_SHA256_MATCHES_BINDING = (() => {
	const expected = expectedHelperSha256()
	if (expected === null || HELPER_SHA256 === null) return false
	return expected === HELPER_SHA256
})()

// eslint-disable-next-line no-console
if (!HELPER_PATH && isSupportedHelperPlatform) {
	// P2 reviewer correction 2026-08-31: the comment previously
	// claimed "skipped via describe.skip", but the wrapper only
	// skips on UNSUPPORTED platforms. On a SUPPORTED platform with
	// the vendored helper missing, `beforeAll` fails closed with an
	// explicit error (see below). This is stricter than skip-on-
	// unsupported — a missing binary on a supported platform is a
	// shipping-artifact defect that MUST fail the suite loudly so
	// CI catches a regression in the vendored binding.
	console.error(
		`[go-parser-result-red.real-helper] supported platform ${HELPER_PLATFORM} but vendored helper binary is missing. Section B will FAIL CLOSED in beforeAll (this is a shipping-artifact defect; do NOT let CI silently skip).`,
	)
} else {
	// eslint-disable-next-line no-console
	console.log(
		`[go-parser-result-red.real-helper] helper bound: platform=${HELPER_PLATFORM} path=${HELPER_PATH ?? "(none)"} sha256=${HELPER_SHA256 ?? "(none)"} matchesBinding=${HELPER_SHA256_MATCHES_BINDING}`,
	)
	if (isSupportedHelperPlatform && HELPER_PATH && !HELPER_SHA256_MATCHES_BINDING) {
		console.error(
			`[go-parser-result-red.real-helper] WARNING: helper SHA does not match VENDORED_ARTIFACTS_BINDING.json for platform ${HELPER_PLATFORM}. Section B tests will fail in beforeAll until the binary is replaced or the binding is refreshed.`,
		)
	}
}

/**
 * Hand-construct a structurally-complete ParsedShell for the LIVE
 * command shape. Mirrors what the vendored mvdan/sh helper would emit
 * for the exact same input (a bash `&&`-chained two-statement program
 * with an inner pipe on the second statement). Source-binding is
 * enforced via `joinRunCommandsForParse` + sha256 so the
 * CORRECTION01 gate stays green.
 *
 * IMPORTANT: this is a SYNTHETIC PRODUCTION-SHAPED AST. It is
 * structurally-shaped to match what the helper is expected to emit,
 * but is NOT the AST the live helper actually produced for
 * corr=CKR8BY07BH. Per reviewer correction, a matching source-digest
 * proves which command was parsed; it does NOT prove this manually
 * constructed AST is what the parser produced. The real-helper
 * discriminator lives in Section B below.
 *
 * Why this is still useful as a first-round test:
 *  - We want a deterministic one-shot discriminator, not a
 *    flaky external binary that requires `apps/vscode/bin/parser-helper/` to
 *    be present.
 *  - The `MvdanShHelper.invoke` runtime would produce a similar shape
 *    for this input (proven by existing tests in
 *    structured-command-risk.pipeline-leaf-composition.test.ts and
 *    structured-command-risk.redirect-stderr-devnull.test.ts).
 *  - `protocolVersion=4`, `parseStatus=complete`, `sourceDigest
 *    present` are EXACTLY the four fields the live capture recorded
 *    for corr=CKR8BY07BH (`parserResult.validate.v2` probe).
 */
function mkLiveParserResult(toolInput: string): ParsedShell {
	const { joined } = joinRunCommandsForParse(toolInput)
	const sourceSha256 = createHash("sha256").update(joined, "utf8").digest("hex")

	// Statement 1: rm <victim>. The live helper would emit the literal
	// victim token as the first argument; we mirror so the structured
	// classifier sees the exact same operand identity. The
	// argProvenance "static" matches what mvdan/sh reports for an
	// unquoted literal word in a normal bash command.
	const rmCmd: StructuredCmd = {
		name: "rm",
		args: ["<VICTIM>"],
		argProvenance: ["static"],
		assigns: [],
		redirects: [],
		isWrapper: false,
		wrapperOf: "",
		inner: "",
	}

	// Statement 2 (rhs of `&&`): ls <victim> 2>&1 | head -2
	const lsCmd: StructuredCmd = {
		name: "ls",
		args: ["<VICTIM>"],
		argProvenance: ["static"],
		assigns: [],
		redirects: [
			// `2>&1` -> fd dup; helper emits op=2>&1 with fd=2 and an
			// empty path. We mirror so the redirect shape is
			// recognized but the dup-target operand is not bound to
			// a filesystem path.
			{ op: "2>&1", path: "", fd: 2, pathProvenance: "static" },
		],
		isWrapper: false,
		wrapperOf: "",
		inner: "",
	}
	const headCmd: StructuredCmd = {
		name: "head",
		args: ["-2"],
		argProvenance: ["static"],
		assigns: [],
		redirects: [],
		isWrapper: false,
		wrapperOf: "",
		inner: "",
	}

	const stmt1: StructuredStmt = { kind: "cmd", cmd: rmCmd }
	const stmt2Inner: StructuredStmt = {
		kind: "pipe",
		left: { kind: "cmd", cmd: lsCmd },
		rhs: { kind: "cmd", cmd: headCmd },
	}
	const andStmt: StructuredStmt = { kind: "and", left: stmt1, rhs: stmt2Inner }

	return {
		protocolVersion: 4,
		dialect: "bash",
		sourceSha256,
		parseStatus: "complete",
		hasCommandSubstitution: false,
		program: { stmts: [andStmt] },
		errors: [],
	}
}

/* ---------------------------------------------------------------------- *
 * SECTION A — SYNTHETIC PRODUCTION-SHAPED AST [HISTORICAL]
 *
 * Section A holds the original paired RED with a hand-constructed
 * `ParsedShell` that mirrors the expected helper output shape but is
 * NOT the AST the live helper actually produced for corr=CKR8BY07BH.
 *
 * Reviewer disposition (2026-08-31): NOT_REPRODUCED_WITH_SYNTHETIC_AST.
 * The 4/4 GREEN only proves "this synthetic AST does not trigger the
 * live ASK"; it does NOT prove "the parser-aware path is exonerated".
 * Section B (below) supersedes Section A as the load-bearing
 * discriminator for the bounded repair.
 *
 * Preserved here as historical evidence of the chronological
 * progression: synthetic-AST first-round discriminator -> real-helper
 * second-round discriminator -> bounded repair.
 * ---------------------------------------------------------------------- */

describe("LIVE_AUTHORIZATION + PARSER_RESULT presence paired RED", () => {
	let workspaceRoot: string
	let victim: string
	let tmpDir: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		// Ensure .factory/tmp exists inside the workspace root so the
		// victim sits INSIDE the canonical root (mirrors the exact-
		// shape GREEN fixture).
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		tmpDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/r5-live-paired-red-"))
		victim = join(tmpDir, "victim.txt")
		writeFileSync(victim, "fixture for the parser-result paired RED\n", "utf8")
	})

	afterAll(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore: workspace may already be cleaned
		}
	})

	const liveInput = () => ({
		command: `rm ${victim} && ls ${victim} 2>&1 | head -2`,
		requires_approval: false,
	})

	// Build the EXACT same live authorization shape as the producer/
	// composer chain RED: persisted safe-only + realpath evidence ->
	// override "all" -> envelope seatbelt-experimental.
	function buildLiveStampedAuth(): CommandHostAuthorization {
		const input = liveInput()
		const evidence = buildPathAuthorityEvidence({
			workspaceRoots: [workspaceRoot],
			cwd: workspaceRoot,
			command: input,
		})
		expect(evidence.ok).toBe(true)
		if (!evidence.ok) {
			throw new Error(`evidence builder failed: ${evidence.reason}`)
		}

		const persistedAuth: CommandHostAuthorization = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [workspaceRoot],
			cwd: workspaceRoot,
			pathAuthorityEvidence: evidence.evidence,
		})

		const projectedAuth = resolveSessionHostAuthorization(persistedAuth, "all")
		expect(projectedAuth).toBeDefined()
		expect(projectedAuth?.mode).toBe("all")

		const stampedAuth = applySeatbeltAuthorityEnvelope(projectedAuth!, "seatbelt-experimental")
		expect(stampedAuth.mode).toBe("all")
		expect(stampedAuth.mandatorySeatbelt).toBe(true)
		return stampedAuth
	}

	it("CONTROL: same live input + same stamped auth + parserResult=undefined => ALLOW / host_mode_all_seatbelt_required / mandatorySeatbeltExecution=true", () => {
		const stampedAuth = buildLiveStampedAuth()
		const input = liveInput()

		const result = evaluateCommandToolApprovalWithPlan(input, stampedAuth, undefined)

		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})

	it("RED: same live input + same stamped auth + validated parserResult => ALLOW (CONSERVATION). SUSPECTED CURRENT: ASK / risk_hard_floor.", () => {
		const stampedAuth = buildLiveStampedAuth()
		const input = liveInput()

		const parserResult = mkLiveParserResult(input.command)
		// Sanity-check the four live-captured summary fields are present.
		expect(parserResult.protocolVersion).toBe(4)
		expect(parserResult.parseStatus).toBe("complete")
		expect(typeof parserResult.sourceSha256).toBe("string")
		expect(parserResult.sourceSha256.length).toBe(64)
		expect(parserResult.program).not.toBeNull()

		const result = evaluateCommandToolApprovalWithPlan(input, stampedAuth, {
			// The lower composer (the same one SdkController.ts:523
			// calls) threads this through `evaluateCommandRiskWithParser`
			// (the V2-aware risk composer). The cast is structural:
			// `ParsedShell` IS the trusted-internal V2 evidence
			// shape; the public type-name separation is just to keep
			// the host source free of the V2 type identifier.
			parserResult: parserResult as never,
		})

		// Diagnostic dump so the post-mortem sees the actual verdict
		// emitted with parserResult present (regardless of pass/fail).
		// eslint-disable-next-line no-console
		console.log(
			"[paired-red] parserResult verdict:",
			JSON.stringify({
				approved: result.approved,
				kind: result.decision.kind,
				source: result.decision.source,
				reason: result.decision.reason,
				mandatorySeatbeltExecution: result.mandatorySeatbeltExecution,
			}),
		)

		// CONSERVATION INVARIANT — see header.
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
		// ↑ If this fails with `decision.kind === "ask"` and
		// `decision.source === "risk_hard_floor"`, the defect is
		// REPRODUCED and the parser-aware risk/composition path is
		// NECESSARY for the live ASK downgrade.
	})
})

// --------------------------------------------------------------------------
// INTERNAL PROBE: direct call to evaluateStructuredCommandRisk on the live
// stimulus. Per the stop rule: "parser-result presence alone is
// insufficient -> add ONE final internal probe around the R5 classifier
// inputs/outputs". This probe reads the structured-classifier verdict
// without going through the lower composer, so we see EXACTLY what V2
// emits for this exact AST.
//
// Positive control: also run a stimulus that the V2 classifier is
// KNOWN to escalate (sensitive-write redirect into ~/.ssh), proving
// the probe has reach and the gate works in the other direction.
// --------------------------------------------------------------------------

function mkSensitiveWriteParserResult(toolInput: string): ParsedShell {
	const { joined } = joinRunCommandsForParse(toolInput)
	const sourceSha256 = createHash("sha256").update(joined, "utf8").digest("hex")

	const pwdCmd: StructuredCmd = {
		name: "pwd",
		args: [],
		argProvenance: [],
		assigns: [],
		redirects: [
			// write redirect to ~/.ssh/authorized_keys — sensitive
			// write target. The V2 classifier (structured-command-risk.ts
			// classifyRedirect -> SENSITIVE_WRITE_TARGETS) emits
			// `redirect-sensitive-write-ssh` -> `never-auto-approve`.
			{ op: ">", path: "~/.ssh/authorized_keys", fd: null, pathProvenance: "static" },
		],
		isWrapper: false,
		wrapperOf: "",
		inner: "",
	}

	return {
		protocolVersion: 4,
		dialect: "bash",
		sourceSha256,
		parseStatus: "complete",
		hasCommandSubstitution: false,
		program: { stmts: [{ kind: "cmd", cmd: pwdCmd }] },
		errors: [],
	}
}

describe("LIVE_AUTHORIZATION + PARSER_RESULT -- V2 internal probe (post HALT_RED_NOT_REPRODUCED)", () => {
	let workspaceRoot: string
	let victim: string
	let tmpDir: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		tmpDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/r5-live-v2-probe-"))
		victim = join(tmpDir, "victim.txt")
		writeFileSync(victim, "fixture for the v2-probe\n", "utf8")
	})

	afterAll(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	it("PROBE-1: V2 structured classifier on the LIVE stimulus => downgradeToNeverAutoApprove=false", () => {
		const liveCmd = `rm ${victim} && ls ${victim} 2>&1 | head -2`
		const parserResult = mkLiveParserResult(liveCmd)

		const v2 = evaluateStructuredCommandRisk({
			toolInput: liveCmd,
			parserResult,
		})

		// eslint-disable-next-line no-console
		console.log(
			"[v2-probe] live stimulus analysis:",
			JSON.stringify(
				{
					parseConfidence: v2.parseConfidence,
					aggregate: v2.aggregate,
					promoteToAllow: v2.promoteToAllow,
					downgradeToNeverAutoApprove: v2.downgradeToNeverAutoApprove,
					perStatementSources: v2.perStatement.map((s) => s.source),
					perStatementRisks: v2.perStatement.map((s) => s.risk),
					reasons: v2.reasons,
				},
				null,
				2,
			),
		)

		// Frozen empirical observation: the live stimulus's AST
		// does NOT trigger `downgradeToNeverAutoApprove`. This is
		// the structural proof that the parser-aware
		// risk/composition path is NOT the discriminator for the
		// live ASK.
		expect(v2.parseConfidence).toBe("complete")
		expect(v2.downgradeToNeverAutoApprove).toBe(false)
	})

	it("PROBE-2 (positive control): V2 structured classifier on sensitive-write redirect => downgradeToNeverAutoApprove=true", () => {
		const liveCmd = `pwd > ~/.ssh/authorized_keys`
		const parserResult = mkSensitiveWriteParserResult(liveCmd)

		const v2 = evaluateStructuredCommandRisk({
			toolInput: liveCmd,
			parserResult,
		})

		// eslint-disable-next-line no-console
		console.log(
			"[v2-probe] sensitive-write analysis:",
			JSON.stringify(
				{
					parseConfidence: v2.parseConfidence,
					aggregate: v2.aggregate,
					downgradeToNeverAutoApprove: v2.downgradeToNeverAutoApprove,
					perStatementSources: v2.perStatement.map((s) => s.source),
					perStatementRisks: v2.perStatement.map((s) => s.risk),
					reasons: v2.reasons,
				},
				null,
				2,
			),
		)

		// Positive control: proves the probe has reach and the
		// strengthen gate DOES fire for a structurally-catastrophic
		// AST. If THIS test failed, the probe would be suspect.
		expect(v2.parseConfidence).toBe("complete")
		expect(v2.downgradeToNeverAutoApprove).toBe(true)
		expect(v2.aggregate).toBe("never-auto-approve")
	})
})

/* ---------------------------------------------------------------------- *
 * Diagnostic structural fingerprint helper (used by Section B tests).
 * Walks the parsed program AST and emits an operator-readable summary
 * WITHOUT dumping command text. This is the reviewer-requested
 * diagnostic: enough structure to distinguish the live AST from the
 * synthetic fixture, without redaction-sensitive payload.
 * ---------------------------------------------------------------------- */

type ParsedShellNonNull = NonNullable<Awaited<ReturnType<MvdanShHelper["invoke"]>>>
function structuralFingerprint(parsed: ParsedShellNonNull | null): Record<string, unknown> {
	if (parsed === null) return { invoke: "null" }
	type Walkable = { kind: string; cmd?: unknown; left?: unknown; rhs?: unknown; inner?: unknown }
	const stmtKinds: string[] = []
	const commands: Array<Record<string, unknown>> = []
	function walk(stmt: Walkable): void {
		if (stmt.kind === "cmd") {
			const cmd = stmt.cmd as {
				name: string
				args: ReadonlyArray<string>
				argProvenance?: ReadonlyArray<string>
				redirects?: ReadonlyArray<{ op: string }>
				isWrapper?: boolean
				wrapperOf?: string
			}
			stmtKinds.push("cmd")
			commands.push({
				name: cmd.name,
				argCount: cmd.args.length,
				argProvenance: cmd.argProvenance ?? [],
				redirectOps: (cmd.redirects ?? []).map((r) => r.op),
				isWrapper: cmd.isWrapper === true,
				wrapperOf: cmd.wrapperOf ?? "",
			})
		} else if (stmt.kind === "and" || stmt.kind === "or" || stmt.kind === "pipe") {
			stmtKinds.push(stmt.kind)
			walk(stmt.left as Walkable)
			walk(stmt.rhs as Walkable)
		} else if (stmt.kind === "subshell") {
			stmtKinds.push("subshell")
			walk(stmt.inner as Walkable)
		} else if (stmt.kind === "opaque") {
			stmtKinds.push("opaque")
		}
	}
	if (parsed.program) {
		for (const stmt of parsed.program.stmts) {
			walk(stmt as Walkable)
		}
	}
	return {
		invoke: "success",
		protocolVersion: parsed.protocolVersion,
		dialect: parsed.dialect,
		parseStatus: parsed.parseStatus,
		hasCommandSubstitution: parsed.hasCommandSubstitution,
		sourceSha256Prefix: parsed.sourceSha256.slice(0, 16),
		stmtKinds,
		commands,
	}
}

/* ---------------------------------------------------------------------- *
 * SECTION B — REAL-HELPER PARSER RESULT RED [LOAD-BEARING]
 *
 * Drives the actual vendored mvdan/sh helper binary with the LIVE
 * stimulus and feeds the real `ParsedShell` into the lower composer
 * (the same one `SdkController.ts:523` calls). This is the
 * reviewer-required discriminator: a synthetic AST that only shares
 * a source-digest is not equivalent evidence for "the parser-aware
 * path is exonerated". The real helper may emit operationally
 * different argv (quote-stripping, expansion handling, wrapper
 * detection, redirect projection, etc.) that changes which branch
 * the structured classifier takes.
 *
 * P1 evidence binding: HELPER_PATH is resolved and its SHA-256
 * MUST equal the entry in VENDORED_ARTIFACTS_BINDING.json for the
 * current platform. `beforeAll` fails closed on mismatch. This
 * ensures Section B's "REAL_HELPER_BYTES = vendored binding"
 * claim is mechanically asserted (not merely narrated).
 *
 * Stop rules:
 *
 *   real helper -> ASK / risk_hard_floor
 *   no parser   -> ALLOW
 *     → RED_REPRODUCED (genuine, real-evidence)
 *     → parser path causally necessary
 *
 *   real helper -> ALLOW / host_mode_all_seatbelt_required
 *   no parser   -> ALLOW
 *     → HALT_RED_NOT_REPRODUCED (genuine, real-evidence)
 *     → parser-aware path is exonerated by REAL evidence
 *     → close out the parser hypothesis
 *
 * On unsupported platforms or when the vendored helper is missing
 * on a supported platform, the `describeWithHelper` wrapper skips
 * the entire block.
 * ---------------------------------------------------------------------- */

describeWithHelper("LIVE_AUTHORIZATION + REAL-HELPER parserResult paired RED", () => {
	let workspaceRoot: string
	let victim: string
	let tmpDir: string
	let helper: MvdanShHelper

	beforeAll(() => {
		if (!HELPER_PATH) {
			throw new Error(
				`Vendored parser-helper binary missing for supported platform ${HELPER_PLATFORM}; cannot run real-helper RED.`,
			)
		}
		// P1 evidence binding (reviewer directive 2026-08-31).
		// The "REAL_HELPER_BYTES = vendored binding" claim is
		// load-bearing for Section B. Fail closed if the resolved
		// helper SHA does not match the bound entry in
		// VENDORED_ARTIFACTS_BINDING.json for this platform.
		if (!HELPER_SHA256_MATCHES_BINDING) {
			const expected = expectedHelperSha256()
			throw new Error(
				`Helper SHA mismatch for platform ${HELPER_PLATFORM}:\n` +
					`  resolved: ${HELPER_SHA256}\n` +
					`  expected: ${expected}\n` +
					`  path:     ${HELPER_PATH}\n` +
					`  binding:  ${VENDORED_BINDING_PATH}\n` +
					`Section B cannot run with out-of-band helper bytes; refresh the binding or replace the binary.`,
			)
		}
		helper = new MvdanShHelper({
			platform: HELPER_PLATFORM as NonNullable<HelperPlatform>,
			binaryPath: () => HELPER_PATH as string,
		})
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		tmpDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/r5-live-real-helper-"))
		victim = join(tmpDir, "victim.txt")
		writeFileSync(victim, "fixture for the real-helper RED\n", "utf8")
	})

	afterAll(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	const liveInput = () => ({
		command: `rm ${victim} && ls ${victim} 2>&1 | head -2`,
		requires_approval: false,
	})

	function buildLiveStampedAuth(): CommandHostAuthorization {
		const input = liveInput()
		const evidence = buildPathAuthorityEvidence({
			workspaceRoots: [workspaceRoot],
			cwd: workspaceRoot,
			command: input,
		})
		expect(evidence.ok).toBe(true)
		if (!evidence.ok) {
			throw new Error(`evidence builder failed: ${evidence.reason}`)
		}
		const persistedAuth: CommandHostAuthorization = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [workspaceRoot],
			cwd: workspaceRoot,
			pathAuthorityEvidence: evidence.evidence,
		})
		const projectedAuth = resolveSessionHostAuthorization(persistedAuth, "all")
		expect(projectedAuth).toBeDefined()
		expect(projectedAuth?.mode).toBe("all")
		const stampedAuth = applySeatbeltAuthorityEnvelope(projectedAuth!, "seatbelt-experimental")
		expect(stampedAuth.mode).toBe("all")
		expect(stampedAuth.mandatorySeatbelt).toBe(true)
		return stampedAuth
	}

	it("REAL-HELPER: live stimulus through MvdanShHelper.invoke => parsed == non-null with complete AST", async () => {
		const input = liveInput()
		const parsed = await helper.invoke(input)

		// eslint-disable-next-line no-console
		console.log("[real-helper-red] AST fingerprint:", JSON.stringify(structuralFingerprint(parsed), null, 2))

		expect(parsed).not.toBeNull()
		if (parsed === null) {
			throw new Error("helper returned null on live stimulus; cannot proceed")
		}
		expect(parsed.parseStatus).toBe("complete")
		expect(parsed.protocolVersion).toBe(4)
		const { joinRunCommandsForParse } = await import("@cline/core/internal/command-risk-internal")
		const { joined } = joinRunCommandsForParse(input)
		const expectedDigest = createHash("sha256").update(joined, "utf8").digest("hex")
		expect(parsed.sourceSha256).toBe(expectedDigest)
	})

	it("REAL-HELPER RED: same live input + same stamped auth + REAL parserResult => ALLOW (CONSERVATION). SUSPECTED CURRENT: ASK / risk_hard_floor.", async () => {
		const stampedAuth = buildLiveStampedAuth()
		const input = liveInput()

		const parsed = await helper.invoke(input)
		expect(parsed).not.toBeNull()
		if (parsed === null) {
			throw new Error("helper returned null on live stimulus; cannot proceed")
		}

		const result = evaluateCommandToolApprovalWithPlan(input, stampedAuth, {
			parserResult: parsed as never,
		})

		// Diagnostic: call evaluateCommandRiskWithParser directly to
		// see what the V2 strengthen branch emits independently of
		// the downstream composition.
		const { evaluateCommandRiskWithParser } = await import("@cline/core/internal/command-risk-internal")
		const riskDirect = evaluateCommandRiskWithParser({
			toolInput: input,
			hostAuthorization: stampedAuth,
			parserResult: parsed,
		})
		// eslint-disable-next-line no-console
		console.log(
			"[real-helper-red] risk-direct:",
			JSON.stringify({
				decision: riskDirect.decision,
				disposition: riskDirect.disposition,
				source: riskDirect.source,
				reasons: riskDirect.reasons,
			}),
		)

		// eslint-disable-next-line no-console
		console.log(
			"[real-helper-red] verdict:",
			JSON.stringify({
				approved: result.approved,
				kind: result.decision.kind,
				source: result.decision.source,
				reason: result.decision.reason,
				mandatorySeatbeltExecution: result.mandatorySeatbeltExecution,
			}),
		)

		// CONSERVATION INVARIANT.
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
		// ↑ If this fails with `decision.kind === "ask"` and
		// `decision.source === "risk_hard_floor"`, the parser-aware
		// path is REPRODUCED by REAL evidence.
	})

	it("REAL-HELPER PROBE: V2 structured classifier on the LIVE parser AST => downgradeToNeverAutoApprove=?", async () => {
		const input = liveInput()
		const parsed = await helper.invoke(input)
		expect(parsed).not.toBeNull()
		if (parsed === null) {
			throw new Error("helper returned null on live stimulus; cannot proceed")
		}

		const v2 = evaluateStructuredCommandRisk({
			toolInput: input,
			parserResult: parsed,
		})

		// eslint-disable-next-line no-console
		console.log(
			"[real-helper-red] V2 analysis on live AST:",
			JSON.stringify(
				{
					parseConfidence: v2.parseConfidence,
					aggregate: v2.aggregate,
					promoteToAllow: v2.promoteToAllow,
					downgradeToNeverAutoApprove: v2.downgradeToNeverAutoApprove,
					perStatementSources: v2.perStatement.map((s) => s.source),
					perStatementRisks: v2.perStatement.map((s) => s.risk),
					reasons: v2.reasons,
				},
				null,
				2,
			),
		)

		// No expected-verdict assertion here; the test's job is to
		// surface the value. The stop rules in the file header
		// determine the disposition.
		expect(v2.parseConfidence).toBe("complete")
	})

	/* ---------------------------------------------------------------------- *
	 * FOCUSED CONSERVATION WITNESS — SECOND CAUSAL GATE
	 *
	 * Reviewer ablation (cycle 2, 2026-08-31) confirmed that the
	 * opaque-composition guard IS a necessary second causal gate
	 * (V2-only repair re-broke the live specimen with
	 * `risk_opaque_composition` upstream). This test mechanically
	 * asserts the upstream causal sequence by inspecting the
	 * `risk-direct` output BEFORE the downstream re-skin at
	 * `sdk-tool-policies.ts:988`. If a future change weakens the
	 * second causal gate (the opaque guard's Seatbelt-aware
	 * exception) without a compensating repair, this witness will
	 * detect it.
	 * ---------------------------------------------------------------------- */

	it("CAUSAL GATE WITNESS: Seatbelt-honored ALLOW survives both V2 R5 strengthen AND opaque-composition guards", async () => {
		const stampedAuth = buildLiveStampedAuth()
		const input = liveInput()

		const parsed = await helper.invoke(input)
		expect(parsed).not.toBeNull()
		if (parsed === null) {
			throw new Error("helper returned null on live stimulus; cannot proceed")
		}

		// Inspect upstream risk surface BEFORE the downstream
		// re-skin at sdk-tool-policies.ts:988 (which collapses
		// any `risk.disposition === "never-auto-approve"` into
		// `source: "risk_hard_floor"`).
		const { evaluateCommandRiskWithParser } = await import("@cline/core/internal/command-risk-internal")
		const riskDirect = evaluateCommandRiskWithParser({
			toolInput: input,
			hostAuthorization: stampedAuth,
			parserResult: parsed,
		})

		// eslint-disable-next-line no-console
		console.log(
			"[causal-gate-witness] upstream risk:",
			JSON.stringify({
				decision: riskDirect.decision,
				disposition: riskDirect.disposition,
				source: riskDirect.source,
				reasons: riskDirect.reasons,
			}),
		)

		// The four-load-bearing facts that prove BOTH causal gates
		// are honored (V1 R5 + V2 R5 + opaque + downstream):
		//
		// 1. Upstream decision is ALLOW (V1 R5 floor's
		//    `seatbeltObligationHonored` guard fired; opaque branch's
		//    `seatbeltObligationHonored` guard fired).
		expect(riskDirect.decision).toBe("allow")
		expect(riskDirect.disposition).toBe("auto-approve-eligible")

		// 2. Upstream source is the canonical lattice's Seatbelt
		//    source — i.e. NEITHER `risk_hard_floor` NOR
		//    `risk_opaque_composition` leaked through.
		//    (`sdk-tool-policies.ts` re-skins disposition-based
		//    verbiage downstream, but the upstream source label
		//    here is the canonical composition source.)
		expect(riskDirect.source).toBe("host_mode_all_seatbelt_required")

		// 3. R5 classification is still operator-visible via the
		//    reasons array (the V1 R5 floor matched and the V2
		//    structured classifier surfaced an R5 child).
		expect(riskDirect.reasons).toContain("risk:hard-floor:root-destruction")
		expect(riskDirect.reasons).toContain("structured-max-risk:never-auto-approve:aggregated-r5-child")

		// 4. Seatbelt-obligation-honored surface reasons from BOTH
		//    gates appear (V1 R5 floor guard + V2 R5 strengthen
		//    branch guard + opaque-composition guard). This
		//    proves all three Seatbelt-aware exceptions fired,
		//    not just one — i.e. none was silently elided.
		const seatbeltHonoredReasons = riskDirect.reasons.filter(
			(r) => typeof r === "string" && r.includes("seatbelt-obligation-honored"),
		)
		// Three gates fire Seatbelt-obligation-honored reasons:
		//   - V1 R5 floor (line 506): "risk:seatbelt-obligation-honored"
		//   - Opaque branch:            "opaque-composition:seatbelt-obligation-honored"
		//   - V2 R5 strengthen branch:  "risk:seatbelt-obligation-honored"
		expect(seatbeltHonoredReasons.length).toBeGreaterThanOrEqual(3)

		// And the downstream composition agrees.
		const result = evaluateCommandToolApprovalWithPlan(input, stampedAuth, {
			parserResult: parsed as never,
		})
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})

	/* ---------------------------------------------------------------------- *
	 * CONSERVATION MATRIX ABLATION
	 *
	 * Reviewer-specified (2026-08-31): the same REAL parser result must
	 * still downgrade to ASK when the Seatbelt obligation is NOT
	 * honored. This proves the bounded repair did NOT weaken the
	 * off-obligation case — the Seatbelt-aware exception is purely
	 * conditional.
	 * ---------------------------------------------------------------------- */

	it("CONSERVATION ABLATION: same REAL parser result + mode=all (NO mandatorySeatbelt) => ASK / risk_hard_floor", async () => {
		const input = liveInput()
		const parsed = await helper.invoke(input)
		expect(parsed).not.toBeNull()
		if (parsed === null) {
			throw new Error("helper returned null on live stimulus; cannot proceed")
		}

		// Build authority WITHOUT mandatorySeatbelt.
		const evidence = buildPathAuthorityEvidence({
			workspaceRoots: [workspaceRoot],
			cwd: workspaceRoot,
			command: input,
		})
		expect(evidence.ok).toBe(true)
		if (!evidence.ok) {
			throw new Error(`evidence builder failed: ${evidence.reason}`)
		}
		const persistedAuth: CommandHostAuthorization = commandHostAuthorization({
			mode: "all",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [workspaceRoot],
			cwd: workspaceRoot,
			pathAuthorityEvidence: evidence.evidence,
		})
		const projectedAuth = resolveSessionHostAuthorization(persistedAuth, "all")
		expect(projectedAuth).toBeDefined()
		// mode=all WITHOUT mandatorySeatbelt -> source = host_mode_all
		expect(projectedAuth?.mode).toBe("all")
		expect(projectedAuth?.mandatorySeatbelt).not.toBe(true)

		const result = evaluateCommandToolApprovalWithPlan(input, projectedAuth!, {
			parserResult: parsed as never,
		})

		// eslint-disable-next-line no-console
		console.log(
			"[conservation-ablation] verdict:",
			JSON.stringify({
				approved: result.approved,
				kind: result.decision.kind,
				source: result.decision.source,
				reason: result.decision.reason,
				mandatorySeatbeltExecution: result.mandatorySeatbeltExecution,
			}),
		)

		// Without mandatorySeatbelt, the bounded repair MUST NOT
		// suppress the R5 floor. Live R5 still fires.
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("risk_hard_floor")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})
})
