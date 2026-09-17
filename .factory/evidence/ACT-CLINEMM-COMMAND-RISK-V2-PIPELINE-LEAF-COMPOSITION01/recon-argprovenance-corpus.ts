// Verify parser-proven argProvenance on a broader corpus of realistic
// commands the user actually runs. These are the "reconnaissance"
// cases the original ACT §12 recon chain decomposes into.
import { MvdanShHelper } from "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"

const helper = new MvdanShHelper({
	platform: "darwin-arm64",
	binaryPath: () => "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper",
})

const cases = [
	// Realistic observational reader commands the user runs:
	"git log --oneline -5",
	"git log --oneline -20",
	"git log --oneline -5 origin/main",
	"git log --oneline -20 origin/main",
	"git log -n 10",
	"git log --stat -5",
	"git diff HEAD~1",
	"git diff --stat HEAD~1",
	"git show HEAD",
	"git show --stat HEAD",
	"git rev-parse HEAD",
	"git rev-parse --abbrev-ref HEAD",
	"git rev-list --count HEAD",
	"git branch --show-current",
	"head -30 some-file",
	"head -n 30 some-file",
	"head 30 some-file",
	"cat some-file",
	"wc -l some-file",
	"wc -l some-file other-file",
	"tail -20 some-file",
	"sort some-file",
	"uniq some-file",

	// Negative cases (must NOT pass parser-proven):
	"head $(rm -rf foo)",
	"head \"$HOME\"",
	"head ${HOME}/file",
	"head some-file; rm -rf foo",
	"head some-file | sh",
	"head some-file > /etc/passwd",
	"head some-file 2>&1 | tee /etc/passwd",
	"head --help",
	"head --version",
]

for (const cmd of cases) {
	const parsed = await helper.invoke({ command: cmd })
	if (!parsed || !parsed.program) { console.log(`NULL: ${cmd}`); continue }
	const stmt = parsed.program.stmts[0]
	if (stmt.kind !== "cmd") { console.log(`NOT-CMD: ${cmd}`); continue }
	const c = stmt.cmd
	console.log(`${cmd}`)
	console.log(`  name=${c.name} args=${JSON.stringify(c.args)} argProvenance=${JSON.stringify(c.argProvenance)} hasCmdSubst=${parsed.hasCommandSubstitution} redirects=${JSON.stringify(c.redirects)}`)
}
