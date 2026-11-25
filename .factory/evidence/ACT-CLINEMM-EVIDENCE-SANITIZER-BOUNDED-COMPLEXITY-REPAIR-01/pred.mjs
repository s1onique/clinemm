export function sanitizeOutcomeText(text) {
	return (
		text
			// KEY=value / KEY: value assignments whose key names a secret.
			// The value runs to the end of the quoted string (spaces and all)
			// or to the next delimiter, so a multi-word secret is consumed
			// whole rather than partially.
			.replace(
				/("?)((?:[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|auth[_-]?key|passphrase)[A-Za-z0-9_.-]*)\1\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;)\]}]+)/gi,
				"$1$2[REDACTED]",
			)
			// Bearer headers.
			.replace(
				/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
				"$1 [REDACTED]",
			)
			// PEM private key blocks.
			.replace(
				/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
				"[REDACTED PRIVATE KEY]",
			)
			// Common provider-shaped keys that are not key=value.
			.replace(
				/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
				"[REDACTED]",
			)
	);
}
