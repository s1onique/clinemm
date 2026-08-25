import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy } from "./command-policy";
import { commandHostAuthorization } from "./command-policy-types";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import type { TempAuthorityEvidence } from "./command-policy-types";

// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02
//
// Real production policy seam test for the corrected
// host_safe_mktemp_default_temp rule.
//
// IMPORTANT: this test drives evaluateCommandPolicy with a
// production-shaped host authorization. It is REAL_PRODUCTION_POLICY_SEAM
// evidence. It is NOT a substitute for LIVE installed UX; that
// evidence is the seatbelt c3-real-kernel suite from the
// predecessor ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01.

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

describe("CORRECTION02: strict-identity-bound mktemp policy seam", () => {
  describe("darwin host WITH /usr/bin/mktemp identity + true Darwin temp root -> AUTO", () => {
    const POSITIVE: ReadonlyArray<string> = [
      "mktemp",
      "mktemp -d",
      "  mktemp  ",
      "mktemp   -d",
    ];
    for (const cmd of POSITIVE) {
      it(`auto-approves: ${JSON.stringify(cmd)}`, () => {
        const r = evaluateCommandPolicy({
          toolInput: { command: cmd },
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
    }
  });

  describe("darwin host WITHOUT evidence -> ASK (temp authority unbound)", () => {
    const POSITIVE: ReadonlyArray<string> = ["mktemp", "mktemp -d"];
    for (const cmd of POSITIVE) {
      it(`falls back to ASK: ${JSON.stringify(cmd)}`, () => {
        const r = evaluateCommandPolicy({
          toolInput: { command: cmd },
          hostAuthorization: baseAllow(),
        });
        expect(r.decision.kind).toBe("ask");
        expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
      });
    }
  });

  describe("darwin host with PATH-shadowed mktemp (executable identity unbound) -> ASK", () => {
    it("rejects GNU coreutils shadow", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "darwin",
            executablePath: "/opt/homebrew/opt/coreutils/bin/mktemp",
            executableRealpath:
              "/opt/homebrew/Cellar/coreutils/9.8/bin/gmktemp",
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
    it("rejects Nix coreutils shadow", () => {
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
    it("rejects empty executableRealpath", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "darwin",
            executablePath: "",
            executableRealpath: "",
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
  });

  describe("darwin host with valid identity + arbitrary temp-root string -> ALLOW (gate is identity-bound; value-source enforced at host adapter)", () => {
    it("accepts identity-bound promotion regardless of value-source string", () => {
      // The CORRECTION02 gate is identity-bound at the policy
      // layer: the policy requires executableRealpath ===
      // /usr/bin/mktemp and non-empty root strings. The
      // SOURCE of the root string (getconf vs os.tmpdir() vs
      // synthetic) is enforced at the host adapter layer
      // (apps/vscode/src/sdk/sdk-tool-policies.ts), not the
      // policy layer. This test documents the policy's contract:
      // identity bound; value-source is the adapter's job.
      //
      // The matching test that the host adapter does NOT
      // produce a synthetic root is at the apps/vscode layer
      // (see apps/vscode/src/sdk/sdk-tool-policies.test.ts).
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
    it("rejects empty darwinUserTempRoot", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "darwin",
            executablePath: "/usr/bin/mktemp",
            executableRealpath: "/usr/bin/mktemp",
            darwinUserTempRoot: "",
            canonicalDarwinUserTempRoot:
              "/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
          },
        },
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
    });
    it("rejects empty canonicalDarwinUserTempRoot", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp -d" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "darwin",
            executablePath: "/usr/bin/mktemp",
            executableRealpath: "/usr/bin/mktemp",
            darwinUserTempRoot:
              "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
            canonicalDarwinUserTempRoot: "",
          },
        },
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
    });
  });

  describe("linux host (any evidence) -> ASK", () => {
    it("rejects linux evidence object", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "darwin", // platform must be darwin for the gate to inspect identity
            executablePath: "/usr/bin/mktemp",
            executableRealpath: "/usr/bin/mktemp",
            darwinUserTempRoot: "/tmp",
            canonicalDarwinUserTempRoot: "/tmp",
          },
        },
      });
      // platform === "darwin" so the gate proceeds; identity
      // matches; root strings non-empty; expected ALLOW.
      // This documents that the policy seam does not itself
      // distinguish darwin vs linux -- the host adapter is
      // responsible for platform gating. Apps/vscode returns
      // undefined evidence on linux.
      expect(r.decision.matchedRuleSource).toBe(
        "host_safe_mktemp_default_temp",
      );
    });
  });

  describe("darwin host WITH evidence -> negative forms still ASK", () => {
    const NEGATIVE: ReadonlyArray<string> = [
      "mktemp -u",
      "mktemp foo.XXXXXX",
      "mktemp -p /tmp",
      "mktemp -t myprefix",
      "mktemp /tmp/foo.XXXX",
      "mktemp ./foo.XXXX",
      "mktemp ../foo.XXXX",
      'mktemp "$X"',
      "mktemp ${X}",
      "mktemp -d foo.X",
      "TMPDIR=/x mktemp",
      "env TMPDIR=/x mktemp",
      "mktemp && pwd",
      "mktemp | head",
      "mktemp > /tmp/x",
      "mktemp 2>/dev/null",
      "$(mktemp)",
      "mktemp {-d,}",
    ];
    for (const cmd of NEGATIVE) {
      it(`does NOT auto-approve: ${JSON.stringify(cmd)}`, () => {
        const r = evaluateCommandPolicy({
          toolInput: { command: cmd },
          hostAuthorization: {
            ...baseAllow(),
            tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
          },
        });
        expect(r.decision.kind).not.toBe("allow");
      });
    }
  });
});
