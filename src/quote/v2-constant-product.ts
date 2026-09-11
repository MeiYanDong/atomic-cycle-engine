export interface V2QuoteInput {
  readonly amountIn: bigint
  readonly reserveIn: bigint
  readonly reserveOut: bigint
  readonly feeBps: number
}

/** Fee-aware x*y=k exact-input quote. It intentionally rounds down. */
export function quoteV2ExactInput(input: V2QuoteInput): bigint {
  if (input.amountIn <= 0n) throw new RangeError('amountIn must be positive')
  if (input.reserveIn <= 0n || input.reserveOut <= 0n) {
    throw new RangeError('reserves must be positive')
  }
  if (!Number.isInteger(input.feeBps) || input.feeBps < 0 || input.feeBps >= 10_000) {
    throw new RangeError('feeBps must be an integer in [0, 10000)')
  }

  const feeDenominator = 10_000n
  const amountInAfterFee = input.amountIn * BigInt(10_000 - input.feeBps)
  return (
    (amountInAfterFee * input.reserveOut) / (input.reserveIn * feeDenominator + amountInAfterFee)
  )
}
