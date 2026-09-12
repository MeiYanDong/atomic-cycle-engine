import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { appendEvidence, sanitizeEvidence } from '../src/evidence/jsonl-store.js'
import { ReadOnlyRpcClient, type ReadOnlyRpcMethod } from '../src/rpc/read-only-client.js'

void test('read-only RPC rejects signing and broadcasting before transport', async () => {
  let calls = 0
  const client = new ReadOnlyRpcClient('https://rpc.example', (_endpoint, request) => {
    calls += 1
    return Promise.resolve({ jsonrpc: '2.0', id: request.id, result: '0x1' })
  })

  await assert.rejects(
    client.request('eth_sendRawTransaction' as ReadOnlyRpcMethod, ['0xdeadbeef']),
    /not read-only/,
  )
  assert.equal(calls, 0)
})

void test('RPC errors never expose endpoint paths or query credentials', async () => {
  let calls = 0
  const client = new ReadOnlyRpcClient('https://rpc.example/private-project?token=sensitive', {
    maxTransportAttempts: 3,
    transport: (_endpoint, request) => {
      calls += 1
      return Promise.resolve({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -1, message: 'failed' },
      })
    },
  })
  await assert.rejects(client.request('eth_chainId'), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    assert.match(message, /https:\/\/rpc\.example/)
    assert.doesNotMatch(message, /private-project|sensitive/)
    return true
  })
  assert.equal(calls, 1)
  assert.deepEqual(client.stats(), {
    logicalRequests: 1,
    providerRequests: 1,
    transportFailures: 0,
    recoveredTransportRequests: 0,
  })
})

void test('bounded read retry recovers thrown transport failures and counts actual requests', async () => {
  let calls = 0
  const client = new ReadOnlyRpcClient('https://rpc.example', {
    maxTransportAttempts: 2,
    transportRetryDelayMs: 0,
    transport: (_endpoint, request) => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error('temporary transport failure'))
      return Promise.resolve({
        jsonrpc: '2.0',
        id: request.id,
        result: '0x38',
      })
    },
  })

  assert.equal(await client.request('eth_chainId'), '0x38')
  assert.equal(calls, 2)
  assert.deepEqual(client.stats(), {
    logicalRequests: 1,
    providerRequests: 2,
    transportFailures: 1,
    recoveredTransportRequests: 1,
  })
})

void test('exhausted transport retries fail with a sanitized endpoint label', async () => {
  let calls = 0
  const client = new ReadOnlyRpcClient('https://rpc.example/private?token=sensitive', {
    maxTransportAttempts: 2,
    transportRetryDelayMs: 0,
    transport: () => {
      calls += 1
      return Promise.reject(new Error('private?token=sensitive'))
    },
  })

  await assert.rejects(client.request('eth_chainId'), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    assert.equal(message, 'RPC transport unavailable from https://rpc.example')
    return true
  })
  assert.equal(calls, 2)
  assert.deepEqual(client.stats(), {
    logicalRequests: 1,
    providerRequests: 2,
    transportFailures: 2,
    recoveredTransportRequests: 0,
  })
})

void test('a JSON-RPC error after a transport retry is not retried or counted as recovered', async () => {
  let calls = 0
  const client = new ReadOnlyRpcClient('https://rpc.example', {
    maxTransportAttempts: 3,
    transportRetryDelayMs: 0,
    transport: (_endpoint, request) => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error('temporary transport failure'))
      return Promise.resolve({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: 3, message: 'execution reverted' },
      })
    },
  })

  await assert.rejects(client.request('eth_call'), /execution reverted/)
  assert.equal(calls, 2)
  assert.deepEqual(client.stats(), {
    logicalRequests: 1,
    providerRequests: 2,
    transportFailures: 1,
    recoveredTransportRequests: 0,
  })
})

void test('read retry configuration is small and explicitly bounded', () => {
  assert.throws(
    () => new ReadOnlyRpcClient('https://rpc.example', { maxTransportAttempts: 4 }),
    /integer from 1 through 3/,
  )
  assert.throws(
    () => new ReadOnlyRpcClient('https://rpc.example', { transportRetryDelayMs: 1_001 }),
    /integer from 0 through 1000/,
  )
})

void test('evidence writer redacts secrets, serializes bigint, and uses owner-only mode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-cycle-evidence-'))
  const path = join(directory, 'events.jsonl')
  await appendEvidence(path, {
    amount: 12n,
    privateKey: '0xdo-not-store',
    sourceUrl: 'https://example.test/path?token=secret&block=12',
    webhook: 'https://open.feishu.cn/secret',
  })

  const content = await readFile(path, 'utf8')
  assert.match(content, /"amount":"12"/)
  assert.doesNotMatch(content, /do-not-store|open\.feishu|token=secret/)
  assert.match(content, /REDACTED/)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
})

void test('sanitizer preserves ordinary public evidence links', () => {
  const sanitized = sanitizeEvidence({
    documentation: 'https://docs.base.org/base-chain/api-reference/rpc-overview',
    optionalProtocolResult: undefined,
  })
  assert.deepEqual(sanitized, {
    documentation: 'https://docs.base.org/base-chain/api-reference/rpc-overview',
  })
})
