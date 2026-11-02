# U02 Gate-Tally Reconciliation

This is a U03-owned receipt for the **independent reviewer's P1 evidence-accounting
finding** about `ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01`.

**The prior artifact is NOT altered.**  It remains immutable at
`.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01/`.
This file only records the reconciliation, in a new directory, with pointers to
the old artifact and to the audit.

## 1. The finding, reproduced mechanically

The reviewer reported:
> `04-qualification-gates.md` claims 30 total / 28 PASS / 2 baseline non-PASS,
> but only 29 named rows / 27 classified PASS / 2 baseline non-PASS were
> evidenced; row 15 is blank; the F1/F2/F3 labels disagree.

### 1.1 Row count — REPRODUCED

The "Gate count derivation" table in `04-qualification-gates.md` §4 was parsed
mechanically:

```
$ python3 - <<'PY'
import re
t=open('.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01/04-qualification-gates.md').read()
i=t.find('Gate count derivation')
seg=t[i:t.find('The two load-bearing numeric')]
rows=re.findall(r'\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|',seg)
named=[]
for a,b,c,d in rows:
    for n,name in ((a,b),(c,d)):
        if name.strip()!='—':
            named.append((int(n),name.strip()))
print('TOTAL NUMBERED SLOTS:',len(rows)*2)
print('NAMED GATES:',len(named))
print('MISSING NUMBERS:',[x for x in range(1,31) if x not in dict(named)])
PY
TOTAL NUMBERED SLOTS: 30
NAMED GATES: 29
MISSING NUMBERS: [15]
```

**Confirmed:** the table has **30 numbered slots** but only **29 named gates**;
**slot 15 is the blank `—` placeholder**.  There is no evidence for a 30th gate.

### 1.2 PASS/non-PASS split — REPRODUCED

```
$ grep -n 'F[0-9]' .../04-qualification-gates.md
| F1 | `@cline/core` typecheck — 37 diagnostics ...
| F2 | `editor.realpath-authority.test.ts` — 3 RED (C/D/E) ...
| F3 | `local-runtime-host.test.ts` — ... 1 failed ...
| F4 | `src/hub/server/ui-events.test.ts` (4) + `replay-wire.test.ts` (1) ...
| F5 | `src/hub/server/hub-plugins.test.ts` (2) ...
| F6 | vitest worker teardown `EPERM ... syscall: 'kill'` ...
```

The §2 failure-classification table enumerates **SIX** labelled failures, F1…F6.
The §4 summary instead states:

```
| Distinct executable structural gates executed at this HEAD | **30** |
| Executed and PASSING | **28** |
| Executed and failing ONLY due to a PRE-EXISTING / ENVIRONMENTAL condition | **2** (F2, F3 — both proven identical at the fork baseline) |
```

**Confirmed:** the summary's "2 non-PASS (F2, F3)" label disagrees with the
classification table's F1…F6.  The same disagreement is present in the sibling
`ledger.json` (`c3_qualification.pre_existing_failures` lists F1…F6) and in
`05-decision-record.md` P1-3 ("30 distinct gates executed; 28 PASS; the 2 non-PASS
results ...").


### 1.3 How the two numbers can both be right — the reconciliation

The three counts are consistent under ONE reading, which the prior report never
states explicitly:

| Count | Meaning | Derivation |
|---|---|---|
| **29** | distinct NAMED gates evidenced | 30 slots − 1 blank slot (15) |
| **3** | gates whose result is NOT a clean PASS | gate 6 = F1, gate 14 = F3, gate 19 = F2 |
| **26** | gates that are clean PASS | 29 − 3 |
| **2** | what the report called "non-PASS" | it counted only **F2 and F3**, omitting **F1** |

F1 is the `@cline/core` typecheck: it is a **named gate with a non-zero exit**
(exit 2, 37 diagnostics).  The report classifies it as PRE-EXISTING in §2
(row F1) and counts it as PASS in §4.  That is the F-label disagreement.

F4 / F5 / F6 are **not gates**.  They are sub-results *inside* gates that were
otherwise GREEN:
* F4 and F5 are the hub `ui-events` / `replay-wire` / `hub-plugins` failures at
  the default (unwritable) `~/.cline`; gate 23 (§1.5) is the SAME suites run
  with a writable `CLINE_DIR` and is recorded **PASS — 4 files / 15 passed**.
* F6 is the vitest worker-teardown `EPERM` artifact, not a test result.

So the 28-vs-26 discrepancy is **entirely** the question of whether F1 (a
non-zero-exit gate classified PRE-EXISTING) is counted as PASS or as non-PASS.

## 2. Resolution

**A missing 30th gate receipt was NOT found.**  No original execution receipt
for any gate numbered 15 exists anywhere in the prior ACT's evidence directory
or in the upstream ACT's `command-receipts.md` (whose receipt list is a
different, merge-time set of commands).  The reviewer is therefore correct that
**no gate 15 was ever evidenced**.

**No gate was fabricated and no baseline failure was relabelled as passing.**

This ACT adopts the **verified 29-gate figure**, with the F1 disclosure made
explicit:

```
DISTINCT NAMED GATES EVIDENCED AT 3fc91ddda : 29   (not 30)
  clean PASS                                   : 26
  non-PASS, each proven PRE-EXISTING/BY-DESIGN:  3   (F1, F2, F3)
      F1  @cline/core typecheck  — 37 diagnostics, identical (file,code,message)
                                  at the fork baseline; exit 2
      F2  editor.realpath-authority.test.ts — intentional RED matrix C/D/E
                                  (3 failed / 4 passed); declared by the file header
      F3  local-runtime-host.test.ts — 1 failed, same assertion and same values
                                  at the fork baseline
  ACT-owned failures                           : 0
```

The prior report's headline "30 / 28 / 2" is therefore **arithmetically
defensible only if F1 is silently counted as PASS**; its own §2 table and its
own `ledger.json` classify F1 as a PRE-EXISTING failure.  The honest statement
is **29 = 26 + 3**.  This ACT uses 29 = 26 + 3 and records the discrepancy.

## 3. Impact on the U03 verdict

**NONE.**  The P1 is an **evidence-accounting** defect, not a correctness or
safety defect:

* the count of *distinct gates* does not change any gate's observed result;
* F1, F2 and F3 were each independently proven PRE-EXISTING by A/B against the
  fork baseline `265044bf3`, and this ACT **re-executed** all three at the
  current head and re-confirmed them (see commands-and-results.md);
* the "0 ACT-owned failures" claim is unaffected — it remains true.

Per the ACT brief this P1 is **non-blocking for U03 execution** and is batched
at terminal cleanup.

## 4. Cross-references

* Prior artifact (immutable):
  `.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01/04-qualification-gates.md`
  `.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01/ledger.json`
  `.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01/05-decision-record.md`
* The audit finding itself is the independent Codex review of
  `ACT-CLINEMM-FORK-UPSTREAM-MERGE01`; its disposition is recorded in
  `05-decision-record.md` §2 as P1-1 / P1-2 / P1-3.  P1-3 is the row this file
  reconciles.
* This ACT did **not** modify, regenerate or reformat any prior artifact.
  `git status` shows the prior directories untouched.
