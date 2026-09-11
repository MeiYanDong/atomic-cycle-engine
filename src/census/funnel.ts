export type OpportunityOutcome =
  | 'NOT_OBSERVED'
  | 'OBSERVED_AFTER_EXPIRY'
  | 'OBSERVED'
  | 'NO_SHOT_NEGATIVE_EV'
  | 'NO_SHOT_POLICY'
  | 'BLOCKED_CORRECTNESS'
  | 'BLOCKED_RESOURCE'
  | 'ATTEMPTED'
  | 'WON'
  | 'LOST_RACE'
  | 'CONFIRMED_LOST_RACE'
  | 'LOW_VALUE_GUARD_EXIT'
  | 'INVALID_OPPORTUNITY_EXIT'
  | 'SHARED_CAPTURE'
  | 'UNKNOWN'

export interface OpportunityObservation {
  readonly candidateId: string
  readonly outcome: Exclude<OpportunityOutcome, 'NOT_OBSERVED'>
}

export interface ExactRatio {
  readonly numerator: number
  readonly denominator: number
}

export interface OpportunityFunnel {
  readonly chainwide: number
  readonly observed: number
  readonly attempted: number
  readonly won: number
  readonly confirmedRaceLosses: number
  readonly unknown: number
  readonly counts: Readonly<Record<OpportunityOutcome, number>>
  readonly observationRate: ExactRatio | null
  readonly raceWinRate: ExactRatio | null
}

const OUTCOMES: readonly OpportunityOutcome[] = [
  'NOT_OBSERVED',
  'OBSERVED_AFTER_EXPIRY',
  'OBSERVED',
  'NO_SHOT_NEGATIVE_EV',
  'NO_SHOT_POLICY',
  'BLOCKED_CORRECTNESS',
  'BLOCKED_RESOURCE',
  'ATTEMPTED',
  'WON',
  'LOST_RACE',
  'CONFIRMED_LOST_RACE',
  'LOW_VALUE_GUARD_EXIT',
  'INVALID_OPPORTUNITY_EXIT',
  'SHARED_CAPTURE',
  'UNKNOWN',
]

function emptyCounts(): Record<OpportunityOutcome, number> {
  return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<
    OpportunityOutcome,
    number
  >
}

/**
 * Build a denominator-safe funnel from a chain-wide candidate census. Each
 * candidate gets exactly one current outcome; absence is NOT_OBSERVED.
 */
export function buildOpportunityFunnel(input: {
  readonly chainwideCandidateIds: readonly string[]
  readonly observations: readonly OpportunityObservation[]
}): OpportunityFunnel {
  const chainwide = new Set(input.chainwideCandidateIds)
  if (chainwide.size !== input.chainwideCandidateIds.length) {
    throw new Error('chainwide candidate ids must be unique')
  }

  const byCandidate = new Map<string, OpportunityObservation>()
  for (const observation of input.observations) {
    if (!chainwide.has(observation.candidateId)) {
      throw new Error(`observation outside chainwide census: ${observation.candidateId}`)
    }
    if (byCandidate.has(observation.candidateId)) {
      throw new Error(`duplicate candidate observation: ${observation.candidateId}`)
    }
    byCandidate.set(observation.candidateId, observation)
  }

  const counts = emptyCounts()
  for (const candidateId of chainwide) {
    const outcome = byCandidate.get(candidateId)?.outcome ?? 'NOT_OBSERVED'
    counts[outcome] += 1
  }

  const attempted =
    counts.ATTEMPTED +
    counts.WON +
    counts.LOST_RACE +
    counts.CONFIRMED_LOST_RACE +
    counts.SHARED_CAPTURE +
    counts.UNKNOWN
  const raceDenominator = counts.WON + counts.CONFIRMED_LOST_RACE

  return {
    chainwide: chainwide.size,
    observed: chainwide.size - counts.NOT_OBSERVED,
    attempted,
    won: counts.WON,
    confirmedRaceLosses: counts.CONFIRMED_LOST_RACE,
    unknown: counts.UNKNOWN,
    counts,
    observationRate:
      chainwide.size === 0
        ? null
        : {
            numerator: chainwide.size - counts.NOT_OBSERVED,
            denominator: chainwide.size,
          },
    raceWinRate:
      raceDenominator === 0
        ? null
        : {
            numerator: counts.WON,
            denominator: raceDenominator,
          },
  }
}

export interface BlockGap {
  readonly fromBlock: bigint
  readonly toBlock: bigint
}

export type CoverageStatus = 'COMPLETE' | 'GAPPED' | 'LAGGING' | 'INVALID'

export interface CoverageWatermark {
  readonly status: CoverageStatus
  readonly requiredFromBlock: bigint
  readonly requiredThroughBlock: bigint
  readonly observedThroughBlock: bigint
  readonly gaps: readonly BlockGap[]
}

export function assessCoverage(input: {
  readonly requiredFromBlock: bigint
  readonly observedThroughBlock: bigint
  readonly canonicalHead: bigint
  readonly confirmationDepth: bigint
  readonly gaps: readonly BlockGap[]
}): CoverageWatermark {
  const invalidRange =
    input.requiredFromBlock < 0n ||
    input.observedThroughBlock < 0n ||
    input.canonicalHead < 0n ||
    input.confirmationDepth < 0n ||
    input.gaps.some(
      (gap) =>
        gap.fromBlock < input.requiredFromBlock ||
        gap.toBlock < gap.fromBlock ||
        gap.toBlock > input.observedThroughBlock,
    )
  const requiredThroughBlock =
    input.canonicalHead > input.confirmationDepth
      ? input.canonicalHead - input.confirmationDepth
      : 0n

  let status: CoverageStatus
  if (invalidRange || input.requiredFromBlock > requiredThroughBlock) status = 'INVALID'
  else if (input.gaps.length > 0) status = 'GAPPED'
  else if (input.observedThroughBlock < requiredThroughBlock) status = 'LAGGING'
  else status = 'COMPLETE'

  return {
    status,
    requiredFromBlock: input.requiredFromBlock,
    requiredThroughBlock,
    observedThroughBlock: input.observedThroughBlock,
    gaps: [...input.gaps],
  }
}
