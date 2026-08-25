import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy } from "./command-policy";
import { commandHostAuthorization } from "./command-policy-types";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import type { TempAuthorityEvidence } from "./command-policy-types";

// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION03
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

describe("CORRECTION03: explicit-path-bound mktemp policy seam", () => {
  describe("darwin host WITH /usr/bin/mktemp identity + true Darwin root -> AUTO for explicit-path positive forms", () => {
    const POSITIVE: ReadonlyArray<string> = [
      "/usr/bin/mktemp",
      "/usr/bin/mktemp -d",
      "  /usr/bin/mktemp  ",
      "/usr/bin/mktemp   -d",
      "/usr/bin/mktemp\t-d",
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

  describe("BARE `mktemp` and `mktemp -d` -> ASK with host_mktemp_shell_resolution_unbound", () => {
    // CORRECTION03: bash's lookup order is shell-function ->
    // builtin -> PATH. The bare form can be shadowed by an
    // exported shell function or BASH_ENV startup file. Slash-
    // bypass is the only way to bind policy-time identity to
    // execution-time identity without executor changes.
    const BARE: ReadonlyArray<string> = [
      "mktemp",
      "mktemp -d",
      "  mktemp  ",
      "mktemp\t-d",
      "mktemp  -d",
    ];
    for (const cmd of BARE) {
      it(`falls back to ASK with shell-resolution-unbound: ${JSON.stringify(cmd)}`, () => {
        const r = evaluateCommandPolicy({
          toolInput: { command: cmd },
          hostAuthorization: {
            ...baseAllow(),
            tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
          },
        });
        expect(r.decision.kind).toBe("ask");
        expect(r.decision.source).toBe(
          "host_mktemp_shell_resolution_unbound",
        );
      });
    }
  });

  describe("darwin host WITHOUT evidence -> ASK with host_mktemp_temp_authority_unbound", () => {
    const POSITIVE: ReadonlyArray<string> = ["/usr/bin/mktemp", "/usr/bin/mktemp -d"];
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
        toolInput: { command: "/usr/bin/mktemp" },
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
    it("rejects empty executableRealpath", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "/usr/bin/mktemp" },
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

  describe("darwin host with empty temp root -> ASK with host_mktemp_temp_authority_unbound", () => {
    it("rejects empty darwinUserTempRoot", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "/usr/bin/mktemp" },
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
        toolInput: { command: "/usr/bin/mktemp -d" },
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

  describe("darwin host WITH evidence + negative forms -> ASK or DENY", () => {
    const NEGATIVE: ReadonlyArray<string> = [
      // -u / -p / -t variants (lexical reject)
      "/usr/bin/mktemp -u",
      "/usr/bin/mktemp -p /tmp",
      "/usr/bin/mktemp -t myprefix",
      // template operand
      "/usr/bin/mktemp foo.XXXXXX",
      // other flags
      "/usr/bin/mktemp -q",
      // compose / opaque
      "/usr/bin/mktemp && pwd",
      "/usr/bin/mktemp | head",
      "/usr/bin/mktemp > /tmp/x",
      "/usr/bin/mktemp 2>/dev/null",
      "$(/usr/bin/mktemp)",
      // env steering
      "TMPDIR=/x /usr/bin/mktemp",
      "env TMPDIR=/x /usr/bin/mktemp",
      // dynamic operand
      '/usr/bin/mktemp "$X"',
      "/usr/bin/mktemp ${X}",
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
