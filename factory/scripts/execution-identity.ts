#!/usr/bin/env bun
/** Independent renderer-side Git object verification for evidence identity. */

import { spawnSync } from "node:child_process";
import type { ExecutionIdentityDerivation } from "./baseline-closure";

const OID_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Resolve the recorded execution identity against the repository object
 * database. This deliberately does not consume the runner's boolean assertion.
 */
export function deriveExecutionIdentity(
	root: string,
	executionHeadOid: unknown,
	executionTreeOid: unknown,
): ExecutionIdentityDerivation {
	if (
		typeof executionHeadOid !== "string" ||
		typeof executionTreeOid !== "string" ||
		!OID_PATTERN.test(executionHeadOid) ||
		!OID_PATTERN.test(executionTreeOid)
	) {
		return {
			executionHeadExists: false,
			executionTreeExists: false,
			derivedTreeOid: null,
		};
	}

	const resolvedHead = revParseVerify(root, `${executionHeadOid}^{commit}`);
	const resolvedTree = revParseVerify(root, `${executionTreeOid}^{tree}`);
	const derivedTree = revParseVerify(root, `${executionHeadOid}^{tree}`);

	return {
		executionHeadExists: resolvedHead !== null,
		executionTreeExists: resolvedTree !== null,
		derivedTreeOid: derivedTree,
	};
}

function revParseVerify(root: string, expression: string): string | null {
	const result = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", expression], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) return null;
	const oid = (result.stdout ?? "").trim();
	return OID_PATTERN.test(oid) ? oid : null;
}
