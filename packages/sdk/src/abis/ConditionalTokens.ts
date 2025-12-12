export const CONDITIONAL_TOKENS_ABI = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "oracle",
        type: "address"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "questionId",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "outcomeSlotCount",
        type: "uint256"
      }
    ],
    name: "ConditionPreparation",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "oracle",
        type: "address"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "questionId",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "payoutNumerators",
        type: "uint256[]"
      }
    ],
    name: "ConditionResolution",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "operator",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256[]",
        name: "ids",
        type: "uint256[]"
      },
      {
        internalType: "uint256[]",
        name: "values",
        type: "uint256[]"
      }
    ],
    name: "TransferBatch",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "operator",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "id",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      }
    ],
    name: "TransferSingle",
    type: "event"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "id",
        type: "uint256"
      }
    ],
    name: "balanceOf",
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
        internalType: "address[]",
        name: "accounts",
        type: "address[]"
      },
      {
        internalType: "uint256[]",
        name: "ids",
        type: "uint256[]"
      }
    ],
    name: "balanceOfBatch",
    outputs: [
      {
        internalType: "uint256[]",
        name: "",
        type: "uint256[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256"
      }
    ],
    name: "getPayout",
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
        name: "outcomeSlotCount",
        type: "uint256"
      }
    ],
    name: "getConditionId",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "collateralToken",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "parentCollectionId",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "partition",
        type: "uint256[]"
      }
    ],
    name: "getCollectionId",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "collateralToken",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "collectionId",
        type: "bytes32"
      }
    ],
    name: "getPositionId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      }
    ],
    name: "isConditionPrepared",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      }
    ],
    name: "arePayoutsReported",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "name",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      }
    ],
    name: "oracle",
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
        name: "outcomeSlotCount",
        type: "uint256"
      }
    ],
    name: "prepareCondition",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "questionId",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "payoutNumerators",
        type: "uint256[]"
      }
    ],
    name: "reportPayouts",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "collateralToken",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "parentCollectionId",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "partition",
        type: "uint256[]"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "splitPosition",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "collateralToken",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "parentCollectionId",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "partition",
        type: "uint256[]"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "mergePositions",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "collateralToken",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "parentCollectionId",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "conditionId",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "indexSets",
        type: "uint256[]"
      }
    ],
    name: "redeemPositions",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const
