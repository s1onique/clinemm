/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — C3, C17 (Tart CLI argv)
 *
 * Pure argv-construction functions for every Tart primitive the
 * harness uses. These functions take validated input and return
 * a frozen argv array — no shell interpolation, no I/O, no
 * dependency on a particular `tart` build's flag parser.
 *
 * Tests assert these functions preserve hostile input as ONE argv
 * element (e.g. `foo; rm -rf /` stays as one token).
 *
 * Upstream Tart CLI discovered from openai/tart quick-start and
 * docs (clone, ip, run, stop, delete). Anything beyond this list
 * is out of scope for the substrate ACT.
 */

// =============================================================================
// Image / clone
// =============================================================================

/** `tart clone <image> <vmName>` — clones an image into a new VM. */
export function tartCloneArgv(args: {
  image: string;
  vmName: string;
}): readonly string[] {
  return ["tart", "clone", args.image, args.vmName];
}

// =============================================================================
// Run / stop / delete
// =============================================================================

/**
 * `tart run <vm> [--no-graphics]` — starts the VM in the background.
 * We always use `--no-graphics` because the harness is headless.
 *
 * Note: `tart run` is long-running. The orchestrator spawns it
 * via ProcessRunner.run with timeoutMs = startMs and treats
 * timedOut=true as "VM is running"; the explicit completion
 * signal is `tart ip` returning an address.
 */
export function tartRunArgv(args: {
  vmName: string;
  cpu?: number;
  memoryMiB?: number;
  diskGiB?: number;
  noGraphics?: boolean;
}): readonly string[] {
  const argv: string[] = ["tart", "run"];
  if (args.noGraphics !== false) argv.push("--no-graphics");
  if (typeof args.cpu === "number") argv.push("--cpu", String(args.cpu));
  if (typeof args.memoryMiB === "number") argv.push("--memory", String(args.memoryMiB));
  if (typeof args.diskGiB === "number") argv.push("--disk-size", String(args.diskGiB));
  argv.push(args.vmName);
  return argv;
}

/** `tart stop <vm>` — graceful shutdown. */
export function tartStopArgv(vmName: string): readonly string[] {
  return ["tart", "stop", vmName];
}

/** `tart delete <vm>` — remove VM definition + data. */
export function tartDeleteArgv(vmName: string): readonly string[] {
  return ["tart", "delete", vmName];
}

// =============================================================================
// IP readiness
// =============================================================================

/** `tart ip <vm>` — prints the guest's IP address on stdout. */
export function tartIpArgv(vmName: string): readonly string[] {
  return ["tart", "ip", vmName];
}

/** `tart list` — list all VM names, one per line. */
export function tartListArgv(): readonly string[] {
  return ["tart", "list"];
}

/** `tart --version` — version probe used by `doctor`. */
export function tartVersionArgv(): readonly string[] {
  return ["tart", "--version"];
}

// =============================================================================
// Image validation
// =============================================================================

/**
 * Validate the image reference. We refuse anything that isn't
 * `<repo>[@sha256:<64-hex-digest>]` so the ACT cannot silently
 * drift to `:latest` (the upstream Cirrus base images are
 * published ONLY with `:latest`, so a tag-only reference would
 * silently fetch a new image on every clone).
 *
 * Note: this is a SUBSTRATE validation. Image provenance is the
 * testbed-image contract's problem, not ours. We only enforce the
 * format here.
 */
export function validateImageRef(image: string): { ok: true } | { ok: false; error: string } {
  if (typeof image !== "string" || image.length === 0) {
    return { ok: false, error: "image is empty" };
  }
  if (!/^[a-zA-Z0-9._\-/:]+@sha256:[0-9a-f]{64}$/.test(image)) {
    return {
      ok: false,
      error:
        `image must be 'registry/path@sha256:<64-hex-digest>' (refuses tag-only OCI references); got ${JSON.stringify(image)}`,
    };
  }
  return { ok: true };
}