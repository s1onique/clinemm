ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01 — Causal Classification

## Causal chain (per ACT §1, §45)

```
allocation profiler root-cause hypothesis
    REFUTED AS NECESSARY
        (HOST_CRASH_WITH_ALLOCATION_PROFILER_OFF = REPRODUCED)
        (HOST_CRASH_WITH_ALLOCATION_PROFILER_ON  = REPRODUCED)
        -> ALLOCATION_PROFILER_NECESSARY_FOR_CRASH = FALSE

WVSL allocation repair
    LIVE EFFECTIVE / PARTIAL
        (listSessionsCalls: 6 -> 2; readSessionManifestTitleCalls: 894 -> 304)

host death
    STILL REPRODUCED

VSCodium emergency profiler
    TOO LATE
        (stall begins -> host becomes unresponsive -> VS Code decides to attach profiler -> host dies before useful profile is captured)

next epistemic need
    PRE-FAILURE CPU EVIDENCE
        (acquired by THIS ACT's pre-armed rolling CPU profiler)

C1: GO
```

This ACT closes the branch: "VSCodium's reactive profiler is the only
mechanism, and it's too late". After this ACT, an in-process CPU profiler
is ARMED at extension activation (gated by dogfood + CLINEMM_DIAG_CPU_PROFILE=1)
and STARTS on the first qualifying notify-enabled background command — BEFORE
the workload runs.

## C1: GO

Build only after the focused CPU-profiler protocol/rotation tests and
the real Inspector smoke probe are green. Then run ONE clean dogfood
specimen with CPU profiling ON and allocation profiling OFF.

This ACT achieves C1: focused tests GREEN, smoke probe GREEN, production
diff committed, dogfood specimen PENDING (operator's manual step).

## Classification (post-capture, per ACT §29)

The successor ACT ACT-CLINEMM-EXTENSION-HOST-CPU-CAPTURE01 chooses ONE:

### CP1 — one stable ClineMM leaf dominates across segments

    same authored source path dominates >=2 adjacent pre-failure segments

Then symbolize if minified and authorize a causal ACT.

### CP2 — hotness shifts across segments but one ancestry dominates

    Example: drain -> onSessionEvent -> ...

Then investigate shared parent seam.

### CP3 — GC dominates again

Then correlate with permanent allocation profiler in a SEPARATE run.

### CP4 — Node/Inspector profiler dominates

Then:

    HALT_CPU_PROFILER_PERTURBATION_TOO_HIGH

and change sampling/segment cadence once.

### CP5 — no useful signal

    PASS_CPU_CAPTURE_CAUSE_UNRESOLVED
    No repair.

## Repair authorization

At THIS ACT's closure, repair remains:

    FALSE

unless a source-level function is already unambiguously bound and a
necessity discriminator exists. The ClineMM leaves in any production
profile are MOST LIKELY minified (per the prior exthost-402d7f.cpuprofile
analysis showing mangled symbols like Rnl, r_, cwi, etc.). If the winning
symbol IS minified:

    NEXT ACT = SYMBOLIZATION (not repair)

Example: ACT-CLINEMM-EXTENSION-HOST-I_-HOTLEAF-SYMBOLIZATION01 if i_
reappears as the dominant stable pre-failure leaf.

## Allowed verdicts (post-capture)

    PASS_CPU_CAPTURE_SINGLE_HOTLEAF                (CP1)
    PASS_CPU_CAPTURE_SHARED_ANCESTRY               (CP2)
    PASS_CPU_CAPTURE_GC_DOMINANT                   (CP3)
    PASS_CPU_CAPTURE_CAUSE_UNRESOLVED              (CP5)
    PASS_CPU_CAPTURE_PROFILER_PERTURBATION_IDENTIFIED (CP4)

    CAPTURE_INSUFFICIENT
    HALT_REQUIRED_CPU_PROFILER_CAPABILITY_UNAVAILABLE
    HALT_CPU_PROFILER_PERTURBATION_TOO_HIGH
    HALT_REPOSITORY_TRUST

NO `REPAIRED` verdict is permitted in this ACT (per ACT §43).
