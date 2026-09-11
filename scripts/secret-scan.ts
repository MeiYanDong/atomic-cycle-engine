import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const ROOT = process.cwd()
const SKIP_DIRECTORIES = new Set(['.git', 'coverage', 'dist', 'node_modules', 'reports'])
const SENSITIVE_EXTENSIONS = new Set(['.key', '.p12', '.pem', '.pfx'])
const SECRET_PATTERNS: readonly [string, RegExp][] = [
  ['private key literal', /private[_-]?key\s*[:=]\s*["']0x[0-9a-f]{64}["']/i],
  ['mnemonic literal', /mnemonic\s*[:=]\s*["'][a-z]+(?:\s+[a-z]+){11,23}["']/i],
  ['Feishu webhook credential', /open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[0-9a-f-]{20,}/i],
  ['generic token literal', /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_-]{24,}["']/i],
]

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesBelow(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function main(): Promise<void> {
  const findings: string[] = []
  for (const path of await filesBelow(ROOT)) {
    const relativePath = relative(ROOT, path)
    if (relativePath.startsWith('.env') && relativePath !== '.env.example') {
      findings.push(`${relativePath}: environment file must not be committed`)
      continue
    }
    if (SENSITIVE_EXTENSIONS.has(extname(path).toLowerCase())) {
      findings.push(`${relativePath}: sensitive file extension`)
      continue
    }
    if (relativePath === 'package-lock.json') continue
    const content = await readFile(path, 'utf8').catch(() => '')
    for (const [label, pattern] of SECRET_PATTERNS) {
      if (pattern.test(content)) findings.push(`${relativePath}: ${label}`)
    }
  }
  if (findings.length > 0) throw new Error(`secret scan failed:\n${findings.join('\n')}`)
  process.stdout.write('secret-scan: PASS\n')
}

await main()
