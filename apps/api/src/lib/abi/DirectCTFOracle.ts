export const DirectCTFOracleABI = [
  {
    type: 'function',
    name: 'prepareBinaryCondition',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'questionId', type: 'bytes32' }],
    outputs: [{ name: 'conditionId', type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'reportPayouts',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'questionId', type: 'bytes32' },
      { name: 'payouts', type: 'uint256[]' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'questionId', type: 'bytes32' },
      { name: 'payouts', type: 'uint256[]' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'resolveBinary',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'questionId', type: 'bytes32' },
      { name: 'yesWins', type: 'bool' }
    ],
    outputs: []
  }
] as const
