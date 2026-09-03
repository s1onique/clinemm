/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION06-BUILD-EXPORT
 *
 * Package-surface compile witness for the `@cline/core` public barrel.
 *
 * Why this file exists:
 *
 *   The dogfood VSIX build runs
 *
 *     bun --production -F @cline/core build
 *       → bun ./bun.mts
 *       → bun tsc -p tsconfig.build.json
 *
 *   `tsconfig.build.json` emits the public `.d.ts` declarations
 *   (`declaration: true`, `emitDeclarationOnly: true`). Source-level
 *   consumers can resolve the SDK through deep-relative paths,
 *   `tsconfig.json` `paths`, or the workspace's test stub. None of
 *   those paths force the *package* barrel surface to compile.
 *
 *   As a result, a barrel re-export like
 *
 *     export { type TemporaryExternalPathAuthority } from
 *       "./runtime/command-policy/path-authority-evidence-builder"
 *
 *   can stay GREEN in feature tests, GREEN in apps/vscode typecheck,
 *   GREEN in webview typecheck, and RED at the exact-head package
 *   build with TS2305 — because the builder does not actually
 *   export `TemporaryExternalPathAuthority`. The canonical type
 *   lives in `./runtime/command-policy/path-authority-evidence`.
 *
 *   This witness imports from the public barrel (`../index`) and
 *   uses each imported member in the exported witness type below,
 *   so the compiler must resolve the entire transitive barrel
 *   surface. A drift between the barrel and its underlying source
 *   modules fails with TS2305 here, BEFORE any `.d.ts` is emitted
 *   by the real `tsconfig.build.json` build.
 *
 *   It is included in `tsconfig.witness.json`'s `include` list (a
 *   dedicated `--noEmit` tsconfig extending `tsconfig.build.json`).
 *   The witness tsconfig also includes `src/index.ts` itself, so
 *   the public barrel is compiled in the same `tsc` invocation as
 *   the witness. Running
 *
 *     bun tsc -p tsconfig.witness.json --noEmit
 *
 *   is the canonical regression gate.
 *
 * Rule (Factory doctrine):
 *
 *   If an ACT modifies `sdk/packages/core/src/index.ts` (the package
 *   barrel/public index), the package build is mandatory closure
 *   evidence — not just source typecheck.
 *
 *   Bun commands (canonical RED/GREEN gates):
 *
 *     bun --production -F @cline/core build
 *     bun tsc -p tsconfig.witness.json --noEmit
 */

import type {
	BuildPathEvidenceOptions,
	BuildPathEvidenceResult,
	TemporaryExternalPathAuthority,
	WorkspacePathAuthorityEvidence,
	WorkspacePathOperandEvidence,
} from "../index"

// Each imported member is consumed as a property of the exported
// witness type below. The compiler therefore MUST resolve every
// transitively-re-exported type from `../index` to the underlying
// source module. If any barrel re-export points at a module that
// does not export the symbol, tsc fails with TS2305.
export type PublicBarrelSurfaceWitness = {
	readonly TemporaryExternalPathAuthority: TemporaryExternalPathAuthority
	readonly WorkspacePathAuthorityEvidence: WorkspacePathAuthorityEvidence
	readonly WorkspacePathOperandEvidence: WorkspacePathOperandEvidence
	readonly BuildPathEvidenceOptions: BuildPathEvidenceOptions
	readonly BuildPathEvidenceResult: BuildPathEvidenceResult
}