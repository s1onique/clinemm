# SDK transport integration testing (C2.4-C)

When qualifying the REAL transport topology of an SDK class — e.g.
`@cline/core` `LocalRuntimeHost` — for an authority-boundary fixture,
there are several non-obvious gotchas:

1. **The `@cline/core` bundle minifier name-collides**
   `SqliteSessionStore` and `SqliteTeamStore` (and possibly other
   class pairs) both mangle to identifier `w4` in the bundled
   `dist/index.js`. The LAST one wins in the bundle's `export {...}`
   statement, so `import { SqliteSessionStore } from "@cline/core"`
   fails at runtime with `is not a constructor`.
   Workaround: import from a deep relative path or instantiate
   `LocalRuntimeHost` (which still mangles to a class-exported
   alias that DOES survive).

2. **`apps/vscode/vitest.config.ts` aliases `@cline/core`** to
   `src/test/cline-core-vitest-stub.ts`. The stub only exposes a
   handful of model-catalog helpers — internal classes like
   `LocalRuntimeHost`, `SessionRuntime`, `ClineCore`, etc. are
   NOT visible. To exercise the REAL class, place the test under
   `sdk/packages/core/src/runtime/host/` (where
   `local-runtime-host.subscribe-runtime-events.e2f-f1-correction01.test.ts`
   and `local-runtime-host.c24-c-transport.test.ts` already live) and
   import via deep relative path (`./local-runtime-host`).

3. **Test seam for `LocalRuntimeHost`** is the `createAgent` factory
   option, NOT a re-implementation of `subscribeRuntimeEvents`. The
   production class delegates to
   `options.createAgent ?? ((config) => new SessionRuntime(config))`
   at `local-runtime-host.ts:262`. A stand-in host (one that
   re-implements `subscribeRuntimeEvents` semantics) is acceptable
   as a **component-test** control but NOT as the sole evidence
   for real Local-to-wiring composition qualification.

# When you need the REAL host on the wiring side

If you need both ends of the seam to be the production classes
(real `LocalRuntimeHost` + real `subscribeCanonicalRuntimeEventsToShadow`
+ real `TaskShadowHostWiring`):

- Place the bridge test under `apps/vscode/src/sdk/__tests__/` next to
  the wiring.
- Use a DEDICATED `vitest.config.c2-4-c-bridge.ts` (next to the base
  `vitest.config.ts`) that adds:
    - `resolve.alias: { "@cline-internal/core/<path>": <absolute path> }`
      for the SDK classes you need to import (bypasses the
      `@cline/core` stub alias).
    - `server.fs.allow: [..., <sdkCoreRoot>]` so Vite can resolve
      files outside the apps/vscode project root.
- In the base `vitest.config.ts`, set
  `exclude: ["src/sdk/__tests__/real-local-to-shadow-bridge..."]`
  so the base config doesn't try to run the bridge test (it lacks
  the alias).

  This exclusion of the bridge test from the base config is
  STRUCTURALLY LEGAL. The dedicated bridge config / tsconfig /
  typecheck-wrapper own the bridge entirely.

- Create a DEDICATED `tsconfig.c2-4-c-bridge.json` that:
    - extends `tsconfig.json`,
    - sets `rootDir: "../.."` so it can include the SDK source files
      (and tests transitively pull them in via deep-relative imports),
    - re-declares ALL base `paths` (TS `paths` does NOT merge across
      `extends`; the bridge tsconfig must redeclare them plus the
      new `@cline-internal/core/...` aliases),
    - `include`s ONLY the bridge test file.

  The transitive production source will pull in baseline errors
  (e.g. `task-state-shadow.ts:169`) — these are inherited from the
  base config. See the next section.

- Add canonical-gate scripts in `apps/vscode/package.json`:
    - `test:vitest:c2-4-c-bridge` runs the dedicated bridge vitest
      config,
    - `check-types:c2-4-c-bridge` runs the bridge typecheck wrapper,
    - wire both into `ci:check-all` so a regression of the bridge
      breaks CI rather than passing the base sweep silently.

The reference implementation is at:

- `apps/vscode/src/sdk/__tests__/real-local-to-shadow-bridge.c24-c-correction01.test.ts`
  (the bridge test)
- `apps/vscode/vitest.config.c2-4-c-bridge.ts`
  (the bridge vitest config)
- `apps/vscode/tsconfig.c2-4-c-bridge.json`
  (the bridge typecheck project)
- `apps/vscode/scripts/check-types-bridge-with-baseline.ts`
  (the bridge typecheck baseline wrapper)
- `apps/vscode/baselines/c2-4-c-bridge-ts-baseline.json`
  (the frozen baseline file)
- `apps/vscode/package.json` scripts
  `test:vitest:c2-4-c-bridge` and `check-types:c2-4-c-bridge`.

# Handling transitive production-source TS errors

When the bridge tsconfig transitively pulls in production source
files (because the wiring imports the shadow comparator which
imports `TaskState` from `@cline/agents`), any pre-existing TS
errors in those files become visible. They are NOT bridge-test
errors — they are baseline errors in production wiring.

There are two ways to handle them:

(A) **Fix the production error** — usually the smallest possible
    patch, e.g. adding a missing type alias. Beware: fixing the
    error may unmask *latent* errors that were previously hidden
    by the unresolved type alias (TS treats `Cannot find name 'X'`
    as `any`, which suppresses downstream checks). Verify that
    the fix does not introduce new errors elsewhere.

(B) **Machine-enforced baseline wrapper** — `tsc` itself has no
    baseline concept, so we wrap it with a small Bun script that:
    1. runs `tsc -p tsconfig.c2-4-c-bridge.json --noEmit`,
    2. parses the diagnostic set into (file, line, col, code,
       message) tuples,
    3. canonicalizes them (sorted),
    4. compares against a frozen JSON baseline,
    5. exits 0 on exact match, exits 1 with ADDED / REMOVED
       reports on any drift.

    Use `BRIDGE_BASELINE_UPDATE=1` to refresh the baseline when
    a deliberate change is made (e.g. a production fix lands and
    the baseline shrinks).

Option (B) is the safer default: it preserves the architectural
state (the bridge test imports real production wiring) while
explicitly baselining the noise. Option (A) is preferable ONLY
when the production fix is genuinely small and well-understood.

# Lessons learned

1. **Excluding the bridge from the base config is legal** —
   the dedicated child project re-includes and typechecks it.
   The previous version of this file recommended "STOP, don't
   exclude"; that was wrong. The correct pattern is the
   dedicated-project approach with a baseline wrapper.

2. **A `tsc` script in `ci:check-all` is NOT a green gate on
   its own.** The presence of the script proves it ran; the
   exit code proves it passed. Use the wrapper for the bridge.

3. **TypeScript `paths` do NOT merge across `extends`.** Any
   child tsconfig that overrides `paths` must redeclare ALL
   the parent's entries.

4. **Transitive production-source errors are baseline errors.**
   A new diagnostic in `task-state-shadow.ts:169` is not a
   "regression" of the bridge — it is a regression of the
   production code, frozen in the baseline file.

5. **A diagnostic-baseline wrapper MUST validate the compiler process
   itself**, not only parse compiler text. Never refresh a baseline
   after spawn failure, signal termination, or non-diagnostic
   nonzero execution. Concretely: check `result.error`,
   `result.signal`, and `result.status` in addition to parsing
   stdout/stderr. Without these checks, an infrastructure failure
   producing zero parseable diagnostics would rewrite a baseline to
   `[]`, after which an identical failure would compare `[] == []`
   and pass — a false-pass hazard. The wrapper exits `2` (distinct
   from `0` clean / `1` drift) on infrastructure failure so CI logs
   distinguish "tsc broke" from "diagnostics drifted".

6. **Diagnostic reports must compare whole tuples, not JSON lines.**
   Splitting canonicalized JSON by `\n` fragments a single record
   across multiple lines (e.g. one record can produce three lines
   `"file": "..."`, `"line": N`, `"code": M`) so the FAIL report
   shows fragments, not coherent diagnostics. Use a single
   `JSON.stringify([file, line, col, code, message])` key and
   `Set` comparison. The exact canonical comparison still gates
   correctly either way; this is a forensic-quality fix.
