// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GenesisVault
 * @notice On-chain vault that emits rich events for every deposit, withdrawal,
 *         and internal transfer.  Genesis monitors these events in real time.
 *
 *         KEY BLOCKCHAIN FEATURES SHOWCASED:
 *           1. Event-driven architecture (Solidity `event`)
 *           2. Inbound/outbound tracking on-chain
 *           3. Reentrancy protection
 *           4. Per-user balance accounting
 *           5. Emergency pause (circuit-breaker pattern)
 */
contract GenesisVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────── State ────────────────────
    IERC20 public immutable token;

    mapping(address => uint256) public balances;
    uint256 public totalDeposits;
    uint256 public totalWithdrawals;
    bool public paused;

    // ──────────────────── Events (the core of Genesis monitoring) ────────
    /// @notice Emitted on every deposit — Genesis indexes this immediately.
    event Deposit(
        address indexed user,
        uint256 amount,
        uint256 newBalance,
        uint256 timestamp
    );

    /// @notice Emitted on every withdrawal — potential "outbound whale" signal.
    event Withdrawal(
        address indexed user,
        uint256 amount,
        uint256 remainingBalance,
        uint256 timestamp
    );

    /// @notice Vault-internal transfer between two users.
    event InternalTransfer(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 timestamp
    );

    /// @notice Large movement detected on-chain — threshold exceeded.
    event LargeMovement(
        address indexed user,
        string movementType,  // "deposit" | "withdrawal"
        uint256 amount,
        uint256 thresholdUsed,
        uint256 timestamp
    );

    /// @notice Emergency pause toggled.
    event EmergencyAction(
        string action,   // "paused" | "unpaused"
        address indexed triggeredBy,
        uint256 timestamp
    );

    // ──────────────────── Modifiers ─────────────────
    modifier whenNotPaused() {
        require(!paused, "Vault: paused");
        _;
    }

    // ──────────────────── Constructor ────────────────
    constructor(address tokenAddress) Ownable(msg.sender) {
        token = IERC20(tokenAddress);
    }

    // ──────────────────── Core functions ─────────────

    /**
     * @notice Deposit tokens into the vault.
     * @param amount Number of token units (with decimals).
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Vault: zero amount");

        token.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        totalDeposits += amount;

        emit Deposit(msg.sender, amount, balances[msg.sender], block.timestamp);

        // On-chain large-movement detection (threshold hard-coded for demo;
        // the ThresholdEngine contract provides user-customisable thresholds).
        if (amount >= 100_000 * 1e6) {
            emit LargeMovement(msg.sender, "deposit", amount, 100_000 * 1e6, block.timestamp);
        }
    }

    /**
     * @notice Withdraw tokens from the vault.
     */
    function withdraw(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Vault: zero amount");
        require(balances[msg.sender] >= amount, "Vault: insufficient balance");

        balances[msg.sender] -= amount;
        totalWithdrawals += amount;
        token.safeTransfer(msg.sender, amount);

        emit Withdrawal(msg.sender, amount, balances[msg.sender], block.timestamp);

        if (amount >= 100_000 * 1e6) {
            emit LargeMovement(msg.sender, "withdrawal", amount, 100_000 * 1e6, block.timestamp);
        }
    }

    /**
     * @notice Transfer balance to another vault user without touching the token contract.
     *         Demonstrates internal accounting — useful for Layer-2 patterns.
     */
    function internalTransfer(address to, uint256 amount) external nonReentrant whenNotPaused {
        require(to != address(0) && to != msg.sender, "Vault: invalid recipient");
        require(balances[msg.sender] >= amount, "Vault: insufficient balance");

        balances[msg.sender] -= amount;
        balances[to] += amount;

        emit InternalTransfer(msg.sender, to, amount, block.timestamp);
    }

    // ──────────────────── Admin / Emergency ─────────

    function pause() external onlyOwner {
        paused = true;
        emit EmergencyAction("paused", msg.sender, block.timestamp);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit EmergencyAction("unpaused", msg.sender, block.timestamp);
    }

    // ──────────────────── View helpers ───────────────

    function getVaultStats() external view returns (
        uint256 _totalDeposits,
        uint256 _totalWithdrawals,
        uint256 _vaultBalance,
        bool _paused
    ) {
        return (totalDeposits, totalWithdrawals, token.balanceOf(address(this)), paused);
    }
}
