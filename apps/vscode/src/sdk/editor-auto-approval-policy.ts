/**
 * =============================================================================
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 — PHASE 2
 * =============================================================================
 *
 * Pure, no-I/O edit-tool auto-approval policy lattice.
 *
 * Contract (per phase0-reconfirmation.md §3):
 *
 *   evaluateEditAutoApproval({ editFiles, editFilesExternally, classification })
 *     -> { kind: "allow" } | { kind: "ask"; reason }
 *
 * No filesystem access in this function. The classification evidence is
 * produced by `classifyEditTarget` in `./editor-path-authority.ts` and passed
 * in as an immutable value.
 *
 * Required deterministic cases (6-row lattice):
 *
 *   | base edit | class       | external | result |
 *   | --------- | ----------- | -------- | ------ |
 *   | false     | inside      | any      | ASK    |
 *   | false     | outside     | any      | ASK    |
 *   | true      | inside      | any      | ALLOW  |
 *   | true      | outside     | false    | ASK    |
 *   | true      | outside     | true     | ALLOW  |
 *   | any       | unavailable | any      | ASK    |
 *
 * This lattice is the SINGLE source of truth for editor / apply_patch
 * auto-approval decisions. The coordinator's existing `shouldAutoApproveTool`
 * callback returns the same lattice verdict when the tool is on the
 * CURRENT INCLUDED SURFACE (editor + apply_patch) and the caller has
 * classified the effective target.
 *
 * The legacy edit-tool names (replace_in_file / write_to_file / delete_file)
 * are deliberately NOT routed through this lattice. They keep their existing
 * `!!settings.actions.editFiles` policy. The ACT does NOT claim target-aware
 * parity for those legacy names (see phase0-reconfirmation.md §1.6).
 */

export type EditTargetClassification = "inside" | "outside" | "unavailable"

export interface EditApprovalContext {
	editFiles: boolean
	editFilesExternally: boolean
	classification: EditTargetClassification
}

export interface EditApprovalSettings {
	editFiles: boolean
	editFilesExternally: boolean
}

export type EditApprovalDecision = { kind: "allow" } | { kind: "ask"; reason: string }

/**
 * Extract the set of absolute target paths that participate in an editor /
 * apply_patch call's effective-destination authority.
 *
 * For `editor`, returns [input.path].
 * For `apply_patch`, returns the union of:
 *   - the record-key `sourcePath` for every action (Update/Add/Delete)
 *   - the action `movePath` when present (move destination)
 * If the input shape is unrecognised (frozen contract violation), returns [].
 *
 * The returned paths are exactly the strings the tool intends to read or
 * write. They are NOT yet canonicalized; the classifier is responsible for
 * realpath canonicalization + workspace-root containment.
 */
export function extractEditTargets(toolName: string, input: unknown): string[] {
	if (toolName === "editor") {
		return extractEditorInputPath(input)
	}
	if (toolName === "apply_patch") {
		return extractApplyPatchTargets(input)
	}
	return []
}

function extractEditorInputPath(input: unknown): string[] {
	if (typeof input !== "object" || input === null) return []
	const rec = input as Record<string, unknown>
	const p = rec.path
	if (typeof p === "string" && p.length > 0) return [p]
	return []
}

/**
 * Textual extraction of target paths from the apply_patch grammar. We do not
 * parse chunks (that requires `currentFiles`); we only enumerate the file
 * markers (`*** Update File:`, `*** Add File:`, `*** Delete File:`,
 * `*** Move to:`). For each `Update File:` action we record both the source
 * path (record-key) and the following `*** Move to:` destination, when
 * present. This is the load-bearing enumeration frozen in phase0
 * reconfirmation §1.2.
 */
function extractApplyPatchTargets(input: unknown): string[] {
	const text = extractApplyPatchText(input)
	if (text === undefined) return []

	const targets: string[] = []
	const lines = text.split(/\r?\n/)
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ""
		const trimmed = line.trim()
		// Skip non-marker comment lines and section headers (`@@`).
		if (trimmed.startsWith("*** Begin Patch")) continue
		if (trimmed.startsWith("*** End Patch")) continue
		if (trimmed.startsWith("*** End of File")) continue
		if (trimmed.startsWith("@@")) continue

		const upd = markerPath(line, "*** Update File: ")
		if (upd !== undefined) {
			targets.push(upd)
			// Look ahead for `*** Move to: ` on the immediately following
			// non-empty marker line. This is the load-bearing movePath
			// enumeration — without it an inside source moved outside would
			// be silently auto-approved.
			for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
				const next = lines[j] ?? ""
				const nextTrim = next.trim()
				if (nextTrim.startsWith("@@")) continue
				const move = markerPath(next, "*** Move to: ")
				if (move !== undefined) {
					targets.push(move)
				}
				break
			}
			continue
		}

		const add = markerPath(line, "*** Add File: ")
		if (add !== undefined) {
			targets.push(add)
			continue
		}

		const del = markerPath(line, "*** Delete File: ")
		if (del !== undefined) {
			targets.push(del)
		}
	}
	return targets
}

function extractApplyPatchText(input: unknown): string | undefined {
	if (typeof input === "string") return input
	if (typeof input !== "object" || input === null) return undefined
	const rec = input as Record<string, unknown>
	const inner = rec.input
	if (typeof inner === "string") return inner
	return undefined
}

function markerPath(line: string, marker: string): string | undefined {
	const trimmed = line.trim()
	if (!trimmed.startsWith(marker)) return undefined
	const p = trimmed.substring(marker.length).trim()
	return p.length > 0 ? p : undefined
}

export function evaluateEditAutoApproval(ctx: EditApprovalContext): EditApprovalDecision {
	// UNAVAILABLE: fail closed (ASK). Even an explicit `editFilesExternally=true`
	// cannot rescue us — we have no evidence to evaluate.
	if (ctx.classification === "unavailable") {
		return {
			kind: "ask",
			reason: "editor: target classification unavailable (fail closed)",
		}
	}

	// editFiles=false always ASK regardless of target.
	if (!ctx.editFiles) {
		return {
			kind: "ask",
			reason: "editor: editFiles toggle is off",
		}
	}

	// editFiles=true. The classification dimension is now load-bearing.
	if (ctx.classification === "inside") {
		return { kind: "allow" }
	}

	// classification === "outside".
	if (ctx.editFilesExternally) {
		return { kind: "allow" }
	}

	return {
		kind: "ask",
		reason: "editor: target is outside the workspace and editFilesExternally is off",
	}
}
