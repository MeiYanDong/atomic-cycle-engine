import assert from 'node:assert/strict'
import test from 'node:test'

import { enumerateSimpleCycles } from '../src/graph/enumerate-cycles.js'
import { asset, edge } from './fixtures.js'

void test('enumerates deterministic 2, 3, and 4 hop cycles', () => {
  const base = asset(1, 'BASE')
  const b = asset(2, 'B')
  const c = asset(3, 'C')
  const d = asset(4, 'D')
  const e = asset(5, 'E')
  const f = asset(6, 'F')
  const g = asset(7, 'G')

  const routes = enumerateSimpleCycles(
    [
      edge({ id: '2a', source: 'p2a', tokenIn: base, tokenOut: b }),
      edge({ id: '2b', source: 'p2b', tokenIn: b, tokenOut: base }),
      edge({ id: '3a', source: 'p3a', tokenIn: base, tokenOut: c }),
      edge({ id: '3b', source: 'p3b', tokenIn: c, tokenOut: d }),
      edge({ id: '3c', source: 'p3c', tokenIn: d, tokenOut: base }),
      edge({ id: '4a', source: 'p4a', tokenIn: base, tokenOut: e }),
      edge({ id: '4b', source: 'p4b', tokenIn: e, tokenOut: f }),
      edge({ id: '4c', source: 'p4c', tokenIn: f, tokenOut: g }),
      edge({ id: '4d', source: 'p4d', tokenIn: g, tokenOut: base }),
    ],
    base,
  )

  assert.deepEqual(routes.map((route) => route.edges.length).sort(), [2, 3, 4])
  assert.deepEqual(
    routes.map((route) => route.id),
    [...routes.map((route) => route.id)].sort(),
  )
})

void test('never treats both directions of one pool as a two-pool cycle', () => {
  const base = asset(1, 'BASE')
  const quote = asset(2, 'QUOTE')
  const routes = enumerateSimpleCycles(
    [
      edge({ id: 'forward', source: 'same-pool', tokenIn: base, tokenOut: quote }),
      edge({ id: 'reverse', source: 'same-pool', tokenIn: quote, tokenOut: base }),
    ],
    base,
  )
  assert.deepEqual(routes, [])
})

void test('rejects an edge whose asset identity crosses chains', () => {
  const base = asset(1, 'BASE')
  const foreign = asset(2, 'FOREIGN', 4663)
  assert.throws(
    () =>
      enumerateSimpleCycles(
        [edge({ id: 'foreign-a', source: 'foreign-a', tokenIn: base, tokenOut: foreign })],
        base,
      ),
    /cross-chain assets/,
  )
})
