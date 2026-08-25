import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy } from "./command-policy";
import { commandHostAuthorization } from "./command-policy-types";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";

const HOST_AUTH = commandHostAuthorization({
  mode: "safe-only",
  explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

describe("LIVE GREEN: mktemp at command-policy seam after C2 (current exact-head)", () => {
  const POSITIVE: ReadonlyArray<string> = ["mktemp", "mktemp -d", "  mktemp  ", "mktemp   -d"];
  for (const cmd of POSITIVE) {
    it(`auto-approves: ${JSON.stringify(cmd)}`, () => {
      const d = evaluateCommandPolicy({
        toolInput: { command: cmd },
        hostAuthorization: HOST_AUTH,
      });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        cmd,
        decisionKind: d.decision.kind,
        decisionSource: d.decision.source,
        matchedRuleSource: d.decision.matchedRuleSource,
        firstCommandMatchedRuleSource: d.commands[0]?.matchedRuleSource,
      }));
      expect(d.decision.kind, `expected allow for ${cmd}`).toBe("allow");
      expect(d.decision.kind, `expected allow for ${cmd}`).toBe("allow");
      expect(d.decision.matchedRuleSource, `expected matchedRuleSource=host_safe_mktemp_default_temp for ${cmd}`).toBe(
        "host_safe_mktemp_default_temp",
      );
    });
  }

  const NEGATIVE: ReadonlyArray<string> = [
    "mktemp -u",
    "mktemp foo.XXXXXX",
    "mktemp -p /tmp",
    "mktemp -p /tmp foo.XXXX",
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
      const d = evaluateCommandPolicy({
        toolInput: { command: cmd },
        hostAuthorization: HOST_AUTH,
      });
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        cmd,
        decisionKind: d.decision.kind,
        decisionSource: d.decision.source,
      }));
      expect(d.decision.kind, `must NOT allow ${cmd}`).not.toBe("allow");
    });
  }
});
