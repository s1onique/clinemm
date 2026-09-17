ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01 -- production-rejection-boundary.md

THE EXACT PATH a user-typed `mktemp` takes through the production
command-policy seam (current exact-head 7f1ff13d9):

  toolInput: { tool: "run_command", params: { command: "mktemp" } }
       |
       v
  evaluateCommandRisk(input) -- public production entry in
                                sdk/packages/core/src/runtime/
                                command-policy/command-risk.ts:324
       |
       v
  evaluateCommandPolicy(...) -- canonical policy composition
                                (V1 lexical / safe-rule lookup)
       |
       v
  normalizeRunCommandsInput(toolInput) -- produces the normalized
                                          command shape
       |
       v
  parseRunCommands(normalized) -- the V1 parser layer that decides
                                  parseConfidence ('failed' here)
       |
       v
  evaluateCommandPolicy.LATE: aggregate = ASK with source = unknown_input
       |
       v
  command-risk.ts:5d: parseConfidence === 'failed' => finalDecision = ASK,
                          finalDisposition = ASK, finalSource = 'risk_parse_failed'
       |
       v
  PRODUCTION POLICY DECISION returned to the host adapter:
    decision = "ask"
    disposition = "ask"
    source = "risk_parse_failed"
    reasons = ["command could not be parsed"]

The user observes this as "mktemp was not auto-approved" because
no positive match was found in V1 safe-rule engine (no rule for
mktemp exists in DEFAULT_COMMAND_HOST_ALLOW_RULES), and the V1
parser layer surfaces a parse-failed ASK fallback rather than
forwarding to V2 (the parser-proven positive-provenance branch).

THE CORE OBSERVATION
====================

Both `mktemp` AND `mktemp -u` AND `mktemp foo.XXXXXX` and all
other variants share the SAME rejection source: 'risk_parse_failed'.
That is because mktemp is not in the V1 safe-rules list. The V1
parser layer has no production mktemp grammar. The classification
delta between "safe mktemp" and "unsafe mktemp" lives entirely in
V1's regex-positive matcher -- which is exactly where this ACT
will insert `host_safe_mktemp_default_temp`.

THE FIX SHAPE
=============

Add a single V1 safe rule:

  {
    source: "host_safe_mktemp_default_temp",
    pattern: /^\s*mktemp(?:\s+-d)?\s*$/u,
  }

Reviewed forms:
  mktemp                    -> match (auto-approve-eligible)
  mktemp -d                 -> match (auto-approve-eligible)

Explicitly NOT matched (remain ASK/DENY in V1):
  mktemp -u                 (unsafe; object disappears after return)
  mktemp -p /tmp ...        (path-steering)
  mktemp -t foo             (template, not a path-steering form alone
                             but Darwin documents template-driven creation)
  mktemp TEMPLATE           (path-steering)
  mktemp "$X"               (dynamic operand)
  mktemp ${X}               (dynamic operand)
  TMPDIR=/... mktemp        (env steering)
  env TMPDIR=/... mktemp    (env steering)
  mktemp -d foo.X           (combined flags + template)
  mktemp 2>/dev/null        (?; regex would match but production rule
                             pass-thru requires no OPAQUE_SHELL_TOKENS;
                             `>` is opaque -- auto-rejected upstream)

The rule's `OPAQUE_SHELL_TOKENS` filter (in findSafeRuleMatch)
already guards all `&&`, `||`, `|`, `;`, `>`, `<`, `$`, `${`
inputs -- so we don't need to write that into the regex.

PARSE_PROVENANCE (the reviewer's question 33):
=============================================

The proposed regex `^\s*mktemp(?:\s+-d)?\s*$` does NOT flatten
dynamic args into `-d` because (a) `findSafeRuleMatch` uses the
rendered surface (not the AST), and (b) the regex's trailing
`\s*$` anchor forbids any additional tokens beyond `-d`.

So:
  mktemp "$FLAGS"      -> OPAQUE `${`, no rule match
  mktemp $FLAGS        -> rendered with $FLAGS value, has
                          alphabetic operator chars, no rule match
  mktemp "$(printf -- -d)"  -> OPAQUE `$(`, no rule match
  mktemp ${FLAGS:-"-d"} -> OPAQUE `${`, no rule match

PARSE_HELPER DELTA:   NONE
SAFE_RULE DELTA:       +1 entry (host_safe_mktemp_default_temp)
PRODUCTION CODE:      command-safe-rules.ts (single regex insert)
PRODUCTION TESTS:     +1 new describe block
                      existing tests untouched
