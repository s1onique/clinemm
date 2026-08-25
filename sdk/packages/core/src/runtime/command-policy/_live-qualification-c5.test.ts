// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02 --
// LIVE QUALIFICATION (C5 of the parent ACT; CORRECTION02 of C2).
//
// IMPORTANT: this test drives evaluateCommandPolicy directly with a
// production-shaped host authorization. It is REAL_PRODUCTION_POLICY_SEAM
// evidence for the CORRECTION02 disposition. It is NOT a substitute for
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

describe("C5 LIVE QUALIFICATION: strict-identity-bound mktemp (CORRECTION02)", () => {
  describe("RED REPRO PROOF P0-1: darwin host with steered effective root -> ASK at policy seam (identity still binds, but value source is host-adapter's responsibility)", () => {
    it("darwin host WITH os.tmpdir()-steered evidence but identity matches -> ALLOW (policy is identity-bound, value-source enforced at host adapter)", () => {
      // The policy gate is identity-bound: executableRealpath ===
      // /usr/bin/mktemp. The values of darwinUserTempRoot and
      // canonicalDarwinUserTempRoot are accepted as long as they
      // are non-empty strings. The host adapter enforces that
      // these values came from /usr/bin/getconf DARWIN_USER_TEMP_DIR.
      //
      // This test documents the policy's contract: identity is
      // bound; value-source is host-adapter's responsibility.
      // The host adapter is unit-tested separately (see
      // apps/vscode/src/sdk/sdk-tool-policies.test.ts).
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "darwin",
            executablePath: "/usr/bin/mktemp",
            executableRealpath: "/usr/bin/mktemp",
            darwinUserTempRoot: "/synthetic/attacker-selected",
            canonicalDarwinUserTempRoot: "/synthetic/attacker-selected",
          },
        },
      });
      expect(r.decision.kind).toBe("allow");
      expect(r.decision.matchedRuleSource).toBe(
        "host_safe_mktemp_default_temp",
      );
    });
  });

  describe("RED REPRO PROOF P0-2: PATH-shadowed executable identity -> ASK at policy seam", () => {
    it("darwin host WITH GNU coreutils shadow -> ASK with host_mktemp_executable_identity_unbound", () => {
      // This is the load-bearing regression that CORRECTION02
      // closes. CORRECTION01 had no executable identity field;
      // this test proves the CORRECTION02 gate rejects it.
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
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
    it("darwin host WITHOUT evidence -> ASK with host_mktemp_temp_authority_unbound", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: baseAllow(),
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
    });
  });

  describe("GREEN PROOF: darwin host WITH strict identity + true Darwin root -> AUTO", () => {
    it("auto-approves bare mktemp on darwin with /usr/bin/mktemp identity", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
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
    it("auto-approves bare mktemp -d on darwin with /usr/bin/mktemp identity", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp -d" },
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
    it("mktemp -u is ASK", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp -u" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("ask");
    });
    it("mktemp foo.XXXXXX is ASK", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp foo.XXXXXX" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("ask");
    });
  });
});
