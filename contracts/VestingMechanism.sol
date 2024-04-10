// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./MerkleTree.sol";
import "./KYCVerification.sol";



error NoVestingSchedule();
error TokenAddressZero();
error InvalidProof();
error ReleaseTimeNotReached();
error NoTokensDue();
error TGEStartTimestampMustBePositive();
error NewBeneficiaryIsZeroAddress();
error CallerHasNoVestingSchedule();
error NewBeneficiaryAlreadyHasVestingSchedule();
error BeneficiaryNotKYCVerified();
error AllTokensWereClaimed();

/**
 * @title VestingMechanism
 * @dev Implements a vesting mechanism for the RumToken project
 */
contract VestingMechanism is AccessControl, ReentrancyGuard, MerkleTree, KYCVerification {
    using SafeERC20 for IERC20;

    bytes32 public constant VESTING_ADMIN_ROLE = keccak256("VESTING_ADMIN_ROLE");

    struct VestingSchedule {
        uint256 totalAmount;
        uint256 amountReleased;
        uint256 cliffDuration;
        uint256 vestingDuration;
        uint256 vestingIntervalSeconds;
        uint256 lastReleaseTime;
        uint256 initialReleasePercentage;        
    }


    mapping(address => VestingSchedule) private _vestingSchedules;
    mapping(address => bool) public hasTransferredVesting;

    IERC20 private _token;

    // TGE start timestamp
    uint256 public vestingStartTime;

    event TokensReleased(address indexed beneficiary, uint256 amount, uint256 timestamp);
    event VestingRevoked(address indexed beneficiary);
    event VestingOwnershipTransferred(address indexed previousBeneficiary, address indexed newBeneficiary);

    /**
     * @dev Sets the token that will be vested, initializes roles, and sets the TGE start timestamp.
     * @param tokenAddress The address of the RumToken contract.
     * @param vestingMerkleRoot The merkle root for vesting schedules.
     * @param _vestingStartTime The TGE start timestamp.
     */
    constructor(
        address adminAddress,
        address tokenAddress,
        bytes32 vestingMerkleRoot,
        uint256 _vestingStartTime
    )
        MerkleTree(vestingMerkleRoot)
        KYCVerification(adminAddress)
    {
        if (tokenAddress == address(0)) revert TokenAddressZero();
        _token = IERC20(tokenAddress);
        vestingStartTime = _vestingStartTime;     
        _grantRole(DEFAULT_ADMIN_ROLE, adminAddress);   
        _grantRole(VESTING_ADMIN_ROLE, adminAddress);
    }

    struct ReleaseParams {
        address beneficiary;
        uint256 totalAmount;
        uint256 delayInSeconds;
        uint256 tgePercent;   
        uint256 vestingPeriodDays;             
        uint256 vestingPeriodDurationInSeconds;
    }

    /**
    * @dev Releases vested tokens to the beneficiary. If no vesting schedule exists, attempts to create one using Merkle tree verification.
    * @param params The parameters for releasing vested tokens, encapsulated in a struct.
    * @param proof Merkle proof to verify against the Merkle root for creating a new vesting schedule.
    */
    function release(ReleaseParams calldata params, bytes32[] calldata proof) external nonReentrant {
        require(msg.sender == params.beneficiary, "VestingMechanism: Caller must be the beneficiary");
        if (hasTransferredVesting[msg.sender]) revert CallerHasNoVestingSchedule();
        if (kycRequired) {
            if (!isKYCVerified(params.beneficiary)) revert BeneficiaryNotKYCVerified();
        }
        
        VestingSchedule storage schedule = _vestingSchedules[params.beneficiary];
        // Check if the vesting schedule exists or needs to be created
        if (schedule.totalAmount == 0) {
            // Attempt to create a new vesting schedule if it does not exist
            bytes32 leaf = keccak256(abi.encodePacked(params.beneficiary, params.totalAmount, params.delayInSeconds, params.tgePercent, params.vestingPeriodDays, params.vestingPeriodDurationInSeconds));            
            if (!verifyProof(proof, leaf)) revert InvalidProof();
                                        
            schedule.totalAmount = params.totalAmount;
            schedule.amountReleased = 0;
            schedule.lastReleaseTime = 0;
            schedule.cliffDuration = params.delayInSeconds;
            schedule.vestingDuration = params.vestingPeriodDays * 86400; // Convert days to seconds
            schedule.initialReleasePercentage = params.tgePercent;      
            schedule.vestingIntervalSeconds = params.vestingPeriodDurationInSeconds;      
        }
        uint256 amountClaimable = _releasableAmount(schedule); 
        uint256 nextEligibleReleaseTime = _calculateNextEligibleReleaseTime(amountClaimable, schedule.lastReleaseTime, schedule.cliffDuration, schedule.vestingIntervalSeconds);
        if (block.timestamp < nextEligibleReleaseTime) revert ReleaseTimeNotReached();
        if (amountClaimable == 0) revert NoTokensDue();

        schedule.amountReleased += amountClaimable;
        schedule.lastReleaseTime = block.timestamp;        
        _token.safeTransfer(params.beneficiary, amountClaimable);

        emit TokensReleased(params.beneficiary, amountClaimable, block.timestamp);
    }

    struct VestingDetails {
        uint256 vestingStart;
        uint256 vestingEnd;
        uint256 amountClaimable;
        uint256 amountReleased;
        uint256 amountLeft;
        bool hasVestingSchedule;
        uint256 nextReleaseTime;
        bool isClaimable;
    }

    /**
     * @dev Calculates the next eligible release time for a given vesting schedule.
     * @param amountClaimable The amount that is claimable at the time of the function call.
     * @param lastReleaseTime The timestamp of the last release.
     * @param cliffDuration The duration of the cliff in seconds.
     * @param vestingIntervalSeconds The duration between vesting intervals in seconds.
     * @return uint256 The timestamp of the next eligible release time.
     */
    function _calculateNextEligibleReleaseTime(uint256 amountClaimable, uint256 lastReleaseTime, uint256 cliffDuration, uint256 vestingIntervalSeconds) private view returns (uint256) {
        uint256 vestingStart = vestingStartTime + cliffDuration;        
        uint256 nextEligibleReleaseTime;

        if ((lastReleaseTime > 0 && amountClaimable == 0 && block.timestamp < vestingStart) || (lastReleaseTime == 0 && amountClaimable == 0 && block.timestamp < vestingStart)) {
            nextEligibleReleaseTime = vestingStart;
        } else {
            if (block.timestamp >= vestingStart && lastReleaseTime < vestingStart) {
                nextEligibleReleaseTime = vestingStart;
            } else {
                nextEligibleReleaseTime = lastReleaseTime + vestingIntervalSeconds;
            }
        }

        return nextEligibleReleaseTime;
    }

    /**
    * @dev Retrieves vesting details for a beneficiary. If no vesting schedule exists, it calculates potential vesting details based on the provided parameters.
    * @param params The parameters for releasing or potentially creating a new vesting schedule for the beneficiary.
    * @return VestingDetails A struct containing detailed information about the beneficiary's vesting schedule.
    */
    function getVestingDetails(ReleaseParams calldata params)
        public
        view
        returns (VestingDetails memory)
    {
        VestingSchedule storage schedule = _vestingSchedules[params.beneficiary];
        bool hasVestingSchedule = schedule.totalAmount > 0;

        uint256 cliffDuration = hasVestingSchedule ? schedule.cliffDuration : params.delayInSeconds;
        uint256 vestingDuration = hasVestingSchedule ? schedule.vestingDuration : params.vestingPeriodDays * 86400; // Convert days to seconds
        uint256 vestingIntervalSeconds = hasVestingSchedule ? schedule.vestingIntervalSeconds : params.vestingPeriodDurationInSeconds;

        uint256 vestingStart = vestingStartTime + cliffDuration;                       
        uint256 vestingEnd = vestingStartTime + cliffDuration + vestingDuration;                        

        VestingSchedule memory tempSchedule = VestingSchedule({
            totalAmount: hasVestingSchedule ? schedule.totalAmount : params.totalAmount,
            amountReleased: schedule.amountReleased,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            vestingIntervalSeconds: vestingIntervalSeconds,
            lastReleaseTime: schedule.lastReleaseTime,
            initialReleasePercentage: hasVestingSchedule ? schedule.initialReleasePercentage : params.tgePercent                
        });
        uint256 amountClaimable = _releasableAmount(tempSchedule);
        uint256 amountLeft = schedule.totalAmount - schedule.amountReleased;
        uint256 nextEligibleReleaseTime;
        nextEligibleReleaseTime = _calculateNextEligibleReleaseTime(amountClaimable, schedule.lastReleaseTime, cliffDuration, vestingIntervalSeconds);
        bool isClaimable = amountClaimable > 0 && nextEligibleReleaseTime > 0 && block.timestamp >= nextEligibleReleaseTime;

        return VestingDetails({
            vestingStart: vestingStart,
            vestingEnd: vestingEnd,
            amountClaimable: amountClaimable,
            amountReleased: schedule.amountReleased,
            amountLeft: amountLeft,
            hasVestingSchedule: hasVestingSchedule,
            nextReleaseTime: nextEligibleReleaseTime,
            isClaimable: isClaimable
        });
    }
    /**
     * @dev Calculates the amount that has already vested but hasn't been released yet.
     * Private view function used internally to calculate releasable amount.
     * @param schedule The vesting schedule of the beneficiary.
     * @return The vested amount that hasn't been released yet.
     */
    function _releasableAmount(VestingSchedule memory schedule) private view returns (uint256) {
        if (hasTransferredVesting[msg.sender]){
            return 0;
        }
        return _vestedAmount(schedule) - schedule.amountReleased;
    }

    /**
     * @dev Calculates the amount that has already vested.
     * Private view function used internally to calculate vested amount.
     * @param schedule The vesting schedule of the beneficiary.
     * @return The amount that has already vested.
     */
    function _vestedAmount(VestingSchedule memory schedule) private view returns (uint256) {
        uint256 currentTime = block.timestamp;

        // Calculate the initial release amount
        uint256 initialRelease = (schedule.totalAmount * schedule.initialReleasePercentage) / 100;

        if (currentTime >= vestingStartTime + schedule.cliffDuration + schedule.vestingDuration) {            
            return schedule.totalAmount;
        } else if (currentTime >= vestingStartTime + schedule.cliffDuration) {
            // If the current time is after the cliff duration, calculate the vested amount
            // This includes the initial release plus any additional amount vested based on time elapsed since the cliff
            uint256 timeElapsedSinceCliff = currentTime - (vestingStartTime + schedule.cliffDuration);
            uint256 vestingDurationAfterCliff = schedule.vestingDuration - schedule.cliffDuration;
            uint256 vestedAmountAfterInitial = (schedule.totalAmount - initialRelease) * timeElapsedSinceCliff / vestingDurationAfterCliff;
            return initialRelease + vestedAmountAfterInitial;
        } else {
            // Before or at the cliff duration, the initial release is available
            return initialRelease;
        }
    }

    /**
     * @dev Allows changing the vesting start timestamp. Can only be called by an admin.
     * @param newVestingStartTime The new vesting start timestamp.
     */
    function setTgeStartTimestamp(uint256 newVestingStartTime) external onlyRole(VESTING_ADMIN_ROLE) {
        if (newVestingStartTime <= 0) revert TGEStartTimestampMustBePositive();
        vestingStartTime = newVestingStartTime;        
    }

    /**
     * @dev Transfers the ownership of the caller's vesting schedule to a new beneficiary.
     * @param newBeneficiary The address of the new beneficiary.
     */
    function transferVestingOwnership(address newBeneficiary) external {
        if (newBeneficiary == address(0)) revert NewBeneficiaryIsZeroAddress();
        if (_vestingSchedules[msg.sender].totalAmount == 0) revert CallerHasNoVestingSchedule();
        if (_vestingSchedules[msg.sender].totalAmount == _vestingSchedules[msg.sender].amountReleased) revert AllTokensWereClaimed();
        require(newBeneficiary != address(this), "Vesting: new owner can not be the vesting contract");
        
        // Ensure the new beneficiary does not already have a vesting schedule
        if (_vestingSchedules[newBeneficiary].totalAmount > 0) revert NewBeneficiaryAlreadyHasVestingSchedule();

        // Transfer the vesting schedule
        hasTransferredVesting[msg.sender] = true;
        _vestingSchedules[newBeneficiary] = _vestingSchedules[msg.sender];

        // Reset the vesting schedule of the current beneficiary
        delete _vestingSchedules[msg.sender];

        emit VestingOwnershipTransferred(msg.sender, newBeneficiary);
    }

}
