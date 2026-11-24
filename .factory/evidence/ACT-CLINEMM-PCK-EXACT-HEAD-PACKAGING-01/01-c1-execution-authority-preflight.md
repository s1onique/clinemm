# ACT-CLINEMM-PCK-EXACT-HEAD-PACKAGING-01 — C1 EXECUTION-AUTHORITY PREFLIGHT

## The PRODUCTION schemas (INSPECTED, not assumed)

```text
sdk/packages/core/src/extensions/tools/schemas.ts

  RunCommandsInputSchema  (the CANONICAL, strict run_commands shape)
      { commands: string[], notifyOnCompletion?: boolean }
    .strict()
    The executable-bearing field is 'commands', an ARRAY of complete
    shell command strings.

    RunCommandsInputUnionSchema additionally accepts {command}, {cmd},
    a bare array and a bare string, and normalizeRunCommandsToolInput()
    canonicalises the confirmed Flint shape {command: "<JSON array>"}
    into {commands: [...]} BEFORE schema validation. So 'commands' is the
    field the runtime actually executes, and 'command' / 'cmd' are the
    accepted compatibility spellings of the SAME field.

  ReadFilesInputSchema
      { files: ReadFileRequest[] }
    A request carries 'path' (and the tolerant aliases 'file_path' /
    'filePath'). THERE IS NO EXECUTABLE COMMAND IN A READ REQUEST.
```

## The CANONICAL history representation (production fixtures)

```text
sdk/packages/core/src/extensions/context/evidence-continuity.test.ts
  toolCall("call_a", "run_commands", { commands: [\"helm template\"] })
```

## The DEFECT (RED_REPRODUCED against CORRECTION02)

```text
CORRECTION02 walked a GLOBAL key list:
  command, commands, query, script, path, file_path, filePath

The consequence was a FALSE ASSURANCE: a read_files call whose FILE PATH
was the string "make build" was classified as a BUILD INVOCATION and
reached tool_observed. A file named "make build" is not a command, and a
command is never inferred from a path.

RED:  3 failed | 5 passed (9 tests)
      expected [ 'make build' ] to deeply equal []
      expected 'tool_observed' to be 'model_reported'
```

## The CORRECTION (smallest conservative change)

```ts
export const COMMAND_EXECUTION_INPUT_FIELDS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  run_commands: Object.freeze(["commands", "command", "cmd"]),
});
```

The key walk is now SCOPED TO THE TOOL, using the PRODUCTION schema's
own boundary rather than a global list. The CLASSIFICATION itself is
UNCHANGED: classifyCommand() still does the work; this table only
decides WHICH VALUES are eligible to be classified. A tool that is not
listed contributes NO classification at all.

NO new classifier. NO vocabulary expansion. NO architecture change.
