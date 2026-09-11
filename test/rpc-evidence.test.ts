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
  const client = new ReadOnlyRpcClient(
    'https://rpc.example/private-project?token=sensitive',
    (_endpoint, request) =>
      Promise.resolve({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -1, message: 'failed' },
      }),
  )
  await assert.rejects(client.request('eth_chainId'), (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    assert.match(message, /https:\/\/rpc\.example/)
    assert.doesNotMatch(message, /private-project|sensitive/)
    return true
  })
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
  })
  assert.deepEqual(sanitized, {
    documentation: 'https://docs.base.org/base-chain/api-reference/rpc-overview',
  })
})
