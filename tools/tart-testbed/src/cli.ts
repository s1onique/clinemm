/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — CLI (C14)
 *
 * Usage:
 *   clinemm-testbed run <spec.json> [--out <dir>] [--backend fake|tart]
 *   clinemm-testbed validate <spec.json>
 *   clinemm-testbed doctor
 *
 * Default backend is 'fake' (deterministic, no VM launched).
 * doctor emits a JSON readiness report without creating any VM.
 */

import { readFileSync } from "node:fs";
import { argv, exit, stdout, stderr } from "node:process";
import { spawn as bunSpawn } from "bun";
import {
  classifyHostPure,
  FakeProcessRunner,
  FakeTestbedBackend,
  RealProcessRunner,
  TartBackend,
  TestbedOrchestrator,
  validateImageRef,
  type HostClassification,
  type TestbedSpec,
} from "./index.ts";

function usage(): never {
  stdout.write(
    [
      "clinemm-testbed — ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01",
      "",
      "Usage:",
      "  clinemm-testbed run <spec.json> [--out <dir>] [--backend fake|tart] [--allow-vm]",
      "  clinemm-testbed validate <spec.json>",
      "  clinemm-testbed doctor",
      "",
      "Default backend is 'fake' (deterministic, no VM launched).",
      "Pass --allow-vm to actually shell out to the Tart CLI. The substrate ACT forbids this on closure.",
      "",
    ].join("\n"),
  );
  exit(2);
}

function parseArgs(): { subcommand: string; positional: string[]; flags: Record<string, string> } {
  const a = argv.slice(2);
  if (a.length === 0) usage();
  const subcommand = a[0];
  if (subcommand === undefined) usage();
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 1; i < a.length; i++) {
    const tok = a[i];
    if (tok === undefined) continue;
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq >= 0) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else {
        const key = tok.slice(2);
        const next = a[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = "true";
        }
      }
    } else {
      positional.push(tok);
    }
  }
  return { subcommand, positional, flags };
}

async function probeBinary(name: string): Promise<boolean> {
  try {
    const r = bunSpawn({
      cmd: ["/usr/bin/which", name],
      stdout: "pipe",
      stderr: "pipe",
    });
    const txt = await new Response(r.stdout as ReadableStream).text();
    await r.exited;
    return r.exitCode === 0 && txt.trim().length > 0;
  } catch {
    return false;
  }
}

async function classifyHost(): Promise<HostClassification> {
  const [tartAvail, sshAvail] = await Promise.all([probeBinary("tart"), probeBinary("ssh")]);
  return classifyHostPure({
    os: process.platform,
    arch: process.arch,
    tartAvailable: tartAvail,
    sshAvailable: sshAvail,
  });
}
async function doctor(): Promise<void> {
  const host = await classifyHost();
  const out = {
    schemaVersion: 1,
    host,
    notes: host.supported
      ? "host supported; `tart run` should work for darwin-arm64"
      : "host NOT supported by this substrate; use FakeBackend for unit tests",
  };
  stdout.write(JSON.stringify(out, null, 2) + "\n");
  exit(0);
}

function loadSpec(path: string): TestbedSpec {
  const txt = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(txt);
  } catch (e) {
    stderr.write(`[clinemm-testbed] invalid JSON in ${path}: ${(e as Error).message}\n`);
    exit(2);
  }
  if (typeof parsed !== "object" || parsed === null) {
    stderr.write(`[clinemm-testbed] spec is not an object\n`);
    exit(2);
  }
  const obj = parsed as { image?: unknown; commands?: unknown };
  if (typeof obj.image !== "string") {
    stderr.write(`[clinemm-testbed] spec.image must be a string\n`);
    exit(2);
  }
  if (obj.commands !== undefined && !Array.isArray(obj.commands)) {
    stderr.write(`[clinemm-testbed] spec.commands must be an array\n`);
    exit(2);
  }
  return parsed as TestbedSpec;
}

function validateSpec(spec: TestbedSpec): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const iv = validateImageRef(spec.image);
  if (!iv.ok) errors.push(iv.error);
  if (spec.commands === undefined || spec.commands.length === 0) {
    errors.push("spec.commands must be a non-empty array");
  } else {
    for (let i = 0; i < spec.commands.length; i++) {
      const c = spec.commands[i];
      if (c === undefined) continue;
      if (!Array.isArray(c.argv) || c.argv.length === 0) {
        errors.push(`commands[${i}].argv must be a non-empty array`);
      } else {
        for (let j = 0; j < c.argv.length; j++) {
          if (typeof c.argv[j] !== "string") errors.push(`commands[${i}].argv[${j}] must be a string`);
        }
      }
    }
  }
  if (spec.artifacts !== undefined) {
    for (let i = 0; i < spec.artifacts.length; i++) {
      const a = spec.artifacts[i];
      if (a === undefined) continue;
      if (typeof a.guestPath !== "string") errors.push(`artifacts[${i}].guestPath must be a string`);
      if (typeof a.hostDestination !== "string") errors.push(`artifacts[${i}].hostDestination must be a string`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export type CliRunnerKind = "fake" | "tart" | "rejected";

export interface CliRunnerWiring {
  readonly kind: CliRunnerKind;
  readonly proc: FakeProcessRunner | RealProcessRunner;
  readonly backend: FakeTestbedBackend | TartBackend;
  /** Only set when kind === "rejected". */
  readonly rejectReason?: string;
}

/**
 * CORRECTION01: extract the (backendKind, allowVm, host) →
 * (proc, backend) decision so it is testable in isolation.
 * Real Tart MUST get RealProcessRunner + TartBackend; the fake
 * default MUST stay on FakeProcessRunner + FakeTestbedBackend.
 */
export function selectCliRunner(
  backendKind: "fake" | "tart",
  allowVm: boolean,
  host: HostClassification,
): CliRunnerWiring {
  if (backendKind === "tart" && !allowVm) {
    return {
      kind: "rejected",
      proc: new FakeProcessRunner([], { strict: false }),
      backend: new FakeTestbedBackend(),
      rejectReason:
        "--backend tart requires --allow-vm to actually shell out to tart; the substrate ACT forbids VM launch on closure. Re-run with --allow-vm on a supported host, or use --backend fake.",
    };
  }
  if (backendKind === "tart" && !host.supported) {
    return {
      kind: "rejected",
      proc: new FakeProcessRunner([], { strict: false }),
      backend: new FakeTestbedBackend(),
      rejectReason: `host not supported by real Tart: os=${host.os} arch=${host.arch} tartAvailable=${host.tartAvailable} sshAvailable=${host.sshAvailable}`,
    };
  }
  if (backendKind === "tart") {
    return {
      kind: "tart",
      proc: new RealProcessRunner(),
      backend: new TartBackend(),
    };
  }
  return {
    kind: "fake",
    proc: new FakeProcessRunner(
      [
        { argvPrefix: ["fake-stop"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
        { argvPrefix: ["fake-delete"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
        { argvPrefix: ["fake-copy-in"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
        { argvPrefix: ["fake-copy-out"], result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
        { result: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 } },
      ],
      { strict: false },
    ),
    backend: new FakeTestbedBackend(),
  };
}

async function runSpec(spec: TestbedSpec, backendKind: "fake" | "tart", outDir: string | undefined, allowVm: boolean): Promise<void> {
  const host = await classifyHost();
  const wiring = selectCliRunner(backendKind, allowVm, host);
  if (wiring.kind === "rejected") {
    stderr.write(`[clinemm-testbed] ${wiring.rejectReason}\n`);
    exit(2);
  }
  const orch = new TestbedOrchestrator({
    backend: wiring.backend,
    processRunner: wiring.proc,
    outputDir: outDir,
    host,
  });
  const result = await orch.run(spec);
  stdout.write(JSON.stringify(result, null, 2) + "\n");
  exit(result.overallStatus === "PASS" || result.overallStatus === "KEEP_VM" ? 0 : 1);
}

export async function main(): Promise<void> {
  const { subcommand, positional, flags } = parseArgs();
  if (subcommand === "doctor") return doctor();
  if (subcommand === "validate") {
    const p = positional[0];
    if (p === undefined) usage();
    const spec = loadSpec(p);
    const r = validateSpec(spec);
    if (r.ok) {
      stdout.write(JSON.stringify({ ok: true }, null, 2) + "\n");
      exit(0);
    }
    stdout.write(JSON.stringify({ ok: false, errors: r.errors }, null, 2) + "\n");
    exit(1);
  }
  if (subcommand === "run") {
    const p = positional[0];
    if (p === undefined) usage();
    const spec = loadSpec(p);
    const v = validateSpec(spec);
    if (!v.ok) {
      stderr.write(`[clinemm-testbed] invalid spec:\n${v.errors.join("\n")}\n`);
      exit(2);
    }
    const backendKind = (flags.backend ?? "fake") as "fake" | "tart";
    const outDir = flags.out;
    const allowVm = flags["allow-vm"] === "true";
    return runSpec(spec, backendKind, outDir, allowVm);
  }
  usage();
}

if (import.meta.main) {
  void main();
}
