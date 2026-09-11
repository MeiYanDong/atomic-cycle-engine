# Sanitized runtime heartbeat production promotion

- Date: 2026-09-12 CST
- Functional release: `175f08f8fa6b99be817c21f9dd014f354b1e8931`
- Scope: Base watcher and its sanitized, read-only portfolio heartbeat

## Outcome

The Base watcher is running from the exact functional release and now publishes a mode-0640, field-allowlisted runtime
heartbeat at `/run/atomic-cycle-portfolio/heartbeat.json`. The private execution state under
`/var/lib/atomic-cycle-engine` remains mode 0700 and is not exposed to the cross-project business reporter.

The accepted production process had MainPID `2409`, `NRestarts=0` and systemd state `active/running`. Its heartbeat
reported `350` routes checked, `0` positive routes, no broadcast, `0` confirmed-profit transactions, `0 ETH` verified
net profit and `0 ETH` failed Gas. These are receipt-bound zero results, not simulated returns.

No signing, broadcast, withdrawal, wallet transfer or execution-authorization change was performed by this release.

## Rejected attempts and recovery

The first full release-host check did not complete within the Cloud Assistant execution window while ESLint was still
running on the 2 GB host, so no release switch was accepted from that attempt. The Cloud Assistant channel later became
unresponsive and the instance was rebooted through the provider control plane. All enabled services recovered through
systemd before promotion work resumed.

A later repeated restart sequence reached systemd's `start-limit-hit`. The previous release was restored, the failed
state was reset, and service health was re-established before a single-restart promotion. The accepted promotion then
kept one stable process with `NRestarts=0`; there was no evidence of a strategy-process crash in the final release.

## Quality and runtime gates

- Local `npm run check`: formatting, lint, typecheck, contract compilation, `39/39` tests, deterministic contract tests
  and secret scanning passed.
- GitHub Actions run `34619915524`: passed for functional release
  `175f08f8fa6b99be817c21f9dd014f354b1e8931`.
- Release host: dependency installation, typecheck, specification tests, contract compilation, all `39` tests,
  deterministic contract tests, secret scan and production build passed before the accepted symlink switch.
- The release symlink, systemd process working directory and heartbeat release identity resolved to the same commit.
- The public heartbeat was readable by the dedicated portfolio group but not writable by it; private signer state and
  credentials remained inaccessible.

## Consumer boundary

The unified portfolio dashboard consumes only this sanitized heartbeat. It does not read the Base signing key, raw
authorization records, signed transactions, RPC credentials or private execution ledger. A missing, stale,
group-writable or malformed heartbeat fails closed as partial/unknown rather than fabricating a current balance or
profit value.
