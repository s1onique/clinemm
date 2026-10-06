/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01
 * Test C4 (VM identity) and C17 (hostile name rejection).
 */

import { describe, expect, it } from "bun:test";
import {
  VM_NAME_PREFIX,
  newRunId,
  shortRunSuffix,
  vmNameFor,
  vmOwnedByRun,
} from "../src/vm-identity.ts";

const fixedRandom = (): number => 0; // deterministic for tests

describe("vmNameFor", () => {
  it("includes the run id in the name and stays bounded", () => {
    const name = vmNameFor({ runId: "abc12345", random: fixedRandom });
    expect(name.startsWith(`${VM_NAME_PREFIX}-`)).toBe(true);
    expect(name).toContain("abc12345");
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it("includes the spec.vmNamePrefix when supplied", () => {
    const name = vmNameFor({ runId: "abc12345", vmNamePrefix: "substrate", random: fixedRandom });
    expect(name).toContain("substrate");
  });

  it("truncates oversized spec.vmNamePrefix to fit 63 chars", () => {
    const big = "x".repeat(200);
    const name = vmNameFor({ runId: "abc12345", vmNamePrefix: big, random: fixedRandom });
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it("names are lowercase alnum + dashes (CLI-safe)", () => {
    const name = vmNameFor({ runId: "ABC123", vmNamePrefix: "FOO_BAR", random: fixedRandom });
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("vmOwnedByRun", () => {
  it("accepts names produced by vmNameFor with the same runId", () => {
    const runId = "abc12345";
    const name = vmNameFor({ runId, random: fixedRandom });
    expect(vmOwnedByRun(name, runId)).toBe(true);
  });

  it("rejects names without the canonical prefix", () => {
    expect(vmOwnedByRun("not-clinemm-abc12345-xy", "abc12345")).toBe(false);
  });

  it("rejects names missing the runId segment", () => {
    expect(vmOwnedByRun(`${VM_NAME_PREFIX}-notrun-suffix`, "abc12345")).toBe(false);
  });

  it("rejects empty / non-string input", () => {
    expect(vmOwnedByRun("", "abc12345")).toBe(false);
    // @ts-expect-error testing non-string
    expect(vmOwnedByRun(undefined, "abc12345")).toBe(false);
  });

  it("rejects mismatched runId", () => {
    const name = vmNameFor({ runId: "run-aaa", random: fixedRandom });
    expect(vmOwnedByRun(name, "run-bbb")).toBe(false);
  });
});

describe("random helpers", () => {
  it("shortRunSuffix is 6 chars from the alphabet", () => {
    expect(shortRunSuffix(fixedRandom)).toHaveLength(6);
    expect(shortRunSuffix(fixedRandom)).toMatch(/^[a-z0-9]{6}$/);
  });

  it("newRunId is 12 chars from the alphabet", () => {
    expect(newRunId(fixedRandom)).toHaveLength(12);
    expect(newRunId(fixedRandom)).toMatch(/^[a-z0-9]{12}$/);
  });
});