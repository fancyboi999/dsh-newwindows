import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

let errorCount = 0
let warningCount = 0

function reportError(ruleId, filePath, lineNum, message, fixHint) {
  const relPath = path.relative(rootDir, filePath)
  console.error(`\x1b[31m[${ruleId}] ${relPath}:${lineNum} — ${message}\x1b[0m`)
  if (fixHint) {
    console.error(`      修复: ${fixHint}`)
  }
  errorCount++
}

function scanMarkdownFiles(dir) {
  const mdFiles = []
  if (!fs.existsSync(dir)) return mdFiles

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        mdFiles.push(...scanMarkdownFiles(fullPath))
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      mdFiles.push(fullPath)
    }
  }
  return mdFiles
}

// 检查 DL1: AGENTS.md 默认 <= 120 行
function checkDL1() {
  const agentsPath = path.join(rootDir, 'AGENTS.md')
  if (!fs.existsSync(agentsPath)) {
    reportError('DL1', agentsPath, 1, 'AGENTS.md 权威入口文件不存在', '在仓库根目录下创建 AGENTS.md')
    return
  }
  const content = fs.readFileSync(agentsPath, 'utf8')
  const lines = content.split(/\r?\n/)
  if (lines.length > 120) {
    reportError(
      'DL1',
      agentsPath,
      lines.length,
      `AGENTS.md 行数超出上限 (${lines.length} > 120 行)`,
      '将细节渐进披露到 docs/design.md、docs/dsh-integration.md 或 docs/validation.md，使顶层入口保持在 120 行以内。'
    )
  }
}

// 检查 DL2: 检查相对链接
function checkDL2(mdFiles) {
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split(/\r?\n/)

    lines.forEach((line, index) => {
      const lineNum = index + 1
      let match
      // 重置正则
      linkRegex.lastIndex = 0
      while ((match = linkRegex.exec(line)) !== null) {
        const rawTarget = match[2].trim()

        // 忽略外部链接、锚点以及协议伪链接
        if (
          rawTarget.startsWith('http://') ||
          rawTarget.startsWith('https://') ||
          rawTarget.startsWith('mailto:') ||
          rawTarget.startsWith('#')
        ) {
          continue
        }

        // 剥离目标中的内部锚点与参数
        const targetWithoutAnchor = rawTarget.split('#')[0].split('?')[0]
        if (!targetWithoutAnchor) {
          continue
        }

        const resolvedTarget = path.resolve(path.dirname(filePath), targetWithoutAnchor)
        if (!fs.existsSync(resolvedTarget)) {
          reportError(
            'DL2',
            filePath,
            lineNum,
            `链接目标不存在: ${rawTarget}`,
            `核查目标文件是否存在或相对路径是否正确。若目标已被移除或重构，更新或删除该链接：${targetWithoutAnchor}`
          )
        }
      }
    })
  }
}

function run() {
  console.log('--- 开始执行 docs-lint ---')

  const topLevelMd = ['AGENTS.md', 'README.md']
    .map(name => path.join(rootDir, name))
    .filter(p => fs.existsSync(p))

  const docsDir = path.join(rootDir, 'docs')
  const docsMd = scanMarkdownFiles(docsDir)
  const allMd = [...topLevelMd, ...docsMd]

  checkDL1()
  checkDL2(allMd)

  console.log(`扫描完成: 共检查 ${allMd.length} 个 Markdown 文档。`)

  if (errorCount > 0) {
    console.error(`\x1b[31mdocs-lint 失败: 发现 ${errorCount} 处错误。\x1b[0m`)
    process.exit(1)
  }

  console.log('\x1b[32mdocs-lint 通过: 所有检查项全绿。\x1b[0m')
}

run()
