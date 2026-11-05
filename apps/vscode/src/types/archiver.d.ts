/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The minimal ambient declaration for the EXISTING `archiver`
 * dependency.
 *
 * `archiver` is already declared in `apps/vscode/package.json`
 * (`dependencies.archiver`) and is already installed; it ships no
 * bundled type declarations and `@types/archiver` is not a dependency
 * of this workspace. The extension only needs the streaming surface it
 * actually uses, so the declaration below is deliberately NARROW: it
 * declares exactly the calls the incident exporter makes and nothing
 * more.
 *
 * Mirrors the existing `src/types/picomatch.d.ts` pattern.
 */
declare module "archiver" {
	import type { Writable } from "node:stream"

	type ArchiverOptions = {
		readonly zlib?: { readonly level?: number }
	}

	type ArchiverEntryData = {
		readonly name: string
	}

	type Archiver = {
		append(source: string | Buffer, entry: ArchiverEntryData): Archiver
		pipe(destination: Writable): Writable
		finalize(): Promise<void>
		on(event: "error", listener: (err: Error) => void): Archiver
	}

	function archiver(format: "zip", options?: ArchiverOptions): Archiver

	export default archiver
}
