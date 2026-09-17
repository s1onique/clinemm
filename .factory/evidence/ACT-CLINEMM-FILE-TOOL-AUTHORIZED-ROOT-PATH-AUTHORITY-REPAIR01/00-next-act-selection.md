# ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-PATH-AUTHORITY-REPAIR01 / 00-next-act-selection

## Decision (plan-mode)

The next **full production ACT to dogfood** is
`ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-PATH-AUTHORITY-REPAIR01`.

It is **hard-gated** on first completing the live bind
(`LIVE_TOOL`, `LIVE_INPUT_PATH`, `SESSION_CWD`,
`WORKSPACE_ROOT`, `PRODUCTION_ENTRY`, `PATH_NORMALIZER`,
`MUTATION_PRIMITIVE`, `AUTHORIZED_ROOT`,
`FIRST_BROKEN_BOUNDARY`) in the still-open
`ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01`.

If that bind cannot be made from durable evidence, the
recon ACT must declare `CAPTURE_INSUFFICIENT` and add the
smallest capture needed (mirroring the W-carrier / THSICAP /
TSWPD diagnostic pattern already used in other lanes).
The repair ACT does NOT open until the bind lands.

## Why this is the correct next production lane

```text
- Live evidence F1 (host mutation outside the intended
  Runity/srs tree) is durable and load-bearing.
- Live evidence F2 (later shell-side Seatbelt denial)
  proves only that shell authority is separate; it does
  NOT establish that the host mutation was authorized.
- The two authority systems are DIFFERENT. A Seatbelt
  failure does NOT prove file-tool authority was correct.
- Upstream SDK contract: built-in tools (editor,
  apply_patch) respect CoreSessionConfig.cwd /
  workspaceRoot. The host mutation escapes that
  contract exactly when the authorized root is broader
  than the intended working tree.
- Current SDK editing centers on editor + apply_patch.
  Legacy write_to_file / replace_in_file may be
  defensive residue, not the real mutation seam.
- Therefore the next ACT must bind the LIVE tool FIRST
  (not assume it), classify its authorized root from the
  actual production contract, then RED + repair against
  the real seam.
```

## State at HEAD 083b6c3a1

```text
branch                  = main
working tree            = clean
git status --porcelain  = empty
git stash list          = empty
HEAD                    = 083b6c3a1 (twenty-ninth-pass:
                          P0 exportability fix + P1
                          diagnostic accounting correction
                          landed)

Recon ACT status:
  ENTRY_HEAD             = 03af027a9 (P1 calibration + handoff)
  CORRECTION_HEAD        = a127aed18 (P1 wording fix)
  ACTUAL_TOOL            = UNBOUND  (Q1 not completed)
  ACTUAL_AUTHORIZED_ROOT = UNBOUND  (Q2 not completed)
  AUTHORIZED_ROOT_VIOLATION = NOT YET PROVEN
  FIRST_BROKEN_BOUNDARY  = UNBOUND
  C1                     = GO_LIVE_BIND (per a127aed18 verdict)
  PRODUCTION_REPAIR      = NOT AUTHORIZED
```

The recon ACT's own §4 stop rule says:

> NO production repair until:
>   - Q1 LIVE bind is complete
>   - Q5 RED is authored
>   - Factory reviewer authorizes the repair
>   - Conservation proof (ACAS01-equivalent for the
>     file-tool surface, INCLUDING the case-G
>     global-skill conservation) is captured

The proposed repair ACT spec honors that stop rule
explicitly via its §0 step 1 (require clean working tree,
record ENTRY_HEAD, do NOT touch the still-open W-carrier
diagnostic lane) and its §1 LIVE_BIND step
(CAPTURE_INSUFFICIENT halt when durable evidence cannot
bind the actual mutation tool; do NOT repair).

## Why we do NOT open the repair ACT in this cycle

The proposed repair ACT's §1 LIVE_BIND requires durable
evidence that is NOT recoverable from the local checkout:

```text
LOCAL DURABLE EVIDENCE CHECK at HEAD 083b6c3a1:
  /Projects/Runtime/                -> ENOENT (already gone)
  /Projects/                        -> ENOENT
  Runity tree (the intended workspace)
                                     -> not present in this VM
  ~/.cline/data/                    -> present (only shared
                                       state); no srs session
                                       JSONL here
  The original srs session transcript
                                     -> not durable on disk
```

Per the recon ACT §3 Q1 stop condition, without the
session/transcript evidence we cannot in good conscience
emit a `LIVE_TOOL =` binding — and the repair ACT §1
specifies `CAPTURE_INSUFFICIENT` exactly when the bind
cannot be made from durable transcript/log evidence.

The repair ACT also requires `R2 lexical escape` to FAIL
at ENTRY_HEAD against the real production seam. That
requires the LIVE tool + resolver + authorized root to
already be bound (per repair ACT §5 causal discriminator
and §4 ENTRY RED REQUIREMENT). Without the bind, R2 has
no real production seam to attack.

Opening the repair ACT now would force one of two
regressions against the factory discipline:

```text
1. Repair ACT opens without LIVE_TOOL bound
   -> violates its own §1 LIVE_BIND stop rule
   -> violates its own §4 ENTRY RED REQUIREMENT
      (no real production seam to attack)
   -> violates the recon ACT's §4 stop rule
      (no Q1/Q2 yet)

2. Repair ACT opens and RE-DERIVES the LIVE_TOOL bind
   -> duplicates recon ACT's Q1 work
   -> violates the factory discipline's
      "Do not create another parent/umbrella ACT"
   -> requires a new broad recon under a repair ACT
      label, which is exactly what the user forbade
      ("I would not create another broad recon")
```

The smallest correct sequencing is therefore:

```text
cycle N+1:
  Complete ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-
  AUTHORITY-RECON01 Q1 (LIVE bind) + Q2 (authorized root)
  on the live srs session, OR via the smallest capture
  if durable evidence is insufficient.

  If bind lands:
    - FIRST_BROKEN_BOUNDARY = <resolved concrete seam>
    - LIVE_TOOL = <concrete tool>
    - AUTHORIZED_ROOT = <concrete root>
    - open ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-
      PATH-AUTHORITY-REPAIR01 with the bind as the
      ENTRY_RED_REQUIREMENT input

  If bind cannot land:
    - declare CAPTURE_INSUFFICIENT
    - instrument the smallest capture (path-resolver
      entry + tool-name + cwd/workspaceRoot snapshot)
      following the existing THSICAP / TSWPD / W-carrier
      diagnostic profile pattern
    - rebuild VSIX, dogfood the live srs tree again
    - redo Q1-Q2 with the captured tool/root evidence

  Then, ONLY after the bind:
    - open the repair ACT
    - freeze the path-authority contract (per repair §3)
    - RED at the real production seam (per repair §4)
    - classify causal discriminator (per repair §5)
    - implement smallest shared authorized-root guard
      (per repair §6)
    - dogfood LIVE_QUALIFICATION (per repair §11)
```

## Mapping between repair ACT sections and recon stop rules

```text
Repair ACT section                Recon ACT stop rule
-------------------------------   --------------------------------
§0 Entry / repo trust             recon §4 clean tree required
                                  (working tree clean at 083b6c3a1)

§1 LIVE_BIND                      recon Q1 (LIVE editor bind)
                                  + recon Q2 (per-tool authorized
                                  root); both UNBOUND at HEAD
§2 Recon the real path flow       recon Q3 (path-authority
                                  primitive); gated on Q1
§3 Freeze path-authority contract recon Q4 (composition seam);
                                  per-tool, NOT universal
§4 True RED at real seam          recon Q5 RED matrix (A-F + G/H
                                  conservation); gated on Q1-Q4
§5 Causal discriminator            recon §3 (case-by-case root
                                  classification)
§6 Repair (smallest, lowest seam) recon §4 stop rule + factory
                                  reviewer authorization
§7 Symlink / TOCTOU discipline    recon Q3 step 4-5 (symlink
                                  traversal / replacement)
§8 Error / UX contract            recon §4 conservation (C9 no
                                  writes outside authorizedRoot)
§9 Conservation C1..C12           recon §4 conservation
                                  (case G global-skill ALLOW +
                                   Seatbelt unchanged)
§10 GREEN gates                   recon §7 ACT_DONE gate list
                                  (Q1-Q5 AUTHORED + necessity
                                   ablation + git diff --check
                                   + clean tree)
§11 LIVE_QUALIFICATION            per existing dogfood pattern
                                  (rebuild VSIX + bind tool +
                                   LIVE A/B/C/D)
§12 STOP RULES                    recon §4 stop rules +
                                  factory discipline
```

In other words: the proposed repair ACT is a faithful
linearization of the recon ACT's stop rules. It is the
correct ACT to run next; it is just hard-gated on the
bind, exactly as the recon ACT requires.

## W-carrier coexistence

The repair ACT spec explicitly says:

> Do NOT touch the still-open W-carrier diagnostic lane
> except for ordinary coexistence/build conservation.

That is consistent with the W-carrier trace's frozen
REMOVAL_TRIGGER:

```text
REMOVAL_TRIGGER = first successful LIVE binding of
                  Q1..Q4 capture to the missing-gauge
                  boundary + a proper repair, then
                  remove the resolver + activation
                  helper + trace module + extension
                  wiring TOGETHER
```

The W-carrier lane is for the compaction context-gauge
missing-data lane (a different LIVE failure); the
file-tool lane is for the `../../Runtime` mutation
(a different LIVE failure). The two lanes are
independent; both remain open; both have their own
REMOVAL_TRIGGER conditions. The file-tool repair ACT
must not disturb W-carrier module seam, env-var
parser location, or activation helper — only coexist
during build / typecheck / lint gates.

## What this evidence file DOES commit

This evidence file records the plan-mode selection of
the next production ACT and the explicit hard-gate on
completing the live bind first. It is a planning
artifact, NOT a production code change. No production
files are modified. The repair ACT itself is NOT opened
in this cycle.

## What this evidence file does NOT do

- It does NOT open the repair ACT.
- It does NOT bind `LIVE_TOOL`, `AUTHORIZED_ROOT`, or
  `FIRST_BROKEN_BOUNDARY`. Those remain UNBOUND until
  the recon ACT Q1/Q2 land.
- It does NOT author a RED at the real production seam.
  That belongs to the recon ACT §Q5, which is gated on
  Q1/Q2.
- It does NOT modify the W-carrier lane.
- It does NOT modify Seatbelt.

## Factory state (planning, durable for the next pass)

```text
NEXT_ACT_DECIDED =
  ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-
  PATH-AUTHORITY-REPAIR01

NEXT_ACT_HARD_GATE =
  ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-
  AUTHORITY-RECON01 Q1 + Q2 must land first

NEXT_ACT_DOES_NOT_OPEN_IN_THIS_CYCLE = YES
  (reason: live bind UNBOUND, durable evidence not
   recoverable from the local checkout)

NEXT_STEP_SMALLEST =
  either (a) complete Q1/Q2 on a live srs session
  where the original /Projects/Runtime/... specimen
  was created and where the model transcript is
  recoverable, OR
  (b) declare CAPTURE_INSUFFICIENT in the recon ACT
  and instrument the smallest capture following the
  THSICAP / TSWPD / W-carrier pattern

PRODUCTION_FILES_CHANGED_THIS_CYCLE = 0
NEW_RED_THIS_CYCLE = 0
NEW_REVIEW_ROUND = 0
```

## Verdict

```text
NEXT_ACT = ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-
           PATH-AUTHORITY-REPAIR01
HARD_GATE = recon Q1 (LIVE tool bind) + Q2 (authorized
            root bind)
CYCLE_DECISION = plan-mode only; do NOT open the repair
                  ACT yet
C1 = GO_PLAN_NEXT_ACT (this evidence file)
NEXT_DECISION_OWNER = factory causal reviewer + dogfood
                       operator (next live cycle)
```
