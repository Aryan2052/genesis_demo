// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AlertRegistry
 * @notice Immutable on-chain log of all alerts Genesis has fired.
 *         Provides a tamper-proof audit trail — no one can delete or modify
 *         historical alerts.
 *
 *         KEY BLOCKCHAIN FEATURES:
 *           1. Immutable audit trail (alerts can never be edited/deleted)
 *           2. On-chain timestamping
 *           3. Alert verification (anyone can verify an alert was real)
 *           4. Decentralised alert history (not in a private database)
 */
contract AlertRegistry is Ownable {

    // ──────────────────── Types ─────────────────────
    enum Severity { LOW, MEDIUM, HIGH, CRITICAL }

    struct Alert {
        uint256 id;
        address triggeredBy;      // which address caused the alert
        address token;            // which token was involved
        uint256 amount;           // transaction amount
        Severity severity;
        string alertType;         // "whale_transfer", "rapid_outflow", etc.
        string summary;           // human-readable summary (from CyreneAI)
        uint256 blockNumber;
        uint256 timestamp;
    }

    // ──────────────────── Storage ───────────────────
    Alert[] public alerts;
    uint256 public alertCount;

    // Authorised recorders (Genesis backend address)
    mapping(address => bool) public authorisedRecorders;

    // ──────────────────── Events ────────────────────
    event AlertRecorded(
        uint256 indexed alertId,
        address indexed triggeredBy,
        address indexed token,
        uint256 amount,
        Severity severity,
        string alertType,
        string summary,
        uint256 blockNumber,
        uint256 timestamp
    );

    event RecorderAuthorised(address indexed recorder, uint256 timestamp);
    event RecorderRevoked(address indexed recorder, uint256 timestamp);

    // ──────────────────── Modifiers ─────────────────
    modifier onlyRecorder() {
        require(
            authorisedRecorders[msg.sender] || msg.sender == owner(),
            "AlertRegistry: not authorised"
        );
        _;
    }

    // ──────────────────── Constructor ────────────────
    constructor() Ownable(msg.sender) {
        // Owner is automatically an authorised recorder
        authorisedRecorders[msg.sender] = true;
    }

    // ──────────────────── Core ──────────────────────

    /**
     * @notice Record an alert on-chain. Called by Genesis backend.
     *         Once written, the alert is IMMUTABLE.
     */
    function recordAlert(
        address triggeredBy,
        address token,
        uint256 amount,
        Severity severity,
        string calldata alertType,
        string calldata summary
    ) external onlyRecorder returns (uint256 alertId) {
        alertId = alertCount++;

        alerts.push(Alert({
            id: alertId,
            triggeredBy: triggeredBy,
            token: token,
            amount: amount,
            severity: severity,
            alertType: alertType,
            summary: summary,
            blockNumber: block.number,
            timestamp: block.timestamp
        }));

        emit AlertRecorded(
            alertId,
            triggeredBy,
            token,
            amount,
            severity,
            alertType,
            summary,
            block.number,
            block.timestamp
        );
    }

    // ──────────────────── Admin ─────────────────────

    function authoriseRecorder(address recorder) external onlyOwner {
        authorisedRecorders[recorder] = true;
        emit RecorderAuthorised(recorder, block.timestamp);
    }

    function revokeRecorder(address recorder) external onlyOwner {
        authorisedRecorders[recorder] = false;
        emit RecorderRevoked(recorder, block.timestamp);
    }

    // ──────────────────── View ──────────────────────

    function getAlert(uint256 alertId) external view returns (Alert memory) {
        require(alertId < alertCount, "Invalid alert ID");
        return alerts[alertId];
    }

    function getRecentAlerts(uint256 count) external view returns (Alert[] memory) {
        uint256 start = alertCount > count ? alertCount - count : 0;
        uint256 length = alertCount - start;
        Alert[] memory recent = new Alert[](length);
        for (uint256 i = 0; i < length; i++) {
            recent[i] = alerts[start + i];
        }
        return recent;
    }

    function getAlertsBySeverity(Severity severity) external view returns (Alert[] memory) {
        // Count first
        uint256 count = 0;
        for (uint256 i = 0; i < alertCount; i++) {
            if (alerts[i].severity == severity) count++;
        }
        // Collect
        Alert[] memory result = new Alert[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < alertCount; i++) {
            if (alerts[i].severity == severity) {
                result[idx++] = alerts[i];
            }
        }
        return result;
    }
}
