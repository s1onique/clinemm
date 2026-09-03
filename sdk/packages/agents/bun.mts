/// <reference types="@types/bun" />
export {};

// Externalize third-party runtime deps plus the provider/runtime layer that
// the Agent facade loads dynamically. `@cline/shared` stays bundled.
const external = ["@cline/llms", "nanoid"];
const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
// minify: true keeps identifier mangling active even when sourcemaps are enabled.
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		minify,
		sourcemap,
		packages: "bundle",
		external,
	},
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (thirty-second-pass) — package-internal entry point that
	// exports ONLY the runtime-trace install helper. This
	// subpath is NOT registered in `package.json` `exports`,
	// so external consumers (CLI, JetBrains, etc.) cannot
	// reach it via `import("@cline/agents/internal-w-trace")`
	// (the package system rejects unknown subpaths). The
	// single intended consumer is the ClineMM bridge, which
	// imports this file via a relative filesystem path
	// outside the package barrel.
	{
		entrypoints: ["./src/internal-w-trace.ts"],
		outdir: "./dist",
		target: "node",
		minify,
		sourcemap,
		packages: "bundle",
		external,
		// The entry's own output filename:
		naming: "internal-w-trace.js",
	},
];

for (const config of builds) {
	const result = await Bun.build(config);

	if (result.logs.length > 0) {
		for (const log of result.logs) {
			console.warn(log);
		}
	}
}
