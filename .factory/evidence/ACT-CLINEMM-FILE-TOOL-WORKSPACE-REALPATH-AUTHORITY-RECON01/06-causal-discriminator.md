# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 06-causal-discriminator

ENTRY_HEAD          = 03af027a9
HEAD_AT_BINDING     = 684356da8
branch              = main
working tree        = dirty (1 new test file under
                            sdk/packages/core/src/extensions/tools/executors/
                            editor.realpath-authority.test.ts;
                            no other tracked-file
                            modifications;
                            recon ACT does not stage test
                            files in this cycle per §14 —
                            leave staged for the repair ACT
                            to commit).

## Q9 — Causal discriminator

The discriminator changes ONE load-bearing variable and
demonstrates the defect is admitted by today's production
seam, not by the test fixture.

```text
PROD VARIABLE TO FLIP:
  sdk/packages/core/src/extensions/tools/executors/editor.ts
    resolveFilePath at lines 42-65.

  Specifically the closure branch at line 56-58:
    if (isAbsoluteInput) {
        return resolved;     // <-- "Absolute paths are
                                  accepted directly; cwd
                                  restriction applies to
                                  relative inputs."
    }

  Per file JSDoc (EditorExecutorOptions.restrictToCwd,
  lines 28-33):
    "Restrict relative-path file operations to paths
     inside cwd.
     Absolute paths are always accepted as-is."

VARIABLES HELD CONSTANT:
  - cwd (== authorizedRoot)            SAME
  - inputPath                          SAME (= outside target)
  - production code path               SAME
  - file system state                  SAME
  - test caller                        SAME
```

```text
DISCRIMINATOR TEST:
  Identical call, identical input, identical fs state.

  Yesterday: caller inputs absolute outside path
             (e.g. /outside-root/c.txt).
             resolveFilePath returns path.normalize(inputPath)
             unchanged. fs.mkdir + fs.writeFile
             proceed normally.
             Outcome: RED (mutation lands outside).

  With the documented "absolute paths are bypassed"
  semantic removed and the relative-only check
  applied unconditionally:
             resolveFilePath returns path.relative
             of the absolute-target vs cwd, which is
             "../outside-root/c.txt".
             rel.startsWith("..") === true, so the
             function throws "Path must stay within
             cwd". fs.mkdir never runs.
             Outcome: GREEN (mutation refused).

Chronology alone does NOT establish causality.
The single-variable flip is the absolute-input
branch of resolveFilePath's "bypass restrictToCwd"
decision — its existence IS the load-bearing defect.
```

## Discriminator against alternative framings

```text
ALT_FRAMING_1: "It's a sanitization defect."
  - REJECTED. The ClineMM controller sanitizers
    (createSkillFile etc.) DO strip
    /[^a-zA-Z0-9_-]/g, but those are file-creation
    channels that the editor tool does NOT pass
    through. The LIVE specimens used the editor tool
    directly with a sanitized-already absolute path;
    no further string-strip is required. The defect
    admits the path as-is regardless of its
    character set.

ALT_FRAMING_2: "It's a base source defect — the
  resolver uses the wrong base."
  - PARTIALLY ACCEPTED. The base source IS missing:
    for absolute inputs, the closure has no base at
    all; path.resolve(cwd, inputPath) is unreachable
    because the isAbsoluteInput branch on line 48-50
    substitutes path.normalize. This is the
    CASE_E_WRONG_AUTHORIZED_ROOT classification.

ALT_FRAMING_3: "It's a TOCTOU race."
  - REJECTED for the primary RED. The defect
    reproduces in ZERO race window — the executor
    itself returns the resolved path, immediately
    followed by fs.mkdir + fs.writeFile with no
    interceding await that could permit a swap.
    TOCTOU is a bounded follow-up per ACT §11
    (covered by a future ACT); not the primary.

ALT_FRAMING_4: "Symlink escape."
  - REJECTED for the primary RED. Case D (Q5 matrix)
    is unobserved at LIVE; the closure does perform
    a lexical containment check on relative inputs,
    but symlinked abs paths would still bypass
    containment identically to the live specimen.
    Structurally available; structurally unobserved.
    Captured as a future-ACT TOCTOU/symlink
    follow-up under ACT §11 + §13 conservation. Not
    the load-bearing defect here.
```

## Verdict

```text
CASE                          = CASE_E_WRONG_AUTHORIZED_ROOT
FIRST_BROKEN_BOUNDARY         = resolveFilePath at
                                 editor.ts:42-65, the
                                 isAbsoluteInput branch
                                 at line 56-58
ROOT_CAUSE                    = path.normalize() for
                                 absolute inputs in lieu
                                 of path.resolve(cwd, ...)
                                 + the
                                 restrictToCwd-bypass
                                 condition
DISCRIMINATOR                  = remove the absolute
                                 bypass; the
                                 relative-only check
                                 (line 60-62) refuses
                                 the LIVE target with
                                 the same error string
                                 it already uses for
                                 relative "../..."
                                 cases.
```

## STOP-RULE note

Per ACT §18, this ACT does NOT execute the repair; it
stops here and passes the bound Q1 evidence to the
already-planned repair ACT
ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-PATH-AUTHORITY-REPAIR01
which is hard-gated on this Q1 completion.

The single load-bearing fix has not yet been authored,
which means NECESSITY_ABLATION (Q12) cannot be exercised
in this ACT. It is the FIRST action the repair ACT must
perform after opening. This is also tracked in
12-live-qualification as LIVE_QUALIFICATION_GATE = PENDING
(turns over once the repair lands).
