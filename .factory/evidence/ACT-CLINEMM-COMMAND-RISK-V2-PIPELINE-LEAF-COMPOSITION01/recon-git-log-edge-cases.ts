import { MvdanShHelper } from "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"

const helper = new MvdanShHelper({
	platform: "darwin-arm64",
	binaryPath: () => "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper",
})

const cases = [
	// Open questions from C1 plan:
	"git log main..feature",
	"git log HEAD@{upstream}",
	"git log --grep foo",
	"git log --grep=foo",
	"git log --author=name",
	"git log --since=2024-01-01",
	"git log --until=2024-01-01",
	"git log -p",
	"git log --patch",
	"git log main",
	"git log main..HEAD",
	"git log HEAD..main",
	"git log --all",
	"git log --branches",
	// Tilde and caret expansion:
	"git log HEAD~1",
	"git log HEAD^",
	"git log HEAD^2",
	// Brace expansion:
	"git log {main,feature}",
	// globs:
	"git log -- '*.ts'",
	"git log -- 'src/**/*.ts'",
	// quoted refs:
	"git log 'main..feature'",
	"git log \"main..feature\"",
]

for (const cmd of cases) {
	const parsed = await helper.invoke({ command: cmd })
	if (!parsed || !parsed.program) { console.log(`NULL: ${cmd}`); continue }
	const stmt = parsed.program.stmts[0]
	if (stmt.kind !== "cmd") { console.log(`NOT-CMD: ${cmd}`); continue }
	const c = stmt.cmd
	console.log(`${cmd}`)
	console.log(`  args=${JSON.stringify(c.args)} argProvenance=${JSON.stringify(c.argProvenance)} hasCmdSubst=${parsed.hasCommandSubstitution}`)
}
