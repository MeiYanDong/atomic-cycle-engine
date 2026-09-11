import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'

type JsonPrimitive = boolean | null | number | string
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|mnemonic|password|private.?key|raw.?transaction|rpc.?url|secret|signed.?transaction|webhook)/i

function sanitizeUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:api|auth|key|secret|sig|token)/i.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    url.hash = ''
    return url.toString()
  } catch {
    return '[INVALID_URL]'
  }
}

export function sanitizeEvidence(value: unknown, key = ''): JsonValue {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return sanitizeUrl(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitizeEvidence(childValue, childKey),
      ]),
    )
  }
  return `[${typeof value}]`
}

export async function appendEvidence(
  filePath: string,
  event: Readonly<Record<string, unknown>>,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  const file = await open(filePath, 'a', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(sanitizeEvidence(event))}\n`, 'utf8')
  } finally {
    await file.close()
  }
}
