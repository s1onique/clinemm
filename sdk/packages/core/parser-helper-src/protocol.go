// Package protocol defines the wire format between the host runtime and
// the parser helper. This is the same surface that lives in TypeScript at
// sdk/packages/core/src/runtime/command-policy/parser-helper/protocol.ts.
//
// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01.
//
// SCOPE (this ACT, Phase 2):
//
//   - Add per-arg shell-provenance provenance to the wire format
//     (`argProvenance: "static" | "dynamic" | "unknown"`) while
//     preserving the v2 surface (every existing field is unchanged).
//   - Bump PARSER_HELPER_PROTOCOL_VERSION to 3. v2 callers that read
//     v3 responses simply ignore the additive `argProvenance` field;
//     v3 callers that read v2 responses treat every arg as
//     `unknown` (fail-closed; see the classifier's protocolVersion
//     gate).
//   - DO NOT change expansion authority. The host does NOT resolve
//     cmd-subst / param-exp / arith / procsub. Provenance is
//     classifier-side information only.
//   - DO NOT fold quoted-`find` work into this cycle.
package main

// PARSER_HELPER_PROTOCOL_VERSION must match STRUCTURED_PROTO_VERSION in
// sdk/packages/core/src/runtime/command-policy/structured-command-risk.ts.
//
// v2 = frozen compatibility oracle.
// v3 = v2 projection + argProvenance (this ACT).
const PARSER_HELPER_PROTOCOL_VERSION = 3

// Dialect accepted on stdin. The legacy binary only honors bash for v2;
// v3 retains the same single-dialect surface.
type Dialect string

const (
	DialectBash Dialect = "bash"
)

// ParserHelperRequest is the JSON shape written to stdin.
type ParserHelperRequest struct {
	Dialect Dialect `json:"dialect"`
	Source  string  `json:"source"`
}

// ArgProvenance classifies one argument (Word) of a CallExpr.
//
// Invariant: classifier operates on the ORIGINAL *syntax.Word AST
// (never on a projected string).
type ArgProvenance string

const (
	// ProvenanceStatic means the argument, after shell expansion,
	// is provably a fixed string of literal bytes. This requires
	// SglQuoted / bare-safe-Lit / DblQuoted-of-static-parts
	// composition. Backslash-escapes are honored (echo \* -> "*"
	// is STATIC because the source bytes preserve the explicit
	// escape intent of the user).
	ProvenanceStatic ArgProvenance = "static"

	// ProvenanceDynamic means the argument contains (or may contain)
	// shell expansion that the classifier cannot prove static:
	// CmdSubst, ParamExp, ArithmExp, ProcSubst, ExtGlob, BraceExp,
	// or a bare-Lit whose source bytes contain unescaped
	// tilde / brace / glob / bracket / dollar / backtick.
	ProvenanceDynamic ArgProvenance = "dynamic"

	// ProvenanceUnknown means the classifier could not establish a
	// positive answer. Defaulted when the AST contains an unknown
	// WordPart subtype. Fail-closed.
	ProvenanceUnknown ArgProvenance = "unknown"
)

// ParsedShellJSON is the JSON shape written to stdout. Field names must
// match the TS ParsedShellJSON EXACTLY (the host runtime validates this
// shape).
//
// v3 adds ArgProvenance alongside Args inside each cmd projection.
// The length MUST equal Args' length. The TS host enforces the
// invariant; the Go side produces them in lockstep.
type ParsedShellJSON struct {
	ProtocolVersion       int                    `json:"protocolVersion"`
	ParseStatus           string                 `json:"parseStatus"` // "complete" | "failed"
	Dialect               string                 `json:"dialect"`
	SourceSha256          string                 `json:"sourceSha256"`
	HasCommandSubstitution bool                  `json:"hasCommandSubstitution"`
	Program               *StructuredProgramJSON `json:"program"`
	Errors                []string               `json:"errors"`
}

// StructuredProgramJSON mirrors TS StructuredProgramJSON.
type StructuredProgramJSON struct {
	Stmts []map[string]any `json:"stmts"`
}
