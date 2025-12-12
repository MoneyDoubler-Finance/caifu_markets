export const EXCHANGE_ABI = [
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
      },
      {
        internalType: "address",
        name: "_feeRecipient",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "_feeBps",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "newFeeBps",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "address",
        name: "newFeeRecipient",
        type: "address"
      }
    ],
    name: "FeeParametersSet",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "orderHash",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "taker",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "price",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "size",
        type: "uint256"
      }
    ],
    name: "OrderFilled",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "orderHash",
        type: "bytes32"
      }
    ],
    name: "OrderCancelled",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "orderHash",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "maker",
        type: "address"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "marketId",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "outcome",
        type: "uint256"
      },
      {
        internalType: "enum Exchange.OrderSide",
        name: "side",
        type: "uint8"
      },
      {
        internalType: "uint256",
        name: "price",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "size",
        type: "uint256"
      }
    ],
    name: "OrderCreated",
    type: "event"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    name: "orderFilled",
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
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    name: "orderStatus",
    outputs: [
      {
        internalType: "enum Exchange.OrderStatus",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    name: "userNonces",
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
    inputs: [],
    name: "feeRecipient",
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
    name: "feeBps",
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
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address"
      }
    ],
    name: "getNonce",
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
        internalType: "uint256",
        name: "index",
        type: "uint256"
      }
    ],
    name: "getTrade",
    outputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "orderHash",
            type: "bytes32"
          },
          {
            internalType: "address",
            name: "taker",
            type: "address"
          },
          {
            internalType: "uint256",
            name: "price",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "size",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "timestamp",
            type: "uint256"
          }
        ],
        internalType: "struct Exchange.Trade",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTradeCount",
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
        components: [
          {
            internalType: "address",
            name: "maker",
            type: "address"
          },
          {
            internalType: "address",
            name: "taker",
            type: "address"
          },
          {
            internalType: "bytes32",
            name: "marketId",
            type: "bytes32"
          },
          {
            internalType: "uint256",
            name: "outcome",
            type: "uint256"
          },
          {
            internalType: "enum Exchange.OrderSide",
            name: "side",
            type: "uint8"
          },
          {
            internalType: "uint256",
            name: "price",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "size",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "expiry",
            type: "uint256"
          }
        ],
        internalType: "struct Exchange.Order",
        name: "order",
        type: "tuple"
      }
    ],
    name: "hashOrder",
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
        components: [
          {
            internalType: "address",
            name: "maker",
            type: "address"
          },
          {
            internalType: "address",
            name: "taker",
            type: "address"
          },
          {
            internalType: "bytes32",
            name: "marketId",
            type: "bytes32"
          },
          {
            internalType: "uint256",
            name: "outcome",
            type: "uint256"
          },
          {
            internalType: "enum Exchange.OrderSide",
            name: "side",
            type: "uint8"
          },
          {
            internalType: "uint256",
            name: "price",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "size",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "expiry",
            type: "uint256"
          }
        ],
        internalType: "struct Exchange.Order",
        name: "order",
        type: "tuple"
      },
      {
        internalType: "bytes",
        name: "signature",
        type: "bytes"
      }
    ],
    name: "createOrder",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "maker",
            type: "address"
          },
          {
            internalType: "address",
            name: "taker",
            type: "address"
          },
          {
            internalType: "bytes32",
            name: "marketId",
            type: "bytes32"
          },
          {
            internalType: "uint256",
            name: "outcome",
            type: "uint256"
          },
          {
            internalType: "enum Exchange.OrderSide",
            name: "side",
            type: "uint8"
          },
          {
            internalType: "uint256",
            name: "price",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "size",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "expiry",
            type: "uint256"
          }
        ],
        internalType: "struct Exchange.Order[]",
        name: "orders",
        type: "tuple[]"
      },
      {
        internalType: "bytes[]",
        name: "signatures",
        type: "bytes[]"
      },
      {
        internalType: "uint256[]",
        name: "fillSizes",
        type: "uint256[]"
      }
    ],
    name: "fillOrders",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "maker",
            type: "address"
          },
          {
            internalType: "address",
            name: "taker",
            type: "address"
          },
          {
            internalType: "bytes32",
            name: "marketId",
            type: "bytes32"
          },
          {
            internalType: "uint256",
            name: "outcome",
            type: "uint256"
          },
          {
            internalType: "enum Exchange.OrderSide",
            name: "side",
            type: "uint8"
          },
          {
            internalType: "uint256",
            name: "price",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "size",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "expiry",
            type: "uint256"
          }
        ],
        internalType: "struct Exchange.Order",
        name: "order",
        type: "tuple"
      },
      {
        internalType: "bytes",
        name: "signature",
        type: "bytes"
      }
    ],
    name: "cancelOrder",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_feeRecipient",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "_feeBps",
        type: "uint256"
      }
    ],
    name: "setFeeParameters",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const
