import console from 'node:console'
import process from 'node:process'

import { formatEther } from 'viem'

import { createBaseReadClient } from '../live/base-v2-v3/client.js'
import { scanBaseTokens } from '../live/base-v2-v3/scan.js'
import { BASE_CANARY_TOKENS } from '../live/base-v2-v3/tokens.js'

function bigintFlag(name: string, fallbackValue: bigint): bigint {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallbackValue
  const raw = process.argv[index + 1]
  if (raw === undefined || !/^\d+$/.test(raw))
    throw new Error(`${name} requires an integer wei value`)
  return BigInt(raw)
}

const maximumAmount = bigintFlag('--max-amount-wei', 3_000_000_000_000_000n)
const amountGrid = [12n, 6n, 3n, 2n, 1n]
  .map((divisor) => maximumAmount / divisor)
  .filter((amount, index, values) => amount > 0n && values.indexOf(amount) === index)

const client = createBaseReadClient(process.env.BASE_READ_RPC_URL)

const scan = await scanBaseTokens(client, BASE_CANARY_TOKENS, amountGrid, 3)
const results = scan.quotes
const failures = scan.failures

const positives = results
  .filter((item) => item.disposition === 'POSITIVE_GROSS')
  .sort((left, right) => {
    const leftProfit = left.exactGrossProfit ?? 0n
    const rightProfit = right.exactGrossProfit ?? 0n
    return leftProfit === rightProfit ? 0 : leftProfit > rightProfit ? -1 : 1
  })
const quoteFailureCount = results.filter((item) => item.disposition === 'QUOTE_FAILED').length

console.log(
  JSON.stringify(
    {
      status: failures.length === 0 && quoteFailureCount === 0 ? 'COMPLETE' : 'PARTIAL',
      mode: 'READ_ONLY_GROSS_SCAN',
      tokenCount: BASE_CANARY_TOKENS.length,
      amountGridEth: amountGrid.map((amount) => formatEther(amount)),
      evaluatedRoutes: results.length,
      exactQuotedRoutes: results.filter((item) => item.exactAmountOut !== null).length,
      positiveGrossRoutes: positives.length,
      quoteFailureCount,
      topPositiveGross: positives.slice(0, 10).map((item) => ({
        symbol: item.token.symbol,
        direction: `${item.entryVenue}_TO_${item.exitVenue}`,
        entryFee: item.entryFee,
        exitFee: item.exitFee,
        amountInEth: formatEther(item.amountIn),
        grossProfitEth: item.exactGrossProfit === null ? null : formatEther(item.exactGrossProfit),
        blockNumber: item.blockNumber.toString(),
        blockHash: item.blockHash,
      })),
      failures,
      caveat:
        'Positive gross is not executable net profit. Contract gas, L1 data fee, safety buffer, full-call simulation, signer balance, live arm, and receipt reconciliation remain required.',
    },
    null,
    2,
  ),
)
