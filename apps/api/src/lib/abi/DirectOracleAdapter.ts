export const DirectOracleAdapterABI = [
  {
    type: 'function',
    name: 'initializeCondition',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'oracle', type: 'address' },
      { name: 'questionId', type: 'bytes32' },
      { name: 'outcomeSlotCount', type: 'uint8' },
      { name: 'optionalClarification', type: 'string' }
    ],
    outputs: [{ name: 'conditionId', type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'requestResolve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'conditionId', type: 'bytes32' },
      { name: 'payouts', type: 'uint256[]' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'conditions',
    stateMutability: 'view',
    inputs: [{ name: 'conditionId', type: 'bytes32' }],
    outputs: [
      { name: 'questionId', type: 'bytes32' },
      { name: 'oracle', type: 'address' },
      { name: 'outcomeSlotCount', type: 'uint8' },
      { name: 'prepared', type: 'bool' },
      { name: 'resolved', type: 'bool' }
    ]
  }
] as const
