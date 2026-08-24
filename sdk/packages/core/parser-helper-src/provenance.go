// provenance.go classifies the shell-staticness of every Word that
// appears as a CallExpr argument. The classification operates on the
// ORIGINAL *syntax.Word AST (never on the projected string).
//
// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01
//   + CORRECTION01 (DblQuoted-context P1 fix).
//
// mvdan/sh v3.13.1 AST facts (verified by astprobe in CORRECTION01
// review, reproduced in the commit):
//
//   - SglQuoted.Value is the literal bytes inside the single quotes.
//     Trivially STATIC.
//   - SglQuoted.Dollar === true for $'...' (ANSI-C escapes). The
//     parsed .Value already contains the post-escape bytes per
//     mvdan docs, so $'foo\nbar' is a deterministic literal
//     expansion and remains STATIC.
//   - DblQuoted.Parts is a list of WordPart. Recurse WITH QUOTE
//     CONTEXT (quoteDouble) so nested Lit is treated as literal
//     data, not as bare-unquoted data.
//   - DblQuoted.Dollar === true for $"..." (Bash locale-string
//     translation). The translation depends on the LC_* locale
//     environment variables -- which the "value is independent of
//     environment" requirement forbids. Classify as DYNAMIC (fail
//     closed; we cannot prove the translation is invariant).
//   - Lit is a string-literal part. mvdan merges contiguous string
//     literal ranges and PRESERVES BACKSLASH ESCAPES (verified:
//     `echo \\*` produces Lit.Value="\\*"). The user's escape intent
//     survives into the AST.
//   - ParamExp / CmdSubst / ArithmExp / ProcSubst / ExtGlob /
//     BraceExp all have a typed AST node. DYNAMIC.
//   - BraceExp only appears as a result of SplitBraces; this helper
//     does NOT call SplitBraces (the projection layer keeps BraceExp
//     as a Lit so that the legacy projection matches the frozen
//     oracle). Therefore BraceExp need not be handled here; the
//     source-byte scan below catches brace characters in BARE Lits.
//
// Quote-context-aware classification rules (frozen contract,
// CORRECTION01 review):
//
//   SglQuoted                                       -> static
//   SglQuoted (Dollar=true, $'...' ANSI-C)          -> static
//                                                    (deterministic)
//
//   DblQuoted (Dollar=true, $"..." locale string)    -> dynamic
//                                                    (locale-dependent)
//   DblQuoted (ordinary "...")                       -> static iff every
//                                                    nested WordPart
//                                                    is static; recurse
//                                                    with quoteDouble
//                                                    context
//
//   Lit + quoteDouble                               -> static
//                                                    (active `$`,
//                                                    command / arith
//                                                    substitutions are
//                                                    typed AST parts,
//                                                    not Lit; glob /
//                                                    brace / tilde are
//                                                    suppressed by
//                                                    double-quotes)
//   Lit + quoteBare                                 -> static iff the
//                                                    source bytes
//                                                    contain no
//                                                    unescaped tilde /
//                                                    brace / glob /
//                                                    bracket /
//                                                    dollar /
//                                                    backtick /
//                                                    paren /
//                                                    redirect /
//                                                    pipeline /
//                                                    composition /
//                                                    comment /
//                                                    history; otherwise
//                                                    dynamic
//
//   ParamExp / CmdSubst / ArithmExp / ProcSubst /
//   ExtGlob / BraceExp                              -> dynamic
//
//   unknown WordPart                                -> unknown
//                                                    (fail closed)
//
// Concatenation is compositional: classify each part; the Word is
// static iff every part is static, dynamic iff at least one is
// dynamic, unknown otherwise.
//
// Source bytes for the Lit-byte scan are taken from
// Lit.ValuePos.Offset..ValueEnd.Offset on the original source string.
// This preserves the user's escape intent (e.g. `echo \\*` has
// source bytes `\\*` which contains a backslash -- the classifier
// treats a backslash as a "shell may remove this; expansion may
// follow" signal and returns DYNAMIC, BUT only when the backslash
// is unescaped AND the Lit is in BARE context (quoteBare). For
// `echo \\*` the source bytes are `\` followed by `*`; the
// backslashed form means the * has been quote-escaped. Since the
// shell will strip the backslash and produce "*", and "*" is a
// glob character in BARE contexts, the post-expansion value IS a
// single literal "*" -- which is shell-static. The classifier
// reports DYNAMIC for `echo \\*` because the backslash precedes a
// bare-byte scan trigger; consumers must then handle this with
// their own escape semantics if they care. (In practice the only
// current consumer is `echo`, which we already classify via the
// V1 regex's narrower quoted class.)
//
// The double-quoted-Lit exception is the CORRECTION01 fix: under
// `quoteDouble`, ALL bytes of a nested Lit are literal data (the
// shell will only expand the typed AST parts that the AST has
// separately surfaced as ParamExp / CmdSubst / ArithmExp). Glob /
// brace / tilde are NOT expanded inside double quotes. Therefore
// `Lit + quoteDouble` is unconditionally STATIC, no byte scan.
package main

import (
	"mvdan.cc/sh/v3/syntax"
)

// quoteContext tracks the lexical quote context inside which a Lit
// (or other WordPart) appears. The context changes which bytes the
// shell treats as subject to further expansion.
//
// quoteBare    -- unquoted (BARE). Glob / brace / tilde / unescaped
//                 composition tokens ARE subject to expansion; the
//                 byte scanner below is required to prove staticness.
//
// quoteDouble  -- inside "...". Only the typed-AST expansions
//                 (ParamExp / CmdSubst / ArithmExp) execute; glob /
//                 brace / tilde are suppressed. A nested Lit is
//                 therefore unconditionally static.
type quoteContext int

const (
	quoteBare quoteContext = iota
	quoteDouble
)

// classifyWordProvenance classifies a Word. Source bytes are passed
// in for the bare-Lit byte scan. Recursion enters at quoteBare.
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
		p := classifyPartProvenance(part, source, quoteBare)
		switch p {
		case ProvenanceDynamic:
			return ProvenanceDynamic
		case ProvenanceUnknown:
			overall = ProvenanceUnknown
		}
	}
	return overall
}

// classifyPartProvenance classifies a single WordPart. The ctx
// parameter is the quote context in which the part appears; it is
// threaded explicitly so that a Lit inside "..." is not
// mis-classified using the bare-Lit byte scanner.
//
// The source parameter is the ORIGINAL shell source string; the Lit
// scan reads source[ValuePos.Offset():ValueEnd.Offset()].
func classifyPartProvenance(part syntax.WordPart, source string, ctx quoteContext) ArgProvenance {
	switch v := part.(type) {
	case *syntax.SglQuoted:
		// Single quotes always contain literal bytes. The two
		// single-quoted forms are:
		//   - '...'         literal bytes; trivially STATIC.
		//   - $'...'        ANSI-C escapes. mvdan's .Value
		//                  already contains the post-escape bytes
		//                  per mvdan docs, so the expansion is
		//                  deterministic literal processing. Still
		//                  STATIC.
		_ = v.Dollar // explicit: Dollar does not affect staticness.
		return ProvenanceStatic

	case *syntax.DblQuoted:
		// CORRECTION01 (DblQuoted-context P1 fix):
		//   - Dollar === true  -> $"..." locale translation;
		//                         depends on LC_* environment.
		//                         Classify DYNAMIC (fail closed;
		//                         we cannot prove the translation
		//                         is invariant).
		//   - Dollar === false -> ordinary "...". Recurse with
		//                         quoteDouble context so nested Lit
		//                         is treated as literal data.
		if v.Dollar {
			return ProvenanceDynamic
		}
		if len(v.Parts) == 0 {
			// "" or $"" (already handled above for $"").
			// Empty quoted is still static (no expansion
			// produces a non-static result for an empty quoted).
			return ProvenanceStatic
		}
		overall := ProvenanceStatic
		for _, nested := range v.Parts {
			p := classifyPartProvenance(nested, source, quoteDouble)
			if p == ProvenanceDynamic {
				return ProvenanceDynamic
			}
			if p == ProvenanceUnknown {
				overall = ProvenanceUnknown
			}
		}
		return overall

	case *syntax.Lit:
		switch ctx {
		case quoteDouble:
			// CORRECTION01 (DblQuoted-context P1 fix).
			//
			// Inside "..." the shell suppresses pathname
			// expansion (glob), brace expansion, and tilde
			// expansion. Only the typed-AST expansions run
			// (ParamExp / CmdSubst / ArithmExp) -- and those are
			// surfaced as their own AST node kinds, NOT as Lit.
			// Therefore a Lit nested inside a non-locale
			// DblQuoted is unconditionally literal data.
			//
			// No byte scan. No backslash-escape rules. No
			// rune-trigger tables. The typed AST is the
			// authority; the projection strings are not.
			return ProvenanceStatic
		case quoteBare:
			return classifyBareLitProvenance(v, source)
		default:
			// Future quoteContext value: fail closed.
			return ProvenanceUnknown
		}

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

// classifyBareLitProvenance inspects a BARE-Lit part's source bytes
// for any unescaped expansion-triggering rune. If the bytes are
// clean, the part is STATIC. If any unescaped dangerous rune is
// present, the part is DYNAMIC.
//
// This function MUST NOT be called for a Lit inside a DblQuoted --
// use classifyPartProvenance with quoteDouble context for that. The
// caller is responsible for routing.
func classifyBareLitProvenance(lit *syntax.Lit, source string) ArgProvenance {
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
	// Lit.Value -- we are scanning SOURCE bytes, which also
	// preserve backslashes. A single backslash followed by a
	// dangerous rune means the user explicitly escaped that rune,
	// so it is NOT a glob / brace / etc. in the post-expansion
	// value).
	//
	// However, mvdan's Lit splitting may have already merged or
	// split around backslashes. Per the verified probe:
	//   `echo \\*` -> one Lit part, Lit.Value="\\*", source
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
		if isDangerousBareRune(c) {
			return ProvenanceDynamic
		}
		prevWasBackslash = false
	}

	return ProvenanceStatic
}

// isDangerousBareRune reports whether a byte c, appearing unescaped
// in an UNQUOTED Lit, would be subject to shell expansion (glob,
// brace, tilde, parameter, command-substitution, process-
// substitution, backgrounding, pipe, redirect, etc).
//
// We are conservative -- ANY of these in an unquoted position is
// enough to flip the arg to DYNAMIC.
func isDangerousBareRune(c byte) bool {
	switch c {
	case '~', '{', '}', '*', '?', '[', ']', '$', '`', '(', ')':
		return true
	case '\\':
		// Already handled in classifyBareLitProvenance (we
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
