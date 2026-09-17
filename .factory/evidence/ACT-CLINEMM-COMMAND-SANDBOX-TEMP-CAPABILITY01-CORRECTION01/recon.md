# ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-CORRECTION01 — recon

## Gap

In ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01 (commit 938faa7bb),
the SeatbeltSandboxBackendExperimental.prepare() flow was:

  1. Canonicalize readonlyRoots / writableRoots / denyReadSubpaths
  2. IF cap.tempRoot supplied:
     - canonicalize cap.tempRoot
       - on failure: throw SandboxError (caller-supplied; nothing to clean)
     ELSE:
     - mkdtempSync(join(tmpdir(), "clinemm-sandbox-temp-"))  => synthesizedTempRoot
     - canonicalize synthesizedTempRoot
       - on failure: bestEffortRm(synthesizedTempRoot) + throw SandboxError  ✓
  3. generateSeatbeltProfile(...)
  4. mkdtempSync profile dir  => profileDir
  5. writeFileSync profile
     - on failure: bestEffortRm(profileDir) + throw SandboxError  ✓
  6. materializeEnvironment(...)
  7. return { ..., cleanup: () => bestEffortRm(profileDir); if (synthesizedTempRoot) bestEffortRm(synthesizedTempRoot) }

The pre-existing cleanup branches were:
  - synthesis canonicalization failure  -> cleans synthesizedTempRoot  ✓
  - profile-write failure              -> cleans profileDir           ✓

The MISSING branch:
  - profile generation failure         -> NOTHING cleaned
  - profile-dir creation failure       -> NOTHING cleaned
  - materialize environment failure    -> NOTHING cleaned

Any of these failures between successful synthesis and successful
return would leak /private/var/folders/.../T/clinemm-sandbox-temp-XXXXX.

## Fix scope

Wrap steps 3-6 in a single try/catch:

```ts
let profileDir: string | undefined
let profilePath: string | undefined
let materialized: ReturnType<typeof materializeEnvironment> | undefined
try {
    // 3) generate profile
    // 4) mkdtempSync profile dir
    // 5) writeFileSync profile
    // 6) materialize environment
} catch (cause) {
    if (profileDir) bestEffortRm(profileDir)
    if (synthesizedTempRoot) bestEffortRm(synthesizedTempRoot)
    throw cause
}
```

Caller-supplied `cap.tempRoot` is NEVER cleaned here; we never allocated
it. The `synthesizedTempRoot` we DID allocate is cleaned best-effort.

The post-allocation wrap also removes the existing inner cleanup
calls (the `bestEffortRm(profileDir)` inside the profile-write catch)
because the outer wrap handles it. This is a strict improvement:
no double-cleanup risk because `bestEffortRm` is idempotent (rmSync
with force: true is no-op if path doesn't exist).

## Test seam

`vi.mock("./seatbelt-profile", ...)` at file scope with a mutable
switch (`mockProfileState.shouldThrow`). The mock factory delegates
to `vi.importActual` when the switch is false (the real module), and
throws when the switch is true. This is the smallest viable DI seam
that affects the backend's static `import "./seatbelt-profile"`:

  - `vi.mock` is hoisted at file scope and intercepts all imports
  - outside the test, the real module behavior is unchanged
  - the throw is observed as a raw Error (not wrapped in SandboxError
    because the wrap is inside prepare(), and the mock throws at the
    generateSeatbeltProfile level, which IS inside the wrap and gets
    re-thrown via the wrap's `throw cause`)
  - both `bestEffortRm` calls fire on the throw path

## Tests added

```
CORRECTION01: profile generation failure cleans up the synthesized temp root
  -> mockProfileState.shouldThrow = true
  -> SeatbeltSandboxBackendExperimental.prepare({...})
  -> caught is not undefined
  -> leaked (a clinemm-sandbox-temp-XXX dir created during prepare()
     and still present after) is undefined

CORRECTION01: caller-supplied tempRoot is NOT touched on any failure
  -> pass cap.tempRoot = caller-created dir
  -> mockProfileState.shouldThrow = true
  -> expect(caller-created dir) to still exist after prepare() throws
```

Both run on any platform (they observe host-side cleanup, not
sandbox-exec behavior).
