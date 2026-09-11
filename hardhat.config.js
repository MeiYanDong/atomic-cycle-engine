export default {
  chainDescriptors: {
    8453: {
      name: 'Base',
      chainType: 'op',
      hardforkHistory: {
        bedrock: { blockNumber: 0 },
        regolith: { blockNumber: 0 },
        canyon: { blockNumber: 0 },
        ecotone: { blockNumber: 0 },
        fjord: { blockNumber: 0 },
        granite: { blockNumber: 0 },
        holocene: { blockNumber: 0 },
        isthmus: { blockNumber: 0 },
      },
    },
  },
  solidity: {
    version: '0.8.26',
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhatMainnet: {
      type: 'edr-simulated',
      chainType: 'l1',
      chainId: 8453,
    },
  },
}
