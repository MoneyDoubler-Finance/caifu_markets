// CTF (Conditional Tokens Framework) ABI - Extended
export const CTFABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' }
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getConditionId',
    type: 'function',
    stateMutability: 'pure',
    inputs: [
      { name: 'oracle', type: 'address' },
      { name: 'questionId', type: 'bytes32' },
      { name: 'outcomeSlotCount', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'setApprovalForAll',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' }
    ],
    outputs: [],
  },
  {
    name: 'isApprovedForAll',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'operator', type: 'address' }
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'safeTransferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'safeBatchTransferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'ids', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'balanceOfBatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'accounts', type: 'address[]' },
      { name: 'ids', type: 'uint256[]' }
    ],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'splitPosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'partition', type: 'uint256[]' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
  },
  {
    name: 'mergePositions',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'partition', type: 'uint256[]' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
  },
  {
    name: 'prepareCondition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'oracle', type: 'address' },
      { name: 'questionId', type: 'bytes32' },
      { name: 'outcomeSlotCount', type: 'uint256' }
    ],
    outputs: [],
  },
  {
    name: 'reportPayouts',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'questionId', type: 'bytes32' },
      { name: 'payouts', type: 'uint256[]' }
    ],
    outputs: [],
  },
  {
    name: 'redeemPositions',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSets', type: 'uint256[]' }
    ],
    outputs: [],
  },
  {
    name: 'getCollectionId',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSet', type: 'uint256' }
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getPositionId',
    type: 'function',
    stateMutability: 'pure',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'collectionId', type: 'bytes32' }
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'isConditionPrepared',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'conditionId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'isConditionResolved',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'conditionId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getOutcomeSlotCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'conditionId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getConditionMetadata',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'conditionId', type: 'bytes32' }],
    outputs: [
      { name: 'oracle', type: 'address' },
      { name: 'questionId', type: 'bytes32' },
      { name: 'outcomeSlotCount', type: 'uint256' },
      { name: 'denominator', type: 'uint256' }
    ],
  },
] as const;
