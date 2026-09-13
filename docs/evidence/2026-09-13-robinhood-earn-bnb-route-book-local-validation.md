# Robinhood Earn/DEX and BNB liquid route-book local validation

- Evidence level: `live_observed` for RPC reads; `repository_record` for code and tests
- Date: 2026-09-13
- Mutation: none; no signer, deployment or broadcast was used

## Automated checks

The route-book and RPC quote tests passed 8/8. The full `npm run check` gate then passed: 62 TypeScript tests were
discovered, 61 passed and one Linux-only lock migration scenario was skipped on macOS; Solidity compile, three positive
contract paths, 14 rejection boundaries, lint, formatting, typecheck, spec validation and secret scan all passed.

## Fixed-block readback

Command:

```bash
npm run shadow:cross-venue -- --once --output /tmp/atomic-cycle-final.json
```

Observed at `2026-09-13T07:34:45.119Z`:

| Chain     |       Block | Route templates | Fully quoted | Gross-positive | Gas-adjusted-positive | Provider requests |
| --------- | ----------: | --------------: | -----------: | -------------: | --------------------: | ----------------: |
| Robinhood |  61,782,983 |              80 |           60 |              4 |                     0 |               204 |
| BNB       | 121,606,638 |              80 |           70 |              0 |                     0 |               460 |

The best visible Robinhood hybrid was `WETH → AI → WETH`, entering on Uniswap V3 and exiting through the Earn stock
and meme pool. At the smallest observed principal, its gross edge was `0.000003057104939245 WETH`, but the conservative
Gas estimate plus risk reserve made estimated net value `-0.000049766495060755 WETH`. The next principal tier is only
probed when its route group remains gross-positive; these tiers are an observation ladder, not a live capital cap.

No route was eligible for execution. Gross-positive observations are retained as evidence that the widened route book
is finding different prices; they are not counted as profit and did not authorize a transaction.

## Identity readback

- Robinhood block `61,779,045`: the Earn Vault, BatchRouter and all three reviewed pools returned bytecode. The bounded
  registry verifier completed with chain ID `4663` and 20 requests.
- BNB block `121,605,826`: USDT, USDC, FDUSD, Cake, ETH and BTCB all returned bytecode, 18 decimals and the expected
  on-chain symbol (Cake's contract casing is preserved here; the product label remains CAKE).
