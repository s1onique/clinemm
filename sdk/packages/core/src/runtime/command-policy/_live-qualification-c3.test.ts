import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy } from "./command-policy";
import { commandHostAuthorization } from "./command-policy-types";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";

// LIVE QUALIFICATION (ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-C3)
// Drives evaluateCommandPolicy with the production-shaped host authorization.
// Same configuration as the in-app SDK adapter at executeSafeCommands=true.
const HOST_AUTH = commandHostAuthorization({
  mode: "safe-only",
  explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

describe("C3 LIVE QUALIFICATION: mktemp end-to-end policy seam", () => {
  const POSITIVE: ReadonlyArray<string> = ["mktemp", "mktemp -d"];
  const NEGATIVE: ReadonlyArray<string> = [
    "mktemp -u",
    "mktemp foo.XXXXXX",
    "mktemp -p /tmp",
    "mktemp -t myprefix",
    "mktemp /tmp/foo.XXXX",
    "TMPDIR=/x mktemp",
    "env TMPDIR=/x mktemp",
  ];
  for (const cmd of POSITIVE) {
    it(`auto-approves (Wave-1 positive): ${JSON.stringify(cmd)}`, () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: cmd },
        hostAuthorization: HOST_AUTH,
      });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        phase: "C3-live",
        cmd,
        decisionKind: r.decision.kind,
        decisionSource: r.decision.source,
        matchedRuleSource: r.decision.matchedRuleSource,
        firstCommandMatchedRuleSource: r.commands[0]?.matchedRuleSource,
      }));
      expect(r.decision.kind, `expected allow for ${cmd}`).toBe("allow");
      expect(
        r.decision.matchedRuleSource,
        `expected host_safe_mktemp_default_temp for ${cmd}`,
      ).toBe("host_safe_mktemp_default_temp");
    });
  }

  for (const cmd of NEGATIVE) {
    it(`does NOT auto-approve: ${JSON.stringify(cmd)}`, () => {
      const r = evaluateCommandPolicy({
        toolInput: { command: cmd },
        hostAuthorization: HOST_AUTH,
      });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        phase: "C3-live",
        cmd,
        decisionKind: r.decision.kind,
        decisionSource: r.decision.source,
      }));
      expect(r.decision.kind, `must NOT allow ${cmd}`).not.toBe("allow");
    });
  }
});
