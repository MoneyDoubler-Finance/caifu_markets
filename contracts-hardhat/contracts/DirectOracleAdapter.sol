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
 
          Example Markets — Oracle Adapter
*/
pragma solidity ^0.8.20;

/// @notice Minimal Ownable (no OZ imports to keep it lightweight)
abstract contract Ownable {
    address public owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }
    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: not owner");
        _;
    }
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Ownable: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}

/// @notice Gnosis Conditional Tokens minimal interface
/// CTF ties conditionId = keccak256(oracle, questionId, outcomeSlotCount).
/// Only the oracle (msg.sender) can call reportPayouts for that condition.  (See linked CTF code)
interface IConditionalTokens {
    function prepareCondition(address oracle, bytes32 questionId, uint256 outcomeSlotCount) external;
    function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount) external pure returns (bytes32);
    function getOutcomeSlotCount(bytes32 conditionId) external view returns (uint256);
    function payoutDenominator(bytes32 conditionId) external view returns (uint256);
    /// getter generated for mapping(bytes32 => uint[]) public payoutNumerators
    function payoutNumerators(bytes32 conditionId, uint256 index) external view returns (uint256);
    function isConditionResolved(bytes32 conditionId) external view returns (bool);
}

/// @notice Interface the Direct Oracle exposes to let the adapter ask it to report
/// The oracle implementation must internally call CTF.reportPayouts(questionId, payouts)
/// with msg.sender == oracle address (i.e., this oracle contract).
interface IDirectCTFOracle {
    function reportPayouts(bytes32 questionId, uint256[] calldata payouts) external;
}

/// @title DirectOracleAdapter
/// @notice Fat adapter responsible for initializing CTF conditions against a chosen oracle
///         and providing admin/manager utilities (clarifications, orchestration).
/// @dev Resolution itself is performed by the oracle contract; adapter never calls CTF.reportPayouts directly.
contract DirectOracleAdapter is Ownable {
    // -------------------- Errors --------------------
    error NotManager();
    error OracleNotAllowed();
    error AlreadyPrepared();
    error InvalidOutcomeCount();
    error InvalidPayouts();
    error UnknownCondition();

    // -------------------- Events --------------------
    event ManagerUpdated(address indexed account, bool allowed);
    event OracleAllowed(address indexed oracle, bool allowed);
    event ConditionInitialized(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint8 outcomeSlotCount
    );
    event ClarificationSet(bytes32 indexed conditionId, string text);
    event ResolutionRequested(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256[] payouts);
    event ResolutionSynced(bytes32 indexed conditionId, uint256[] payouts, uint256 denominator, bool resolvedFlag);

    // -------------------- Storage --------------------
    address public immutable ctf;

    /// @dev simple manager role (owner can add/remove)
    mapping(address => bool) public isManager;

    /// @dev safelist of oracle contracts this adapter is permitted to initialize markets with
    mapping(address => bool) public allowedOracles;

    struct ConditionMeta {
        bytes32 questionId;
        address oracle;
        uint8 outcomeSlotCount;
        bool prepared;
        bool resolved; // best-effort mirror; truth lives in CTF
    }

    mapping(bytes32 => ConditionMeta) public conditions;          // conditionId => meta
    mapping(bytes32 => string) public clarifications;             // optional “bulletin board”
    mapping(bytes32 => uint256[]) public lastSyncedPayouts;       // cached view of CTF state (optional)

    // -------------------- Modifiers --------------------
    modifier onlyManagerOrOwner() {
        if (msg.sender != owner && !isManager[msg.sender]) revert NotManager();
        _;
    }

    constructor(address _ctf) {
        require(_ctf != address(0), "Adapter: CTF zero");
        ctf = _ctf;
    }

    // -------------------- Admin & Roles --------------------

    function setManager(address account, bool allowed) external onlyOwner {
        isManager[account] = allowed;
        emit ManagerUpdated(account, allowed);
    }

    function setAllowedOracle(address oracle, bool allowed) external onlyOwner {
        allowedOracles[oracle] = allowed;
        emit OracleAllowed(oracle, allowed);
    }

    // -------------------- Initialization --------------------

    /// @notice Initialize a new condition on CTF, binding it to `oracle` (not to this adapter).
    /// @dev outcomeSlotCount must be >= 2. The resulting conditionId is persisted and returned.
    function initializeCondition(
        address oracle,
        bytes32 questionId,
        uint8 outcomeSlotCount,
        string calldata optionalClarification
    ) external onlyManagerOrOwner returns (bytes32 conditionId)
    {
        if (!allowedOracles[oracle]) revert OracleNotAllowed();
        if (outcomeSlotCount < 2) revert InvalidOutcomeCount();

        // Prepare condition on CTF with the ORACLE address (not adapter)
        IConditionalTokens(ctf).prepareCondition(oracle, questionId, outcomeSlotCount);

        // Compute conditionId exactly as CTF does
        conditionId = IConditionalTokens(ctf).getConditionId(oracle, questionId, outcomeSlotCount);

        ConditionMeta storage meta = conditions[conditionId];
        if (meta.prepared) revert AlreadyPrepared();

        meta.questionId = questionId;
        meta.oracle = oracle;
        meta.outcomeSlotCount = outcomeSlotCount;
        meta.prepared = true;

        if (bytes(optionalClarification).length > 0) {
            clarifications[conditionId] = optionalClarification;
            emit ClarificationSet(conditionId, optionalClarification);
        }

        emit ConditionInitialized(conditionId, oracle, questionId, outcomeSlotCount);
    }

    /// @notice Convenience helper to recompute a conditionId without state writes.
    function computeConditionId(address oracle, bytes32 questionId, uint8 outcomeSlotCount)
        external
        pure
        returns (bytes32)
    {
        // Same function signature as CTF; exposed for convenience/testing
        return keccak256(abi.encodePacked(oracle, questionId, uint256(outcomeSlotCount)));
    }

    // -------------------- Clarifications --------------------

    function setClarification(bytes32 conditionId, string calldata text) external onlyManagerOrOwner {
        if (!conditions[conditionId].prepared) revert UnknownCondition();
        clarifications[conditionId] = text;
        emit ClarificationSet(conditionId, text);
    }

    // -------------------- Resolution Orchestration --------------------

    /// @notice Ask the bound oracle to report payouts to CTF for this condition.
    /// @dev Adapter does NOT call CTF directly. It calls the oracle, which must then call CTF.reportPayouts.
    function requestResolve(bytes32 conditionId, uint256[] calldata payouts) external onlyManagerOrOwner {
        ConditionMeta memory meta = conditions[conditionId];
        if (!meta.prepared) revert UnknownCondition();
        if (payouts.length != meta.outcomeSlotCount) revert InvalidPayouts();

        // Denominator must be > 0; check here to fail fast (CTF enforces this too)
        uint256 den;
        unchecked {
            for (uint256 i = 0; i < payouts.length; i++) den += payouts[i];
        }
        if (den == 0) revert InvalidPayouts();

        // Forward to the oracle, which will call CTF.reportPayouts(questionId, payouts)
        IDirectCTFOracle(meta.oracle).reportPayouts(meta.questionId, payouts);

        emit ResolutionRequested(conditionId, meta.oracle, meta.questionId, payouts);
    }

    /// @notice Pull the resolution state from CTF and cache it locally (optional; truth remains in CTF).
    function syncResolution(bytes32 conditionId) public returns (uint256[] memory payouts, uint256 denominator, bool resolvedFlag) {
        ConditionMeta storage meta = conditions[conditionId];
        if (!meta.prepared) revert UnknownCondition();

        resolvedFlag = IConditionalTokens(ctf).isConditionResolved(conditionId);
        denominator = IConditionalTokens(ctf).payoutDenominator(conditionId);

        uint256 n = IConditionalTokens(ctf).getOutcomeSlotCount(conditionId);
        payouts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            payouts[i] = IConditionalTokens(ctf).payoutNumerators(conditionId, i);
        }

        // cache (best-effort; can be omitted if you prefer to stay fully stateless)
        delete lastSyncedPayouts[conditionId];
        if (n > 0) {
            lastSyncedPayouts[conditionId] = payouts;
        }
        meta.resolved = resolvedFlag;

        emit ResolutionSynced(conditionId, payouts, denominator, resolvedFlag);
    }

    /// @notice Read-only view helper mirroring syncResolution without writes.
    function viewResolution(bytes32 conditionId) external view returns (uint256[] memory payouts, uint256 denominator, bool resolvedFlag) {
        uint256 n = IConditionalTokens(ctf).getOutcomeSlotCount(conditionId);
        payouts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            payouts[i] = IConditionalTokens(ctf).payoutNumerators(conditionId, i);
        }
        denominator = IConditionalTokens(ctf).payoutDenominator(conditionId);
        resolvedFlag = IConditionalTokens(ctf).isConditionResolved(conditionId);
    }
}
