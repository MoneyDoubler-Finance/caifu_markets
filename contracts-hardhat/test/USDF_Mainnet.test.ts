import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { ContractTransactionReceipt, TransactionReceipt } from "ethers";

let ethers: HardhatEthers;

const WAD = 10n ** 18n;
const INITIAL_RATE = BigInt("1269000000000000000000"); // 1269e18

type EthersError = Error & { shortMessage?: string; reason?: string };

function expectErrorIncludes(error: EthersError, expected: string) {
  const message = error.shortMessage ?? error.reason ?? error.message ?? "";
  expect(message).to.include(expected);
}

async function expectRevert(promise: Promise<unknown>, expectedReason: string) {
  try {
    await promise;
    expect.fail(`Expected revert with '${expectedReason}'`);
  } catch (error) {
    expectErrorIncludes(error as EthersError, expectedReason);
  }
}

async function expectCustomError(promise: Promise<unknown>, expectedError: string) {
  try {
    await promise;
    expect.fail(`Expected custom error '${expectedError}'`);
  } catch (error) {
    expectErrorIncludes(error as EthersError, expectedError);
  }
}

function expectEventArgs(
  receipt: ContractTransactionReceipt | TransactionReceipt | null,
  contract: any,
  eventName: string,
) {
  expect(receipt).to.not.equal(null, "transaction receipt missing");
  for (const log of receipt!.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog({ data: log.data, topics: [...log.topics] });
      if (parsed.name === eventName) {
        return parsed.args;
      }
    } catch (_) {
      // Ignore logs from other contracts
    }
  }
  expect.fail(`Event '${eventName}' not found`);
}

async function deployUSDF_Mainnet() {
  const [deployer, user, other] = await ethers.getSigners();
  const usdf = await ethers.deployContract("USDF_Mainnet", [INITIAL_RATE]);
  await usdf.waitForDeployment();
  return { usdf, deployer, user, other } as const;
}

describe("USDF_Mainnet", function () {
  beforeEach(async () => {
    ({ ethers } = await hre.network.connect());
  });

  describe("buy", function () {
    it("mints USDF at the fixed rate and emits Bought", async function () {
      const { usdf, user } = await deployUSDF_Mainnet();
      const oneBnb = ethers.parseEther("1");
      const expectedUsdf = (oneBnb * INITIAL_RATE) / WAD;
      const contractAddress = await usdf.getAddress();

      const tx = await usdf.connect(user).buy(user.address, { value: oneBnb });
      const args = expectEventArgs(await tx.wait(), usdf, "Bought");
      expect(args.buyer).to.equal(user.address);
      expect(args.to).to.equal(user.address);
      expect(args.bnbIn).to.equal(oneBnb);
      expect(args.usdfOut).to.equal(expectedUsdf);

      expect(await usdf.balanceOf(user.address)).to.equal(expectedUsdf);
      expect(await ethers.provider.getBalance(contractAddress)).to.equal(oneBnb);
    });
  });

  describe("sell", function () {
    it("burns USDF for BNB and emits Sold", async function () {
      const { usdf, deployer, user } = await deployUSDF_Mainnet();
      const contractAddress = await usdf.getAddress();

      const prefund = ethers.parseEther("1");
      await usdf.connect(deployer).buy(deployer.address, { value: prefund });

      const userBuy = ethers.parseEther("1");
      await usdf.connect(user).buy(user.address, { value: userBuy });
      const userBalanceBefore = await usdf.balanceOf(user.address);
      const sellAmount = userBalanceBefore / 2n;
      const expectedBnbOut = (sellAmount * WAD) / INITIAL_RATE;
      const contractBalanceBefore = await ethers.provider.getBalance(contractAddress);
      const userEthBefore = await ethers.provider.getBalance(user.address);

      const tx = await usdf.connect(user).sell(sellAmount, user.address);
      const receipt = await tx.wait();
      const args = expectEventArgs(receipt, usdf, "Sold");
      expect(args.seller).to.equal(user.address);
      expect(args.to).to.equal(user.address);
      expect(args.usdfIn).to.equal(sellAmount);
      expect(args.bnbOut).to.equal(expectedBnbOut);
      const effectiveGasPrice = receipt!.gasPrice ?? receipt!.effectiveGasPrice ?? 0n;
      const gasCost = receipt!.gasUsed * effectiveGasPrice;

      expect(await usdf.balanceOf(user.address)).to.equal(userBalanceBefore - sellAmount);
      expect(await ethers.provider.getBalance(contractAddress)).to.equal(contractBalanceBefore - expectedBnbOut);

      const userEthAfter = await ethers.provider.getBalance(user.address);
      expect(userEthAfter).to.equal(userEthBefore - gasCost + expectedBnbOut);
    });
  });

  describe("edge cases", function () {
    it("validates inputs and liquidity", async function () {
      const { usdf, deployer, user } = await deployUSDF_Mainnet();

      await expectRevert(usdf.connect(user).buy(user.address), "no BNB");
      await expectRevert(usdf.connect(user).sell(0n, user.address), "no USDF");

      const buyValue = ethers.parseEther("1");
      await usdf.connect(user).buy(user.address, { value: buyValue });
      const userBalance = await usdf.balanceOf(user.address);
      const contractAddress = await usdf.getAddress();
      const contractBalance = await ethers.provider.getBalance(contractAddress);

      await usdf.connect(deployer).rescueBNB(deployer.address, contractBalance);

      await expectRevert(usdf.connect(user).sell(userBalance, user.address), "insufficient BNB");
    });

    it("allows direct BNB deposits and emits LiquidityAdded", async function () {
      const { usdf, user } = await deployUSDF_Mainnet();
      const contractAddress = await usdf.getAddress();
      const deposit = ethers.parseEther("0.1");

      const tx = await user.sendTransaction({ to: contractAddress, value: deposit });
      const receipt = await tx.wait();
      const args = expectEventArgs(receipt, usdf, "LiquidityAdded");
      expect(args.from).to.equal(user.address);
      expect(args.amount).to.equal(deposit);
      expect(await ethers.provider.getBalance(contractAddress)).to.equal(deposit);
    });
  });

  describe("admin controls", function () {
    it("restricts owner-only functions and allows asset rescue", async function () {
      const { usdf, deployer, user } = await deployUSDF_Mainnet();
      const contractAddress = await usdf.getAddress();

      const newRate = INITIAL_RATE * 2n;
      await expectCustomError(usdf.connect(user).setRate(newRate), "OwnableUnauthorizedAccount");
      await usdf.setRate(newRate);
      expect(await usdf.rate()).to.equal(newRate);

      const deposit = ethers.parseEther("0.5");
      await usdf.connect(user).buy(user.address, { value: deposit });
      const minted = await usdf.balanceOf(user.address);
      const tokenDeposit = minted / 2n;
      await usdf.connect(user).transfer(contractAddress, tokenDeposit);

      await expectCustomError(
        usdf.connect(user).rescueToken(contractAddress, user.address, tokenDeposit),
        "OwnableUnauthorizedAccount",
      );

      await usdf.rescueToken(contractAddress, deployer.address, tokenDeposit);
      expect(await usdf.balanceOf(deployer.address)).to.equal(tokenDeposit);

      const contractBnbBalance = await ethers.provider.getBalance(contractAddress);
      await expectCustomError(usdf.connect(user).rescueBNB(user.address, 1n), "OwnableUnauthorizedAccount");

      const ownerEthBefore = await ethers.provider.getBalance(deployer.address);
      const tx = await usdf.rescueBNB(deployer.address, contractBnbBalance);
      const receipt = await tx.wait();
      const effectiveGasPrice = receipt!.gasPrice ?? receipt!.effectiveGasPrice ?? 0n;
      const gasCost = receipt!.gasUsed * effectiveGasPrice;

      expect(await ethers.provider.getBalance(contractAddress)).to.equal(0n);
      const ownerEthAfter = await ethers.provider.getBalance(deployer.address);
      expect(ownerEthAfter).to.equal(ownerEthBefore - gasCost + contractBnbBalance);
    });
  });
});
