import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertBasePublicHeartbeat,
  projectBasePublicHeartbeat,
  writeBasePublicHeartbeat,
} from '../src/live/base-v2-v3/public-heartbeat.js'

const operator = '0xb756c304B5411B6dC3e7A6CBCD512Fad8eB6Dca7'
const executor = '0x5EA444843137c1d38D459a4862f3A3d798B49EeA'

function privateHeartbeat(): Readonly<Record<string, unknown>> {
  return {
    运行状态: '实盘监控中',
    钱包: operator,
    合约: executor,
    本轮检查路线: 350,
    毛利为正候选: 2,
    本轮最高毛利_ETH: '0.0000012',
    达到完整实盘门槛候选: 0,
    本轮是否广播: false,
    已确认盈利交易: 1,
    已确认回滚交易: 0,
    累计净利润_ETH: '0.0004',
    累计失败Gas_ETH: '0',
    最新观察区块: '12345678',
    更新时间: '2026-09-11T15:00:00.000Z',
    RPC异常源: ['provider details stay private'],
    主要拦截原因: ['完整合约模拟未达到利润底线'],
  }
}

void test('projects only the allowlisted public Base runtime fields', () => {
  const projected = projectBasePublicHeartbeat(privateHeartbeat())

  assert.equal(projected.runtimeStatus, 'RUNNING')
  assert.equal(projected.operator, operator)
  assert.equal(projected.executor, executor)
  assert.equal(projected.routesChecked, 350)
  assert.equal(projected.bestGrossProfitEth, '0.0000012')
  assert.equal(projected.fullLiveGateCandidates, 0)
  assert.equal(projected.primaryBlockReason, '完整合约模拟未达到利润底线')
  assert.equal(projected.confirmedProfitTransactions, 1)
  assert.equal(projected.verifiedNetEth, '0.0004')
  assert.equal('RPC异常源' in projected, false)
  assert.equal('主要拦截原因' in projected, false)
})

void test('writes a group-readable sanitized heartbeat without widening the private ledger', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'base-public-heartbeat-'))
  const file = path.join(directory, 'heartbeat.json')
  const originalUmask = process.umask(0o077)

  try {
    await writeBasePublicHeartbeat(file, privateHeartbeat())
  } finally {
    process.umask(originalUmask)
  }

  const metadata = await stat(file)
  assert.equal(metadata.mode & 0o777, 0o640)
  assert.equal(
    assertBasePublicHeartbeat(JSON.parse(await readFile(file, 'utf8'))).executor,
    executor,
  )
})

void test('rejects sensitive or malformed public heartbeat payloads', () => {
  const projected = projectBasePublicHeartbeat(privateHeartbeat())
  assert.throws(
    () => assertBasePublicHeartbeat({ ...projected, rpcUrl: 'https://provider.example/key' }),
    /forbidden sensitive field/,
  )
  assert.throws(
    () => assertBasePublicHeartbeat({ ...projected, note: 'not allowlisted' }),
    /outside the allowlist/,
  )
  assert.throws(() => projectBasePublicHeartbeat({ 更新时间: 'not-a-time' }), /valid update time/)
})
