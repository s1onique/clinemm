// cline-parser-helper: protocol-v2 shell parser wrapper.
//
// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 / Phase 1.D.
//
// Wire protocol:
//
//	stdin:   JSON { "dialect": "bash", "source": "<bytes>" }
//	stdout:  JSON ParsedShellJSON (see protocol.go)
//	stderr:  diagnostic messages only
//	exit 0:  always (errors are reported in the JSON, not via exit code)
//
// Security contract (mirrors the TS-side contract):
//
//   1. NO SHELL INVOCATION. This binary is executed DIRECTLY by the
//      host via spawn (no `sh -c`).
//   2. STDIN is the request bytes only. No env-driven config. No
//      remote fetches. No network requirement.
//   3. STDOUT is a single JSON object; no extra writes.
//   4. PROTOCOL is JSON only. Any non-JSON output indicates a Go
//      runtime panic; the host treats that as malformed and falls
//      through to V1 (which is the legacy behavior frozen in the
//      oracle).
//
// Pinned dependency:
//
//	mvdan.cc/sh/v3 v3.13.1  (matches the legacy binary at commit a3c8d49b7)
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

func main() {
	// Read the full stdin request.
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		writeFatal("read stdin: " + err.Error())
		return
	}

	var req ParserHelperRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		writeFatal("parse request: " + err.Error())
		return
	}

	// Defaults: bash for missing/unknown dialect. The legacy binary
	// ignored unknown dialects and parsed as bash.
	dialect := req.Dialect
	if dialect == "" {
		dialect = DialectBash
	}

	// SHA-256 of the exact source bytes. The host independently
	// recomputes this digest and rejects mismatches.
	sum := sha256.Sum256([]byte(req.Source))
	sourceSha := hex.EncodeToString(sum[:])

	// Parse with mvdan/sh.
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))

	// Capture errors via StmtsSeq.
	var stmts []*syntax.Stmt
	var parseErr error
	for stmt, err := range parser.StmtsSeq(strings.NewReader(req.Source)) {
		if err != nil {
			parseErr = err
			break
		}
		if stmt != nil {
			stmts = append(stmts, stmt)
		}
	}

	// Build the response.
	resp := ParsedShellJSON{
		ProtocolVersion:        PARSER_HELPER_PROTOCOL_VERSION,
		Dialect:                string(dialect),
		SourceSha256:           sourceSha,
		HasCommandSubstitution: anyCmdSubst(stmts),
	}

	if parseErr != nil {
		resp.ParseStatus = "failed"
		resp.Program = nil
		resp.Errors = []string{parseErr.Error()}
	} else {
		resp.ParseStatus = "complete"
		resp.Errors = []string{}
		// Project each top-level stmt to its wire form.
		projected := make([]map[string]any, 0, len(stmts))
		for _, stmt := range stmts {
			projected = append(projected, projectStmt(stmt))
		}
		resp.Program = &StructuredProgramJSON{Stmts: projected}
	}

	out, err := json.Marshal(resp)
	if err != nil {
		writeFatal("marshal response: " + err.Error())
		return
	}
	_, _ = os.Stdout.Write(out)
}

// writeFatal emits a parseStatus=failed response with the given error
// message. Used when stdin or JSON marshaling fails; preserves
// protocol-v2 invariants.
func writeFatal(msg string) {
	resp := ParsedShellJSON{
		ProtocolVersion:        PARSER_HELPER_PROTOCOL_VERSION,
		Dialect:                "bash",
		SourceSha256:           "",
		ParseStatus:            "failed",
		HasCommandSubstitution: false,
		Program:                nil,
		Errors:                 []string{msg},
	}
	out, _ := json.Marshal(resp)
	_, _ = os.Stdout.Write(out)
}

// anyCmdSubst is true iff any stmt contains a CmdSubst.
func anyCmdSubst(stmts []*syntax.Stmt) bool {
	for _, stmt := range stmts {
		if hasCmdSubst(stmt) {
			return true
		}
	}
	return false
}
