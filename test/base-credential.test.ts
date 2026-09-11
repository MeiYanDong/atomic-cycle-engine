import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { loadSignerAccount, resolveCredentialPath } from '../src/live/base-v2-v3/credential.js'

void describe('Base signer credential boundary', () => {
  void it('requires an explicit or systemd-provided credential location', () => {
    assert.throws(() => resolveCredentialPath({}), /unavailable/)
  })

  void it('loads a private key without exposing it through configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'base-cycle-credential-'))
    const credential = join(directory, 'base-cycle-signer')
    await writeFile(
      credential,
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n',
      { mode: 0o600 },
    )
    const account = await loadSignerAccount({ credentialsDirectory: directory })
    assert.equal(account.address, '0xFCAd0B19bB29D4674531d6f115237E16AfCE377c')
  })

  void it('rejects credentials readable by group or other users', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'base-cycle-credential-mode-'))
    const credential = join(directory, 'key')
    await writeFile(
      credential,
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n',
      { mode: 0o600 },
    )
    await chmod(credential, 0o644)
    await assert.rejects(
      loadSignerAccount({ explicitCredentialFile: credential }),
      /permissions are too broad/,
    )
  })

  void it('accepts the read-only 0440 file boundary used by systemd credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'base-cycle-systemd-credential-'))
    const credential = join(directory, 'base-cycle-signer')
    await writeFile(
      credential,
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n',
      { mode: 0o440 },
    )
    await chmod(directory, 0o550)
    const account = await loadSignerAccount({ credentialsDirectory: directory })
    assert.equal(account.address, '0xFCAd0B19bB29D4674531d6f115237E16AfCE377c')
  })

  void it('rejects a systemd-style credential in a group-writable directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'base-cycle-systemd-invalid-'))
    const credential = join(directory, 'base-cycle-signer')
    await writeFile(
      credential,
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n',
      { mode: 0o440 },
    )
    await chmod(directory, 0o570)
    await assert.rejects(
      loadSignerAccount({ credentialsDirectory: directory }),
      /systemd signer credential boundary is invalid/,
    )
  })
})
