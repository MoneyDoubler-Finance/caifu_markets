import { expect } from "chai";
import { ethers } from "hardhat";
import { CPMM, IERC20, ICTF } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CPMM Buy Tests", function () {
  let cpmm: CPMM;
  let usdf: IERC20;
  let ctf: ICTF;
  let owner: SignerWithAddress;
  let buyer: SignerWithAddress;
  
  const conditionId = "0x2c84cd99baf7be536bd10cfea53ce835986b04fbca09e8dafa0f85b3f33bb541";
  const feeBps = 200; // 2%
  const initialLiquidity = ethers.parseEther("10");
  
  beforeEach(async function () {
    [owner, buyer] = await ethers.getSigners();
    
    // Get deployed contract addresses from env or use defaults
    const usdfAddress = process.env.USDF_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const ctfAddress = process.env.CTF_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    const cpmmAddress = process.env.CPMM_ADDRESS || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
    
    usdf = await ethers.getContractAt("IERC20", usdfAddress);
    ctf = await ethers.getContractAt("ICTF", ctfAddress);
    cpmm = await ethers.getContractAt("CPMM", cpmmAddress);
  });

  it("Should correctly buy YES tokens (outcome 0)", async function () {
    const outcome = 0; // YES
    const amountIn = ethers.parseEther("1"); // 1 USDF
    
    // Get initial pool state
    const poolBefore = await cpmm.pools(conditionId);
    const reserveYesBefore = poolBefore.reserveYes;
    const reserveNoBefore = poolBefore.reserveNo;
    
    // Quote the buy
    const [sharesOut, , fee] = await cpmm.quoteBuy(conditionId, outcome, amountIn);
    const amountInAfterFee = amountIn - fee;
    
    // Expected: sharesOut ≈ 0.89e18 for balanced pool
    console.log("Quote YES buy: sharesOut =", ethers.formatEther(sharesOut));
    
    // Get YES position ID and initial balance
    const yesPositionId = await cpmm.getPositionId(conditionId, outcome);
    const buyerYesBalanceBefore = await ctf.balanceOf(buyer.address, yesPositionId);
    
    // Approve and buy
    await usdf.connect(buyer).approve(await cpmm.getAddress(), amountIn);
    await cpmm.connect(buyer).buy(conditionId, outcome, amountIn, 0);
    
    // Check pool reserves updated correctly
    const poolAfter = await cpmm.pools(conditionId);
    const reserveYesAfter = poolAfter.reserveYes;
    const reserveNoAfter = poolAfter.reserveNo;
    
    // When buying YES: reserveNo should increase by amountInAfterFee, reserveYes should decrease by sharesOut
    expect(reserveNoAfter).to.equal(reserveNoBefore + amountInAfterFee);
    expect(reserveYesAfter).to.equal(reserveYesBefore - sharesOut);
    
    // Check buyer received YES tokens
    const buyerYesBalanceAfter = await ctf.balanceOf(buyer.address, yesPositionId);
    expect(buyerYesBalanceAfter).to.equal(buyerYesBalanceBefore + sharesOut);
    
    console.log("✓ YES buy: reserveNo increased by", ethers.formatEther(amountInAfterFee));
    console.log("✓ YES buy: reserveYes decreased by", ethers.formatEther(sharesOut));
    console.log("✓ YES buy: buyer received", ethers.formatEther(sharesOut), "YES tokens");
  });

  it("Should correctly buy NO tokens (outcome 1)", async function () {
    const outcome = 1; // NO
    const amountIn = ethers.parseEther("1"); // 1 USDF
    
    // Get initial pool state
    const poolBefore = await cpmm.pools(conditionId);
    const reserveYesBefore = poolBefore.reserveYes;
    const reserveNoBefore = poolBefore.reserveNo;
    
    // Quote the buy
    const [sharesOut, , fee] = await cpmm.quoteBuy(conditionId, outcome, amountIn);
    const amountInAfterFee = amountIn - fee;
    
    // Expected: sharesOut ≈ 0.89e18 for balanced pool
    console.log("Quote NO buy: sharesOut =", ethers.formatEther(sharesOut));
    
    // Get NO position ID and initial balance
    const noPositionId = await cpmm.getPositionId(conditionId, outcome);
    const buyerNoBalanceBefore = await ctf.balanceOf(buyer.address, noPositionId);
    
    // Approve and buy
    await usdf.connect(buyer).approve(await cpmm.getAddress(), amountIn);
    await cpmm.connect(buyer).buy(conditionId, outcome, amountIn, 0);
    
    // Check pool reserves updated correctly
    const poolAfter = await cpmm.pools(conditionId);
    const reserveYesAfter = poolAfter.reserveYes;
    const reserveNoAfter = poolAfter.reserveNo;
    
    // When buying NO: reserveYes should increase by amountInAfterFee, reserveNo should decrease by sharesOut
    expect(reserveYesAfter).to.equal(reserveYesBefore + amountInAfterFee);
    expect(reserveNoAfter).to.equal(reserveNoBefore - sharesOut);
    
    // Check buyer received NO tokens
    const buyerNoBalanceAfter = await ctf.balanceOf(buyer.address, noPositionId);
    expect(buyerNoBalanceAfter).to.equal(buyerNoBalanceBefore + sharesOut);
    
    console.log("✓ NO buy: reserveYes increased by", ethers.formatEther(amountInAfterFee));
    console.log("✓ NO buy: reserveNo decreased by", ethers.formatEther(sharesOut));
    console.log("✓ NO buy: buyer received", ethers.formatEther(sharesOut), "NO tokens");
  });
});
