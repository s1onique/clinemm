# 04 — The behavioural result and the cost

ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01

## The campaign

```text
PHYSICAL_INFERENCE_REQUESTS = 3   (one per arm; the campaign maximum was 6)
ADDITIONAL_SUMMARIZATION_REQUESTS = 0
REPEATS = 0
MODEL = qwen3.8-flash-next-q2_0  (the operator's configured model)
ENDPOINT = the operator's approved local endpoint
REASONING = disabled (thinking: false)
GENERATION BUDGET = 2048 output tokens, IDENTICAL for every arm
ORACLE LEAKAGE = NONE (the machine witness passed on every arm)
```

The three questions were asked as ONE structured request per arm
(`Q1:`/`Q2:`/`Q3:` lines), so the campaign is three requests rather than
nine, and the answers are compared on the same three questions.

**The budget was raised once, before the comparison, for a measured
reason.** The first arm-A run at 1536 tokens reported
`finishReason=max_tokens`. A truncated answer is a MEASUREMENT ARTIFACT and
would penalise whichever arm happened to write longest, so the budget was
raised to 2048 for every arm. All three reported `finishReason=stop`. The
discarded run is not counted: the campaign is three requests.

## The result

Scored with the repository's OWN committed adjudication rubric
(`adjudicateAnswer()`), which is the same rubric the predecessor used:

```text
arm  contextChars  promptTokens  O1                O4                O7                correct/partial/incorrect
A    82 852        23 943       INCORRECT         INCORRECT         INCORRECT         0 / 0 / 3
B    90 974        26 575       PARTIALLY_CORRECT INCORRECT         PARTIALLY_CORRECT 0 / 2 / 1
C    93 071        27 126       PARTIALLY_CORRECT PARTIALLY_CORRECT PARTIALLY_CORRECT 0 / 3 / 0
```

**B improves over A. C improves over A. C improves over B.** The ordering is
monotone and it matches the structural adjudication exactly.

### What the arms actually answered

**ARM A (ordinary continuation) — 0 of 3.**

- O1: *"a dev Helm render succeeded ... a later DO/production-style render
  could not be executed because a chart dependency archive was missing ...
  the CONTEXT does not establish the exact second production-render command
  or its exit status."* — The ordinary compaction does not even establish
  that the production render FAILED.
- O4: *"43 Java test classes ... the other observed counts are different
  inventories: 8 `CREATE INDEX` lines ... 12 matches ... 0 modified
  working-tree files, so they do not conflict with 43."* — It answers with
  the tail's 43 and **explains the non-conflict using unrelated counts**.
- O7: *"MTS Omni sender using `SimpleHttp` with no explicit per-request
  timeout, and the Notification Service sender using hardcoded
  `connectTimeout(10s)` plus a 10-second retry sleep."* — **It substitutes
  values the source never establishes** (10 s / 10 s) for the real ones
  (500 ms / 1000 ms).

**ARM B (existing S2@2048 selection) — 2 of 3 partially correct.**

- O1: *"The first attempted render failed with Helm reporting that the
  [subchart] dependency was missing from `charts/` and needed `helm
  dependency build`"* — **the wrong CAUSE.** The real cause is a Go-template
  type error. This is a MATERIAL DISTORTION, and the automated scorer
  reported `MATERIAL_DISTORTIONS=0` for arm B.
- O4: still *"43 tracked Java test classes"* — **no improvement**. The
  selection never carries the counting definitions.
- O7: *"MTS Omni sender defaults `DEFAULT_CONNECT_TIMEOUT_MILLIS = 500` and
  `DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000`, and the production default sender
  selected for ROZ is `mts-omni`; however the context does not prove these
  read defaults are the effective production timeouts."* — the values, the
  production default and the not-proven qualification are all correct. Only
  the subject attribution is missing.

**ARM C (minimal targeted restoration) — 3 of 3 partially correct.**

- O1: *"failed with exit status 1 and produced a Helm template error in
  [the chart's] ingress template, specifically an error executing `tpl` in
  the ingress YAML while evaluating the hostname/pluck logic"* — **the
  correct failure and the correct template.** The remaining gap is the
  truncated `wrong type for value` clause and the explicit
  `--set global.env=prod` override.
- O4: *"**47**, from the output section labeled `--- files named *Test.java
  only ---`; the other counts, **73** and **43**, do not conflict with 47
  because 73 appears to count a broader set of test-related Java files"*
  — **correct**, including the counting-definition explanation.
- O7: the same as arm B.

### The summary the rubric cannot express

No arm is `CORRECT` on any item. The rubric's remaining criteria are the
ones the source's own framing cannot supply:

| item | criterion still unmet in arm C | why |
|---|---|---|
| O1 | `type-error-not-missing-dependency` | the clause is at char 450 of a 505-char line; the 300-char per-line bound cuts it |
| O1 | `second-render-needed-override` | the `--set global.env=prod` is in the COMMAND, which is not carried |
| O7 | `belongs-to-notification-service` | the provider path is in the COMMAND, which is not carried |

**These are not heuristic misses. They are facts the carried unit cannot
contain.** This is the decisive observation of the ACT.

## The cost

```text
                        A (ordinary)   B (S2@2048)   C (targeted)
context chars             82 852         90 974        93 071
provider prompt tokens    23 943         26 575        27 126
additional vs A              -            +2 632        +3 183
added section chars            0          8 120        10 217
added section EST tokens       0          2 030        2 555
completion tokens          1 859         1 930         1 904
latency (ms)              52 934        111 370       113 950
cache read tokens        23 938             0             0
finish reason               stop            stop          stop
material distortions         0              0              0   (as scored; see §03 — B has one, unscored)
```

**The estimate is 30% optimistic.** Arm B's section was estimated at 2030
tokens and cost 2632 provider-observed tokens; arm C's was estimated at
2555 and cost 3183. The estimate is the SECTION's own length; the observed
cost is the WHOLE request's prompt, and the difference is the request's own
framing and the carried section's delimiters. The ACT's cost reporting must
therefore quote the provider's observation, not the estimate.

**The latency difference is a cache artifact, not a property of the
mechanism.** Arm A read 23 938 cache tokens and finished in 53 s; arms B and
C read ZERO cache tokens and took 111-114 s. The arms were run in sequence
against the same endpoint, and the prefix cache did not carry over. This is
reported as a CACHE OBSERVATION, and it is explicitly NOT attributed to the
carried evidence.

## The decision

**CASE 1 and CASE 2 both apply, and the ACT resolves to CASE 2's verdict.**

- **B improves over A.** The existing selected evidence has *some*
  behavioural utility: it recovers O7's values and O1's failure, where the
  ordinary compaction recovers neither.
- **C improves over B.** The targeted restoration recovers O4 as well, and
  corrects arm B's wrong failure cause.

But the decisive point is NOT the ranking. It is that:

```text
arm C is an ORACLE-GUIDED POSITIVE CAPACITY CONTROL.
```

Arm C's selection is chosen by the oracle. It is not a policy. **What the
campaign establishes is that the capacity EXISTS** — that carrying the
right source bytes produces the right answers, at +3 183 prompt tokens
(+13%) and three requests.

**And what it also establishes is that the EXISTING mechanism does not
reach that capacity.** Arm B's selection carries neither O1's decisive
fragment nor O4's, and it carries a fragment that caused a material
distortion.

The four hypotheses the review listed are now separated:

| hypothesis | status after this ACT |
|---|---|
| relevant fragments were not selected | **CONFIRMED for O1 and O4** — the fragments are admitted but never selected |
| selected fragments lost qualifications during admission | **CONFIRMED and REFINED** — the qualification is not lost by admission; it was never IN the fragment, because it lives in the command |
| the scorer cannot recognise complete facts | **CONFIRMED** — 3 of 9 adjudications are scorer false negatives |
| the resumed model can already reconstruct the facts | **REFUTED for the ordinary arm** — arm A answers 0 of 3, and invents O7's values |

**CASE 2 — "C improves over A, but B does not" is not literally true (B
does improve). The applicable case is CASE 2's CONCLUSION:** evidence
selection remains insufficient; the automatic mechanism has not
demonstrated sufficient utility; close the current implementation campaign
and defer further selection research.
