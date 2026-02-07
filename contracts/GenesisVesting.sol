// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GenesisVesting
 * @notice On-chain token vesting with cliff + linear unlock.
 *         Genesis monitors all vesting events in real time.
 *
 *         KEY FEATURES:
 *           1. Create vesting schedules for any beneficiary
 *           2. Cliff period — no tokens unlockable until cliff passes
 *           3. Linear vesting — tokens unlock gradually after cliff
 *           4. Claim — beneficiary claims unlocked tokens
 *           5. Revoke — owner can revoke unvested tokens
 *           6. Rich events for every action (Genesis monitors these)
 */
contract GenesisVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────── Types ─────────────────────
    struct VestingSchedule {
        address beneficiary;
        address token;
        uint256 totalAmount;       // total tokens locked
        uint256 claimedAmount;     // tokens already claimed
        uint256 startTime;         // vesting start timestamp
        uint256 cliffDuration;     // seconds until cliff ends
        uint256 vestingDuration;   // total vesting duration (includes cliff)
        bool revoked;
        string description;        // e.g. "Team allocation - 12 month vest"
    }

    // ──────────────────── Storage ───────────────────
    VestingSchedule[] public schedules;
    
    // beneficiary → list of their schedule IDs
    mapping(address => uint256[]) public beneficiarySchedules;

    // ──────────────────── Events ────────────────────
    event VestingCreated(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        address indexed token,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        string description,
        uint256 timestamp
    );

    event TokensClaimed(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 amountClaimed,
        uint256 totalClaimed,
        uint256 remainingLocked,
        uint256 timestamp
    );

    event VestingRevoked(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 unvestedAmount,
        uint256 vestedUnclaimed,
        uint256 timestamp
    );

    event UnlockMilestone(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        string milestone,   // "cliff_reached" | "25_percent" | "50_percent" | "75_percent" | "fully_vested"
        uint256 unlockedAmount,
        uint256 timestamp
    );

    // ──────────────────── Constructor ────────────────
    constructor() Ownable(msg.sender) {}

    // ──────────────────── Core functions ─────────────

    /**
     * @notice Create a new vesting schedule. Tokens are transferred to this contract.
     * @param beneficiary Address that will receive vested tokens
     * @param token ERC20 token address
     * @param totalAmount Total tokens to vest
     * @param cliffDuration Seconds until cliff (0 = no cliff)
     * @param vestingDuration Total duration in seconds (must be >= cliffDuration)
     * @param description Human-readable description
     */
    function createVesting(
        address beneficiary,
        address token,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        string calldata description
    ) external onlyOwner returns (uint256 scheduleId) {
        require(beneficiary != address(0), "Vesting: zero address");
        require(totalAmount > 0, "Vesting: zero amount");
        require(vestingDuration >= cliffDuration, "Vesting: duration < cliff");
        require(vestingDuration > 0, "Vesting: zero duration");

        // Transfer tokens to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);

        scheduleId = schedules.length;
        schedules.push(VestingSchedule({
            beneficiary: beneficiary,
            token: token,
            totalAmount: totalAmount,
            claimedAmount: 0,
            startTime: block.timestamp,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            revoked: false,
            description: description
        }));

        beneficiarySchedules[beneficiary].push(scheduleId);

        emit VestingCreated(
            scheduleId,
            beneficiary,
            token,
            totalAmount,
            cliffDuration,
            vestingDuration,
            description,
            block.timestamp
        );
    }

    /**
     * @notice Claim unlocked (vested) tokens.
     * @param scheduleId The vesting schedule to claim from
     */
    function claim(uint256 scheduleId) external nonReentrant {
        VestingSchedule storage s = schedules[scheduleId];
        require(msg.sender == s.beneficiary, "Vesting: not beneficiary");
        require(!s.revoked, "Vesting: revoked");

        uint256 vested = _vestedAmount(s);
        uint256 claimable = vested - s.claimedAmount;
        require(claimable > 0, "Vesting: nothing to claim");

        s.claimedAmount += claimable;

        IERC20(s.token).safeTransfer(s.beneficiary, claimable);

        uint256 remaining = s.totalAmount - s.claimedAmount;

        emit TokensClaimed(
            scheduleId,
            s.beneficiary,
            claimable,
            s.claimedAmount,
            remaining,
            block.timestamp
        );

        // Check milestones
        _checkMilestones(scheduleId, s);
    }

    /**
     * @notice Owner revokes unvested tokens (e.g., team member leaves).
     * @param scheduleId The schedule to revoke
     */
    function revoke(uint256 scheduleId) external onlyOwner {
        VestingSchedule storage s = schedules[scheduleId];
        require(!s.revoked, "Vesting: already revoked");

        uint256 vested = _vestedAmount(s);
        uint256 unvested = s.totalAmount - vested;
        uint256 vestedUnclaimed = vested - s.claimedAmount;

        s.revoked = true;

        // Return unvested tokens to owner
        if (unvested > 0) {
            IERC20(s.token).safeTransfer(owner(), unvested);
        }

        emit VestingRevoked(
            scheduleId,
            s.beneficiary,
            unvested,
            vestedUnclaimed,
            block.timestamp
        );
    }

    /**
     * @notice Simulate time passing for demo purposes (owner only).
     *         In production this would not exist — time passes naturally.
     */
    function simulateTimePass(uint256 scheduleId, uint256 secondsToAdvance) external onlyOwner {
        VestingSchedule storage s = schedules[scheduleId];
        s.startTime -= secondsToAdvance;

        // Emit milestone if cliff just passed
        uint256 vested = _vestedAmount(s);
        if (vested > 0 && s.claimedAmount == 0) {
            uint256 pct = (vested * 100) / s.totalAmount;
            string memory milestone;
            if (block.timestamp >= s.startTime + s.cliffDuration && pct >= 1) {
                milestone = "cliff_reached";
            } else if (pct >= 75) {
                milestone = "75_percent";
            } else if (pct >= 50) {
                milestone = "50_percent";
            } else if (pct >= 25) {
                milestone = "25_percent";
            }
            
            if (bytes(milestone).length > 0) {
                emit UnlockMilestone(scheduleId, s.beneficiary, milestone, vested, block.timestamp);
            }
        }
    }

    // ──────────────────── View functions ─────────────

    function getScheduleCount() external view returns (uint256) {
        return schedules.length;
    }

    function getClaimable(uint256 scheduleId) external view returns (uint256) {
        VestingSchedule storage s = schedules[scheduleId];
        if (s.revoked) return 0;
        uint256 vested = _vestedAmount(s);
        return vested - s.claimedAmount;
    }

    function getVestedAmount(uint256 scheduleId) external view returns (uint256) {
        return _vestedAmount(schedules[scheduleId]);
    }

    function getBeneficiaryScheduleCount(address beneficiary) external view returns (uint256) {
        return beneficiarySchedules[beneficiary].length;
    }

    function getScheduleInfo(uint256 scheduleId) external view returns (
        address beneficiary,
        uint256 totalAmount,
        uint256 claimedAmount,
        uint256 claimable,
        uint256 vestingProgress, // 0-100
        bool revoked,
        string memory description
    ) {
        VestingSchedule storage s = schedules[scheduleId];
        uint256 vested = _vestedAmount(s);
        return (
            s.beneficiary,
            s.totalAmount,
            s.claimedAmount,
            s.revoked ? 0 : vested - s.claimedAmount,
            s.totalAmount > 0 ? (vested * 100) / s.totalAmount : 0,
            s.revoked,
            s.description
        );
    }

    // ──────────────────── Internal ──────────────────

    function _vestedAmount(VestingSchedule storage s) internal view returns (uint256) {
        if (block.timestamp < s.startTime + s.cliffDuration) {
            return 0; // Still in cliff period
        }

        uint256 elapsed = block.timestamp - s.startTime;
        if (elapsed >= s.vestingDuration) {
            return s.totalAmount; // Fully vested
        }

        // Linear vesting after cliff
        return (s.totalAmount * elapsed) / s.vestingDuration;
    }

    function _checkMilestones(uint256 scheduleId, VestingSchedule storage s) internal {
        uint256 pct = (s.claimedAmount * 100) / s.totalAmount;
        
        if (s.claimedAmount == s.totalAmount) {
            emit UnlockMilestone(scheduleId, s.beneficiary, "fully_vested", s.totalAmount, block.timestamp);
        } else if (pct >= 75) {
            emit UnlockMilestone(scheduleId, s.beneficiary, "75_percent", s.claimedAmount, block.timestamp);
        } else if (pct >= 50) {
            emit UnlockMilestone(scheduleId, s.beneficiary, "50_percent", s.claimedAmount, block.timestamp);
        } else if (pct >= 25) {
            emit UnlockMilestone(scheduleId, s.beneficiary, "25_percent", s.claimedAmount, block.timestamp);
        }
    }
}
