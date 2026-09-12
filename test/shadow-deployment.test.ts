import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

void test('cross-venue shadow service has no signer, wallet, or shared live state', async () => {
  const [unit, installer, cli, snapshot] = await Promise.all([
    readFile('deploy/systemd/atomic-cycle-shadow.service', 'utf8'),
    readFile('deploy/install-shadow-service.sh', 'utf8'),
    readFile('src/cli/cross-venue-shadow.ts', 'utf8'),
    readFile('src/shadow/public-snapshot.ts', 'utf8'),
  ])
  assert.match(unit, /^User=atomic-cycle-shadow$/m)
  assert.match(unit, /^Group=atomic-cycle-shadow$/m)
  assert.match(unit, /^StateDirectory=atomic-cycle-shadow$/m)
  assert.match(unit, /^StateDirectoryMode=0755$/m)
  assert.match(unit, /^ReadWritePaths=\/var\/lib\/atomic-cycle-shadow$/m)
  assert.match(unit, /cross-venue-shadow\.js --network all/)
  assert.doesNotMatch(
    unit,
    /EnvironmentFile|LoadCredential|LIVE_APPROVED|atomic-cycle-engine\/live\.env/,
  )
  assert.match(installer, /systemd-analyze verify/)
  assert.match(installer, /systemctl enable --now atomic-cycle-shadow\.service/)
  assert.match(installer, /READ_ONLY_CROSS_VENUE_SHADOW/)
  assert.match(installer, /signingEnabled !== false \|\| value\.broadcastEnabled !== false/)
  assert.match(cli, /maxTransportAttempts: 2/)
  assert.match(cli, /transportRetryDelayMs: 200/)

  assert.doesNotMatch(
    `${unit}\n${installer}\n${cli}`,
    /createWalletClient|privateKeyToAccount|eth_sendRawTransaction|private.?key|signed.?transaction/,
  )
  assert.doesNotMatch(snapshot, /createWalletClient|privateKeyToAccount|eth_sendRawTransaction/)
  assert.match(snapshot, /signingEnabled: false/)
  assert.match(snapshot, /broadcastEnabled: false/)
  assert.match(snapshot, /executableCycles: 0/)
})
