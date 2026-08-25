// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION03 --
// LIVE QUALIFICATION (C6 of the parent ACT).
//
// IMPORTANT: this test drives evaluateCommandPolicy directly with a
// production-shaped host authorization. It is REAL_PRODUCTION_POLICY_SEAM
// evidence for the CORRECTION03 disposition. It is NOT a substitute for
// LIVE installed UX; the TRUE live installed UX evidence is the seatbelt
// c3-real-kernel suite from the predecessor ACT
// (ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01).

import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy } from "./command-policy";
import { commandHostAuthorization } from "./command-policy-types";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import type { TempAuthorityEvidence } from "./command-policy-types";

const DARWIN_BSD_EVIDENCE: TempAuthorityEvidence = {
  platform: "darwin",
  executablePath: "/usr/bin/mktemp",
  executableRealpath: "/usr/bin/mktemp",
  darwinUserTempRoot: "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
  canonicalDarwinUserTempRoot:
    "/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
};

const baseAllow = () =>
  commandHostAuthorization({
    mode: "safe-only",
    explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
  });

describe("C6 LIVE QUALIFICATION: explicit-path-bound mktemp (CORRECTION03)", () => {
  describe("RED REPROOF P0-3 (shell function / BASH_ENV shadow): bare form -> ASK with shell_resolution_unbound", () => {
    // The bare form has no slash in the command name. Bash will
    // perform shell-function -> builtin -> PATH lookup. The
    // policy cannot prove the executed identity, so the gate
    // fails closed with a distinct source label.
    it("bare `mktemp` -> ASK with host_mktemp_shell_resolution_unbound", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_shell_resolution_unbound");
    });
    it("bare `mktemp -d` -> ASK with host_mktemp_shell_resolution_unbound", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp -d" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_shell_resolution_unbound");
    });
  });

  describe("RED REPROOF P0-1 (os.tmpdir steering) + P0-2 (PATH shadow): still ASK", () => {
    it("PATH-shadowed executable identity -> ASK with executable_identity_unbound", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "/usr/bin/mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "darwin",
            executablePath: "/run/current-system/sw/bin/mktemp",
            executableRealpath:
              "/nix/store/8xhvpkpg6gbm9q0sk2p3hf6nj9fzgr3n-coreutils-9.8/bin/coreutils",
            darwinUserTempRoot: "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
            canonicalDarwinUserTempRoot:
              "/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
          },
        },
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe(
        "host_mktemp_executable_identity_unbound",
      );
    });
    it("missing evidence -> ASK with temp_authority_unbound", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "/usr/bin/mktemp" },
        hostAuthorization: baseAllow(),
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
    });
  });

  describe("GREEN PROOF: darwin host WITH explicit-path identity + true Darwin root -> AUTO", () => {
    it("auto-approves /usr/bin/mktemp on darwin with /usr/bin/mktemp identity", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "/usr/bin/mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("allow");
      expect(r.decision.matchedRuleSource).toBe(
        "host_safe_mktemp_default_temp",
      );
    });
    it("auto-approves /usr/bin/mktemp -d on darwin with /usr/bin/mktemp identity", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "/usr/bin/mktemp -d" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("allow");
      expect(r.decision.matchedRuleSource).toBe(
        "host_safe_mktemp_default_temp",
      );
    });
  });

  describe("CONSERVATION: negative forms remain ASK with darwin+evidence", () => {
    it("/usr/bin/mktemp -u is ASK", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "/usr/bin/mktemp -u" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("ask");
    });
    it("/usr/bin/mktemp foo.XXXXXX is ASK", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "/usr/bin/mktemp foo.XXXXXX" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("ask");
    });
    it("TMPDIR=/x /usr/bin/mktemp is ASK", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "TMPDIR=/x /usr/bin/mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("ask");
    });
  });
});
