// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*

________/\\\\\\\\\_____________________________/\\\\\_______________                                                  
 _____/\\\////////____________________________/\\\///________________                                                 
  ___/\\\/___________________________/\\\_____/\\\____________________                                                
   __/\\\______________/\\\\\\\\\____\///___/\\\\\\\\\____/\\\____/\\\_                                               
    _\/\\\_____________\////////\\\____/\\\_\////\\\//____\/\\\___\/\\\_                                              
     _\//\\\______________/\\\\\\\\\\__\/\\\____\/\\\______\/\\\___\/\\\_                                             
      __\///\\\___________/\\\/////\\\__\/\\\____\/\\\______\/\\\___\/\\\_                                            
       ____\////\\\\\\\\\_\//\\\\\\\\/\\_\/\\\____\/\\\______\//\\\\\\\\\__                                           
        _______\/////////___\////////\//__\///_____\///________\/////////___                                          
__/\\\\____________/\\\\______________________________________________________________________________________        
 _\/\\\\\\________/\\\\\\_______________________________/\\\___________________________________________________       
  _\/\\\//\\\____/\\\//\\\______________________________\/\\\____________________________/\\\___________________      
   _\/\\\\///\\\/\\\/_\/\\\__/\\\\\\\\\_____/\\/\\\\\\\__\/\\\\\\\\________/\\\\\\\\___/\\\\\\\\\\\__/\\\\\\\\\\_     
    _\/\\\__\///\\\/___\/\\\_\////////\\\___\/\\\/////\\\_\/\\\////\\\____/\\\/////\\\_\////\\\////__\/\\\//////__    
     _\/\\\____\///_____\/\\\___/\\\\\\\\\\__\/\\\___\///__\/\\\\\\\\/____/\\\\\\\\\\\_____\/\\\______\/\\\\\\\\\\_   
      _\/\\\_____________\/\\\__/\\\/////\\\__\/\\\_________\/\\\///\\\___\//\\///////______\/\\\_/\\__\////////\\\_  
       _\/\\\_____________\/\\\_\//\\\\\\\\/\\_\/\\\_________\/\\\_\///\\\__\//\\\\\\\\\\____\//\\\\\____/\\\\\\\\\\_ 
        _\///______________\///___\////////\//__\///__________\///____\///____\//////////______\/////____\//////////__                
 
         Example Markets — USDF vending
*/

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title USDF_Mainnet
/// @notice Simple fixed-rate USDF vending machine (USDT <-> USDF).
contract USDF is ERC20, Ownable, ReentrancyGuard {
    uint256 public constant WAD = 1e18;

    // BSC mainnet USDT (18 decimals)
    address public constant USDT_ADDRESS = 0x55d398326f99059fF775485246999027B3197955;
    IERC20 public immutable usdt; // collateral token (USDT)
    uint256 public constant RATE = WAD; // 1 USDF per 1 USDT (scaled)

    event Bought(address indexed buyer, address indexed to, uint256 usdtIn, uint256 usdfOut);
    event Sold(address indexed seller, address indexed to, uint256 usdfIn, uint256 usdtOut);

    constructor() ERC20("USDF", "USDF") Ownable(msg.sender) {
        usdt = IERC20(USDT_ADDRESS);
    }

    /// @notice Purchase USDF by sending USDT at the fixed rate.
    /// @param to recipient of newly minted USDF
    /// @param usdtAmount amount of USDT to spend (must be approved)
    function buy(address to, uint256 usdtAmount) external nonReentrant returns (uint256 usdfOut) {
        require(usdtAmount > 0, "no USDT");
        usdfOut = (usdtAmount * RATE) / WAD;
        require(usdfOut > 0, "amount too small");
        require(usdt.transferFrom(msg.sender, address(this), usdtAmount), "USDT transfer failed");
        _mint(to, usdfOut);
        emit Bought(msg.sender, to, usdtAmount, usdfOut);
    }

    /// @notice Sell USDF back to the contract for USDT at the fixed rate.
    function sell(uint256 usdfAmount, address to) external nonReentrant returns (uint256 usdtOut) {
        require(usdfAmount > 0, "no USDF");
        usdtOut = (usdfAmount * WAD) / RATE;
        require(usdtOut > 0, "amount too small");
        require(usdt.balanceOf(address(this)) >= usdtOut, "insufficient USDT");
        _burn(msg.sender, usdfAmount);
        uint256 fee;
        uint256 hundredUsdt = 100 * 1e18; // assumes USDT 18 decimals
        if (usdtOut > hundredUsdt) {
            fee = (usdtOut * 2) / 100; // 2%
        } else {
            fee = 2 * 1e18; // flat 2 USDT
        }
        require(usdtOut > fee, "fee exceeds payout");
        uint256 net = usdtOut - fee;
        require(usdt.transfer(to, net), "USDT send failed");
        require(usdt.transfer(owner(), fee), "fee send failed");
        emit Sold(msg.sender, to, usdfAmount, usdtOut);
    }

    /// @notice Owner-only arbitrary mint for seeding liquidity or ops.
    function mint(address to, uint256 amount) external onlyOwner {
        require(amount > 0, "amount=0");
        _mint(to, amount);
    }

    /// @notice Rescue arbitrary ERC20 tokens accidentally sent to this contract.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).transfer(to, amount);
    }

    /// @notice Rescue USDT specifically.
    function rescueUSDT(address to, uint256 amount) external onlyOwner {
        require(usdt.transfer(to, amount), "USDT rescue failed");
    }
}
