import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  acquireLiveFence,
  appendLiveLedger,
  readLiveLedger,
  summarizeLiveLedger,
} from '../src/live/base-v2-v3/ledger.js'

void describe('Base live attempt ledger', () => {
  void it('blocks a new attempt until the signed plan has a terminal effect', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'base-live-ledger-'))
    const ledgerPath = join(directory, 'attempts.jsonl')
    const shared = {
      attemptId: 'attempt-1',
      transactionHash: `0x${'12'.repeat(32)}`,
      nonce: 7,
    }
    await appendLiveLedger(ledgerPath, { ...shared, stage: 'PLAN' })
    let summary = summarizeLiveLedger(await readLiveLedger(ledgerPath))
    assert.equal(summary.unresolvedAttempt?.attemptId, 'attempt-1')

    await appendLiveLedger(ledgerPath, {
      ...shared,
      stage: 'EFFECT',
      outcome: 'RECONCILED_SUCCESS',
      gasCostWei: '123',
      economicNet: '456',
    })
    summary = summarizeLiveLedger(await readLiveLedger(ledgerPath))
    assert.equal(summary.unresolvedAttempt, null)
    assert.equal(summary.reconciledSuccessCount, 1)
  })

  void it('counts only reconciled reverted gas against the failure cap', () => {
    const base = {
      schemaVersion: 1 as const,
      recordedAt: '2026-09-11T00:00:00.000Z',
      transactionHash: `0x${'34'.repeat(32)}`,
      nonce: 1,
    }
    const summary = summarizeLiveLedger([
      {
        ...base,
        attemptId: 'success',
        stage: 'EFFECT',
        outcome: 'RECONCILED_SUCCESS',
        gasCostWei: '100',
        economicNet: '300',
      },
      {
        ...base,
        attemptId: 'revert',
        stage: 'EFFECT',
        outcome: 'RECONCILED_REVERT',
        gasCostWei: '200',
      },
    ])
    assert.equal(summary.cumulativeFailedGasWei, 200n)
    assert.equal(summary.cumulativeEconomicNetWei, 300n)
    assert.equal(summary.reconciledRevertCount, 1)
  })

  void it('enforces one active local nonce owner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'base-live-fence-'))
    const first = await acquireLiveFence(directory)
    await assert.rejects(acquireLiveFence(directory), /already active/)
    await first.release()
    const second = await acquireLiveFence(directory)
    await second.release()
  })
})
