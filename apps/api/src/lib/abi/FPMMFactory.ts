export const FPMMFactoryABI = [
  {
    name: 'createFixedProductMarketMaker',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'conditionalTokens', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'conditionIds', type: 'bytes32[]' },
      { name: 'fee', type: 'uint256' }
    ],
    outputs: [{ name: 'marketMaker', type: 'address' }],
  },
  {
    name: 'allowedCollateralToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'defaultFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'FixedProductMarketMakerCreation',
    inputs: [
      { indexed: true, name: 'creator', type: 'address' },
      { indexed: false, name: 'fixedProductMarketMaker', type: 'address' },
      { indexed: true, name: 'conditionalTokens', type: 'address' },
      { indexed: true, name: 'collateralToken', type: 'address' },
      { indexed: false, name: 'conditionIds', type: 'bytes32[]' },
      { indexed: false, name: 'fee', type: 'uint256' }
    ],
  },
] as const;
