// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01 --
// LIVE QUALIFICATION (C4 of the parent ACT; CORRECTION01 of C2).
//
// IMPORTANT: this test drives evaluateCommandPolicy directly with a
// production-shaped host authorization. It is REAL_PRODUCTION_POLICY_SEAM
// evidence for the CORRECTION01 disposition. It is NOT a substitute for
// LIVE installed UX; the TRUE live installed UX evidence is the seatbelt
// c3-real-kernel suite from the predecessor ACT
// (ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01).

import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy } from "./command-policy";
import { commandHostAuthorization } from "./command-policy-types";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import type { TempAuthorityEvidence } from "./command-policy-types";

const DARWIN_EVIDENCE: TempAuthorityEvidence = {
  platform: "darwin",
  effectiveDefaultTempRoot: "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
  canonicalDefaultTempRoot:
    "/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
};

const baseAllow = () =>
  commandHostAuthorization({
    mode: "safe-only",
    explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
  });

describe("C4 LIVE QUALIFICATION: mktemp end-to-end policy seam (CORRECTION01)", () => {
  describe("RED REPRO PROOF: lexical mktemp with steering-via-environment is blocked by the host-evidence gate", () => {
    it("darwin host WITHOUT evidence: bare mktemp returns ASK with host_mktemp_temp_authority_unbound", () => {
      // The cross-platform leak (CORRECTION01 RED):
      // - rendered command is exactly "mktemp"
      // - in production, the parent process may have TMPDIR set externally
      // - GNU mktemp honors it; BSD mktemp on darwin ignores it
      // - the lexical rule matches but the host-evidence gate refuses ALLOW
      //   when the host hasn't proven the destination is intrinsically bounded
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: baseAllow(),
      });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          phase: "C4-RED",
          cmd: "mktemp",
          decisionKind: r.decision.kind,
          decisionSource: r.decision.source,
          reason: r.decision.reason,
        }),
      );
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
    });

    it("linux host WITH linux evidence: bare mktemp returns ASK (darwin gate rejects linux evidence)", () => {
      // The darwin-only gate explicitly rejects linux evidence;
      // a Linux host running GNU mktemp cannot promote bare mktemp
      // to ALLOW under this ACT.
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "linux",
            effectiveDefaultTempRoot: "/tmp",
            canonicalDefaultTempRoot: "/tmp",
          },
        },
      });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          phase: "C4-RED-linux",
          cmd: "mktemp",
          decisionKind: r.decision.kind,
          decisionSource: r.decision.source,
        }),
      );
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
    });
  });

  describe("GREEN PROOF: darwin host WITH evidence -> AUTO (bounded destination host-proven)", () => {
    it("auto-approves bare mktemp on darwin with evidence", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_EVIDENCE,
        },
      });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          phase: "C4-GREEN",
          cmd: "mktemp",
          decisionKind: r.decision.kind,
          decisionSource: r.decision.source,
          matchedRuleSource: r.decision.matchedRuleSource,
        }),
      );
      expect(r.decision.kind).toBe("allow");
      expect(r.decision.matchedRuleSource).toBe(
        "host_safe_mktemp_default_temp",
      );
    });

    it("auto-approves bare mktemp -d on darwin with evidence", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp -d" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_EVIDENCE,
        },
      });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          phase: "C4-GREEN",
          cmd: "mktemp -d",
          decisionKind: r.decision.kind,
          decisionSource: r.decision.source,
          matchedRuleSource: r.decision.matchedRuleSource,
        }),
      );
      expect(r.decision.kind).toBe("allow");
      expect(r.decision.matchedRuleSource).toBe(
        "host_safe_mktemp_default_temp",
      );
    });
  });

  describe("CONSERVATION: negative forms remain ASK with darwin evidence", () => {
    it("mktemp -u is ASK", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp -u" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("ask");
    });
    it("mktemp foo.XXXXXX is ASK", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp foo.XXXXXX" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: DARWIN_EVIDENCE,
        },
      });
      expect(r.decision.kind).toBe("ask");
    });
  });
});
