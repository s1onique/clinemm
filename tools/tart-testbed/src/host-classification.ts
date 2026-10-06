/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — C15 (Host compatibility)
 *
 * Tart is Apple-Silicon/macOS-specific (Virtualization.framework).
 * The CLI must classify unsupported hosts cleanly without stack
 * traces. We surface a structured `HostClassification` so the
 * orchestrator can emit `TESTBED_UNAVAILABLE` and so `doctor`
 * reports a bounded reason.
 *
 * This module is PURE — it does not shell out to probe Tart. The
 * caller supplies the `which("tart")` boolean. The orchestrator
 * wires a `ProcessRunner` for that probe so unit tests stay
 * deterministic.
 */

import type { HostClass, HostClassification } from "./types.ts";

/**
 * Classify the host without touching the filesystem or subprocess.
 * `arch` is the JS `process.arch` value (arm64/x64/etc).
 */
export function classifyHostPure(args: {
  os: NodeJS.Platform;
  arch: string;
  tartAvailable: boolean;
  sshAvailable: boolean;
}): HostClassification {
  const os = args.os;
  const arch = args.arch;
  const cls: HostClass = ((): HostClass => {
    if (os === "darwin" && arch === "arm64") return "darwin-arm64";
    if (os === "darwin" && arch === "x64") return "darwin-x64";
    if (os === "linux" && arch === "x64") return "linux-x64";
    if (os === "linux" && arch === "arm64") return "linux-arm64";
    return "other";
  })();

  // Tart supports darwin-arm64 (Apple Silicon). Anything else is
  // unsupported in this substrate ACT — we deliberately do NOT
  // add a Lima backend, etc.
  let supported = false;
  let reason: string | undefined;
  if (cls !== "darwin-arm64") {
    reason = `Tart runs macOS guests on Apple Silicon via Virtualization.framework; detected host ${os}/${arch} is not supported by this substrate`;
  } else if (!args.tartAvailable) {
    reason = `tart executable not found on PATH`;
  } else if (!args.sshAvailable) {
    reason = `ssh executable not found on PATH; the testbed needs ssh to drive the guest`;
  } else {
    supported = true;
  }

  const out: HostClassification = {
    os,
    arch,
    class: cls,
    tartAvailable: args.tartAvailable,
    sshAvailable: args.sshAvailable,
    supported,
  };
  if (!supported && reason !== undefined) {
    return { ...out, reason };
  }
  return out;
}