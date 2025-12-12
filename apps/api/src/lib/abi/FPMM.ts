export const FPMMABI = [
  {
    name: 'addFunding',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'addedFunds', type: 'uint256' },
      { name: 'distributionHint', type: 'uint256[]' }
    ],
    outputs: [],
  },
  {
    name: 'calcBuyAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'investmentAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' }
    ],
    outputs: [{ name: 'outcomeTokensToBuy', type: 'uint256' }],
  },
  {
    name: 'calcSellAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' }
    ],
    outputs: [{ name: 'outcomeTokenSellAmount', type: 'uint256' }],
  },
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'investmentAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
      { name: 'minOutcomeTokensToBuy', type: 'uint256' }
    ],
    outputs: [],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
      { name: 'maxOutcomeTokensToSell', type: 'uint256' }
    ],
    outputs: [],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'conditionalTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'collateralToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'fee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'FPMMFundingAdded',
    inputs: [
      { indexed: true, name: 'funder', type: 'address' },
      { indexed: false, name: 'amountsAdded', type: 'uint256[]' },
      { indexed: false, name: 'sharesMinted', type: 'uint256' }
    ],
  },
  {
    type: 'event',
    name: 'FPMMFundingRemoved',
    inputs: [
      { indexed: true, name: 'funder', type: 'address' },
      { indexed: false, name: 'amountsRemoved', type: 'uint256[]' },
      { indexed: false, name: 'collateralRemovedFromFeePool', type: 'uint256' },
      { indexed: false, name: 'sharesBurnt', type: 'uint256' }
    ],
  },
  {
    type: 'event',
    name: 'FPMMBuy',
    inputs: [
      { indexed: true, name: 'buyer', type: 'address' },
      { indexed: false, name: 'investmentAmount', type: 'uint256' },
      { indexed: false, name: 'feeAmount', type: 'uint256' },
      { indexed: true, name: 'outcomeIndex', type: 'uint256' },
      { indexed: false, name: 'outcomeTokensBought', type: 'uint256' }
    ],
  },
  {
    type: 'event',
    name: 'FPMMSell',
    inputs: [
      { indexed: true, name: 'seller', type: 'address' },
      { indexed: false, name: 'returnAmount', type: 'uint256' },
      { indexed: false, name: 'feeAmount', type: 'uint256' },
      { indexed: true, name: 'outcomeIndex', type: 'uint256' },
      { indexed: false, name: 'outcomeTokensSold', type: 'uint256' }
    ],
  },
] as const;
