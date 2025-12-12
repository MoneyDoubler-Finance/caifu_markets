"use strict";
// Minimal ABI interfaces for runtime contract interaction
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKET_FACTORY_ABI = exports.EXCHANGE_ABI = exports.CTF_ABI = void 0;
exports.CTF_ABI = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
    "function setApprovalForAll(address operator, bool approved)",
    "function isApprovedForAll(address account, address operator) view returns (bool)",
    "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) returns (uint256)",
];
exports.EXCHANGE_ABI = [
    "function addLiquidity(uint256 tokenId, uint256 amount, uint256 minLiquidity) returns (uint256)",
    "function removeLiquidity(uint256 tokenId, uint256 liquidity, uint256 minAmount) returns (uint256)",
    "function buy(uint256 tokenId, uint256 amount, uint256 maxCost) returns (uint256)",
    "function sell(uint256 tokenId, uint256 amount, uint256 minProceeds) returns (uint256)",
    "function getSpotPrice(uint256 tokenId) view returns (uint256)",
    "function calcBuyAmount(uint256 investmentAmount, uint256 tokenId) view returns (uint256)",
    "function calcSellAmount(uint256 returnAmount, uint256 tokenId) view returns (uint256)",
];
exports.MARKET_FACTORY_ABI = [
    "function createBinaryMarket(string question, bytes32 questionId, address oracle, uint256 openTime, uint256 closeTime) returns (uint256)",
    "function getMarket(uint256 marketId) view returns (tuple(bytes32 conditionId, string question, address oracle, uint256 openTime, uint256 closeTime, bool resolved))",
    "event MarketCreated(uint256 indexed marketId, bytes32 indexed conditionId, string question)",
    "event MarketResolved(uint256 indexed marketId, bytes32 indexed conditionId, uint256[] payouts)",
];
