# ADR 0003: add independent Robinhood and BNB venues as shadow-only capabilities

- Status: Accepted
- Date: 2026-09-13

## Context

The existing Robinhood opportunity board discovers many platform-labelled targets, but most settle through the same
Uniswap v4 PoolManager. More platform names do not necessarily create independent prices. The Base live canary also
cannot answer whether BNB has opportunities because its execution and risk contract is deliberately chain-specific.

## Decision

1. Add BNB Chain as a third read-only network.
2. Register official Uniswap v2/v3/v4 and PancakeSwap v2/v3 contracts on BNB.
3. Add official Uniswap v2 and PancakeSwap v2/v3 venues on Robinhood beside the existing Uniswap v3/v4 sources.
4. Keep platform, protocol and liquidity venue independent.
5. Treat PancakeSwap v2 fee semantics as dynamic/unknown until a protocol-specific state adapter proves the effective
   fee; do not reuse Uniswap's fixed 30 bps assumption.
6. Grant no calldata, signer, broadcaster, wallet, nonce or live authorization to the new sources.
7. Treat a public BNB `eth_getLogs` limitation as an explicit coverage gap, not an empty market.
8. Run a credential-free service that compares the V2/V3 venues at one fixed block, subtracts conservative Gas and a
   risk reserve, and publishes only a sanitized mode-0644 snapshot. A positive row remains non-executable.

## Consequences

- The opportunity census can distinguish genuinely independent venues from additional labels on one PoolManager.
- Registry and bounded-discovery evidence can be collected without funding BNB or widening current wallets.
- Positive gross observations will still be non-executable until state, quote, risk, calldata and Effect adapters are
  independently implemented and promoted.
- The first continuous slice intentionally covers liquid named assets and two principal probes. It does not claim an
  all-token or 3–4 hop opportunity denominator. The second principal probe is activated only when the smallest probe
  has positive gross output, avoiding routine public-RPC spend on a standard-AMM route already negative before Gas.

## Verification

- Unit tests cover source separation and PancakeSwap v2's unknown fee.
- Unit tests cover Gas/risk subtraction, cross-venue separation, public-field allowlisting and zero execution authority.
- Registry verification must prove code on all official addresses at one fixed block per chain.
- A bounded live scan must record `COMPLETE` or precise `GAPPED` ranges; no scan result may imply all-history coverage.
