/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The EXPORT acceptance suite.
 *
 * RED-04 — "User cannot export through UI" — reproduced at ENTRY_HEAD:
 * there was no `cline.reportTaskProblem` command contribution, no
 * registry entry, no extension-host export handler and no webview
 * action that could reach the extension host.
 *
 * This suite now asserts the GREEN behavior:
 *
 *   G13  a UI action initiates a native ZIP export
 *   G14  the ZIP contains parseable, correctly correlated evidence
 *   G15  the default export excludes sensitive payloads
 *   G16  no network request or automatic upload occurs
 *   G17  the existing debug dump commands remain compatible
 *   G12  the exact build identity is preserved or marked unverified
 *   A1   the privacy sentinels appear NOWHERE in the decompressed ZIP
 *   A8   every included file's manifest hash, the archive structure
 *        and the schema are verified; unsafe paths are rejected
 *   A9   a mismatched build provenance is classified MISMATCH
 *
 * The archive is inspected by DECOMPRESSING it, not by reading the
 * in-memory bundle.
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionRegistryInfo } from "@/registry"
import { buildBuildRuntimeIdentity, verifyBuildProvenance } from "@/sdk/automatic-incident-build-identity"
import {
	captureAutomaticIncident,
	clearAutomaticIncidents,
	setAutomaticIncidentCaptureEnabled,
} from "@/sdk/automatic-incident-capture"
import {
	AUTOMATIC_INCIDENT_EXPORT_SCHEMA_VERSION,
	buildAutomaticIncidentExportBundle,
	capExportArray,
	capExportString,
	EXPORT_ARCHIVE_PATHS,
	sha256Hex,
	validateExportArchivePath,
	writeAutomaticIncidentZip,
} from "@/sdk/automatic-incident-export"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

const TASK_A = "task-a-1793899291382"
const SESSION_A = "session-a"
const REPORT_COMMAND = "cline.reportTaskProblem"

let tmp: string

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "aice01-export-"))
	clearAutomaticIncidents()
	setAutomaticIncidentCaptureEnabled(true)
})

afterEach(() => {
	setAutomaticIncidentCaptureEnabled(false)
	clearAutomaticIncidents()
	if (tmp && existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
})

/**
 * The privacy sentinels. NONE of them may appear anywhere in the
 * decompressed archive.
 */
const SENTINELS = {
	apiKey: "sk-sentinel-APIKEY-9f3a2b",
	password: "hunter2-sentinel-PASSWORD-4c7d1e",
	absolutePath: "/Users/sentinel-user/secret/workspace/file.txt",
	commandText: "echo sentinel-COMMAND-8b2f6a",
	stdoutSecret: "sentinel-STDOUT-1a9e4c leaked token",
	modelPrompt: "sentinel-PROMPT-3d8b7f please summarize this",
	gitRemoteCredential: "https://sentinel-user:sentinel-TOKEN@github.com/acme/private.git",
}

const buildIdentity = () => ({
	schemaVersion: 1,
	provenanceVerification: "UNOBSERVED" as const,
	runtimeInstanceId: "extension-host-test",
	extensionVersion: "9.9.9-test",
	hostPlatform: "darwin",
	hostArchitecture: "arm64",
	verificationNote: "no build provenance artifact was present",
})

const openIncident = () =>
	captureAutomaticIncident({
		identity: {
			sessionId: SESSION_A,
			taskId: TASK_A,
			epoch: 4,
			barrierId: "barrier-test-1",
			coordinatorInstanceId: "coord-test",
			extensionHostInstanceId: "host-test",
		},
		stage: "completion_held",
		outcome: "unresolved_containment_failure",
		detail: {
			holdReason: "unresolved_containment_failure",
			unresolvedContainmentFailureCount: 2,
			unconsumedTerminalCount: 1,
			// The sentinels are injected into the OBSERVED detail to
			// prove the exporter does NOT carry them through.
			leakedDetail: SENTINELS.commandText,
			leakedPath: SENTINELS.absolutePath,
		},
		blockingJobIds: ["cmd_mw3ttmsis0wqw9y7", "cmd_mw3ump8m1o4iwiwj"],
	})

describe("AICE01 G13/G17 — the user-facing action and the existing commands", () => {
	it("G13 — the report command is contributed AND registered", () => {
		const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8")) as {
			contributes?: { commands?: Array<{ command: string; title: string; category?: string }> }
		}
		const commands = pkg.contributes?.commands ?? []
		const contributed = commands.find((c) => c.command === REPORT_COMMAND)
		expect(contributed).toBeDefined()
		expect(contributed?.title).toBe("ClineMM: Report Task Problem")

		const registered = Object.values(ExtensionRegistryInfo.commands) as string[]
		expect(registered).toContain(REPORT_COMMAND)
	})

	it("G17 — the existing developer dump commands remain compatible", () => {
		const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8")) as {
			contributes?: { commands?: Array<{ command: string; title: string }> }
		}
		const commands = pkg.contributes?.commands ?? []
		const bundle = commands.find((c) => c.command === "cline.debug.dumpCompletionIncidentBundle")
		const authority = commands.find((c) => c.command === "cline.debug.dumpBackgroundJobLivenessAuthority")
		expect(bundle?.title).toBe("Cline: Dump Completion Incident Bundle")
		expect(authority?.title).toBe("Cline Debug: Dump Background Job Liveness Authority")
		const registered = Object.values(ExtensionRegistryInfo.commands) as string[]
		expect(registered).toContain("cline.debug.dumpCompletionIncidentBundle")
		expect(registered).toContain("cline.debug.dumpBackgroundJobLivenessAuthority")
	})
})

describe("AICE01 G14/A1/A8 — the archive contents", () => {
	it("G14/A1/A8 — the ZIP contains parseable, correlated, privacy-safe evidence", async () => {
		const incident = openIncident()
		const bundle = buildAutomaticIncidentExportBundle({
			incident: incident!,
			buildIdentity: buildIdentity(),
			containmentProvenance: {
				status: "available",
				protectedJobs: [{ jobId: "cmd_mw3ttmsis0wqw9y7", containmentFailed: "substrate_alive", postcondition: "alive" }],
			},
			phaseWriters: [{ writerId: "session-event-bcb-hold-resumable", phase: "resumable" }],
			continuationSummary: { status: "available", outcome: "stalled_no_progress" },
		})

		const zipPath = join(tmp, "clinemm-incident.zip")
		await writeAutomaticIncidentZip(bundle, zipPath)
		expect(existsSync(zipPath)).toBe(true)

		// --- DECOMPRESS and inspect the ACTUAL archive --------------
		const outDir = join(tmp, "unzipped")
		execFileSync("unzip", ["-q", zipPath, "-d", outDir], { stdio: "pipe" })

		const { readdirSync } = await import("node:fs")
		const entries = readdirSync(outDir).sort()
		expect(entries).toEqual([...EXPORT_ARCHIVE_PATHS].sort())

		// Every entry is a FLAT, relative, normalized name.
		for (const entry of entries) {
			expect(validateExportArchivePath(entry)).toBe(entry)
		}

		// --- The manifest is parseable and carries the hashes ---------
		const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as {
			schemaVersion: number
			incidentId: string
			files: Array<{ file: string; sha256: string; bytes: number }>
			loss: { loss: boolean }
			privacy: { excluded: string[] }
		}
		expect(manifest.schemaVersion).toBe(AUTOMATIC_INCIDENT_EXPORT_SCHEMA_VERSION)
		expect(manifest.incidentId).toBe(incident?.incidentId)
		expect(manifest.privacy.excluded).toContain("command bodies")

		// EVERY included file's hash matches its ACTUAL bytes.
		for (const file of manifest.files) {
			const actual = readFileSync(join(outDir, file.file), "utf8")
			expect(file.sha256, `hash mismatch for ${file.file}`).toBe(sha256Hex(actual))
			expect(file.bytes).toBe(Buffer.byteLength(actual, "utf8"))
		}

		// --- The summary is parseable and correlates -----------------
		const summary = JSON.parse(readFileSync(join(outDir, "summary.json"), "utf8")) as {
			incidentId: string
			hold: { blockingJobCount: number; unconsumedTerminalCount: number }
			reconciliation: { registered: number; resolved: number; exhausted: number; unknown: number }
			evidence: { classification: string; loss: boolean }
			observed: string[]
			notEstablished: string[]
		}
		expect(summary.incidentId).toBe(incident?.incidentId)
		expect(summary.hold.blockingJobCount).toBe(2)
		expect(summary.hold.unconsumedTerminalCount).toBe(1)
		expect(summary.evidence.classification).toBe("CAPTURE_INSUFFICIENT")
		expect(summary.observed.length).toBeGreaterThan(0)
		expect(summary.notEstablished.length).toBeGreaterThan(0)

		// --- The coverage is parseable and per-blocking-job ----------
		const coverage = JSON.parse(readFileSync(join(outDir, "coverage.json"), "utf8")) as {
			blockingJobIds: string[]
			coverage: Array<{ jobId: string; originalFailure: string; reconciliationTerminalOutcome: string }>
		}
		expect(coverage.blockingJobIds).toEqual(["cmd_mw3ttmsis0wqw9y7", "cmd_mw3ump8m1o4iwiwj"])
		expect(coverage.coverage).toHaveLength(2)
		expect(coverage.coverage[0].reconciliationTerminalOutcome).toBe("NOT_OBSERVED")

		// --- The timelines are JSONL -------------------------------
		const timeline = readFileSync(join(outDir, "completion-timeline.jsonl"), "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l) as { stage: string; detail: Record<string, unknown> })
		expect(timeline.length).toBeGreaterThan(0)
		expect(timeline[0].stage).toBe("completion_held")

		// --- A1: NONE OF THE SENTINELS APPEAR ANYWHERE ---------------
		for (const entry of entries) {
			const contents = readFileSync(join(outDir, entry), "utf8")
			for (const [name, sentinel] of Object.entries(SENTINELS)) {
				expect(contents.includes(sentinel), `sentinel ${name} leaked into ${entry}`).toBe(false)
			}
			// The absolute user path must not appear either.
			expect(contents.includes("/Users/")).toBe(false)
		}
	})

	it("A8 — the manifest declares its integrity contract and the member set matches", async () => {
		const incident = openIncident()
		const bundle = buildAutomaticIncidentExportBundle({
			incident: incident!,
			buildIdentity: buildIdentity(),
		})
		const zipPath = join(tmp, "clinemm-integrity.zip")
		await writeAutomaticIncidentZip(bundle, zipPath)
		const outDir = join(tmp, "unzipped-integrity")
		execFileSync("unzip", ["-q", zipPath, "-d", outDir], { stdio: "pipe" })

		const { readdirSync } = await import("node:fs")
		const members = readdirSync(outDir).sort()
		const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as {
			files: Array<{ file: string; sha256: string; bytes: number }>
			manifestIntegrity: {
				selfExcluded: boolean
				selfPath: string
				selfDigestPublishedOutOfBand: boolean
				memberCount: number
			}
		}

		// The contract is EXPLICIT, not implicit.
		expect(manifest.manifestIntegrity.selfExcluded).toBe(true)
		expect(manifest.manifestIntegrity.selfPath).toBe("manifest.json")
		expect(manifest.manifestIntegrity.selfDigestPublishedOutOfBand).toBe(true)

		// The manifest does NOT list itself among the hashed files.
		expect(manifest.files.map((f) => f.file)).not.toContain("manifest.json")

		// The member set is EXACTLY the listed files plus the manifest.
		const listed = manifest.files.map((f) => f.file).sort()
		expect(members).toEqual([...listed, "manifest.json"].sort())
		expect(manifest.manifestIntegrity.memberCount).toBe(members.length)

		// The manifest's OWN digest is published out of band, on the
		// bundle's hashes map, and it matches the archive's bytes.
		expect(bundle.hashes["manifest.json"]).toBe(sha256Hex(readFileSync(join(outDir, "manifest.json"), "utf8")))
	})

	it("A8 — unsafe archive paths are REJECTED", () => {
		expect(validateExportArchivePath("manifest.json")).toBe("manifest.json")
		expect(validateExportArchivePath("../escape.json")).toBeUndefined()
		expect(validateExportArchivePath("/etc/passwd")).toBeUndefined()
		expect(validateExportArchivePath("nested/file.json")).toBeUndefined()
		expect(validateExportArchivePath("C:\\windows\\system32")).toBeUndefined()
		expect(validateExportArchivePath("")).toBeUndefined()
		expect(validateExportArchivePath("with\0null.json")).toBeUndefined()
	})

	it("A8 — the exported strings and arrays are CAPPED", () => {
		expect(capExportString("x".repeat(1000))?.length).toBeLessThan(600)
		expect(capExportString(undefined)).toBeUndefined()
		const capped = capExportArray(Array.from({ length: 1000 }, (_, i) => i))
		expect(capped.items).toHaveLength(512)
		expect(capped.omitted).toBe(488)
	})
})

describe("AICE01 G12/A9 — the build identity", () => {
	it("G12/A9 — version disagreement is MISMATCH while bundle SHA remains independent", () => {
		const bundleSha = "a".repeat(64)
		const provenance = {
			schemaVersion: 1,
			sourceHead: "b5f1f9f54a915e19cd59f8d7cb8a2b7c938de3ea",
			extensionVersion: "4.1.26-b5f1f9f54",
			bundledExtensionSha256: bundleSha,
		}
		const runtimeVersion = "4.1.26-b5f1f9f54"
		expect(
			verifyBuildProvenance(provenance, bundleSha, {
				runtimeExtensionVersion: runtimeVersion,
				installedPackageVersion: runtimeVersion,
			}).verification,
		).toBe("VERIFIED")
		expect(
			verifyBuildProvenance(provenance, bundleSha, {
				runtimeExtensionVersion: "4.1.16-5a1c485cb",
				installedPackageVersion: runtimeVersion,
			}).verification,
		).toBe("MISMATCH")
		expect(
			verifyBuildProvenance(provenance, bundleSha, {
				runtimeExtensionVersion: runtimeVersion,
				installedPackageVersion: "4.1.16-5a1c485cb",
			}).verification,
		).toBe("MISMATCH")
		expect(
			verifyBuildProvenance(provenance, "b".repeat(64), {
				runtimeExtensionVersion: runtimeVersion,
				installedPackageVersion: runtimeVersion,
			}).verification,
		).toBe("MISMATCH")
	})

	it("G12 — an ABSENT provenance is UNOBSERVED, never VERIFIED", () => {
		const identity = buildBuildRuntimeIdentity({
			provenance: undefined,
			runtime: {
				runtimeInstanceId: "host-1",
				extensionVersion: "1.2.3",
				hostPlatform: "darwin",
				hostArchitecture: "arm64",
				onDiskBundleSha256: "abc",
			},
		})
		expect(identity.provenanceVerification).toBe("UNOBSERVED")
		expect(identity.verificationNote).toBeTruthy()
	})

	it("A9 — a MISMATCHED provenance is classified MISMATCH", () => {
		const verification = verifyBuildProvenance(
			{
				schemaVersion: 1,
				sourceHead: "deadbeef",
				bundledExtensionSha256: "aaa",
			},
			"bbb",
		)
		expect(verification.verification).toBe("MISMATCH")
		expect(verification.note).toBeTruthy()
	})

	it("G12 — a MATCHING provenance is VERIFIED", () => {
		const verification = verifyBuildProvenance(
			{ schemaVersion: 1, sourceHead: "deadbeef", bundledExtensionSha256: "aaa" },
			"aaa",
		)
		expect(verification.verification).toBe("VERIFIED")
	})

	it("G16 — the export module contains NO network call", async () => {
		const source = readFileSync(join(__dirname, "..", "automatic-incident-export.ts"), "utf8")
		expect(source).not.toMatch(/\bfetch\s*\(/)
		expect(source).not.toMatch(/\baxios\b/)
		expect(source).not.toMatch(/https?:\/\//)
	})
})
