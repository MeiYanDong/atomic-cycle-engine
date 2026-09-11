import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  parseAbiParameters,
  toHex,
  type TransactionReceipt,
} from 'viem'

import { BASE_EXECUTOR_ABI } from '../src/live/base-v2-v3/abi.js'
import type { BaseReadClient } from '../src/live/base-v2-v3/client.js'
import {
  reconcileReceipt,
  type ReceiptReconciliationPlan,
} from '../src/live/base-v2-v3/execution.js'
import { loadBaseLivePolicy } from '../src/live/base-v2-v3/policy.js'

const executor = getAddress('0x1000000000000000000000000000000000000001')
const token = getAddress('0x2000000000000000000000000000000000000002')
const v3Pool = getAddress('0x3000000000000000000000000000000000000003')
const routeHash = keccak256(toHex('route'))
const transactionHash = keccak256(toHex('transaction'))
const blockHash = keccak256(toHex('block'))

void describe('Base live receipt economics', () => {
  let endpoint = ''
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { l1Fee: '0x5' } }))
  })

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server has no port')
    endpoint = `http://127.0.0.1:${String(address.port)}`
  })

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    )
  })

  void it('subtracts L2 gas, L1 data fee and operator fee before recording success', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'base-live-reconcile-'))
    const ledgerPath = path.join(directory, 'attempts.jsonl')
    const policy = loadBaseLivePolicy({
      BASE_BROADCAST_RPC_URLS: endpoint,
      BASE_MIN_NET_PROFIT_WEI: '1',
    })
    const client = {
      getBlock: () => Promise.resolve({ hash: blockHash }),
      readContract: (request: { readonly functionName: string }) => {
        if (request.functionName === 'balanceOf') return Promise.resolve(1_100n)
        if (request.functionName === 'getOperatorFee') return Promise.resolve(7n)
        return Promise.reject(new Error(`unexpected function ${request.functionName}`))
      },
    } as unknown as BaseReadClient
    const plan: ReceiptReconciliationPlan = {
      attemptId: `test:${transactionHash}`,
      transactionHash,
      nonce: 0,
      executor,
      token,
      v3Pool,
      routeHash,
      v2First: true,
      amountIn: 500n,
      minimumProfit: 1n,
      executorWethBefore: 1_000n,
    }
    const topics = encodeEventTopics({
      abi: BASE_EXECUTOR_ABI,
      eventName: 'Executed',
      args: { routeHash, intermediateToken: token, v3Pool },
    })
    const receipt = {
      blockHash,
      blockNumber: 99n,
      status: 'success',
      gasUsed: 10n,
      effectiveGasPrice: 3n,
      logs: [
        {
          address: executor,
          topics,
          data: encodeAbiParameters(parseAbiParameters('bool,uint256,uint256,uint256'), [
            true,
            500n,
            600n,
            100n,
          ]),
        },
      ],
    } as unknown as TransactionReceipt

    const effect = await reconcileReceipt(client, policy, ledgerPath, plan, receipt)
    assert.equal(effect.outcome, 'RECONCILED_SUCCESS')
    assert.equal(effect.gasCost, 42n)
    assert.equal(effect.grossProfit, 100n)
    assert.equal(effect.economicNet, 58n)

    const record = JSON.parse((await readFile(ledgerPath, 'utf8')).trim()) as Record<
      string,
      unknown
    >
    assert.equal(record.l1Fee, '5')
    assert.equal(record.operatorFee, '7')
    assert.equal(record.gasCostWei, '42')
    assert.equal(record.economicNet, '58')
  })
})
