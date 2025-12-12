export const MARKET_FACTORY_ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_conditionalTokens",
        type: "address"
      },
      {
        internalType: "address",
        name: "_collateralToken",
        type: "address"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "marketId",
        type: "uint256"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        internalType: "string",
        name: "title",
        type: "string"
      },
      {
        internalType: "string[]",
        name: "outcomes",
        type: "string[]"
      },
      {
        internalType: "address",
        name: "creator",
        type: "address"
      }
    ],
    name: "MarketCreated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "marketId",
        type: "uint256"
      },
      {
        internalType: "uint256[]",
        name: "payoutNumerators",
        type: "uint256[]"
      }
    ],
    name: "MarketResolved",
    type: "event"
  },
  {
    inputs: [],
    name: "conditionalTokens",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "collateralToken",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    name: "markets",
    outputs: [
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        internalType: "string",
        name: "title",
        type: "string"
      },
      {
        internalType: "address",
        name: "creator",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "createdAt",
        type: "uint256"
      },
      {
        internalType: "bool",
        name: "resolved",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "nextMarketId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "title",
        type: "string"
      },
      {
        internalType: "bytes32",
        name: "questionId",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "oracle",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "openTime",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "closeTime",
        type: "uint256"
      }
    ],
    name: "createBinaryMarket",
    outputs: [
      {
        internalType: "uint256",
        name: "marketId",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "title",
        type: "string"
      },
      {
        internalType: "string[]",
        name: "outcomes",
        type: "string[]"
      },
      {
        internalType: "address",
        name: "oracle",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "questionId",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "initialLiquidity",
        type: "uint256"
      }
    ],
    name: "createMarket",
    outputs: [
      {
        internalType: "uint256",
        name: "marketId",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "marketId",
        type: "uint256"
      },
      {
        internalType: "uint256[]",
        name: "payoutNumerators",
        type: "uint256[]"
      }
    ],
    name: "resolveMarket",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "marketId",
        type: "uint256"
      }
    ],
    name: "getMarket",
    outputs: [
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        internalType: "string",
        name: "title",
        type: "string"
      },
      {
        internalType: "string[]",
        name: "outcomes",
        type: "string[]"
      },
      {
        internalType: "address",
        name: "creator",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "createdAt",
        type: "uint256"
      },
      {
        internalType: "bool",
        name: "resolved",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getMarketCount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const
