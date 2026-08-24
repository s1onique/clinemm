// projection.go converts the mvdan/sh v3.13.1 AST into the narrow JSON
// projection that the host runtime consumes.
//
// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 / Phase 1.D.
//
// mvdan/sh v3.13.1 model summary (relevant to this projection):
//
//   - Stmt is a STRUCT (not interface) with fields:
//        Cmd        Command      // interface
//        Background bool         // stmt &
//        Semicolon  Pos          // ; ; or &
//        Redirs     []*Redirect  // stmt-level redirects
//        ...
//   - Command is an interface implemented by *CallExpr, *Subshell,
//     *BinaryCmd, *IfClause, *WhileClause, *ForClause, *CaseClause,
//     *Block, *FuncDecl, *ArithmCmd, *TestClause, *DeclClause,
//     *LetClause, *TimeClause, *CoprocClause, *TestDecl.
//   - For `;` and `&` separators at the top level, parser.StmtsSeq
//     yields ONE Stmt per separated command (Background=true for &).
//   - BinaryCmd represents `&&`, `||`, `|` between two *Stmt (pointers).
//   - CallExpr has NO Redirs; all redirects live on the Stmt.
//   - Assign.Value is *Word, not *Lit. We project the Word.
//
// Project invariants (must equal the legacy binary frozen in
// .factory/oracle/REFERENCE_PROTOCOL_V2.json):
//
//   1. Stmt kinds preserved: cmd, and, or, pipe, subshell. All other
//      mvdan Command kinds (if/while/for/case/block/funcdecl/arithm/
//      testdecl/decl/let/time/coproc) project to {kind:"opaque"}.
//
//   2. Wrappers are detected by exact-form: name in {bash, sh, zsh,
//      mksh} AND first arg == "-c". wrapperOf mapping:
//        bash  -> "bash"
//        sh    -> "posix"
//        zsh   -> "zsh"
//        mksh  -> "mksh"
//      Any other shape (bash -lc, bash without -c, name=value bash -c)
//      is NOT a wrapper.
//
//   3. Word projection:
//      - Lit / SglQuoted      -> the literal value (bytes).
//      - DblQuoted            -> concatenation of static parts
//                               (Lit within the double-quoted) with
//                               non-static parts replaced as follows:
//                                 * ParamExp       -> "${...}"
//                                 * ArithmExp      -> "${...}"
//                                 * CmdSubst       -> "${...}"
//                                 * ProcSubst      -> "?"
//                                 * ExtGlob        -> "${...}"
//                                 * BraceExp       -> "${...}"
//      - Bare (unquoted) non-static parts:
//                                 * ParamExp       -> "${...}"
//                                 * ArithmExp      -> "${...}"
//                                 * CmdSubst       -> "$(...)"
//                                 * ProcSubst      -> "?"
//                                 * ExtGlob        -> "${...}"
//                                 * BraceExp       -> "${...}"
//      - For words composed entirely of Lit parts, use Word.Lit() (a
//        syntactic shortcut; the reviewer's caveat that Word.Lit()
//        does NOT prove absence of later shell expansion is irrelevant
//        here because we use it only for words that ARE pure Lit).
//
//   4. hasCommandSubstitution is true iff CmdSubst appears ANYWHERE in
//      the program (including inside DblQuoted, including as an
//      unquoted bare expression).
//
//   5. Assigns: parsed from `name=value` prefixes BEFORE the cmd name.
//      Assign.Value is projected as a Word (rule 3).
//
//   6. Redirects: op captured as the redirect operator string
//      (">", ">&", "<", ">>", "<<<", etc.). Path is the redirect
//      target Word, projected with rule (3). stmt-level redirects come
//      before CallExpr-level redirects (matches shell semantics).
//
//   7. Top-level stmt->stmts[] mapping: each *Stmt from parser.StmtsSeq
//      produces exactly one entry in program.stmts[]. The legacy helper
//      did NOT fold `&` or `;` separators into a stmt-list node; it
//      emitted one entry per separated command.
package main

import (
	"fmt"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

// PlaceholderExp is substituted for non-static WordParts in args[].
const PlaceholderExp = "${...}"

// PlaceholderCmdSubst is substituted for command-substitution WordParts
// that appear OUTSIDE of a DblQuoted. Inside a DblQuoted, CmdSubst is
// folded into the parent placeholder strategy (it becomes "${...}").
const PlaceholderCmdSubst = "$(...)"

// PlaceholderProcSubst is substituted for process-substitution WordParts
// (<(...) or >(...)) regardless of position. The legacy helper emits
// the literal byte "?" for any ProcSubst.
const PlaceholderProcSubst = "?"

// projectStmt projects a single mvdan *Stmt into the wire form. The
// returned map's "kind" key is the stmt kind per the protocol contract.
func projectStmt(stmt *syntax.Stmt, source string) map[string]any {
	if stmt == nil {
		return map[string]any{"kind": "opaque"}
	}
	switch c := stmt.Cmd.(type) {
	case *syntax.CallExpr:
		return projectCallExpr(c, stmt.Redirs, source)
	case *syntax.Subshell:
		return projectSubshell(c, source)
	case *syntax.BinaryCmd:
		return projectBinaryCmd(c, source)
	default:
		// IfClause, WhileClause, ForClause, CaseClause, Block,
		// FuncDecl, ArithmCmd, TestClause, DeclClause, LetClause,
		// TimeClause, CoprocClause, TestDecl: all opaque for v2.
		return map[string]any{"kind": "opaque"}
	}
}

// projectCallExpr converts a CallExpr into the "cmd" stmt form.
// stmt-level redirects (stmt.Redirs) are merged with the CallExpr's own
// redirects (in that order: stmt-level first, then expr-level, matching
// shell semantics where stmt-level redirects apply to the whole command).
func projectCallExpr(call *syntax.CallExpr, stmtRedirs []*syntax.Redirect, source string) map[string]any {
	assigns := make([]map[string]string, 0, len(call.Assigns))
	for _, a := range call.Assigns {
		assigns = append(assigns, map[string]string{
			"name":  a.Name.Value,
			"value": projectWord(a.Value),
		})
	}

	name := projectWord(call.Args[0])

	args := make([]string, 0, len(call.Args)-1)
	argProvenance := make([]string, 0, len(call.Args)-1)
	for _, w := range call.Args[1:] {
		args = append(args, projectWord(w))
		argProvenance = append(argProvenance, string(classifyWordProvenance(w, source)))
	}

	redirects := make([]map[string]string, 0)
	for _, r := range stmtRedirs {
		redirects = append(redirects, map[string]string{
			"op":   r.Op.String(),
			"path": projectWord(r.Word),
		})
	}

	cmd := map[string]any{
		"name":          name,
		"args":          args,
		"argProvenance": argProvenance,
		"assigns":       assigns,
		"redirects":     redirects,
		"isWrapper":     false,
		"wrapperOf":     "",
		"inner":         "",
	}

	if isW, dialect, inner := detectWrapper(name, args); isW {
		cmd["isWrapper"] = true
		cmd["wrapperOf"] = dialect
		cmd["inner"] = inner
	}

	return map[string]any{
		"kind": "cmd",
		"cmd":  cmd,
	}
}

// projectSubshell converts a Subshell into the wire form. The legacy
// projection flattens a multi-stmt subshell to the first child (per
// observed corpus behavior; see REFERENCE_PROTOCOL_V2.json id 02 etc.).
func projectSubshell(s *syntax.Subshell, source string) map[string]any {
	if len(s.Stmts) == 0 {
		return map[string]any{"kind": "opaque"}
	}
	return map[string]any{
		"kind":  "subshell",
		"inner": projectStmt(s.Stmts[0], source),
	}
}

// projectBinaryCmd converts a BinaryCmd (&&, ||, |) into the wire form.
func projectBinaryCmd(b *syntax.BinaryCmd, source string) map[string]any {
	kind := ""
	switch b.Op {
	case syntax.AndStmt:
		kind = "and"
	case syntax.OrStmt:
		kind = "or"
	case syntax.Pipe:
		kind = "pipe"
	default:
		return map[string]any{"kind": "opaque"}
	}
	return map[string]any{
		"kind": kind,
		"left": projectStmt(b.X, source),
		"rhs":  projectStmt(b.Y, source),
	}
}

// detectWrapper tests whether the call is a wrapper invocation.
//
// Rules (matching the legacy helper observed empirically against
// .factory/oracle/REFERENCE_PROTOCOL_V2.json):
//
//   - Program name MUST be one of: bash, sh, zsh, mksh.
//   - First arg MUST be exactly "-c".
//   - If both, wrapperOf is the dialect mapping and inner is args[1].
//
// Any other shape (bash without -c, bash -lc, name=value bash -c, etc.)
// is NOT a wrapper.
func detectWrapper(name string, args []string) (bool, string, string) {
	dialect, ok := map[string]string{
		"bash": "bash",
		"sh":   "posix",
		"zsh":  "zsh",
		"mksh": "mksh",
	}[name]
	if !ok {
		return false, "", ""
	}
	if len(args) == 0 || args[0] != "-c" {
		return false, "", ""
	}
	if len(args) < 2 {
		return true, dialect, ""
	}
	return true, dialect, args[1]
}

// projectWord joins the static parts of a syntax.Word into a single
// string, replacing any non-static WordPart with the appropriate
// placeholder.
//
// Shortcut: if the word is composed entirely of *Lit parts (no quotes,
// no expansions), use Word.Lit() directly.
func projectWord(w *syntax.Word) string {
	if w == nil {
		return ""
	}
	if lit := w.Lit(); lit != "" {
		// Word.Lit returns "" unless every part is a *Lit. If non-empty,
		// it's the joined literal string.
		return lit
	}
	var sb strings.Builder
	for _, part := range w.Parts {
		sb.WriteString(projectWordPart(part))
	}
	return sb.String()
}

func projectWordPart(part syntax.WordPart) string {
	switch p := part.(type) {
	case *syntax.Lit:
		return p.Value
	case *syntax.SglQuoted:
		// Single-quoted -> all bytes are literal.
		return p.Value
	case *syntax.DblQuoted:
		var sb strings.Builder
		for _, inner := range p.Parts {
			// CmdSubst inside a DblQuoted -> "${...}" (legacy behavior).
			if _, ok := inner.(*syntax.CmdSubst); ok {
				sb.WriteString(PlaceholderExp)
				continue
			}
			sb.WriteString(projectWordPart(inner))
		}
		return sb.String()
	case *syntax.CmdSubst:
		return PlaceholderCmdSubst
	case *syntax.ParamExp:
		return PlaceholderExp
	case *syntax.ArithmExp:
		return PlaceholderExp
	case *syntax.ProcSubst:
		// Legacy emits the literal byte "?" for any ProcSubst.
		return PlaceholderProcSubst
	case *syntax.ExtGlob:
		return PlaceholderExp
	case *syntax.BraceExp:
		// Brace expansion (e.g. {a,b}); always projects to placeholder.
		return PlaceholderExp
	default:
		// Defensive: any unknown WordPart projects to a placeholder.
		return PlaceholderExp
	}
}

// hasCmdSubst walks the program and returns true iff any CmdSubst
// appears anywhere in the AST (including inside DblQuoted).
func hasCmdSubst(stmt *syntax.Stmt) bool {
	if stmt == nil {
		return false
	}
	switch c := stmt.Cmd.(type) {
	case *syntax.CallExpr:
		for _, w := range c.Args {
			if wordHasCmdSubst(w) {
				return true
			}
		}
		for _, r := range stmt.Redirs {
			if wordHasCmdSubst(r.Word) {
				return true
			}
		}
	case *syntax.Subshell:
		for _, s := range c.Stmts {
			if hasCmdSubst(s) {
				return true
			}
		}
	case *syntax.BinaryCmd:
		return hasCmdSubst(c.X) || hasCmdSubst(c.Y)
	}
	return false
}

func wordHasCmdSubst(w *syntax.Word) bool {
	if w == nil {
		return false
	}
	for _, p := range w.Parts {
		if partHasCmdSubst(p) {
			return true
		}
	}
	return false
}

func partHasCmdSubst(part syntax.WordPart) bool {
	switch p := part.(type) {
	case *syntax.CmdSubst:
		return true
	case *syntax.DblQuoted:
		for _, inner := range p.Parts {
			if partHasCmdSubst(inner) {
				return true
			}
		}
	}
	return false
}

// fmtError formats a single syntax error for the errors[] array.
func fmtError(err error) string {
	if err == nil {
		return ""
	}
	return fmt.Sprintf("%s", err.Error())
}
