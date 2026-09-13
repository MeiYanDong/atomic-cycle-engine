import type { BaseReadClient } from './client.js'
import { quoteBaseTokenCycles, type BaseCycleQuote } from './quote.js'
import type { BaseCanaryToken } from './tokens.js'

export interface BaseTokenScan {
  readonly quotes: readonly BaseCycleQuote[]
  readonly failures: readonly string[]
}

export async function scanBaseTokens(
  client: BaseReadClient,
  tokens: readonly BaseCanaryToken[],
  amounts: readonly bigint[],
  concurrency = 3,
): Promise<BaseTokenScan> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new RangeError('Base token scan concurrency must be between one and eight')
  }
  const results: Array<readonly BaseCycleQuote[] | undefined> = Array.from(
    { length: tokens.length },
    () => undefined,
  )
  const failures: Array<string | undefined> = Array.from({ length: tokens.length }, () => undefined)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < tokens.length) {
      const index = nextIndex
      nextIndex += 1
      const token = tokens[index]
      if (token === undefined) continue
      try {
        results[index] = await quoteBaseTokenCycles(client, token, amounts)
      } catch (error) {
        failures[index] = `${token.symbol}:${error instanceof Error ? error.name : 'UNKNOWN_ERROR'}`
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tokens.length) }, async () => worker()),
  )
  return {
    quotes: results.flatMap((quotes) => quotes ?? []),
    failures: failures.filter((failure): failure is string => failure !== undefined),
  }
}
