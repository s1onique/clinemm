// Package protocol defines the wire format between the host runtime and
// the parser helper. This is the same surface that lives in TypeScript at
// sdk/packages/core/src/runtime/command-policy/parser-helper/protocol.ts.
//
// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 / Phase 1.D.
//
// SCOPE (this ACT):
//   - Reconstruct protocol v2 field-for-field.
//   - DO NOT bump protocolVersion.
//   - DO NOT add shellStatic provenance here (deferred).
package main

// PARSER_HELPER_PROTOCOL_VERSION must match STRUCTURED_PROTO_VERSION in
// sdk/packages/core/src/runtime/command-policy/structured-command-risk.ts.
const PARSER_HELPER_PROTOCOL_VERSION = 2

// Dialect accepted on stdin. The legacy binary only honors bash for v2.
type Dialect string

const (
	DialectBash Dialect = "bash"
)

// ParserHelperRequest is the JSON shape written to stdin.
type ParserHelperRequest struct {
	Dialect Dialect `json:"dialect"`
	Source  string  `json:"source"`
}

// ParsedShellJSON is the JSON shape written to stdout. Field names must
// match the TS ParsedShellJSON EXACTLY (the host runtime validates this
// shape).
type ParsedShellJSON struct {
	ProtocolVersion       int                  `json:"protocolVersion"`
	ParseStatus           string               `json:"parseStatus"` // "complete" | "failed"
	Dialect               string               `json:"dialect"`
	SourceSha256          string               `json:"sourceSha256"`
	HasCommandSubstitution bool                `json:"hasCommandSubstitution"`
	Program               *StructuredProgramJSON `json:"program"`
	Errors                []string             `json:"errors"`
}

// StructuredProgramJSON mirrors TS StructuredProgramJSON.
type StructuredProgramJSON struct {
	Stmts []map[string]any `json:"stmts"`
}