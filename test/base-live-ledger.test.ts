import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  acquireLiveFence,
  appendLiveLedger,
  liveFenceBelongsToObservedProcess,
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
    const record = JSON.parse(await readFile(join(directory, 'nonce-owner.lock'), 'utf8')) as {
      readonly schemaVersion?: unknown
      readonly pid?: unknown
      readonly ownerToken?: unknown
    }
    assert.equal(record.schemaVersion, 2)
    assert.equal(record.pid, process.pid)
    assert.match(String(record.ownerToken), /^[0-9a-f-]{36}$/i)
    await assert.rejects(acquireLiveFence(directory), /already active/)
    await first.release()
    const second = await acquireLiveFence(directory)
    await second.release()
  })

  void it('distinguishes a live owner from PID reuse across boot and within one boot', () => {
    const record = {
      schemaVersion: 2 as const,
      pid: 779,
      createdAt: '2026-09-13T02:25:29.201Z',
      ownerToken: randomUUID(),
      bootId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      processStartTicks: '12345',
    }
    assert.equal(
      liveFenceBelongsToObservedProcess(record, {
        exists: true,
        bootId: record.bootId,
        processStartTicks: record.processStartTicks,
        bootedAtMs: Date.parse('2026-09-13T02:00:00.000Z'),
      }),
      true,
    )
    assert.equal(
      liveFenceBelongsToObservedProcess(record, {
        exists: true,
        bootId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        processStartTicks: record.processStartTicks,
        bootedAtMs: Date.parse('2026-09-13T03:27:59.000Z'),
      }),
      false,
    )
    assert.equal(
      liveFenceBelongsToObservedProcess(record, {
        exists: true,
        bootId: record.bootId,
        processStartTicks: '67890',
        bootedAtMs: Date.parse('2026-09-13T02:00:00.000Z'),
      }),
      false,
    )
    assert.equal(
      liveFenceBelongsToObservedProcess(
        { pid: 779, createdAt: '2026-09-13T02:25:29.201Z' },
        {
          exists: true,
          bootId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          processStartTicks: '67890',
          bootedAtMs: Date.parse('2026-09-13T03:27:59.000Z'),
        },
      ),
      false,
    )
  })

  void it('never releases a replacement fence owned by another process identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'base-live-fence-release-'))
    const lockPath = join(directory, 'nonce-owner.lock')
    const first = await acquireLiveFence(directory)
    const record = JSON.parse(await readFile(lockPath, 'utf8')) as Record<string, unknown>
    const replacementOwnerToken = randomUUID()
    await writeFile(
      lockPath,
      `${JSON.stringify({
        ...record,
        ownerToken: replacementOwnerToken,
      })}\n`,
    )

    await first.release()
    assert.equal(
      (JSON.parse(await readFile(lockPath, 'utf8')) as { ownerToken?: unknown }).ownerToken,
      replacementOwnerToken,
    )
    await rm(lockPath)
  })

  void it(
    'migrates a legacy pre-boot lock even when its PID was reused',
    { skip: process.platform !== 'linux' },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'base-live-fence-legacy-'))
      const lockPath = join(directory, 'nonce-owner.lock')
      await writeFile(
        lockPath,
        `${JSON.stringify({ pid: process.pid, createdAt: '1970-01-01T00:00:00.000Z' })}\n`,
        { mode: 0o600 },
      )

      const fence = await acquireLiveFence(directory)
      const migrated = JSON.parse(await readFile(lockPath, 'utf8')) as {
        readonly schemaVersion?: unknown
        readonly pid?: unknown
      }
      assert.equal(migrated.schemaVersion, 2)
      assert.equal(migrated.pid, process.pid)
      await fence.release()
    },
  )
})
