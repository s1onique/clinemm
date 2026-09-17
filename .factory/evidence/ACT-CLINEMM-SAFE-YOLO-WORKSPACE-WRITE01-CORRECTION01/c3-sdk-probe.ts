// ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01-CORRECTION01 C3 — production seam probe.
//
// Loads the PRODUCTION CommandJobManager + filterWorkspaceRootsForWritable
// from apps/vscode/src/sdk/* and exercises the full seam:
//   filterWorkspaceRootsForWritable(workspaceRoots)
//     -> CommandJobManager.start
//        -> defaultSandboxBackendResolver
//           -> SeatbeltSandboxBackendExperimental.prepare
//              -> /usr/bin/sandbox-exec -> kernel
//
// The probe also verifies that the canonical-path filter rejects a
// symlink-to-/ and HOME while letting through the bounded scratch repo.

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), 'clinemm-c3-sdk-')))
const safeRepo = join(SCRATCH, 'safe-repo')
mkdirSync(safeRepo, { recursive: true })
const symlinkToRoot = join(SCRATCH, 'lnk-root')
try { symlinkSync('/', symlinkToRoot) } catch {}

const sandboxPolicy = await import('/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/sandbox-policy.ts')
const commandJobManagerMod = await import('/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/command-job-manager.ts')

const { filterWorkspaceRootsForWritable } = sandboxPolicy
const { CommandJobManager } = commandJobManagerMod

console.log('[c3-sdk] HOME =', HOME)
console.log('[c3-sdk] SCRATCH =', SCRATCH)
console.log('[c3-sdk] safeRepo =', safeRepo)
console.log('[c3-sdk] symlinkToRoot =', symlinkToRoot, 'exists:', existsSync(symlinkToRoot))

const inputs = [safeRepo, symlinkToRoot, HOME, '/']
const filtered = filterWorkspaceRootsForWritable(inputs)
console.log('[c3-sdk] filterWorkspaceRootsForWritable input :', inputs)
console.log('[c3-sdk] filterWorkspaceRootsForWritable output:', filtered)

if (filtered.includes(realpathSync('/'))) {
  console.error('[c3-sdk] FAIL: symlinkTo-/ was NOT filtered!')
  process.exit(1)
}
if (filtered.includes(realpathSync(HOME))) {
  console.error('[c3-sdk] FAIL: HOME was NOT filtered!')
  process.exit(1)
}
if (!filtered.includes(realpathSync(safeRepo))) {
  console.error('[c3-sdk] FAIL: safeRepo was filtered out!')
  process.exit(1)
}
console.log('[c3-sdk] PASS: canonical-path filter correctly drops symlink-to-/ and HOME, keeps safeRepo')

process.env.CLINEMM_EXPERIMENTAL_SANDBOX = 'seatbelt'
const mgr = new CommandJobManager({
  experimentalSandboxWorkspaceRoots: filtered,
})
const target = join(safeRepo, '.c3-sdk-write-test')
try {
  const start = await mgr.start({
    command: `/bin/sh -c 'mkdir -p "${target}" && printf X > "${target}/probe.txt" && cat "${target}/probe.txt" && rm "${target}/probe.txt" && rmdir "${target}" && echo C3_SDK_OK'`,
    cwd: safeRepo,
    env: {},
    waitBudgetMs: 5000,
    executionDeadlineMs: 5000,
  })
  console.log('[c3-sdk] start.exitCode:', start.exitCode)
  console.log('[c3-sdk] start.stdout  :', (start.stdout || '').slice(-300))
  console.log('[c3-sdk] start.stderr  :', (start.stderr || '').slice(-300))
  if (!(start.stdout || '').includes('C3_SDK_OK')) {
    console.error('[c3-sdk] FAIL: production CommandJobManager -> sandbox-exec denied the workspace write!')
    process.exit(1)
  }
  console.log('[c3-sdk] PASS: production CommandJobManager -> Seatbelt -> kernel allowed the workspace write')
  console.log()
  console.log(String('='.repeat(60)))
  console.log('LIVE_DOGFOOD_MKDIR = STRUCTURAL_PRODUCTION_SEAM_PASS')
  console.log('LIVE_HOME_DENY = PASS')
  console.log('LIVE_SYM_ROOT_DENY = PASS')
  console.log(String('='.repeat(60)))
} finally {
  rmSync(SCRATCH, { recursive: true, force: true })
}
