# ADR 0004: bounded retry for public read-only RPC

- Status: Accepted
- Date: 2026-09-13

## Context

The production BNB shadow completed one fixed-block cycle with eight intermittent provider failures out of 154 reported
requests. The public dashboard correctly degraded the network to `PARTIAL`, but the client made no distinction between
a transport interruption and a deterministic JSON-RPC/EVM error. The existing request counter also counted quote
operations rather than every provider attempt, so transparent retry would understate RPC usage.

## Decision

1. Keep the official credential-free public endpoint as the default; do not consume Chainstack capacity.
2. Permit at most two total attempts with a 200 ms delay, and only when the HTTP transport throws.
3. Never retry a JSON-RPC error response, including an EVM revert.
4. Preserve the same JSON-RPC request identity across the idempotent read retry.
5. Publish logical quotes, logical RPC requests, actual provider attempts, transport failures, recovered logical requests
   and unresolved quote failures separately.
6. Keep the retry option scoped to the signer-free cross-venue process; other readers retain their one-attempt default.
7. Keep `signingEnabled=false`, `broadcastEnabled=false` and `executableCycles=0` unchanged.

## Consequences

- One transient public-RPC interruption no longer makes an otherwise complete fixed-block scan partial.
- Every retry remains visible in cost evidence; reliability is not improved by hiding extra requests.
- Deterministic contract failures cannot multiply into a retry storm.
- Two failed attempts still fail closed and make the affected scan partial.
- This improves read availability only. It provides no execution latency, inclusion or production-SLA claim.
