# ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01

## 05 — The bounded behavioural qualification (§10)

```text
SESSION_ID:        1795491524406_mutdb
PROBE WORDING:     the existing O1/O4/O7 questions, UNCHANGED
ORACLE IN PROMPT:  NEVER — the probe carries the context and the question only
ENDPOINT:          the operator's already-authorized local endpoint
MODEL:             qwen3.8-flash-next-q2_0 (unchanged)
```

### 5.1 THE ARMS

| Arm | Context chars | What it is |
| --- | --- | --- |
| **PROD** | 90 987 | Arm A — the CURRENT production serialization: the real `serializeConversation()` output of the W1 prefix, wrapped in the real production summarizer request. |
| **TARGETED_SOURCE** | 170 504 | Arm B — the TARGETED SOURCE POSITIVE CONTROL: the complete original command/result pairs, with the invocation, the subject, the result, the execution status and the qualification kept TOGETHER. **Contains only the pairs, not the whole source — it is NOT a full-source control and is not named as one.** |
| **FULL_SOURCE** | 194 197 | The GENUINE FULL-SOURCE positive control: the whole original transcript — the user turns, the assistant prose, the tool invocations and the tool results. |

### 5.2 THE MEASUREMENTS

| Arm | Question | Prompt tokens | Cached tokens | Latency | Physical requests |
| --- | --- | --- | --- | --- | --- |
| PROD | O1 | 26 686 | 0 | 82 995 ms | 1 |
| PROD | O4 | 26 696 | 16 384 | 46 224 ms | 1 |
| PROD | O7 | 26 682 | 16 384 | 47 641 ms | 1 |
| TARGETED_SOURCE | O1 | 52 195 | 0 | 148 068 ms | 1 |
| TARGETED_SOURCE | O4 | 52 205 | 49 152 | 34 149 ms | 1 |
| TARGETED_SOURCE | O7 | 52 191 | 49 152 | 32 727 ms | 1 |
| FULL_SOURCE | O1 | 59 703 | 0 | 164 250 ms | 1 |
| FULL_SOURCE | O4 | 59 713 | 49 152 | 52 008 ms | 1 |
| FULL_SOURCE | O7 | 59 699 | 49 152 | 54 979 ms | 1 |

**Every arm used exactly ONE physical request per question.** No arm
introduced an additional inference request.

**The production serialization's own shape, measured on the real path:**

```text
PRODUCTION_SUMMARY_INPUT_CHARS:    59 535
[result omitted] MARKERS:          122
[succeeded] MARKERS:               122
DISTINCT TOOL-RESULT LINES:        4
```

122 successful command results, and **every single result body is
`[result omitted]`**. Only 4 distinct tool-result lines survive the whole
serialization. This is the §02 loss, measured.


### 5.3 THE DIRECT ADJUDICATION

The ACT (§6) requires that the automated regex scorer NOT override direct
source adjudication. The adjudication below was made by reading each answer
against the oracle's `correctAnswerCriteria` and `requiredQualifications`
**directly**. The raw answers are in the GITIGNORED tree.

---

#### O1 — "two attempts were made to render the production Helm manifest"

Oracle criteria: (a) the first render failed with a **template type error**
(non-string environment value); (b) the first render's exit status was
**non-zero**; (c) the second render succeeded **only after an explicit
environment override** was supplied.

**PROD — INCORRECT (material factual substitution).**

The PROD answer describes the first attempt as:

> "The command's status is recorded as **succeeded** / success."

and attributes the rendering to the ROZ chart with `global.env=dev`,
describing the second attempt as a `grep -c` returning `0`. The oracle's
actual first attempt FAILED. The answer states the opposite of the
decisive fact: it converts a **failed** operation into a **successful** one.
This is exactly the failure mode the ACT's §8 forbids — "no silent
conversion of failed operations into successful outcomes" — and it is
produced by the PRODUCTION arm, not introduced by any candidate.

Criteria: (a) **not satisfied** (no template type error), (b) **not
satisfied** (exit status stated as succeeded), (c) **not satisfied**.

**TARGETED_SOURCE — CORRECT.**

> "Produced an error because the chart dependency was missing locally…
> `exit=1`"

and the second attempt's templating error is quoted in full, ending with
the explicit conclusion that the render "needed a properly supplied
environment value, such as `global.env=prod`".

Criteria: (a) **satisfied** — the `gotpl` / "wrong type for value;
expected string; got interface {}" error is quoted; (b) **satisfied** —

---

#### O4 — "which count belongs to the conventional-suffix definition"

Oracle criteria: (a) gives the conventional-suffix count as **the
smallest** of the observed counts; (b) does **NOT** present more than one
number as "the" authoritative count; (c) attributes the difference to the
**counting definition**, not to a contradiction.

**PROD — PARTIALLY CORRECT (and materially wrong on the value).**

The PROD answer gives the count as **43** and asserts it is "the count
under the definition that matches only files whose names end with the
conventional test suffix". The decisive value is **47**, and 43 is **not**
the smallest of the observed counts ({42, 43, 47, 73}) — 42 is.

Criteria: (a) **not satisfied** (43 is not the smallest; the correct answer
is 47); (b) **satisfied** (one number is presented as authoritative);
(c) **satisfied** (the difference IS attributed to the counting definition).

**TARGETED_SOURCE — CORRECT.**

> "The count that belongs to the definition 'only files whose name ends
> with the conventional test suffix' is **47**."

and it explains that 73 came from a broader `grep -iE 'test\.java$'`-style
filter, that 42 and 43 used other scopes, and that they "are not
necessarily 'files named only `Test.java`'".

Criteria: (a) **satisfied** (47, identified as the smallest); (b)
**satisfied**; (c) **satisfied**.

**FULL_SOURCE — CORRECT.**

> "The observed count that corresponds to the definition 'only files whose
> names end with the conventional Java test suffix' is: **47**"

Criteria: (a), (b), (c) all **satisfied**.

---

#### O7 — "what timeout configuration was actually read"

Oracle criteria: (a) gives the **two default constants** of the
notification-service provider; (b) states that the production default
service is the **carrier sender**, a different provider; (c) states that
the read constants are **defaults and are not proven to be the effective
production values**.

**PROD — INCORRECT.**

The PROD answer gives `KC_NS_KAFKA_SEND_TIMEOUT_MS: "1500"` from
`.helm/roz/values.yaml` as "the timeout configuration actually read". The
decisive read is the **Java** pair — `DEFAULT_CONNECT_TIMEOUT_MILLIS = 500`
and `DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000` — in the notification-service
provider. The PROD answer misses both constants.

Criteria: (a) **not satisfied** (no 500/1000 pair is given as the read
defaults); (b) **partially satisfied** (the carrier sender `mts-omni` IS
named for ROZ default); (c) **satisfied** (the answer does say the read
values are not proven effective).

**TARGETED_SOURCE — CORRECT.**

> "DEFAULT_CONNECT_TIMEOUT_MILLIS = 500;
> DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000"

with the environment-override mechanism quoted, the carrier-vs-notification
distinction drawn, and the explicit statement that the read defaults are
defaults and not proven effective.

Criteria: (a) **satisfied**; (b) **satisfied**; (c) **satisfied**.

**FULL_SOURCE — CORRECT** on the notification-service constants, and
additionally surfaces the sibling `NotificationServiceClient` constants
(`CONNECT_TIMEOUT_MS = 500`, `SOCKET_TIMEOUT_MS = 1500`) — a **more**
complete reading of the source than the targeted arm. Criteria (a), (b),
(c) all **satisfied**.

---

### 5.4 THE ADJUDICATION TABLE

| Proposition | PROD | TARGETED_SOURCE | FULL_SOURCE |
| --- | --- | --- | --- |
| **O1** | **INCORRECT** — states a failed render succeeded | **CORRECT** | **CORRECT** |
| **O4** | **PARTIAL** — wrong value (43, not the smallest 47) | **CORRECT** | **CORRECT** |
| **O7** | **INCORRECT** — misses the decisive constants | **CORRECT** | **CORRECT** |

```text
O1_CONSERVATION:     PROD=NO   TARGETED_SOURCE=YES   FULL_SOURCE=YES
O4_CONSERVATION:     PROD=PARTIAL  TARGETED_SOURCE=YES   FULL_SOURCE=YES
O7_CONSERVATION:     PROD=NO   TARGETED_SOURCE=YES   FULL_SOURCE=YES
```

### 5.5 THE CONCLUSION THE ACT ASKS FOR

**§6's question is answered: the model CAN recover O1/O4/O7 from the
original evidence.** Both the targeted-source arm and the full-source arm
recover all three propositions correctly. **None of the three is a
model-capability limitation.** The failure in PROD is entirely
compaction-caused.

**§10's conclusion: the faithful representation is behaviourally superior
to the current production serialization on every decisive proposition, and
it introduces NO new material factual substitution.** The one material
substitution observed in this ACT (PROD's O1 "succeeded" claim) is a
property of the EXISTING production path, and it is **eliminated** by the
faithful representation — not introduced by it.

**§5's qualification about the full-source arm is hereby corrected.** The
genuine full-source arm (194 197 chars) DID fit the provider budget and
DID answer all three questions correctly. The earlier `LAST_WORKING`
refusal (§03.4) was a property of that specific measurement — the whole
native prefix as a single provider request — not a budget limit of the
full source. The full-source arm's own requests (59 703 prompt tokens)
were accepted and answered. Both facts are recorded; neither is discarded.

### 5.6 THE CONFIDENTIALITY BOUNDARY — WHAT THE FAITHFUL ARM PUBLISHES

The faithful representation publishes the **command text**, the **result
body** (bounded to 2 000 characters), the **execution status** and the
**qualification**, together.

That is a **broader disclosure** than the current production path, which
publishes the command but replaces every result body with
`[result omitted]`. The faithful arm applies the **existing sanitizer**
(`sanitizeOutcomeText()`) to every published body, and bounds the length.

**This broader disclosure has NOT received a formal confidentiality
review**, and it is the reason the production integration gate (§12) is
not satisfied by the faithful representation as measured. See §06.

`exit=1` is stated; (c) **satisfied** — the explicit environment override is
stated as the thing that made the second attempt succeed.

**FULL_SOURCE — CORRECT.**

> "It produced an **exit status of `1`**… `wrong type for value: Expected:
> string; Actual: interface {}`"

and the second attempt "produced a rendered manifest with **exit status
`0`**".

Criteria: (a), (b), (c) all **satisfied**.
