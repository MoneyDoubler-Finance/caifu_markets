import { ethers } from "ethers";

declare module "hardhat/types/runtime" {
  interface HardhatRuntimeEnvironment {
    ethers: typeof ethers & {
      getSigners(): Promise<any[]>;
      getContractFactory(name: string): Promise<any>;
      getContractAt(name: string, address: string): Promise<any>;
    };
  }
}
