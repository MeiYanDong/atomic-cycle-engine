# ADR 0005: bind the live nonce fence to boot and process identity

- Status: Accepted
- Date: 2026-09-13

## Context

After a production host restart, the persisted Base nonce-owner lock still contained PID 779 from the prior boot. The
new boot assigned PID 779 to Alibaba Cloud Assistant. The old fence checked only whether that numeric PID existed, so
the Base watcher correctly failed closed but could not recover automatically. There was no `attempts.jsonl` and thus no
unresolved transaction; the collision was entirely local process identity.

PID liveness alone is also insufficient within one boot because a stopped process's number can be reused. Lock release
must not delete a replacement lock if ownership changed after the original process acquired it.

## Decision

1. Write schema-v2 locks with PID, creation time, random owner token and, on Linux, boot ID plus process start ticks.
2. Treat an existing lock as active only when its recorded boot and process-start identity match the current `/proc`
   identity for that PID.
3. Migrate a legacy lock automatically only when its PID is absent or its creation time is more than one minute before
   the current Linux boot time. Ambiguous legacy state remains fail-closed.
4. Before release, compare the lock inode, PID and owner token. A process must not remove a replacement lock.
5. Keep the execution ledger and on-chain reconciliation gates unchanged. Fence recovery never proves transaction
   settlement by itself.

## Consequences

- Reboot-time and same-boot PID reuse no longer strand the Base nonce lane.
- A genuine owner with the same boot ID and process start ticks still blocks every contender.
- Non-Linux development environments retain the conservative PID-liveness fallback.
- Corrupt or ambiguous lock records remain manual-recovery events rather than being deleted optimistically.
