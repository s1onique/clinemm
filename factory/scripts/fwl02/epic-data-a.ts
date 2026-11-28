#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/epic-data-a.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — reconciled epics, part A.
 *
 * Covers the HOT epics — those carrying the current execution frontier and
 * the explicit open obligations.
 *
 * Every claim is bound to an exact committed line range. Line numbers refer
 * to the file as committed at SOURCE_HEAD; the generator re-resolves each
 * range against the committed blob and computes its digest.
 */

import type { ReconciledEpic } from "./reconciled-epics.ts";
import { BOARD } from "./reconciled-epics.ts";

const SAFE = ".factory/epics/safe-yolo-seatbelt.md";
const _APPROVAL = ".factory/epics/approval-protection.md";
const HOSTTEST = ".factory/epics/host-test-infrastructure.md";
const _PRODUCT = ".factory/epics/product-config-branding.md";

/**
 * EPIC-CLINEMM-SAFE-YOLO-SEATBELT — the P0 safety substrate.
 *
 * The epic file's own "Current status" is a single very long bullet; the
 * source states the open items in the "Open work" section. The exit criteria
 * are recovered from the "Reopen / new-work conditions" list, which is where
 * the source states the conditions under which the substrate's closure could
 * be invalidated.
 */
export const EPIC_SAFE_YOLO_SEATBELT: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT",
	source_file: ".factory/epics/safe-yolo-seatbelt.md",
	title: "Safe-YOLO + Darwin Seatbelt",
	original_status: "ACTIVE",
	lifecycle: "ACTIVE",
	priority: "P0",
	exit_criteria: [
		"A Seatbelt-default-ON regression breaks the selector contract (`SeatbeltSandboxBackendExperimental` no longer the canonical selector on Darwin when the OS-level sandbox feature is enabled).",
		"Real-kernel host qualification remains `HOST_REQUIRED` where applicable: any ACT that asserts a real-kernel Seatbelt property must include a `host_test_runner` artifact or explicitly mark `HOST_REQUIRED` in the verdict.",
	],
	source_refs: [
		{ path: SAFE, lines: [5, 11] },
		{ path: SAFE, lines: [42, 58] },
	],
	items: [
		{
			item_id: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT/HOST-TEST-RUNNER",
			title: "HOST-TEST RUNNER — host-orchestrated end-to-end test runner",
			description:
				"A separate, host-orchestrated test runner that lets a ClineMM authoring process ask the host to run a bounded corpus of commands / tests / live captures and return machine-readable results. It is the natural next layer above the substrate probes: it replaces per-test `skipIf(!HAS_SUBSTRATE)` caveats with explicit `HOST_REQUIRED` qualification. Inputs are a declared corpus (commands + expected exit codes + optional timeouts), never arbitrary shell from the agent. Outputs are machine-readable with classified failures. Every invocation logs ACT ID, source HEAD, corpus path, runner version, host OS/kernel, start/end wall time and full result. The runner runs as the host user and must not gain Seatbelt privileges the user lacks, nor serve as a covert YOLO bypass. Author as a NEW ACT — do NOT roll the runner into an existing closed ACT, which would invalidate closure evidence.",
			workstream: "safe-yolo-seatbelt",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "HIGH",
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "UNKNOWN",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"A Seatbelt / approval / classic-protection ACT needs host-only evidence and the runner does not yet cover the required corpus (→ new runner ACT scoped).",
				"The runner is observed widening authority / leaking secrets / being used as a covert bypass (→ HALT the runner ACT and any consumer).",
			],
			source_refs: [
				{ path: SAFE, lines: [44, 44] },
				{ path: HOSTTEST, lines: [38, 40] },
				{ path: HOSTTEST, lines: [31, 36] },
			],
			relationships: [
				{
					kind: "CROSS_LINK",
					target: "EPIC-CLINEMM-HOST-TEST-INFRASTRUCTURE/HOST-TEST-RUNNER",
					source_refs: [{ path: SAFE, lines: [44, 44] }],
				},
				{
					kind: "RELATED_TO",
					target: "EPIC-CLINEMM-APPROVAL-PROTECTION/CLASSIC-PROTECTION-RECON01",
					source_refs: [{ path: SAFE, lines: [44, 44] }],
				},
			],
		},
		{
			item_id: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT/CLASSIC-PROTECTION-RECON01",
			title:
				"ACT-CLINEMM-CLASSIC-PROTECTION-RECON01 — classic (non-Seatbelt) approval protection recon",
			description:
				"Classic (non-Seatbelt) approval protection recon — the next-frontier after Safe-YOLO is fully closed. Unblocked by `SEATBELT-DEFAULT-ON01` closure (now satisfied). Likely first deliverable: observe whether the Seatbelt-confined `$HOME`/network/secret boundaries are also enforced when Seatbelt is OFF, where the host's path-authority / command-policy surface takes over, and compare those surfaces to the Seatbelt-confined boundaries to identify any drift.",
			workstream: "safe-yolo-seatbelt",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "HIGH",
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-CLASSIC-PROTECTION-RECON01",
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"A new classic (non-Seatbelt) approval protection recon ACT lands — append to this file's ACT ledger row.",
			],
			source_refs: [{ path: SAFE, lines: [45, 45] }],
			relationships: [
				{
					kind: "RELATED_TO",
					target: "EPIC-CLINEMM-APPROVAL-PROTECTION/CLASSIC-PROTECTION-RECON01",
					source_refs: [{ path: SAFE, lines: [45, 45] }],
				},
			],
		},
		{
			item_id:
				"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01",
			title:
				"ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01 — outside-read policy reconciliation",
			description:
				"Policy / contract reconciliation recon for live specimen `54T24A8CE5`. Operator chose `NOT_A_DEFECT_POLICY_EXPECTED` with policy `WORKSPACE_IS_DATA_AUTHORITY_BOUNDARY`: `host_workspace_realpath_authority` IS the data-authority boundary, NOT a pre-Seatbelt convenience; `ALL` does NOT bypass it. `54T24A8CE5` = `CLOSED_EXPECTED`. Distinct from the R0 execution-obligation recon (sibling candidate) and from the workspace-realpath CORRECTION02 live-failure lane, which closed REPAIRED but with `54T24A8CE5_CAUSAL_BINDING=NOT PROVEN`.",
			workstream: "safe-yolo-seatbelt",
			original_status: "CLOSED / PASS_RECON_NO_DEFECT_FOUND_V1",
			lifecycle: "TERMINAL",
			priority: "P0",
			qualification: "LIVE_QUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: ["ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01"],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/entry-freeze.txt",
				".factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/source-seam-map.md",
				".factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/adversarial-case-inventory.md",
				".factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/final-report.md",
				".factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/verdict-record.md",
			],
			reopen_conditions: [
				"A new R5 defect matches the `NEXT_R5_TRIGGER` predicate (mode=all + mandatorySeatbelt=true + all path-bearing operands inside authorized workspace roots + no explicit deny / hard floor / missing evidence) AND `finalDecision=ask` AND the approval UI is published.",
			],
			source_refs: [{ path: SAFE, lines: [46, 46] }],
		},
		{
			item_id: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT/R5-MANUAL-APPROVAL-LANE",
			title: "R5 manual approval lane — open R5 defect trigger",
			description:
				'The `R5_MANUAL_APPROVAL_LANE` stays OPEN with a sharp `NEXT_R5_TRIGGER`: the next genuine R5 defect must satisfy `mode=all + mandatorySeatbelt=true + all path-bearing operands INSIDE authorized workspace roots + no explicit deny / hard floor / missing evidence` BUT `finalDecision=ask AND approval UI published`. After `f56e87af0+` lands, dogfood should watch for "an unexpected prompt on a fully-authorized, all-inside request." This is not a separate ACT; it is a standing trigger that reopens the R5 lane.',
			workstream: "safe-yolo-seatbelt",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P0",
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: ["ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01"],
			evidence_locators: [],
			reopen_conditions: [
				"An unexpected prompt is observed on a fully-authorized, all-inside request under `mode=all + mandatorySeatbelt=true`.",
			],
			source_refs: [{ path: SAFE, lines: [46, 46] }],
		},
		{
			item_id: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT/TEMP-INTERNAL-CONTROL-CLEANUP",
			title:
				"TEMP-INTERNAL-CONTROL-CLEANUP — temporary / internal control inventory and classification",
			description:
				'This is the PRIMARY owner of the temporary / internal control cleanup inventory; the cross-cutting child row in product-config-branding.md is the secondary row because the eventual replacement is a settings surface. It is an inventory + classification task: each temporary / internal control must be classified as KEEP_INTERNAL / REPLACE_WITH_SETTING / REMOVE_AFTER_SUCCESSOR / DEBUG_ONLY before any cleanup ACT can be opened. No inventory exists yet; opening a "cleanup" ACT without the inventory would be premature. Inventory: `CLINEMM_SAFE_YOLO_NETWORK` → REPLACE_WITH_SETTING; `CLINEMM_SAFE_YOLO_SSH_AGENT` → REPLACE_WITH_SETTING; PTAD env controls → REPLACE_WITH_SETTING (GUARD_NO_PTAD_TAB preserved); `CLINEMM_EXPERIMENTAL_SANDBOX` (sandbox-backend.ts) → KEEP_INTERNAL (substrate-only, not user-facing); any still-live `CLINEMM_EXPERIMENTAL_*` naming that is semantically stale → classification TBD by inventory. Constraints carried into any future ACT: no action in this backlog ACT beyond making the debt durable; the settings-parity ACT\'s §3 inventory may surface these env controls as SUPERSEDED_BY_CLINEMM rows; do not silently convert temporary env controls into permanent public API.',
			workstream: "safe-yolo-seatbelt",
			original_status: "FUTURE / DEFER",
			lifecycle: "DEFERRED",
			priority: "P2",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01/reconciliation.md (FW-11, recorded 2026-08-29 by the thread-future-work normalization ACT)",
			],
			reopen_conditions: [
				"A future ACT is opened whose mission is the temporary / internal control inventory; the inventory must be produced before any cleanup ACT is opened.",
			],
			source_refs: [{ path: SAFE, lines: [110, 157] }],
			relationships: [
				{
					kind: "CROSS_LINK",
					target:
						"EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TEMP-INTERNAL-CONTROL-CLEANUP",
					source_refs: [{ path: SAFE, lines: [118, 122] }],
				},
			],
		},
		{
			item_id:
				"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01",
			title:
				"ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01 — SSH-agent credential authority implementation",
			description:
				"Executable qualification of the frozen `sshAuthenticationAuthority: deny | agent` contract (§15 of RECON01). Production-seam code at HEAD `ff96ea8fe` (the C1 correction cycle) implements the contract: `CommandCapability.sshAuthenticationAuthority` field in `sdk/packages/core/src/runtime/sandbox/types.ts`; `path-literal` AF_UNIX system-socket + remote unix-socket rules in `seatbelt-profile.ts`; `materializeEnvironment` step-3 allow list reintroduces `SSH_AUTH_SOCK` only in agent mode without weakening `SECRET_BLOCKLIST`; activation via `apps/vscode/src/sdk/sandbox-policy.ts` under the temporary env control `CLINEMM_SAFE_YOLO_SSH_AGENT=allow` (the temporary control is itself catalogued for replacement by the settings-surface-parity recon). Phase E/F/G LIVE qualification captured 2026-08-29: SSH_AUTH_SOCK visible, ssh-add shows the RSA key, raw-key `cat` returns EPERM (load-bearing invariant), outbound SSH to `ubuntu@81.177.33.219` returns `SSH_AGENT_AUTH_OK` from host `indeep01`. 4 host-substrate tests (SSH-03/04/06/12) report SKIP under `HAS_SUBSTRATE === false` in this VSCodium authoring shell; they flip to PASS on Terminal.app / iTerm2 / debug-harness without code change.",
			workstream: "safe-yolo-seatbelt",
			original_status: "CLOSED / PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1",
			lifecycle: "TERMINAL",
			priority: "P0",
			qualification: "LIVE_QUALIFIED",
			criteria: [
				'`CommandCapability.sshAuthenticationAuthority` field present with the closed union `undefined | { mode: "agent", resolvedAuthSock }`.',
				"Seatbelt backend emits the two-rule agent SSH pair exactly as RECON01 §5.1 specifies, with `path-literal` (NOT filesystem `literal`, NOT `subpath`).",
				"`materializeEnvironment` reintroduces `SSH_AUTH_SOCK` only when the capability's env allow list contains it (step 3 wins over step 4); `SSH_AUTH_SOCK` stays in `SECRET_BLOCKLIST`.",
				"Substrate-gated RED suite passes on Terminal.app / iTerm2 / debug-harness for SSH-03..SSH-14.",
				"`readonly`-identity-file mode is NOT added.",
				"`SECRET_BLOCKLIST` is unchanged.",
				"No launchd socket parent directory is added to any filesystem grant list.",
			],
			criteria_coverage: "COMPLETE",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [
				"ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01",
				"ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01",
			],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01/final-report.md",
				".factory/evidence/ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01/live-qualification/identity.txt",
				".factory/evidence/ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01/live-qualification/live-ssh-transcript.txt",
				".factory/evidence/ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01/live-qualification/environment.json",
			],
			reopen_conditions: [
				"The `readonly`-identity-file mode is out of scope for V1; renegotiating the frozen §15 contract requires a NEW recon ACT.",
			],
			source_refs: [
				{ path: SAFE, lines: [50, 50] },
				{
					path: ".factory/acts/ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01.md",
					lines: [329, 345],
				},
			],
		},
		{
			item_id:
				"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/SINGLE-R0-EXECUTION-OBLIGATION-PROPAGATION",
			title:
				"ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01 — R0 execution-obligation propagation",
			description:
				"Classification: `BOUNDED DEFECT CANDIDATE`, `SYNTHETIC_REAL / REAL_PRODUCTION_SEAM`, but NOT demonstrated as cause of the intermittent approval-card bug — `…CORRECTION02` is the owner of THAT live investigation; this is a sibling candidate, NOT bundled into CORRECTION02.",
			workstream: "safe-yolo-seatbelt",
			original_status: "DEFER / NOT_STARTED / RECON_REQUIRED",
			lifecycle: "DEFERRED",
			priority: "P1",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [],
			source_refs: [{ path: SAFE, lines: [159, 172] }],
		},
		{
			item_id: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT/NETWORK-POLICY-HARDENING",
			title: "Network-policy hardening / allowlisting (post-V1)",
			description:
				"Post-V1 network-policy hardening and allowlisting. The board's Deferred / hold table records this item as consciously postponed; the epic detail file carries the WHY.",
			workstream: "safe-yolo-seatbelt",
			original_status: "DEFER",
			lifecycle: "DEFERRED",
			priority: "P0",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "UNKNOWN",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [],
			source_refs: [{ path: BOARD, lines: [9435, 9435] }],
		},
	],
};
