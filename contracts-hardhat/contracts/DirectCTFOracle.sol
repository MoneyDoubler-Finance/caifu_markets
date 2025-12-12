// SPDX-License-Identifier: MIT
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
 
          Example Markets — DirectCTFOracle
*/
pragma solidity ^0.8.24;

/// @title DirectCTFOracle
/// @notice Simple, admin-controlled oracle for Gnosis Conditional Tokens (CTF).
///         - Creates conditions with this contract as the oracle
///         - Resolves conditions by calling CTF.reportPayouts(...)
/// @dev Designed to interoperate with the CTF (v1/v2) interface as used by Polymarket/Omen.
///      See the CTF signatures referenced in your codebase (prepareCondition/reportPayouts). 
///      Uses AccessControl for separate CREATOR and RESOLVER roles.
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface IConditionalTokens {
    // CTF core
    function prepareCondition(address oracle, bytes32 questionId, uint256 outcomeSlotCount) external;
    function reportPayouts(bytes32 questionId, uint256[] calldata payouts) external;

    // helpers / views
    function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount) external pure returns (bytes32);
    function getOutcomeSlotCount(bytes32 conditionId) external view returns (uint256);
    function payoutDenominator(bytes32 conditionId) external view returns (uint256);
}

/// @dev Minimal, dependency-free utilities for array checks.
library OracleUtils {
    function sum(uint256[] memory arr) internal pure returns (uint256 s) {
        for (uint256 i = 0; i < arr.length; i++) s += arr[i];
    }
}

contract DirectCTFOracle is AccessControl {
    using OracleUtils for uint256[];

    // --- Roles ---
    bytes32 public constant CREATOR_ROLE  = keccak256("CREATOR_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");

    // --- Immutable / Config ---
    IConditionalTokens public immutable ctf;

    // --- Book-keeping (optional but useful in UIs/backends) ---
    struct ConditionMeta {
        bool prepared;
        bool resolved;
        uint8 outcomeSlots;
        bytes32 questionId;
        bytes32 conditionId;
    }

    // questionId => ConditionMeta (latest outcomeSlotCount wins if reused)
    mapping(bytes32 => ConditionMeta) public conditions;

    // conditionId => true (fast existence/resolve checks)
    mapping(bytes32 => bool) public isPrepared;

    // --- Events ---
    event ConditionInitialized(bytes32 indexed conditionId, bytes32 indexed questionId, uint8 outcomeSlots);
    event ConditionResolved(bytes32 indexed conditionId, bytes32 indexed questionId, uint256[] payoutNumerators);
    event ConditionInvalidated(bytes32 indexed conditionId, bytes32 indexed questionId);

    // --- Constructor ---
    constructor(address _ctf, address admin) {
        require(_ctf != address(0), "CTF addr=0");
        ctf = IConditionalTokens(_ctf);

        // role setup
        _grantRole(DEFAULT_ADMIN_ROLE, admin == address(0) ? msg.sender : admin);
        _grantRole(CREATOR_ROLE,       admin == address(0) ? msg.sender : admin);
        _grantRole(RESOLVER_ROLE,      admin == address(0) ? msg.sender : admin);
    }

    // =========
    // Creation
    // =========

    /// @notice Create a condition on CTF with this contract as the oracle.
    /// @param questionId Arbitrary bytes32 question id (your off-chain registry should map to metadata)
    /// @param outcomeSlotCount Number of outcomes (>=2, <=256; 2 for binary markets)
    function prepareCondition(bytes32 questionId, uint8 outcomeSlotCount)
        public
        onlyRole(CREATOR_ROLE)
        returns (bytes32 conditionId)
    {
        require(outcomeSlotCount >= 2, "need >=2 outcomes");

        // Derive conditionId that CTF will use and ensure not already prepared.
        conditionId = ctf.getConditionId(address(this), questionId, outcomeSlotCount);
        require(!isPrepared[conditionId], "already prepared");

        // Call CTF to initialize; CTF stores payout vector length = outcomeSlotCount.
        ctf.prepareCondition(address(this), questionId, outcomeSlotCount);

        // Persist a lightweight local index (handy for adapters/UIs).
        conditions[questionId] = ConditionMeta({
            prepared: true,
            resolved: false,
            outcomeSlots: outcomeSlotCount,
            questionId: questionId,
            conditionId: conditionId
        });
        isPrepared[conditionId] = true;

        emit ConditionInitialized(conditionId, questionId, outcomeSlotCount);
    }

    /// @notice Convenience for binary conditions (YES/NO).
    function prepareBinaryCondition(bytes32 questionId)
        public
        onlyRole(CREATOR_ROLE)
        returns (bytes32)
    {
        return prepareCondition(questionId, 2);
    }

    // =========
    // Resolve
    // =========

    /// @notice Resolve with explicit payout vector.
    /// @dev Requirements enforced by CTF:
    ///      - condition must be prepared
    ///      - length(payouts) == outcomeSlotCount
    ///      - denominator (sum) > 0 (use equal splits for "invalid" markets)
    ///      - can be called only once (denominator == 0 prior to call)
    function resolve(bytes32 questionId, uint256[] memory payouts)
        public
        onlyRole(RESOLVER_ROLE)
    {
        ConditionMeta memory meta = conditions[questionId];
        require(meta.prepared, "not prepared");
        require(!meta.resolved, "already resolved");
        require(payouts.length == meta.outcomeSlots, "length mismatch");
        require(payouts.sum() > 0, "denominator=0");

        // This call will succeed only because the oracle recorded by CTF is this contract
        // and CTF uses msg.sender (this contract) to recompute conditionId at resolve time.
        ctf.reportPayouts(questionId, payouts);

        // Mark resolved locally (CTF also prevents double-resolve via non-zero denominator).
        conditions[questionId].resolved = true;

        emit ConditionResolved(meta.conditionId, questionId, payouts);
    }

    /// @notice Convenience for binary markets: YES wins (index 0) or NO wins (index 1).
    function resolveBinary(bytes32 questionId, bool yesWins)
        public
        onlyRole(RESOLVER_ROLE)
    {
        uint256[] memory payouts = new uint256[](2);
        payouts[yesWins ? 0 : 1] = 1;
        resolve(questionId, payouts);
    }

    /// @notice Mark market invalid (equal split among outcomes). Common pattern with CTF.
    function invalidate(bytes32 questionId)
        external
        onlyRole(RESOLVER_ROLE)
    {
        ConditionMeta memory meta = conditions[questionId];
        require(meta.prepared, "not prepared");
        require(!meta.resolved, "already resolved");

        uint256[] memory p = new uint256[](meta.outcomeSlots);
        for (uint256 i = 0; i < p.length; i++) p[i] = 1;

        ctf.reportPayouts(questionId, p);
        conditions[questionId].resolved = true;

        emit ConditionInvalidated(meta.conditionId, questionId);
    }

    /// @notice Adapter entrypoint: forward payouts to CTF using this contract as the oracle.
    /// @dev Keeps access control simple (RESOLVER_ROLE) and does not rely on the local
    ///      `prepared` flag; CTF itself enforces that the condition exists and the caller
    ///      matches the oracle bound at prepare time. We still emit a resolved event and
    ///      best-effort backfill the local index so UIs/backends can mirror state.
    function reportPayouts(bytes32 questionId, uint256[] calldata payouts)
        external
        onlyRole(RESOLVER_ROLE)
    {
        // Forward directly to CTF; this will revert if the condition was not prepared
        // with this contract as the oracle, if the length mismatches, or if denominator == 0.
        ctf.reportPayouts(questionId, payouts);

        // Best-effort bookkeeping (does not affect core resolution semantics)
        ConditionMeta storage meta = conditions[questionId];
        bytes32 conditionId = meta.conditionId;
        if (conditionId == bytes32(0)) {
            // Derive conditionId from payouts length; assumes caller supplied the correct
            // outcome count (adapter already enforces this) and matches the prepared CTF condition.
            uint8 slots = uint8(payouts.length);
            conditionId = ctf.getConditionId(address(this), questionId, slots);
            conditions[questionId] = ConditionMeta({
                prepared: true,
                resolved: true,
                outcomeSlots: slots,
                questionId: questionId,
                conditionId: conditionId
            });
        } else {
            meta.resolved = true;
        }

        emit ConditionResolved(conditionId, questionId, payouts);
    }

    // =========
    // Views
    // =========

    /// @notice Compute the conditionId deterministically (mirrors CTF).
    function computeConditionId(bytes32 questionId, uint8 outcomeSlotCount) external view returns (bytes32) {
        return ctf.getConditionId(address(this), questionId, outcomeSlotCount);
    }

    /// @notice Check on-chain outcome slot count via CTF (0 => not prepared).
    function ctfOutcomeSlots(bytes32 conditionId) external view returns (uint256) {
        return ctf.getOutcomeSlotCount(conditionId);
    }

    /// @notice True if CTF denominator set (i.e., resolved at CTF layer).
    function ctfIsResolved(bytes32 conditionId) external view returns (bool) {
        return ctf.payoutDenominator(conditionId) > 0;
    }
}
