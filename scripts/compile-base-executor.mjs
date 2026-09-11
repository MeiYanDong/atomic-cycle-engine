import { createHash } from 'node:crypto'
import console from 'node:console'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import solc from 'solc'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'contracts', 'BaseV2V3CycleExecutor.sol')
const artifactPath = path.join(root, 'artifacts', 'BaseV2V3CycleExecutor.json')

export async function compileBaseExecutor() {
  const source = await readFile(sourcePath, 'utf8')
  const input = {
    language: 'Solidity',
    sources: {
      'BaseV2V3CycleExecutor.sol': { content: source },
    },
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      metadata: { bytecodeHash: 'ipfs' },
      outputSelection: {
        '*': {
          '*': [
            'abi',
            'metadata',
            'evm.bytecode.object',
            'evm.deployedBytecode.object',
            'evm.deployedBytecode.immutableReferences',
          ],
        },
      },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter((item) => item.severity === 'error')
  if (errors.length > 0) throw new Error(errors.map((item) => item.formattedMessage).join('\n'))
  const contract = output.contracts['BaseV2V3CycleExecutor.sol'].BaseV2V3CycleExecutor
  const artifact = {
    contractName: 'BaseV2V3CycleExecutor',
    compiler: solc.version(),
    settings: input.settings,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    immutableReferences: contract.evm.deployedBytecode.immutableReferences,
  }
  return artifact
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifact = await compileBaseExecutor()
  await mkdir(path.dirname(artifactPath), { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  })
  console.log(
    JSON.stringify(
      {
        status: 'ok',
        artifact: path.relative(root, artifactPath),
        compiler: artifact.compiler,
        sourceSha256: artifact.sourceSha256,
        runtimeBytes: (artifact.deployedBytecode.length - 2) / 2,
      },
      null,
      2,
    ),
  )
}
