/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — C4 (VM identity)
 *
 * Tart imposes a length limit on VM names. We therefore generate
 * names that are:
 *   - filesystem/CLI-safe (lowercase alnum + dashes)
 *   - bounded length (max 63 chars total — conservative; matches
 *     POSIX hostname limit)
 *   - deterministic prefix
 *   - random/run-specific suffix
 *   - tagged with the runId so ownership is provable
 *
 * The orchestrator checks every name against
 * `startsWith(runPrefix)` before issuing `tart delete`.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * 6-char [0-9a-z] suffix; 36^6 = ~2.2B combinations — ample for
 * collision resistance within a single ACT run.
 */
export function shortRunSuffix(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return s;
}

/** Random 12-hex runId when the spec doesn't pin one. */
export function newRunId(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 12; i++) {
    s += ALPHABET[Math.floor(random() * 16)];
  }
  return s;
}

/** The canonical VM-name prefix for this substrate. */
export const VM_NAME_PREFIX = "clinemm-testbed";

/**
 * Build a VM name for a given run. Format:
 *
 *   clinemm-testbed-<specPrefix>-<shortRunId>-<suffix>
 *
 * where <specPrefix> is the optional spec.vmNamePrefix (sanitized)
 * or omitted, <shortRunId> is the first 8 hex of the run id, and
 * <suffix> is 6 random [0-9a-z].
 *
 * Total length is bounded to 63 chars (POSIX hostname limit).
 */
export function vmNameFor(spec: {
  runId: string;
  vmNamePrefix?: string;
  random?: () => number;
}): string {
  const rid = sanitizeRunId(spec.runId);
  const random = spec.random ?? Math.random;
  const tail = shortRunSuffix(random);
  const specPart = spec.vmNamePrefix ? `-${sanitizeSpecPrefix(spec.vmNamePrefix)}` : "";
  const full = `${VM_NAME_PREFIX}${specPart}-${rid}-${tail}`;
  if (full.length <= 63) return full;
  // Truncate specPrefix to fit. We keep `clinemm-testbed-` (16) +
  // rid (8) + '-' (1) + tail (6) + '-' (1) = 32 fixed chars.
  const room = 63 - 32;
  const trimmedSpec = spec.vmNamePrefix ? `-${sanitizeSpecPrefix(spec.vmNamePrefix).slice(0, room)}` : "";
  return `${VM_NAME_PREFIX}${trimmedSpec}-${rid}-${tail}`;
}

export function sanitizeSpecPrefix(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function sanitizeRunId(s: string): string {
  // Keep only safe chars; the caller controls the input but the
  // backend refuses to delete anything that doesn't pass this.
  // We strip it (no dashes) so the runId remains a single
  // hyphen-delimited segment of the VM name.
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Returns true iff `candidate` is owned by `runId`. Used before
 * any `tart delete <candidate>` invocation. If false, the backend
 * must emit HALT_TESTBED_VM_OWNERSHIP_UNPROVEN.
 *
 * The ownership check is structural (the name's embedded run-id
 * segment equals the orchestrator's run id) — it does not require
 * any external state.
 */
export function vmOwnedByRun(candidate: string, runId: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const rid = sanitizeRunId(runId);
  if (rid.length === 0) return false;
  // candidate must start with clinemm-testbed- and contain the
  // sanitized runId segment (followed by `-`).
  if (!candidate.startsWith(`${VM_NAME_PREFIX}-`)) return false;
  const after = candidate.slice(`${VM_NAME_PREFIX}-`.length);
  // Find the runId segment as a hyphen-delimited chunk.
  const segs = after.split("-");
  return segs.includes(rid);
}