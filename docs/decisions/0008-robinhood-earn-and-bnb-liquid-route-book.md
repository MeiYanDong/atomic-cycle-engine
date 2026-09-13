# ADR 0008: prioritize Robinhood Earn/DEX hybrids and BNB liquid route families

- Status: Accepted
- Date: 2026-09-13

## Context

The continuous scanner had a generic 2–4 hop graph core but its production route book still contained only direct
two-hop Uniswap/PancakeSwap comparisons. That mismatch made the implementation look broader than the routes actually
quoted. Robinhood's separately operated EarnOnHood keeper already proved four Balancer-v3-style cycles, while BNB was
limited to three stablecoin targets even though its larger liquid venues include CAKE, pegged ETH and BTCB.

## Decision

1. Make Robinhood P0 and BNB P1 in the cross-chain discovery service. Base live remains independent and receives no
   new route engineering in this change.
2. Register the observed EarnOnHood Vault, BatchRouter and three reviewed pools as a distinct
   `EARNONHOOD / BALANCER_V3 / EARN_BALANCER_V3` source. Platform, protocol and liquidity venue remain separate.
3. Quote the four reviewed Earn cycles and every route formed by replacing exactly one Earn leg with one registered
   Robinhood DEX leg. This creates 4 Earn-only and 40 hybrid route templates without allowing an arbitrary pool from a
   website to enter the route book.
4. Expand BNB direct targets from USDT/USDC/FDUSD to also include CAKE, Binance-Peg ETH and BTCB. Add eight curated
   three-hop asset paths around USDT. Each leg asks all four registered DEX venues and selects the greatest exact output
   at the same fixed block. Because the three legs use different token pairs, the monotone exact-input composition is
   equivalent to enumerating every venue combination for that asset path while using fewer RPC requests.
5. Use a five-step geometric observation ladder per chain. A route group advances one step only when its current step
   remains gross-positive, and stops at the first non-positive step. These observation amounts are not an execution
   principal cap; any future live amount must be bounded by current route capacity, financing and the full-cost gate.
6. Charge 600,000 conservative Gas units for a two-hop route and another 200,000 units for each additional hop. This is
   a screening estimate, not a transaction gas receipt.
7. Keep the service credential-free. A positive quote is not executable unless a separate typed calldata path,
   complete simulation, signer/nonce ownership and receipt reconciliation exist. No BNB wallet funding or contract
   deployment is authorized by this ADR.

## Consequences

- Robinhood's configured route book grows from 36 direct DEX routes to 80 templates: 36 direct DEX, 4 Earn-only and
  40 Earn/DEX hybrid routes, including 26 three-hop routes.
- BNB grows from three to six direct assets and gains eight three-hop asset paths, for 80 route templates in total.
- Public-RPC use grows and remains observable in the snapshot. If latency or failure rates become unacceptable, cold
  scans must slow down or move to a measured provider lane; credentials must not be embedded in the public service.
- The independent Earn keeper remains the only typed execution path for the four exact Earn-only routes. Hybrid and BNB
  routes are quote-only until their own executor and fork tests are promoted.

## Promotion gate

A new route may enter live execution only after all of the following are true:

1. a current fixed-state quote is positive after measured full transaction cost;
2. pool, token and router semantics have explicit typed adapters and allowlists;
3. a real-chain fork exercises the complete atomic path and its failure boundaries;
4. one signer owns the nonce lane and the same raw transaction is used across any fanout;
5. the canonical receipt and base-asset balance effect can be reconciled; and
6. BNB execution also includes an explicit Builder/PBS submission and competition policy.
