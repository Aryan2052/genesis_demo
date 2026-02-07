// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ThresholdEngine
 * @notice **User-customisable** on-chain threshold rules.
 *         Any user can register their own alert thresholds for tokens/vaults.
 *         Genesis reads these thresholds to decide when to fire alerts.
 *
 *         KEY BLOCKCHAIN FEATURES:
 *           1. Fully on-chain configuration — no off-chain database needed
 *           2. Each user controls their own thresholds
 *           3. Events emitted for every config change (auditable)
 *           4. Enumerable: Genesis can query all active thresholds
 */
contract ThresholdEngine is Ownable {

    // ──────────────────── Types ─────────────────────
    enum AlertType { LARGE_TRANSFER, WHALE_MOVEMENT, RAPID_FLOW, CUSTOM }

    struct ThresholdRule {
        address token;           // which token to monitor (address(0) = any)
        AlertType alertType;
        uint256 threshold;       // minimum amount to trigger
        uint256 cooldownSec;     // minimum seconds between alerts
        bool enabled;
        string description;      // human-readable (stored on-chain)
    }

    // ──────────────────── Storage ───────────────────
    // user → ruleIndex → ThresholdRule
    mapping(address => ThresholdRule[]) public userRules;
    
    // Global default thresholds (set by contract owner / protocol)
    ThresholdRule[] public globalRules;

    // All users who have ever set a rule (for enumeration)
    address[] public activeUsers;
    mapping(address => bool) private _isActiveUser;

    // ──────────────────── Events ────────────────────
    event ThresholdSet(
        address indexed user,
        uint256 indexed ruleIndex,
        address token,
        AlertType alertType,
        uint256 threshold,
        uint256 cooldownSec,
        string description,
        uint256 timestamp
    );

    event ThresholdUpdated(
        address indexed user,
        uint256 indexed ruleIndex,
        uint256 oldThreshold,
        uint256 newThreshold,
        uint256 timestamp
    );

    event ThresholdRemoved(
        address indexed user,
        uint256 indexed ruleIndex,
        uint256 timestamp
    );

    event GlobalThresholdSet(
        uint256 indexed ruleIndex,
        address token,
        AlertType alertType,
        uint256 threshold,
        string description,
        uint256 timestamp
    );

    // ──────────────────── Constructor ────────────────
    constructor() Ownable(msg.sender) {}

    // ──────────────────── User functions ─────────────

    /**
     * @notice Create a new alert threshold. Fully user-controlled.
     */
    function setThreshold(
        address token,
        AlertType alertType,
        uint256 threshold,
        uint256 cooldownSec,
        string calldata description
    ) external returns (uint256 ruleIndex) {
        require(threshold > 0, "Threshold must be > 0");

        ThresholdRule memory rule = ThresholdRule({
            token: token,
            alertType: alertType,
            threshold: threshold,
            cooldownSec: cooldownSec,
            enabled: true,
            description: description
        });

        userRules[msg.sender].push(rule);
        ruleIndex = userRules[msg.sender].length - 1;

        // Track active user
        if (!_isActiveUser[msg.sender]) {
            _isActiveUser[msg.sender] = true;
            activeUsers.push(msg.sender);
        }

        emit ThresholdSet(
            msg.sender,
            ruleIndex,
            token,
            alertType,
            threshold,
            cooldownSec,
            description,
            block.timestamp
        );
    }

    /**
     * @notice Update an existing threshold value.
     */
    function updateThreshold(uint256 ruleIndex, uint256 newThreshold) external {
        require(ruleIndex < userRules[msg.sender].length, "Invalid rule index");
        require(newThreshold > 0, "Threshold must be > 0");

        uint256 old = userRules[msg.sender][ruleIndex].threshold;
        userRules[msg.sender][ruleIndex].threshold = newThreshold;

        emit ThresholdUpdated(msg.sender, ruleIndex, old, newThreshold, block.timestamp);
    }

    /**
     * @notice Disable a threshold (soft delete).
     */
    function removeThreshold(uint256 ruleIndex) external {
        require(ruleIndex < userRules[msg.sender].length, "Invalid rule index");
        userRules[msg.sender][ruleIndex].enabled = false;

        emit ThresholdRemoved(msg.sender, ruleIndex, block.timestamp);
    }

    // ──────────────────── Owner / global rules ──────

    /**
     * @notice Owner sets protocol-wide default thresholds.
     */
    function setGlobalThreshold(
        address token,
        AlertType alertType,
        uint256 threshold,
        uint256 cooldownSec,
        string calldata description
    ) external onlyOwner returns (uint256 ruleIndex) {
        globalRules.push(ThresholdRule({
            token: token,
            alertType: alertType,
            threshold: threshold,
            cooldownSec: cooldownSec,
            enabled: true,
            description: description
        }));
        ruleIndex = globalRules.length - 1;

        emit GlobalThresholdSet(ruleIndex, token, alertType, threshold, description, block.timestamp);
    }

    // ──────────────────── View helpers ───────────────

    function getUserRuleCount(address user) external view returns (uint256) {
        return userRules[user].length;
    }

    function getUserRule(address user, uint256 index) external view returns (ThresholdRule memory) {
        return userRules[user][index];
    }

    function getGlobalRuleCount() external view returns (uint256) {
        return globalRules.length;
    }

    function getActiveUserCount() external view returns (uint256) {
        return activeUsers.length;
    }

    /**
     * @notice Returns all enabled thresholds for a given user + global rules.
     *         Genesis calls this to build the active rule set.
     */
    function getActiveThresholds(address user) external view returns (ThresholdRule[] memory) {
        uint256 userCount = userRules[user].length;
        uint256 globalCount = globalRules.length;
        
        // Count enabled rules
        uint256 enabledCount = 0;
        for (uint256 i = 0; i < userCount; i++) {
            if (userRules[user][i].enabled) enabledCount++;
        }
        for (uint256 i = 0; i < globalCount; i++) {
            if (globalRules[i].enabled) enabledCount++;
        }

        ThresholdRule[] memory result = new ThresholdRule[](enabledCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < userCount; i++) {
            if (userRules[user][i].enabled) {
                result[idx++] = userRules[user][i];
            }
        }
        for (uint256 i = 0; i < globalCount; i++) {
            if (globalRules[i].enabled) {
                result[idx++] = globalRules[i];
            }
        }

        return result;
    }
}
