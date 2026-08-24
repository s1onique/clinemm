// provenance.go classifies the shell-staticness of every Word that
// appears as a CallExpr argument. The classification operates on the
// ORIGINAL *syntax.Word AST (never on the projected string).
//
// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01.
//
// mvdan/sh v3.13.1 AST facts (verified by astprobe in CORRECTION01
// review, reproduced in the commit):
//
//   - SglQuoted.Value is the literal bytes inside the single quotes.
//     Trivially STATIC.
//   - DblQuoted.Parts is a list of WordPart. Recurse.
//   - Lit is a string-literal part. mvdan merges contiguous string
//     literal ranges and PRESERVES BACKSLASH ESCAPES (verified:
//     "echo \\*" produces Lit.Value="\\*"). The user's escape intent
//     survives into the AST.
//   - ParamExp / CmdSubst / ArithmExp / ProcSubst / ExtGlob /
//     BraceExp all have a typed AST node. DYNAMIC.
//   - BraceExp only appears as a result of SplitBraces; this helper
//     does NOT call SplitBraces (the projection layer keeps BraceExp
//     as a Lit so that the legacy projection matches the frozen
//     oracle). Therefore BraceExp need not be handled here; the
//     source-byte scan below catches brace characters in unquoted
//     Lits.
//
// Classification rules (frozen contract, CORRECTION01 review):
//
//   SglQuoted                              -> static
//   DblQuoted                              -> static iff every
//                                             nested part is static
//   ParamExp / CmdSubst / ArithmExp        -> dynamic
//   ProcSubst / ExtGlob                    -> dynamic
//   Lit (bare)                             -> static iff the literal
//                                             bytes contain no
//                                             unescaped tilde / brace
//                                             / glob / bracket /
//                                             dollar / backtick /
//                                             backslash /
//                                             unescaped ( or ) and
//                                             every rune is
//                                             shell-safe; otherwise
//                                             dynamic
//   other WordPart                         -> unknown (fail closed)
//
// Concatenation is compositional: classify each part; the Word is
// static iff every part is static, dynamic iff at least one is
// dynamic, unknown otherwise.
//
// Source bytes for the Lit-byte scan are taken from
// Lit.ValuePos.Offset..ValueEnd.Offset on the original source string.
// This preserves the user's escape intent (e.g. `echo \*` has
// source bytes "\\*" which contains a backslash -- the classifier
// treats a backslash as a "shell may remove this; expansion may
// follow" signal and returns DYNAMIC, BUT only when the backslash
// is unescaped. For the simple `echo \*` form the source bytes are
// `\` followed by `*`; the *backslashed* form means the * has been
// quote-escaped. Since the shell will strip the backslash and
// produce "*", and "*" is a glob character in unquoted contexts,
// the post-expansion value IS a single literal "*" -- which is
// shell-static.
//
// To capture this faithfully, the rule is:
//
//   - If the Lit.Value's source bytes contain an UNESCAPED rune in
//     {~, {, }, *, ?, [, ], $, `, (, ), \\, <, >, |, ;, &, #, !},
//     the part is DYNAMIC.
//   - "Unescaped" means: the rune is NOT immediately preceded by a
//     single backslash in the source bytes.
//   - A LONE trailing backslash (no following char) is also
//     DYNAMIC (line-continuation / quoting ambiguity).
//
// This faithfully captures both `echo \*` (STATIC; the * is escaped)
// and `echo foo*` (DYNAMIC; the * is bare).
package main

import (
	"mvdan.cc/sh/v3/syntax"
)

// classifyWordProvenance classifies a Word.
//
// All access to source bytes is via the original `source` parameter
// (never via the projected string).
func classifyWordProvenance(w *syntax.Word, source string) ArgProvenance {
	if w == nil {
		return ProvenanceUnknown
	}
	if len(w.Parts) == 0 {
		// An empty Word is shell-empty -- still static for
		// purposes of "no expansion happens". The TS validator
		// rejects empty args anyway.
		return ProvenanceStatic
	}
	overall := ProvenanceStatic
	for _, part := range w.Parts {
		p := classifyPartProvenance(part, source)
		switch p {
		case ProvenanceDynamic:
			return ProvenanceDynamic
		case ProvenanceUnknown:
			overall = ProvenanceUnknown
		}
	}
	return overall
}

// classifyPartProvenance classifies a single WordPart.
//
// The source parameter is the ORIGINAL shell source string; the Lit
// scan reads source[ValuePos.Offset():ValueEnd.Offset()].
func classifyPartProvenance(part syntax.WordPart, source string) ArgProvenance {
	switch v := part.(type) {
	case *syntax.SglQuoted:
		// Single quotes always contain literal bytes; the only
		// special form is $'...' which is also literal-after-
		// escapes (the parsed .Value already contains the
		// post-escape bytes per mvdan docs).
		return ProvenanceStatic

	case *syntax.DblQuoted:
		// Recurse into every nested part. A single dynamic
		// part flips the whole DblQuoted to dynamic.
		if len(v.Parts) == 0 {
			// "" or $"" -- empty / locale string. Still
			// static (no expansion produces a non-static
			// result for an empty quoted).
			return ProvenanceStatic
		}
		overall := ProvenanceStatic
		for _, nested := range v.Parts {
			p := classifyPartProvenance(nested, source)
			if p == ProvenanceDynamic {
				return ProvenanceDynamic
			}
			if p == ProvenanceUnknown {
				overall = ProvenanceUnknown
			}
		}
		return overall

	case *syntax.Lit:
		return classifyLitProvenance(v, source)

	case *syntax.ParamExp,
		*syntax.CmdSubst,
		*syntax.ArithmExp,
		*syntax.ProcSubst,
		*syntax.ExtGlob,
		*syntax.BraceExp:
		return ProvenanceDynamic

	default:
		// Future mvdan node kinds we do not recognize -> unknown
		// (fail-closed). This is the explicit reviewer-mandated
		// behavior for any WordPart subtype that arrives without
		// an explicit rule.
		return ProvenanceUnknown
	}
}

// classifyLitProvenance inspects a Lit part's source bytes for any
// unescaped expansion-triggering rune. If the bytes are clean, the
// part is STATIC. If any unescaped dangerous rune is present, the
// part is DYNAMIC.
func classifyLitProvenance(lit *syntax.Lit, source string) ArgProvenance {
	start := int(lit.ValuePos.Offset())
	end := int(lit.ValueEnd.Offset())
	if start < 0 || end < 0 || start > len(source) || end > len(source) || start > end {
		// Position info missing or out of range -> we cannot
		// prove the literal bytes. Fail closed.
		return ProvenanceUnknown
	}
	bytes := source[start:end]

	// Walk byte by byte; a rune preceded by a single unescaped
	// backslash is "escaped" (mvdan preserves backslashes into
	// Lit.Value -- wait: Lit.Value preserves backslashes. We are
	// scanning SOURCE bytes, which also preserve backslashes. A
	// single backslash followed by a dangerous rune means the
	// user explicitly escaped that rune, so it is NOT a glob /
	// brace / etc. in the post-expansion value).
	//
	// However, mvdan's Lit splitting may have already merged or
	// split around backslashes. Per the verified probe:
	//   "echo \\*" -> one Lit part, Lit.Value="\\*", source
	//   bytes for that Lit are "\\*" (two bytes: 0x5c 0x2a).
	// So the source-byte scan and the Lit-Value scan agree on
	// backslash-presence. We scan SOURCE BYTES because they
	// reflect the user's exact escape intent.
	prevWasBackslash := false
	for i := 0; i < len(bytes); i++ {
		c := bytes[i]
		// Track backslash-escape state across the bytes.
		if c == '\\' {
			prevWasBackslash = !prevWasBackslash
			// If the backslash itself is the LAST byte of the
			// Lit it is a dangling line-continuation; the shell
			// may join lines. Treat as DYNAMIC (fail-closed).
			if i == len(bytes)-1 {
				return ProvenanceDynamic
			}
			continue
		}
		// A backslash that escapes a NEWLINE means a line-
		// continuation that may merge with the next token.
		if c == '\n' {
			return ProvenanceDynamic
		}
		if prevWasBackslash {
			// The dangerous rune was escaped; safe.
			prevWasBackslash = false
			continue
		}
		// Check for unescaped dangerous rune.
		if isDangerousRune(c) {
			return ProvenanceDynamic
		}
		prevWasBackslash = false
	}

	return ProvenanceStatic
}

// isDangerousRune reports whether a byte c, appearing unescaped in
// an unquoted Lit, would be subject to shell expansion (glob,
// brace, tilde, parameter, command-substitution, process-
// substitution, backgrounding, pipe, redirect, etc).
//
// We are conservative -- ANY of these in an unquoted position is
// enough to flip the arg to DYNAMIC.
func isDangerousRune(c byte) bool {
	switch c {
	case '~', '{', '}', '*', '?', '[', ']', '$', '`', '(', ')':
		return true
	case '\\':
		// Already handled in classifyLitProvenance (we
		// never reach here for a backslash that was processed
		// as the escape marker). A bare backslash inside a
		// Lit without a following char is DYNAMIC.
		return true
	case '<', '>', '|', ';', '&', '#', '!':
		// Redirection / pipeline / background / comment
		// / history. Even unquoted inside what LOOKS like an
		// arg position these can split or comment-out later
		// text. Fail closed.
		return true
	}
	return false
}
