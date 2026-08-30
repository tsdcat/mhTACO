// 타코야키 박스 서버 부팅 래퍼 — tsx 를 띄우기 전에 서버 파일이 한 판으로 갖춰졌는지 먼저 대조한다.
//
// 깃허브 웹 업로드는 한 번에 100개까지만 올라가서, 새 판을 올릴 때 src 폴더의 일부만 덮이는 사고가 난다.
// 그 상태로 tsx 가 뜨면 import 단계에서 죽고, 호스팅 로그에는 'npm error path /app' 만 남아 원인을 알 수 없다.
// 그래서 여기서는 의존성 없이(설치가 덜 된 폴더에서도 돌게) 대조표(src/.filelist.json)를 먼저 맞춰 보고,
// 어긋나면 무엇을 해야 하는지 적고 끝낸다. 대조표가 없거나 깨졌으면 검사를 건너뛴다 —
// 이 확인 때문에 서버가 안 켜지면 본말전도다(index.ts 의 기동 후 검사와 같은 철학·같은 규격).
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, 'src')

/** index.ts 의 checkSourceSet 과 같은 규격 — 대조표의 파일 존재·sha256 을 맞춰 어긋난 이름을 모은다. */
function checkSourceSet() {
  const listPath = join(srcDir, '.filelist.json')
  if (!existsSync(listPath)) return []
  try {
    const want = JSON.parse(readFileSync(listPath, 'utf8'))
    const odd = []
    for (const [name, hash] of Object.entries(want)) {
      const p = join(srcDir, name)
      if (!existsSync(p)) {
        odd.push(`${name} (없음)`)
        continue
      }
      if (createHash('sha256').update(readFileSync(p)).digest('hex') !== hash) odd.push(`${name} (다른 판)`)
    }
    return odd
  } catch {
    return [] // 대조표가 깨졌으면 검사를 건너뛴다.
  }
}

const odd = checkSourceSet()
if (odd.length) {
  console.error(
    `[server] 서버 파일 ${odd.length}개가 없거나 다른 판입니다. 깃허브에 src 폴더를 통째로 다시 올려 주세요(웹 업로드는 한 번에 100개까지만 올라갑니다).\n` +
      `[server] 어긋난 파일: ${odd.slice(0, 8).join(', ')}${odd.length > 8 ? ` 외 ${odd.length - 8}개` : ''}`
  )
  process.exit(1)
}

// tsx 실행 파일을 찾아 지금 이 node 로 직접 띄운다 — npx/셸을 거치지 않는다.
// (Windows 의 npx.cmd 경유는 경로 공백·셸 정책에 잘 깨지고, 셸이 끼면 종료 신호가 자식까지 안 간다.)
function resolveTsxCli() {
  try {
    const require = createRequire(import.meta.url)
    return join(dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs')
  } catch {
    return join(here, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  }
}
const tsxCli = resolveTsxCli()
if (!existsSync(tsxCli)) {
  console.error('[server] tsx 를 찾지 못했습니다. 이 폴더에서 npm install 을 먼저 실행해 주세요.')
  process.exit(1)
}

const child = spawn(process.execPath, [tsxCli, join(srcDir, 'index.ts')], {
  cwd: here, // index.ts 가 data/·webdist 를 <cwd> 기준으로 잡는다 — 예전 `tsx src/index.ts` 와 같은 기준 유지
  stdio: 'inherit'
})

// 종료 신호는 자식에게 넘기고, 자식이 저장을 마치고 나가면 그 종료 코드로 따라 나간다.
// 호스팅이 새 판을 올릴 때 보내는 SIGTERM 이 index.ts 의 '저장하고 종료' 경로에 그대로 닿아야 한다.
// Windows 콘솔의 Ctrl+C 는 같은 콘솔의 자식에게도 직접 전달되므로 여기서 다시 쏘지 않는다 —
// Windows 의 kill 은 신호가 아니라 즉시 종료라, 한 번 더 쏘면 저장 중인 자식을 그 자리에서 끊는다.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (process.platform !== 'win32') child.kill(signal)
  })
}
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
child.on('error', (e) => {
  console.error('[server] 서버 프로세스를 시작하지 못했습니다:', e)
  process.exit(1)
})
