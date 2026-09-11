import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const REQUIRED_SECTIONS = [
  'objective',
  'opportunity',
  'timing',
  'profile',
  'decision',
  'execution',
  'recovery',
  'exit',
  'evidence',
  'capabilities',
  'race_thesis',
  'signal_strategy',
  'competition',
  'shot_policy',
  'race_timeline',
  'opportunity_census',
  'learning',
] as const

async function main(): Promise<void> {
  const path = resolve('spec/sniper-spec.json')
  const spec = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  const missing = REQUIRED_SECTIONS.filter(
    (section) => typeof spec[section] !== 'object' || spec[section] === null,
  )
  if (missing.length > 0) throw new Error(`missing object sections: ${missing.join(', ')}`)
  if (spec.spec_version !== '1.4') throw new Error('spec_version must be 1.4')
  if (spec.live_execution_authorized !== false) {
    throw new Error('phase 0 must explicitly disable live execution')
  }

  const profile = spec.profile as Record<string, unknown>
  const execution = spec.execution as Record<string, unknown>
  const capabilities = spec.capabilities as Record<string, Record<string, unknown>>
  if (profile.operation_mode !== 'shadow' || execution.mode !== 'shadow') {
    throw new Error('phase 0 operation and execution modes must both be shadow')
  }
  for (const capability of ['sign', 'broadcast']) {
    if (capabilities[capability]?.level !== 'UNSUPPORTED') {
      throw new Error(`${capability} must remain UNSUPPORTED in phase 0`)
    }
  }

  process.stdout.write(`local-spec-validator: VALID ${path}\n`)
}

await main()
