import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { arch, homedir, platform, release } from "node:os";
import { join } from "node:path";
import { readGlobalSettings, resolveClineDataDir } from "@cline/core";
import packageJson from "../package.json";
import { projectDiagnosticsGlobalSettings } from "./diagnostics-global-settings-projection";
import { projectDiagnosticsSession } from "./diagnostics-session-projection";
import { readSessionManifest } from "./paths";

/** How much of each log file (from the end) is included in the report. */
export const DIAGNOSTICS_LOG_TAIL_BYTES = 2 * 1024 * 1024;

/** How far back the hub log is scanned before routine polling is dropped. */
export const DIAGNOSTICS_HUB_LOG_SCAN_BYTES = 16 * DIAGNOSTICS_LOG_TAIL_BYTES;

// Clients poll these every few seconds. Their successful round trips filled
// the whole hub tail with a few hours of nothing, pushing out the runs a
// report is usually about. Only a start followed by its own successful end is
// dropped: unfinished and failed requests keep both lines.
const HUB_POLLING_COMMANDS = new Set([
	"session.list",
	"settings.list",
	"schedule.list",
	"schedule.upcoming",
	"schedule.list_executions",
	"schedule.active",
]);
const HUB_COMMAND_LINE = /"message":"command\.(start|end)","command":"([^"]+)"/;
const HUB_REQUEST_KEY = /"requestId":"([^"]*)","clientId":"([^"]*)"/;

export function dropHubPollingLines(text: string): string {
	const lines = text.split("\n");
	const dropped = new Set<number>();
	// Some clients reuse request ids, so pair each end with the latest start.
	const openStarts = new Map<string, number>();
	lines.forEach((line, index) => {
		const match = HUB_COMMAND_LINE.exec(line);
		if (!match || !HUB_POLLING_COMMANDS.has(match[2])) return;
		const ids = HUB_REQUEST_KEY.exec(line)?.slice(1).join(" ") ?? "";
		const key = `${match[2]} ${ids}`;
		if (match[1] === "start") {
			openStarts.set(key, index);
			return;
		}
		const start = openStarts.get(key);
		openStarts.delete(key);
		if (!line.includes('"ok":true')) return;
		dropped.add(index);
		if (start !== undefined) dropped.add(start);
	});
	return lines.filter((_, index) => !dropped.has(index)).join("\n");
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01
//
// The LOG TAILS are FREE-FORM text: there is no schema to project them
// through, so a key/value pattern alone cannot be the privacy boundary.
// The patterns below cover the credential SHAPES that the free-form text
// actually uses, each applied at the value position:
//
//   - `key: value` / `key=value` whose key names a secret. The value runs
//     to the end of the quoted string (spaces and all) or to the next
//     delimiter, so a multi-word secret is consumed whole.
//   - URL-EMBEDDED credentials (`https://user:password@host`). The password
//     is replaced and the rest of the URL is preserved, so the artifact
//     still shows WHICH host was involved.
//   - Authorization header values (`Authorization: Bearer <token>`). The
//     scheme word is preserved and the credential is replaced.
//   - Connection strings (`jdbc:postgresql://user:password@host/db`). The
//     userinfo is replaced and the rest of the string is preserved.
//
// The log tail is a LAST-RESORT surface: the structured parts of the report
// (the session projection, the global settings) are allowlisted and never
// reach this code at all.
const SECRET_FIELD_PATTERN =
	/((?:api[_-]?key|token|secret|password|passwd|credential|authorization|auth(?:orization)?[-_]?(?:header|key)|access[-_]?key[-_]?id|aws[-_]?access[-_]?key[-_]?id)"?\s*[:=]\s*"?)([^",}\s]+)/gi;
const SECRET_QUOTED_VALUE_PATTERN =
	/((?:api[_-]?key|token|secret|password|passwd|credential|authorization|auth(?:orization)?[-_]?(?:header|key)|access[-_]?key[-_]?id|aws[-_]?access[-_]?key[-_]?id)"?\s*[:=]\s*")(?:[^"\\]|\\.)*"/gi;
// The USERINFO of a URL: `scheme://<userinfo>@host`. The userinfo is either
// `user:password` or a bare `user`/`token`. The whole userinfo is replaced,
// and the host (and the path) are preserved so the artifact still shows
// WHICH server was involved.
const URL_EMBEDDED_CREDENTIAL_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi;
const AUTHORIZATION_SCHEME_PATTERN =
	/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// A CONNECTION STRING (`jdbc:postgresql://host:port/database`). Even without
// userinfo it identifies the production database and the cluster it lives
// in, so the whole connection target is replaced. The scheme is preserved so
// an analyst can still tell WHICH kind of database was involved.
const CONNECTION_STRING_PATTERN = /\b(jdbc:[a-z0-9+.-]*:\/\/)[^\s"']+/gi;

/**
 * Redact the credential-bearing shapes out of free-form text.
 *
 * This is a BEST-EFFORT filter for the log tails, which have no schema.
 * It is NOT the privacy boundary for the structured parts of the report:
 * those are built from a strict allowlist (see
 * `./diagnostics-session-projection.ts`) and are never passed through here.
 */
export function redactDiagnosticsText(text: string): string {
	const home = homedir();
	let result = text
		// The credential of an Authorization header FIRST: the generic
		// key/value pattern would otherwise consume the `Bearer` scheme word
		// and leave the token behind.
		.replace(AUTHORIZATION_SCHEME_PATTERN, "$1 <redacted>")
		// The quoted form: it consumes the whole quoted value.
		.replace(SECRET_QUOTED_VALUE_PATTERN, '$1<redacted>"')
		.replace(SECRET_FIELD_PATTERN, "$1<redacted>")
		// The userinfo of a URL or a connection string.
		.replace(URL_EMBEDDED_CREDENTIAL_PATTERN, "$1<redacted>@")
		// The target of a JDBC connection string.
		.replace(CONNECTION_STRING_PATTERN, "$1<redacted>");
	if (home) {
		// JSON-encoded Windows paths carry doubled backslashes.
		result = result
			.split(home)
			.join("~")
			.split(home.replaceAll("\\", "\\\\"))
			.join("~");
	}
	return result;
}

function readTail(path: string, maxBytes: number): string | null {
	if (!existsSync(path)) return null;
	let fd: number | undefined;
	try {
		const size = statSync(path).size;
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, length, size - length);
		const text = buffer.toString("utf8");
		if (length === size) return text;
		// Drop the partial first line so the tail starts on a record boundary.
		const newline = text.indexOf("\n");
		return newline === -1 ? "" : text.slice(newline + 1);
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

/** The last `maxBytes` of `text`, starting on a line boundary. */
function lastBytes(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text);
	if (buffer.length <= maxBytes) return text;
	const tail = buffer.subarray(buffer.length - maxBytes).toString("utf8");
	const newline = tail.indexOf("\n");
	return newline === -1 ? "" : tail.slice(newline + 1);
}

function formatStamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

function section(title: string, body: string): string {
	return `\n===== ${title} =====\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

export function buildDiagnosticsReport(
	sessionIds: string[],
	now = new Date(),
): { text: string; sessionIds: string[] } {
	const dataDir = resolveClineDataDir();
	const settings = readGlobalSettings();
	const report = {
		generatedAt: now.toISOString(),
		app: { name: packageJson.name, version: packageJson.version },
		system: {
			platform: platform(),
			arch: arch(),
			osRelease: release(),
			bun: process.versions.bun ?? null,
		},
		dataDir,
		// CORRECTION01: global settings are projected through a finite
		// allowlist. The complete object is never serialized because its
		// schema may gain fields whose values are not shareable.
		//
		// CORRECTION02: the allowlist is refined once more. Several of the
		// selected VALUES are unrestricted user strings (`tuiTheme`,
		// `disabledTools`, `disabledPlugins`, `disabledAgentPlugins`,
		// `cloudModelId`), so selecting their KEYS was not enough: a
		// sensitive string in `disabledPlugins` would have shipped
		// verbatim. The projection therefore publishes only validated
		// primitives (booleans and closed enums) and the COUNTS of the
		// free-form lists — never their entries.
		globalSettings: projectDiagnosticsGlobalSettings(settings),
		// Raw logs remain private; unrestricted free-form bodies cannot be
		// made safe by regex redaction.
		logs: { included: false, reason: "raw log bodies are private" },
	};
	let text = `${JSON.stringify(report, null, 2)}\n`;

	const includedSessions: string[] = [];
	for (const sessionId of new Set(sessionIds)) {
		if (!SESSION_ID_PATTERN.test(sessionId)) continue;
		const manifest = readSessionManifest(sessionId);
		if (!manifest) continue;
		// ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01: the manifest is PRIVATE
		// runtime state — its `prompt` and `metadata.title` are the user's
		// raw prompt, `metadata.git.url` can embed a credential, and
		// `messages_path` / `compaction_path` point at the PRIVATE canonical
		// conversation records. The export therefore carries a SCHEMA-DRIVEN,
		// ALLOWLISTED PROJECTION of the manifest, never the manifest itself.
		//
		// The canonical conversation records are NEVER read: the export only
		// ever opens the manifest.
		const projection = projectDiagnosticsSession(
			manifest,
			sessionId,
			homedir(),
		);
		text += section(
			`session ${sessionId}`,
			JSON.stringify(projection, null, 2),
		);
		includedSessions.push(sessionId);
	}

	return { text: redactDiagnosticsText(text), sessionIds: includedSessions };
}

export function resolveDiagnosticsOutputDir(): string {
	const downloads = join(homedir(), "Downloads");
	return existsSync(downloads)
		? downloads
		: join(resolveClineDataDir(), "diagnostics");
}

export function writeDiagnosticsReport(
	sessionIds: string[],
	outputDir = resolveDiagnosticsOutputDir(),
): { path: string; sessionIds: string[] } {
	const now = new Date();
	const report = buildDiagnosticsReport(sessionIds, now);
	// Bun on Windows can throw EEXIST from a recursive mkdir of an existing
	// directory, so only create the directory when it is actually missing.
	if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
	const path = join(
		outputDir,
		`cline-diagnostics-${packageJson.version}-${formatStamp(now)}.txt`,
	);
	writeFileSync(path, report.text);
	return { path, sessionIds: report.sessionIds };
}
