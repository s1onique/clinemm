# 03 — The direct source adjudication, and the unified root cause

ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01

## The method

The ACT's decisive oracle is **direct inspection of the canonical source**,
not the automated matcher. For each of O1, O4 and O7 the adjudication
establishes, separately:

- the original observation;
- the observed subject;
- the value or polarity;
- the material qualification;
- whether each is present in the arm's carried section;
- whether the source establishes their RELATIONSHIP.

The facts are matched **FRAGMENT-SCOPED**, by the production renderer's own
attribution (`run_commands#<canonicalIndex + 1>`), so a bare number in an
unrelated fragment cannot satisfy a fact. The script does NOT reuse the
predecessor's per-item discriminator, whose "admitted" flag was derived
from the already-admitted candidate set — the reviewer's objection to that
discriminator is accepted.

The classification is a CONSEQUENCE of those facts, in a fixed order:

```text
1. the source does not establish it           -> INSUFFICIENT_EVIDENCE
2. the value is not carried, and the fragment
   was never selected                          -> SOURCE_NOT_SELECTED
3. the value is not carried, and the fragment
   WAS carried but its bytes were bounded      -> ADMISSION_TRUNCATION
4. the value is carried, a qualification is not -> QUALIFICATION_NOT_SELECTED
5. the value and the qualifications are carried,
   but the source-established RELATIONSHIP is not-> RELATIONSHIP_NOT_ESTABLISHED
6. everything is carried                        -> NONE
   (and the automated matcher still reports an omission: SCORER_FALSE_NEGATIVE)
```

## The result

```text
item  arm  category                       automated          scorerFalseNegative
O1    A    SOURCE_NOT_SELECTED             OMITTED            false
O1    B    SOURCE_NOT_SELECTED             OMITTED            false
O1    C    ADMISSION_TRUNCATION            PARTIALLY_PRESERVED false
O4    A    RELATIONSHIP_NOT_ESTABLISHED    OMITTED            false
O4    B    RELATIONSHIP_NOT_ESTABLISHED    OMITTED            false
O4    C    NONE                           OMITTED            TRUE
O7    A    SOURCE_NOT_SELECTED             OMITTED            false
O7    B    NONE                           PARTIALLY_PRESERVED TRUE
O7    C    NONE                           PARTIALLY_PRESERVED TRUE

SCORER_FALSE_NEGATIVES = 3 of 9 adjudications
```

**The automated scorer under-reported.** Three of the nine adjudications
are cases where every fact IS carried and the matcher still reports a
material omission. The predecessor's `MATERIAL_DISTORTIONS=0` and
`critOmitted` figures are therefore floors, not measurements.

## THE UNIFIED ROOT CAUSE

The three categories are not three defects. They are **one** defect seen
from three sides:

> **The admission contract carries the tool RESULT body but never the
> COMMAND that produced it, and it BOUNDS each output line at 300
> characters.**

The command is deliberately excluded: `resolveEvidenceSource()` refuses a
command's own arguments, because they may contain a path, a URL or a
credential. That refusal is correct for CONFIDENTIALITY and it is exactly
what destroys the SEMANTIC relationship the propositions depend on.

```text
MEASURED: fragments whose COMMAND is also carried = 0 of 8
```

Every carried fragment in every arm is a bare output with no indication of
what produced it.

### O1 — the failure cause is not recoverable, and the model substitutes a wrong one

The source at canonical 145 establishes (the chart path is withheld; the
line structure and the clause offset are reproduced exactly):

```text
exit=1
Error: template: <chart>/templates/<subchart>.yaml:29:13:
  executing ... at <tpl . $>: error calling tpl: error during tpl function
  execution for "{{ pluck .Values.global.env ... }}":
  template: gotpl:1:16: executing "gotpl" at <.Values.global.env>:
  wrong type for value; expected string; got interface {}
```

(The chart and subchart names are withheld, as the predecessor's evidence
withholds them. The STRUCTURE of the line — its length, and the offset of
the decisive clause within it — is what the finding depends on, and that is
reproduced exactly.)

The decisive clause **`wrong type for value; expected string; got
interface {}` sits at character 450 of a 505-character line.** The
admission contract's per-line bound is 300 characters, so the clause is
CUT. The carried fragment ends at `...pluck \\"default\\" .Va...[line
truncated]`.

What survives is "the first render failed, exit=1" — the failure's
EXISTENCE, not its CAUSE.

**Arm B then produced a MATERIAL DISTORTION that the scorer did not
detect.** Its answer to O1 was:

> "The first attempted render failed with Helm reporting that the [subchart]
> dependency was missing from `charts/` and needed `helm dependency build`"

That is a **different failure with a different cause** — a missing chart
dependency, not a template type error. It came from a neighbouring carried
fragment (canonical 143) whose body reports a missing subchart dependency
and the `helm dependency build` remedy. The model, deprived of the real
cause, took the only failure explanation the context offered.

This is the distortion mode the source-bound evidence was introduced to
prevent: **a summarizer's successor substituting a neighbouring
subsystem's value.** Here it is a successor reading a neighbouring
fragment.

### O4 — the counting-definition relationship lives in the COMMAND

The source establishes four counts under four counting definitions. The
OUTPUT of canonical 67 contains:

```text
73
--- files named *Test.java only ---
47
```

The label `--- files named *Test.java only ---` is in the OUTPUT. But the
reason the broader 73 is not in conflict with the conventional 47 is that
the two came from DIFFERENT COMMANDS — and the commands are not carried:

```text
canonical  7: git ls-files | grep -iE 'test\.java$' | wc -l            -> 47
canonical 65: git ls-files | grep -E 'Test\.java$|test.*\.java$' | wc -l -> 73
canonical 67: git ls-files | grep -E '\.java$' | grep -i 'test' | wc -l   -> 73

(The commands are reproduced verbatim: they are the FINDING, and they carry
no path, no URL and no credential.)
```

Arm C carried 47 and 73 and the label, and the model answered correctly:

> "The observed count that matches the definition 'only files whose name ends
> with the conventional test suffix' is **47**, from the output section labeled
> `--- files named *Test.java only ---`; the other counts, **73** and **43**,
> do not conflict with 47 because 73 appears to count a broader set of
> test-related Java files or paths"

So the relationship IS recoverable — but only from a fragment that happens
to contain the label, and only because that fragment (canonical 67) also
contains both numbers. The class of defect is the same: the command is
what establishes the definition, and it is never carried.

### O7 — the subject is unbound from the value

The source at canonical 187 establishes:

```text
52:    static final int DEFAULT_CONNECT_TIMEOUT_MILLIS = 500;
53:    static final int DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000;
81:                System.getenv(ENV_CONNECT_TIMEOUT)), DEFAULT_CONNECT_TIMEOUT_MILLIS);
84:                System.getenv(ENV_SOCKET_TIMEOUT)), DEFAULT_SOCKET_TIMEOUT_MILLIS);
=== which sender active in prod (service value) ===
  KC_SPI_PHONE_DEFAULT_SERVICE:
    default: mts-omni
    dev: notification-service
```

The qualification "these constants belong to the **notification-service
provider**" is established by the file PATH of the grep — the command
searched one named subproject's source tree (its path is withheld here, as
the predecessor's evidence withholds it). That path is in the COMMAND, which
is not carried.

What IS carried is `dev: notification-service` — a values-file entry in
which `notification-service` is an ENVIRONMENT NAME, not the provider that
owns the constants. So the subject token `notification-service` appears in
the carried section **twelve times, in a role that does not bind it to the
constants**. The model read the constants correctly in every arm; it could
not attribute them, because the attribution was in the command.

Both arms B and C state the values (500 / 1000), the production default
sender (`mts-omni`), and that the defaults are not proven to be the
effective production values. Both fail the rubric's
`belongs-to-notification-service` criterion.

### The synthesis

```text
O1  the decisive clause is CUT by the per-line bound, and the model
    substitutes a neighbouring fragment's cause          -> ADMISSION_TRUNCATION
O4  the definition lives in the COMMAND, which is not carried -> RELATIONSHIP_NOT_ESTABLISHED
O7  the subject lives in the COMMAND, which is not carried   -> RELATIONSHIP_NOT_ESTABLISHED

COMMON CAUSE: the carried unit is the OUTPUT, stripped of its COMMAND.
```

**This is a boundary defect of the carried unit, not a defect of the
selector.** No re-ranking, no pairing heuristic and no value-qualification
layer can recover a command that the admission contract never carried.
Value-qualification pairing — the proposed R14 — would pair fragments
against each other while the missing information is the FRAME that says
what each fragment is a fragment OF.
