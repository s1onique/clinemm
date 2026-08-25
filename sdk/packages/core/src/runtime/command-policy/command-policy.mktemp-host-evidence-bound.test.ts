import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy } from "./command-policy";
import { commandHostAuthorization } from "./command-policy-types";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import type { TempAuthorityEvidence } from "./command-policy-types";

// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01
//
// Real production policy seam test for the corrected
// host_safe_mktemp_default_temp rule.
//
// IMPORTANT: this test drives evaluateCommandPolicy with a
// production-shaped host authorization. It is REAL_PRODUCTION_POLICY_SEAM
// evidence. It is NOT a substitute for LIVE installed UX; that
// evidence is the seatbelt c3-real-kernel suite from the
// predecessor ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01.

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

describe("CORRECTION01: host-evidence-bound mktemp policy seam", () => {
  describe("darwin host WITH evidence -> AUTO", () => {
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
            tempAuthorityEvidence: DARWIN_EVIDENCE,
          },
        });
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            phase: "CORRECTION01-darwin",
            cmd,
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
    }
  });

  describe("darwin host WITHOUT evidence -> ASK", () => {
    const POSITIVE: ReadonlyArray<string> = ["mktemp", "mktemp -d"];
    for (const cmd of POSITIVE) {
      it(`falls back to ASK: ${JSON.stringify(cmd)}`, () => {
        const r = evaluateCommandPolicy({
          toolInput: { command: cmd },
          hostAuthorization: baseAllow(),
        });
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            phase: "CORRECTION01-no-evidence",
            cmd,
            decisionKind: r.decision.kind,
            decisionSource: r.decision.source,
          }),
        );
        expect(r.decision.kind).toBe("ask");
        expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
      });
    }
  });

  describe("linux host WITH linux evidence -> ASK (darwin gate rejects)", () => {
    const POSITIVE: ReadonlyArray<string> = ["mktemp", "mktemp -d"];
    for (const cmd of POSITIVE) {
      it(`rejects linux evidence: ${JSON.stringify(cmd)}`, () => {
        const r = evaluateCommandPolicy({
          toolInput: { command: cmd },
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
            phase: "CORRECTION01-linux-evidence",
            cmd,
            decisionKind: r.decision.kind,
            decisionSource: r.decision.source,
          }),
        );
        expect(r.decision.kind).toBe("ask");
        expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
      });
    }
  });

  describe("darwin host WITH malformed evidence -> ASK", () => {
    it("empty effectiveDefaultTempRoot", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "darwin",
            effectiveDefaultTempRoot: "",
            canonicalDefaultTempRoot:
              "/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
          },
        },
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
    });
    it("empty canonicalDefaultTempRoot", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp -d" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "darwin",
            effectiveDefaultTempRoot:
              "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
            canonicalDefaultTempRoot: "",
          },
        },
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
    });
    it("unknown platform", () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: "mktemp" },
        hostAuthorization: {
          ...baseAllow(),
          tempAuthorityEvidence: {
            platform: "unknown",
            effectiveDefaultTempRoot: "/tmp",
            canonicalDefaultTempRoot: "/tmp",
          },
        },
      });
      expect(r.decision.kind).toBe("ask");
      expect(r.decision.source).toBe("host_mktemp_temp_authority_unbound");
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
            tempAuthorityEvidence: DARWIN_EVIDENCE,
          },
        });
        expect(r.decision.kind).not.toBe("allow");
      });
    }
  });
});
