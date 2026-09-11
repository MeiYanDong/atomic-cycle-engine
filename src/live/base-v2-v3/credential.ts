import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

import { privateKeyToAccount } from 'viem/accounts'
import type { Hex, PrivateKeyAccount } from 'viem'

export interface CredentialLocationInput {
  readonly credentialsDirectory?: string
  readonly explicitCredentialFile?: string
}

export function resolveCredentialPath(input: CredentialLocationInput): string {
  if (input.explicitCredentialFile !== undefined && input.explicitCredentialFile !== '') {
    return path.resolve(input.explicitCredentialFile)
  }
  if (input.credentialsDirectory !== undefined && input.credentialsDirectory !== '') {
    return path.join(path.resolve(input.credentialsDirectory), 'base-cycle-signer')
  }
  throw new Error('signer credential is unavailable')
}

export async function loadSignerAccount(
  input: CredentialLocationInput,
): Promise<PrivateKeyAccount> {
  const credentialPath = resolveCredentialPath(input)
  const metadata = await lstat(credentialPath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('signer credential must be a regular file')
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error('signer credential permissions are too broad')
  }
  const value = (await readFile(credentialPath, 'utf8')).trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('signer credential has an invalid format')
  }
  return privateKeyToAccount(value as Hex)
}
