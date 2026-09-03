# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 03-authority-primitive

ENTRY_HEAD          = 03af027a9
HEAD_AT_BINDING     = 684356da8
branch              = main
working tree        = clean at ENTRY

## Q3 — Trace the current path-authority primitive

For the `editor` tool only (LIVE bind complete; apply_patch is
treated under Q4 conservation, not as a separate defect).

```text
INPUT_CONTROL         = model_supplied (the literal value of
                       input.path from the model tool_use
                       block; the SDK does NOT prepend or join
                       with anything; the executor treats the
                       value as the FINAL path. For LIVE
                       specimens E1 and E3 the values are
                       absolute.)

SANITIZATION         = NONE on the executor side. The
                       EditFileInputSchema (referenced from
                       definitions.ts:919) is a structural
                       zodToJsonSchema with no string-
                       sanitizer clause; the path is passed
                       through to fs operations verbatim.
                       (Note: this is a separate property
                        from the controller sanitizers used
                        by createSkillFile/createRuleFile
                        which DO strip /[^a-zA-Z0-9_-]/g on
                        the skillName component — those are
                        file-creation channels, not the
                        editor seam.)

LEXICAL_RESOLUTION   = path.isAbsolute / path.normalize /
                       path.relative as follows:
                         line 47  : const isAbsoluteInput =
                                    path.isAbsolute(inputPath)
                         line 48-50 : const resolved =
                                      isAbsoluteInput
                                        ? path.normalize(inputPath)
                                        : path.resolve(cwd,
                                                       inputPath)
                         line 60  : const rel = path.relative(
                                              cwd, resolved)
                         line 61  : if (rel.startsWith("..") ||
                                        path.isAbsolute(rel))
                                      throw ...
                       For absolute inputs, the only resolution
                       applied is normalize(), which collapses
                       .. lexically WITHOUT comparing against
                       cwd.
```

```text
BASE_SOURCE          = NONE on the executor side. The closure
                       receives cwd (== session workspaceRoot)
                       as the second argument but discards it
                       when inputPath is absolute. There is no
                       path.resolve(cwd, inputPath) branch
                       reachable for absolute inputs.

CONTAINMENT_CHECK    = NONE for absolute inputs. For relative
                       inputs only, a lexical containment
                       check against cwd is performed (line
                       60-62). This is the documented
                       "restrictToCwd" semantic.

EXISTING_ANCESTOR_CANONICALIZATION = NONE. The closure uses
                       path.normalize but does NOT call
                       fs.realpath on any ancestor before the
                       mutation; the LIVE specimens' target
                       directory (/Projects/Runtime/srs/.otel
                       -lab/tmp/) was non-existent and was
                       created by fs.mkdir at executor line
                       146, so a realpath guard at the mutation
                       site would have seen the path as
                       already-authorized regardless.

SYMLINK_HANDLING     = NONE. There is no fs.lstat or
                       fs.realpath check on the parent
                       components. A symlink
                       <authorized-root>/link ->
                       <outside-root> followed by an editor
                       write to <authorized-root>/link/file
                       would resolve effective-target to
                       <outside-root>/file via the OS lookup
                       and bypass the closure's lexical
                       containment check (which is only
                       active for relative paths anyway).
                       This case is unobserved at LIVE; it
                       is a structurally available seam
                       defect, captured in Q5 case D as a
                       RED probe (real production code path,
                       not an inferred synthesis).

NONEXISTENT_TARGET_HANDLING = NONE for absolute paths. The
                       closure normalizes and returns the
                       absolute target verbatim, then
                       createFile (line 144-151) calls
                       fs.mkdir(path.dirname(filePath),
                                { recursive: true })
                       followed by fs.writeFile on the
                       requested (and just-created) target.
                       The mkdir-recursive means the requested
                       target dir IS the resolved target
                       dir — no realpath gate, no ancestor
                       check, no cross-boundary comparison.

RACE_PROTECTION      = NONE. The closure performs its decision
                       once at the closure invocation; the
                       subsequent fs.mkdir + fs.writeFile are
                       separate syscalls with no TOCTOU fence
                       around them. A symlink placed after
                       this closure's return (race) would
                       redirect the eventual fs.writeFile
                       outside the closure's notion of cwd.
                       TOCTOU is a separate bounded follow-up
                       per ACT §11; it is NOT the
                       primary RED here.
```

## Q3 — Verdict

```text
CASE_CLASS              = CASE_E_WRONG_AUTHORIZED_ROOT
                          (the resolver uses an incorrect /
                          mismatched base/root — for absolute
                          inputs it ignores cwd entirely).
LOAD_BEARING_FRAMING    = the executor's explicit, JSDoc-
                          documented "Absolute paths are
                          always accepted as-is" branch
                          at line 56-58 of
                          editor.ts is the framing decision
                          that yields the bug class.
                          Defect is at the LEXICAL_RESOLUTION
                          step (no path.resolve for absolute),
                          not at the CONTAINMENT_CHECK step
                          (which is correct for relative paths).
Q3 STATUS               = BOUND
```

## Conserved authority substrate (no change)

```text
pathAuthorityEvidence (WorkspacePathAuthorityEvidence)
  - used by the shell side of command-policy; carries realpath
    of canonical roots and operand-level annotations
  - this ACT does NOT consume it for the editor seam today
  - this ACT identifies it as the natural carrier for the
    repair (see Q4)
```

Q4 = composition seam selection comes next.
