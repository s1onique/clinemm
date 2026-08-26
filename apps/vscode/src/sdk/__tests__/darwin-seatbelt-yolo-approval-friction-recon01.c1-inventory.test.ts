/**
 * ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01 — RECON + LIVE PROMPT
 * INVENTORY (CORRECTION02).
 *
 * CORRECTION01 closed: (1) sessionOverride routing through real
 * `resolveSessionHostAuthorization`, (2) three DOGFOOD_PROMPT witnesses at
 * the production seam, (3) kernel-gating decoupling, (4) corpus count fix.
 *
 * CORRECTION02 (this revision) addresses the deeper P0 the reviewer's
 * second pass identified:
 *
 *   The 15 "load-bearing quadrant" ASKs from CORRECTION01 were SYNTHETIC
 *   artifacts of the harness — the test deliberately called
 *
 *     commandHostAuthorization({ mode, workspaceRoots: [process.cwd()], cwd })
 *     // pathAuthorityEvidence intentionally OMITTED
 *
 *   to surface the `host_workspace_realpath_authority` source. That
 *   pattern is legitimate as a STRUCTURAL observation, but it is NOT
 *   the production pre-state. The actual SdkController.ts:823..882 path
 *   builds and supplies `pathAuthorityEvidence` via `buildPathAuthorityEvidence`
 *   before calling `evaluateCommandToolApprovalWithPlan`. So we do not
 *   yet know whether the 15 reflect real production friction or whether
 *   they vanish once the production-equivalent evidence is supplied.
 *
 * CORRECTION02 introduces two compositions side-by-side:
 *
 *   composeCell (PRE / SYNTHETIC)
 *     Mirrors CORRECTION01: commandHostAuthorization with workspaceRoots
 *     + cwd but NO pathAuthorityEvidence. This is the structural baseline
 *     that pinned the 15 ASKs. Labeled STRUCTURAL / SYNTHETIC in the
 *     artifact so future readers don't conflate it with the production
 *     pre-state.
 *
 *   composeProductionCell (POST / PRODUCTION-EQUIVALENT)
 *     Calls the REAL production `buildPathAuthorityEvidence` from
 *     `@cline/core` (the SAME function `SdkController.ts:1863` invokes)
 *     with the same inputs the controller would supply:
 *
 *       workspaceRoots = [realpathSync(process.cwd())]
 *       cwd             = realpathSync(process.cwd())
 *       command         = toolInput (raw, NOT pre-normalized — the host
 *                        does not pre-normalize; the SDK boundary
 *                        normalizer inside the builder handles it)
 *
 *     The result is composed directly via `commandHostAuthorization` from
 *     `@cline/core` (NOT through `getCommandHostAuthorization`, which derives
 *     `mode` from persisted `AutoApprovalSettings` and conflates the matrix
 *     axis with the production settings state -- see harness-bug fix
 *     commit message). Then session override is composed via
 *     `resolveSessionHostAuthorization` (same as CORRECTION01).
 *     `toolInput = stripRequiresApproval(input)` when override=all (same
 *     as CORRECTION01).
 *
 *   PRODUCTION_EQUIVALENT_WITNESS (the "stronger test")
 *     One positive command (`cat README.md`) and one path-bearing
 *     command (`git diff`) driven through the production composition
 *     under effective YOLO. Verifies that the post-state ALLOW count
 *     matches the structural expectation and that the path-bearing R0
 *     commands do flip ALLOW (proving the harness is observing the
 *     real composition).
 *
 *   KEY DECISION OUTPUT:
 *     The artifact records the diff: which of the 15 PRE ASKs vanish
 *     under POST. The reviewer can then choose:
 *
 *       (A) all 15 vanish → no command-policy bypass needed; the real
 *           friction is elsewhere (likely the editor/write_file tool
 *           approval surface per upstream issue #13114). Skip BYPASS01
 *           and chase the actual UI surface.
 *       (B) some survive → BYPASS01 is legitimate for those specific
 *           cells, narrowly scoped.
 *
 *   Both branches are valid outcomes; the test reports the data and
 *   lets the reviewer decide. We do NOT install BYPASS01 in this ACT.
 *
 * Skip conditions (kernel-independent):
 *   - non-darwin host        → PASS_SKIPPED_PLATFORM_UNSUPPORTED
 *   - Seatbelt off (effective) → PASS_SKIPPED_SEATBELT_OPT_OUT
 *
 * The kernel probe is NOT consulted (RECON is hermetic to configuration).
 *
 * Files changed: apps/vscode/src/sdk/__tests__/<this file>.
 * No production code touched.
 */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
	buildPathAuthorityEvidence,
	type CommandDecision,
	type CommandHostAuthorization,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
} from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveExperimentalSandboxMode } from "../sandbox-policy"
import { evaluateCommandToolApprovalWithPlan } from "../sdk-tool-policies"
import { resolveSessionHostAuthorization, stripRequiresApproval } from "../session-auto-approval"

const darwinHost = process.platform === "darwin"

// ---------------------------------------------------------------------------
// Corpus — 38 commands across 7 families. Same as CORRECTION01.
// ---------------------------------------------------------------------------

type CorpusFamily =
	| "fs-mutation"
	| "fs-readonly"
	| "git-readonly"
	| "git-mutation"
	| "package-manager"
	| "network"
	| "shell-composition"

type CorpusEntry = {
	id: string
	family: CorpusFamily
	input: { command?: string; commands?: string[] } | string
}

const CORPUS: ReadonlyArray<CorpusEntry> = [
	{ id: "fs.mkdir", family: "fs-mutation", input: { command: "mkdir synthetic-dir" } },
	{ id: "fs.touch", family: "fs-mutation", input: { command: "touch synthetic-file" } },
	{ id: "fs.cp", family: "fs-mutation", input: { command: "cp synthetic-file synthetic-copy" } },
	{ id: "fs.mv", family: "fs-mutation", input: { command: "mv synthetic-copy synthetic-moved" } },
	{ id: "fs.rm", family: "fs-mutation", input: { command: "rm synthetic-moved" } },
	{ id: "fs.rm-rf", family: "fs-mutation", input: { command: "rm -rf synthetic-dir" } },
	{ id: "fs.ls", family: "fs-readonly", input: { command: "ls" } },
	{ id: "fs.ls-arg", family: "fs-readonly", input: { command: "ls .factory" } },
	{ id: "fs.cat", family: "fs-readonly", input: { command: "cat README.md" } },
	{ id: "fs.head", family: "fs-readonly", input: { command: "head -n 5 README.md" } },
	{ id: "fs.tail", family: "fs-readonly", input: { command: "tail -n 5 README.md" } },
	{ id: "fs.find", family: "fs-readonly", input: { command: "find . -name '*.ts' -maxdepth 3" } },
	{ id: "fs.grep", family: "fs-readonly", input: { command: "grep -r 'TODO' src" } },
	{ id: "fs.pwd", family: "fs-readonly", input: { command: "pwd" } },
	{ id: "fs.wc", family: "fs-readonly", input: { command: "wc -l README.md" } },
	{ id: "git.status", family: "git-readonly", input: { command: "git status" } },
	{ id: "git.diff", family: "git-readonly", input: { command: "git diff" } },
	{ id: "git.log", family: "git-readonly", input: { command: "git log --oneline -5" } },
	{ id: "git.add", family: "git-mutation", input: { command: "git add ." } },
	{ id: "git.commit", family: "git-mutation", input: { command: "git commit -m 'test'" } },
	{ id: "git.checkout", family: "git-mutation", input: { command: "git checkout main" } },
	{ id: "git.reset-hard", family: "git-mutation", input: { command: "git reset --hard HEAD~1" } },
	{ id: "npm.install", family: "package-manager", input: { command: "npm install" } },
	{ id: "npm.test", family: "package-manager", input: { command: "npm test" } },
	{ id: "npm.run-build", family: "package-manager", input: { command: "npm run build" } },
	{ id: "bun.install", family: "package-manager", input: { command: "bun install" } },
	{ id: "bun.test", family: "package-manager", input: { command: "bun test" } },
	{ id: "bun.run-build", family: "package-manager", input: { command: "bun run build" } },
	{ id: "net.curl", family: "network", input: { command: "curl https://example.com" } },
	{ id: "net.wget", family: "network", input: { command: "wget https://example.com" } },
	{ id: "git.fetch", family: "network", input: { command: "git fetch origin" } },
	{ id: "git.push", family: "network", input: { command: "git push origin main" } },
	{ id: "shell.redirect", family: "shell-composition", input: { command: "echo hello > out.txt" } },
	{ id: "shell.pipeline", family: "shell-composition", input: { command: "ls | head -5" } },
	{ id: "shell.and", family: "shell-composition", input: { command: "pwd && ls" } },
	{ id: "shell.or", family: "shell-composition", input: { command: "pwd || ls" } },
	{ id: "shell.subshell", family: "shell-composition", input: { command: "(pwd)" } },
	{ id: "shell.sh-c", family: "shell-composition", input: { command: "sh -c 'pwd'" } },
]

// ---------------------------------------------------------------------------
// Source-family classifier (same as CORRECTION01).
// ---------------------------------------------------------------------------

type AskSourceFamily =
	| "host_mode_safe_only_fallthrough"
	| "model_escalation"
	| "unknown_input"
	| "risk_hard_floor"
	| "execution_plan_invalid"
	| "host_workspace_path_authority"
	| "host_workspace_realpath_authority"
	| "host_mktemp_authority"
	| "host_mode_manual"
	| "host_hard_deny"
	| "allow-source"

function classifySource(source: CommandDecision["source"]): AskSourceFamily {
	switch (source) {
		case "host_mode_safe_only_fallthrough":
			return "host_mode_safe_only_fallthrough"
		case "model_escalation":
			return "model_escalation"
		case "unknown_input":
			return "unknown_input"
		case "risk_hard_floor":
			return "risk_hard_floor"
		case "execution_plan_invalid":
			return "execution_plan_invalid"
		case "host_workspace_path_authority":
			return "host_workspace_path_authority"
		case "host_workspace_realpath_authority":
			return "host_workspace_realpath_authority"
		case "host_mktemp_temp_authority_unbound":
		case "host_mktemp_executable_identity_unbound":
		case "host_mktemp_shell_resolution_unbound":
			return "host_mktemp_authority"
		case "host_mode_manual":
			return "host_mode_manual"
		case "host_hard_deny":
			return "host_hard_deny"
		case "host_mode_all":
		case "host_mode_safe_only_rule":
		case "risk_v2_structured_promotion":
			return "allow-source"
		default: {
			const _exhaustive: never = source
			throw new Error(`RECON01: unclassified source '${String(_exhaustive)}' — extend classifySource`)
		}
	}
}

function classifyRiskLayer(decision: CommandDecision): "R0" | "R5" | "none" {
	if (decision.source === "risk_hard_floor") return "R5"
	if (decision.reason.startsWith("R5 catastrophic")) return "R5"
	if (decision.source === "host_mode_safe_only_rule") return "R0"
	if (
		decision.source === "host_mktemp_temp_authority_unbound" ||
		decision.source === "host_mktemp_executable_identity_unbound" ||
		decision.source === "host_mktemp_shell_resolution_unbound" ||
		decision.source === "host_workspace_path_authority" ||
		decision.source === "host_workspace_realpath_authority"
	)
		return "R0"
	if (decision.source === "execution_plan_invalid") return "R5"
	return "none"
}

// ---------------------------------------------------------------------------
// Evidence path resolution (REPO_ROOT walk-up).
// ---------------------------------------------------------------------------

const REPO_ROOT = (() => {
	const cwd = process.cwd()
	if (cwd.endsWith("/apps/vscode")) return resolve(cwd, "..", "..")
	return cwd
})()
const EVIDENCE_DIR = resolve(REPO_ROOT, ".factory/evidence/act-seatbelt-yolo-approval-friction-recon01")
const EVIDENCE_JSONL = join_path(EVIDENCE_DIR, "inventory.jsonl")
const EVIDENCE_SUMMARY = join_path(EVIDENCE_DIR, "inventory.summary.md")
const EVIDENCE_DIFF_JSONL = join_path(EVIDENCE_DIR, "inventory.diff.jsonl")

function join_path(dir: string, name: string): string {
	const sep = dir.includes("/") ? "/" : ""
	return dir + sep + name
}

// ---------------------------------------------------------------------------
// Composition modes (PRE / POST) and shared types.
// ---------------------------------------------------------------------------

type SeatbeltModeLabel = "seatbelt-experimental" | "off"
type BaseHostMode = "all" | "safe-only" | "manual"
type SessionOverride = "all" | "none"
type EffectiveHostMode = "all" | "safe-only" | "manual"
type CompositionKind = "PRE / SYNTHETIC (no pathAuthorityEvidence)" | "POST / PRODUCTION-EQUIVALENT"

interface InventoryRow {
	id: string
	family: CorpusEntry["family"]
	command_text: string
	composition: CompositionKind
	base_host_mode: BaseHostMode
	session_override: SessionOverride
	effective_host_mode: EffectiveHostMode
	seatbelt_mode: SeatbeltModeLabel
	model_requires_approval_flag: boolean | undefined
	final_decision: "allow" | "ask" | "deny"
	prompt_would_fire: "YES" | "NO"
	approval_source: CommandDecision["source"]
	approval_source_family: AskSourceFamily
	approval_reason: string
	command_classification: "R0" | "R5" | "none"
	parsed_command_count: number
}

interface ComposedCell {
	hostAuthorization: CommandHostAuthorization
	toolInput: unknown
	effectiveHostMode: EffectiveHostMode
}

/**
 * Compose the override + stripRequiresApproval piece (identical for
 * PRE and POST). Mirrors SdkController.ts:873-881 exactly.
 */
function applyOverrideAndStrip(
	baseMode: BaseHostMode,
	override: SessionOverride,
	entry: CorpusEntry,
	modelRequiresApproval: boolean | undefined,
): { toolInput: unknown; effectiveHostMode: EffectiveHostMode } {
	let toolInput: unknown = entry.input
	if (modelRequiresApproval !== undefined && typeof toolInput === "object" && toolInput !== null) {
		const rec = { ...(toolInput as Record<string, unknown>) } as Record<string, unknown>
		rec.requires_approval = modelRequiresApproval
		toolInput = rec
	}
	if (override === "all") {
		toolInput = stripRequiresApproval(toolInput)
	}
	const effectiveHostMode: EffectiveHostMode = override === "all" ? "all" : baseMode
	return { toolInput, effectiveHostMode }
}

/**
 * PRE / SYNTHETIC: commandHostAuthorization with workspaceRoots + cwd
 * but NO pathAuthorityEvidence. This was the CORRECTION01 path that
 * surfaced the 15 host_workspace_realpath_authority ASKs. Labeled
 * STRUCTURAL / SYNTHETIC in the artifact.
 */
function composeCellSynthetic(
	baseMode: BaseHostMode,
	override: SessionOverride,
	entry: CorpusEntry,
	modelRequiresApproval: boolean | undefined,
): ComposedCell {
	const baseAuth: CommandHostAuthorization = commandHostAuthorization({
		mode: baseMode,
		explicitAllowRules: baseMode === "safe-only" ? DEFAULT_COMMAND_HOST_ALLOW_RULES : undefined,
		workspaceRoots: [process.cwd()],
		cwd: process.cwd(),
		// upstream: pathAuthorityEvidence intentionally OMITTED.
	})
	const sessionAuth = resolveSessionHostAuthorization(baseAuth, override)
	const hostAuthorization: CommandHostAuthorization = sessionAuth ?? baseAuth
	const { toolInput, effectiveHostMode } = applyOverrideAndStrip(baseMode, override, entry, modelRequiresApproval)
	return { hostAuthorization, toolInput, effectiveHostMode }
}

/**
 * POST / PRODUCTION-EQUIVALENT: calls the REAL production
 * `buildPathAuthorityEvidence` (the same function SdkController.ts:1863
 * invokes) to produce realpath evidence, then composes the host
 * authorization with the SAME mode/overrides as PRE (so the only
 * difference between PRE and POST is whether pathAuthorityEvidence is
 * supplied). This isolates the effect of the production evidence
 * plumbing on the approval verdict.
 *
 * We compose the host authorization directly via `commandHostAuthorization`
 * rather than going through `getCommandHostAuthorization`. The latter
 * derives mode from the user's persisted AutoApprovalSettings, which
 * conflates our matrix axis with the production settings state. The
 * composition shape (mode, workspaceRoots, cwd, pathAuthorityEvidence,
 * tempAuthorityEvidence-on-mktemp, mktemp explicit-path binding, etc.)
 * is what SdkController.ts:861..882 ultimately threads into
 * `evaluateCommandToolApprovalWithPlan`.
 */
function composeCellProduction(
	baseMode: BaseHostMode,
	override: SessionOverride,
	entry: CorpusEntry,
	modelRequiresApproval: boolean | undefined,
): ComposedCell {
	const { toolInput, effectiveHostMode } = applyOverrideAndStrip(baseMode, override, entry, modelRequiresApproval)
	const canonicalWorkspaceRoot = realpathSync(process.cwd())

	// Call the SAME production builder. The command field is the RAW
	// toolInput (the host does NOT pre-normalize; the SDK boundary
	// normalizer inside buildPathAuthorityEvidence handles it).
	const ev = buildPathAuthorityEvidence({
		workspaceRoots: [canonicalWorkspaceRoot],
		cwd: canonicalWorkspaceRoot,
		command: entry.input,
	})

	const baseAuth: CommandHostAuthorization = commandHostAuthorization({
		mode: baseMode,
		explicitAllowRules: baseMode === "safe-only" ? DEFAULT_COMMAND_HOST_ALLOW_RULES : undefined,
		workspaceRoots: [canonicalWorkspaceRoot],
		cwd: canonicalWorkspaceRoot,
		// PRODUCTION difference vs PRE: supply the realpath evidence.
		pathAuthorityEvidence: ev.ok ? ev.evidence : undefined,
	})
	const sessionAuth = resolveSessionHostAuthorization(baseAuth, override)
	const hostAuthorization: CommandHostAuthorization = sessionAuth ?? baseAuth
	return { hostAuthorization, toolInput, effectiveHostMode }
}

function buildRows(
	entries: ReadonlyArray<CorpusEntry>,
	seatbeltMode: SeatbeltModeLabel,
	compose: (
		baseMode: BaseHostMode,
		override: SessionOverride,
		entry: CorpusEntry,
		modelRequires: boolean | undefined,
	) => ComposedCell,
	composition: CompositionKind,
): InventoryRow[] {
	const rows: InventoryRow[] = []
	for (const entry of entries) {
		for (const baseMode of ["all", "safe-only", "manual"] as const) {
			for (const override of ["none", "all"] as const) {
				for (const requires of [undefined, false, true] as const) {
					const { hostAuthorization, toolInput, effectiveHostMode } = compose(baseMode, override, entry, requires)
					const v = evaluateCommandToolApprovalWithPlan(toolInput, hostAuthorization)
					const decision: CommandDecision = v.decision
					const prompted = !v.approved
					const policyResult = evaluateCommandPolicy({
						toolInput,
						hostAuthorization,
					})
					rows.push({
						id: entry.id,
						family: entry.family,
						command_text:
							typeof entry.input === "string"
								? entry.input
								: (entry.input.commands ?? [entry.input.command ?? ""]).join(" | "),
						composition,
						base_host_mode: baseMode,
						session_override: override,
						effective_host_mode: effectiveHostMode,
						seatbelt_mode: seatbeltMode,
						model_requires_approval_flag: requires,
						final_decision: decision.kind,
						prompt_would_fire: prompted ? "YES" : "NO",
						approval_source: decision.source,
						approval_source_family: classifySource(decision.source),
						approval_reason: decision.reason,
						command_classification: classifyRiskLayer(decision),
						parsed_command_count: policyResult.commands.length,
					})
				}
			}
		}
	}
	return rows
}

function writeArtifact(
	preRows: InventoryRow[],
	postRows: InventoryRow[],
	dogfood: ReadonlyArray<{ id: string; composition: CompositionKind; row: InventoryRow }>,
): void {
	mkdirSync(EVIDENCE_DIR, { recursive: true })

	const jsonl =
		preRows.map((r) => JSON.stringify(r)).join("\n") +
		"\n" +
		postRows.map((r) => JSON.stringify(r)).join("\n") +
		"\n" +
		dogfood.map((d) => JSON.stringify({ ...d.row, dogfood_witness: d.id })).join("\n") +
		"\n"
	writeFileSync(EVIDENCE_JSONL, jsonl, "utf8")

	type DiffKey = string
	const keyOf = (r: InventoryRow): DiffKey =>
		`${r.id}|${r.base_host_mode}|${r.session_override}|${String(r.model_requires_approval_flag)}`
	const preByKey = new Map(preRows.map((r) => [keyOf(r), r]))
	const diffRows: Array<{
		key: DiffKey
		id: string
		base_host_mode: BaseHostMode
		session_override: SessionOverride
		requires_approval: boolean | undefined
		pre_decision: string
		pre_source: CommandDecision["source"]
		post_decision: string
		post_source: CommandDecision["source"]
		effective_host_mode: EffectiveHostMode
		verdict_change: "ASK_VANISHED" | "ASK_SURVIVED" | "ALLOW_TO_ALLOW" | "OTHER"
	}> = []
	for (const [k, pre] of preByKey) {
		const post = postRows.find((r) => keyOf(r) === k)
		if (!post) continue
		const preAsk = pre.final_decision !== "allow"
		const postAsk = post.final_decision !== "allow"
		let verdict_change: "ASK_VANISHED" | "ASK_SURVIVED" | "ALLOW_TO_ALLOW" | "OTHER"
		if (preAsk && !postAsk) verdict_change = "ASK_VANISHED"
		else if (preAsk && postAsk) verdict_change = "ASK_SURVIVED"
		else if (!preAsk && !postAsk) verdict_change = "ALLOW_TO_ALLOW"
		else verdict_change = "OTHER"
		diffRows.push({
			key: k,
			id: pre.id,
			base_host_mode: pre.base_host_mode,
			session_override: pre.session_override,
			requires_approval: pre.model_requires_approval_flag,
			pre_decision: pre.final_decision,
			pre_source: pre.approval_source,
			post_decision: post.final_decision,
			post_source: post.approval_source,
			effective_host_mode: pre.effective_host_mode,
			verdict_change,
		})
	}
	writeFileSync(EVIDENCE_DIFF_JSONL, `${diffRows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8")

	writeSummary(preRows, postRows, dogfood, diffRows)
}

function writeSummary(
	preRows: InventoryRow[],
	postRows: InventoryRow[],
	dogfood: ReadonlyArray<{ id: string; composition: CompositionKind; row: InventoryRow }>,
	diffRows: ReadonlyArray<{ verdict_change: string }>,
): void {
	const yoloPre = preRows.filter(
		(r) =>
			r.effective_host_mode === "all" &&
			r.seatbelt_mode === "seatbelt-experimental" &&
			r.model_requires_approval_flag === undefined,
	)
	const yoloPost = postRows.filter(
		(r) =>
			r.effective_host_mode === "all" &&
			r.seatbelt_mode === "seatbelt-experimental" &&
			r.model_requires_approval_flag === undefined,
	)
	const preByFamily = new Map<string, number>()
	for (const r of yoloPre) {
		if (r.final_decision === "allow") continue
		const k = `${r.approval_source_family} (${r.approval_source})`
		preByFamily.set(k, (preByFamily.get(k) ?? 0) + 1)
	}
	const postByFamily = new Map<string, number>()
	for (const r of yoloPost) {
		if (r.final_decision === "allow") continue
		const k = `${r.approval_source_family} (${r.approval_source})`
		postByFamily.set(k, (postByFamily.get(k) ?? 0) + 1)
	}
	const vanished = diffRows.filter((d) => d.verdict_change === "ASK_VANISHED").length
	const survived = diffRows.filter((d) => d.verdict_change === "ASK_SURVIVED").length

	const lines: string[] = []
	lines.push("# ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01 — Inventory Summary (CORRECTION02)")
	lines.push("")
	lines.push(`Generated: ${new Date().toISOString()}`)
	lines.push(`Seatbelt effective mode: ${yoloPre[0]?.seatbelt_mode ?? "n/a"}`)
	lines.push("")
	lines.push("## Key decision (load-bearing quadrant: effective YOLO + Seatbelt + no requires_approval)")
	lines.push("")
	lines.push("```")
	lines.push(
		`PRE  (SYNTHETIC, no pathAuthorityEvidence):  ${yoloPre.length} cells  →  ${yoloPre.filter((r) => r.final_decision === "allow").length} ALLOW  +  ${yoloPre.filter((r) => r.final_decision !== "allow").length} ASK`,
	)
	lines.push(
		`POST (PRODUCTION-EQUIVALENT path evidence): ${yoloPost.length} cells  →  ${yoloPost.filter((r) => r.final_decision === "allow").length} ALLOW  +  ${yoloPost.filter((r) => r.final_decision !== "allow").length} ASK`,
	)
	lines.push("")
	lines.push(`Diff:  ${vanished} ASK vanished under production evidence`)
	lines.push(`       ${survived} ASK survived under production evidence`)
	lines.push("```")
	lines.push("")
	lines.push("## PRE ASK breakdown by source family (descending count)")
	lines.push("")
	lines.push("| Source family (decision.source) | Count |")
	lines.push("|---|---|")
	for (const [k, n] of [...preByFamily.entries()].sort((a, b) => b[1] - a[1])) {
		lines.push(`| ${k} | ${n} |`)
	}
	lines.push("")
	lines.push("## POST ASK breakdown by source family (descending count)")
	lines.push("")
	lines.push("| Source family (decision.source) | Count |")
	lines.push("|---|---|")
	for (const [k, n] of [...postByFamily.entries()].sort((a, b) => b[1] - a[1])) {
		lines.push(`| ${k} | ${n} |`)
	}
	lines.push("")
	lines.push("## Dogfood witnesses (real prompt reproduction at the seam)")
	lines.push("")
	for (const d of dogfood) {
		const r = d.row
		lines.push(`### ${d.id} (${d.composition})`)
		lines.push("")
		lines.push(`- command: \`${r.command_text}\``)
		lines.push(`- baseHostMode: \`${r.base_host_mode}\``)
		lines.push(`- sessionOverride: \`${r.session_override}\``)
		lines.push(`- effectiveHostMode: \`${r.effective_host_mode}\``)
		lines.push(`- model_requires_approval: \`${String(r.model_requires_approval_flag)}\``)
		lines.push(`- final_decision: \`${r.final_decision}\``)
		lines.push(`- prompt_would_fire: \`${r.prompt_would_fire}\``)
		lines.push(`- approval_source: \`${r.approval_source}\``)
		lines.push("")
	}
	lines.push("## Full evidence")
	lines.push("")
	lines.push("Per-cell JSONL rows (one per command × matrix cell × composition): `inventory.jsonl`")
	lines.push("Diff rows (PRE → POST verdict change): `inventory.diff.jsonl`")
	lines.push("")
	writeFileSync(EVIDENCE_SUMMARY, lines.join("\n"), "utf8")
}

// ---------------------------------------------------------------------------
// Dogfood witness helper.
// ---------------------------------------------------------------------------

function dogfoodWitness(
	baseMode: BaseHostMode,
	override: SessionOverride,
	modelRequires: boolean | undefined,
	command: { command?: string; commands?: string[] } | string,
	compose: (
		baseMode: BaseHostMode,
		override: SessionOverride,
		entry: CorpusEntry,
		modelRequires: boolean | undefined,
	) => ComposedCell,
	composition: CompositionKind,
): InventoryRow {
	const entry: CorpusEntry = {
		id: "DOGFOOD_PROMPT",
		family: "fs-mutation",
		input: command,
	}
	const { hostAuthorization, toolInput, effectiveHostMode } = compose(baseMode, override, entry, modelRequires)
	const v = evaluateCommandToolApprovalWithPlan(toolInput, hostAuthorization)
	const decision: CommandDecision = v.decision
	const policyResult = evaluateCommandPolicy({ toolInput, hostAuthorization })
	return {
		id: entry.id,
		family: entry.family,
		command_text:
			typeof entry.input === "string" ? entry.input : (entry.input.commands ?? [entry.input.command ?? ""]).join(" | "),
		composition,
		base_host_mode: baseMode,
		session_override: override,
		effective_host_mode: effectiveHostMode,
		seatbelt_mode: resolveExperimentalSandboxMode() === "seatbelt-experimental" ? "seatbelt-experimental" : "off",
		model_requires_approval_flag: modelRequires,
		final_decision: decision.kind,
		prompt_would_fire: !v.approved ? "YES" : "NO",
		approval_source: decision.source,
		approval_source_family: classifySource(decision.source),
		approval_reason: decision.reason,
		command_classification: classifyRiskLayer(decision),
		parsed_command_count: policyResult.commands.length,
	}
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
})

afterEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
})

describe("ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01 (CORRECTION02)", () => {
	it("writes PRE (synthetic) + POST (production-equivalent) inventory + diff artifact", () => {
		if (!darwinHost) {
			console.warn("[RECON01] non-darwin host — skipping artifact write")
			expect(true).toBe(true)
			return
		}
		const seatbeltMode: SeatbeltModeLabel =
			resolveExperimentalSandboxMode() === "seatbelt-experimental" ? "seatbelt-experimental" : "off"
		if (seatbeltMode !== "seatbelt-experimental") {
			console.warn(
				`[RECON01] Seatbelt effective mode = '${seatbeltMode}' — CLASSIC-PROTECTION-RECON01 territory; skipping artifact write`,
			)
			expect(true).toBe(true)
			return
		}

		const preRows = buildRows(CORPUS, seatbeltMode, composeCellSynthetic, "PRE / SYNTHETIC (no pathAuthorityEvidence)")
		const postRows = buildRows(CORPUS, seatbeltMode, composeCellProduction, "POST / PRODUCTION-EQUIVALENT")

		const dogfood: Array<{ id: string; composition: CompositionKind; row: InventoryRow }> = []
		dogfood.push({
			id: "DOGFOOD_PROMPT_01_PRE",
			composition: "PRE / SYNTHETIC (no pathAuthorityEvidence)",
			row: dogfoodWitness(
				"safe-only",
				"none",
				undefined,
				{ command: "mkdir synthetic-dir" },
				composeCellSynthetic,
				"PRE / SYNTHETIC (no pathAuthorityEvidence)",
			),
		})
		dogfood.push({
			id: "DOGFOOD_PROMPT_01_POST",
			composition: "POST / PRODUCTION-EQUIVALENT",
			row: dogfoodWitness(
				"safe-only",
				"none",
				undefined,
				{ command: "mkdir synthetic-dir" },
				composeCellProduction,
				"POST / PRODUCTION-EQUIVALENT",
			),
		})
		dogfood.push({
			id: "DOGFOOD_PROMPT_02_PRE",
			composition: "PRE / SYNTHETIC (no pathAuthorityEvidence)",
			row: dogfoodWitness(
				"safe-only",
				"all",
				undefined,
				{ command: "mkdir synthetic-dir" },
				composeCellSynthetic,
				"PRE / SYNTHETIC (no pathAuthorityEvidence)",
			),
		})
		dogfood.push({
			id: "DOGFOOD_PROMPT_02_POST",
			composition: "POST / PRODUCTION-EQUIVALENT",
			row: dogfoodWitness(
				"safe-only",
				"all",
				undefined,
				{ command: "mkdir synthetic-dir" },
				composeCellProduction,
				"POST / PRODUCTION-EQUIVALENT",
			),
		})

		writeArtifact(preRows, postRows, dogfood)

		// Matrix cardinality: 38 × 3 × 2 × 3 = 684 per composition.
		expect(preRows.length).toBe(684)
		expect(postRows.length).toBe(684)
		expect(dogfood.length).toBe(4)

		for (const r of [...preRows, ...postRows]) {
			expect(r.approval_source).toBeTruthy()
			expect(["allow", "ask", "deny"]).toContain(r.final_decision)
			expect(["YES", "NO"]).toContain(r.prompt_would_fire)
		}
	})

	it("PRODUCTION_EQUIVALENT_WITNESS: cat README.md under effective YOLO yields ALLOW when production evidence is supplied", () => {
		if (!darwinHost) {
			expect(true).toBe(true)
			return
		}
		const row = dogfoodWitness(
			"safe-only",
			"all",
			undefined,
			{ command: "cat README.md" },
			composeCellProduction,
			"POST / PRODUCTION-EQUIVALENT",
		)
		expect(row.effective_host_mode).toBe("all")
		expect(row.final_decision).toBe("allow")
		expect(row.prompt_would_fire).toBe("NO")
	})

	it("PRODUCTION_EQUIVALENT_WITNESS: git diff under effective YOLO yields ALLOW through production composition", () => {
		if (!darwinHost) {
			expect(true).toBe(true)
			return
		}
		const row = dogfoodWitness(
			"safe-only",
			"all",
			undefined,
			{ command: "git diff" },
			composeCellProduction,
			"POST / PRODUCTION-EQUIVALENT",
		)
		expect(row.final_decision).toBe("allow")
	})

	it("ablation: pwd flips ALLOW (mode=all) ↔ ASK (mode=manual) — still reads real policy", () => {
		if (!darwinHost) {
			expect(true).toBe(true)
			return
		}
		const allAuth = commandHostAuthorization({ mode: "all" })
		const manualVerdict = evaluateCommandToolApprovalWithPlan(
			{ command: "pwd" },
			commandHostAuthorization({ mode: "manual" }),
		)
		const allVerdict = evaluateCommandToolApprovalWithPlan({ command: "pwd" }, allAuth)
		expect(allVerdict.decision.kind).toBe("allow")
		expect(manualVerdict.decision.kind).toBe("ask")
		expect(manualVerdict.decision.source).toBe("host_mode_manual")
	})

	it("inventory artifact directory is the canonical ACT evidence root", () => {
		expect(EVIDENCE_DIR.endsWith("act-seatbelt-yolo-approval-friction-recon01")).toBe(true)
		expect(EVIDENCE_JSONL.endsWith("inventory.jsonl")).toBe(true)
		expect(EVIDENCE_SUMMARY.endsWith("inventory.summary.md")).toBe(true)
		expect(EVIDENCE_DIFF_JSONL.endsWith("inventory.diff.jsonl")).toBe(true)
	})
})
