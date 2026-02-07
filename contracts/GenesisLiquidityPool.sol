// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GenesisLiquidityPool
 * @notice Simplified AMM-style liquidity pool for hackathon demo.
 *         Monitors liquidity additions, removals, swaps, and rebalancing.
 *
 *         This simulates a DEX pool (like Uniswap) with two tokens:
 *           - Token A (e.g., gUSD — our stablecoin)
 *           - Token B (e.g., gETH — mock ETH for the pair)
 *
 *         KEY FEATURES:
 *           1. Add liquidity (deposit both tokens into pool)
 *           2. Remove liquidity (withdraw proportional share)
 *           3. Swap tokens (simplified constant-product formula)
 *           4. Pool stats (TVL, reserves, LP share tracking)
 *           5. Rich events for Genesis monitoring pipeline
 *
 *         SIMPLIFIED FOR HACKATHON:
 *           - No LP token minting (tracks shares internally)
 *           - Simplified swap fee (0.3%)
 *           - No flash loan protection (not needed for demo)
 */
contract GenesisLiquidityPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────── Storage ───────────────────
    IERC20 public tokenA;  // e.g., gUSD
    IERC20 public tokenB;  // e.g., gETH
    string public poolName;

    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalLPShares;

    // user → LP shares
    mapping(address => uint256) public lpShares;

    // Config
    uint256 public swapFeeNumerator = 3;     // 0.3% fee
    uint256 public swapFeeDenominator = 1000;

    // Stats
    uint256 public totalSwaps;
    uint256 public totalFeesCollectedA;
    uint256 public totalFeesCollectedB;
    uint256 public totalLiquidityAdded;
    uint256 public totalLiquidityRemoved;

    // ──────────────────── Events ────────────────────
    event LiquidityAdded(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 lpSharesMinted,
        uint256 newReserveA,
        uint256 newReserveB,
        uint256 timestamp
    );

    event LiquidityRemoved(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 lpSharesBurned,
        uint256 newReserveA,
        uint256 newReserveB,
        uint256 timestamp
    );

    event Swap(
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee,
        uint256 newReserveA,
        uint256 newReserveB,
        uint256 timestamp
    );

    event PoolRebalanced(
        address indexed triggeredBy,
        uint256 oldReserveA,
        uint256 oldReserveB,
        uint256 newReserveA,
        uint256 newReserveB,
        string reason,
        uint256 timestamp
    );

    event LargeSwapDetected(
        address indexed trader,
        uint256 amountIn,
        uint256 amountOut,
        uint256 priceImpactBps, // basis points
        uint256 timestamp
    );

    // ──────────────────── Constructor ────────────────
    constructor(
        address _tokenA,
        address _tokenB,
        string memory _poolName
    ) Ownable(msg.sender) {
        require(_tokenA != address(0) && _tokenB != address(0), "Pool: zero addr");
        require(_tokenA != _tokenB, "Pool: same tokens");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        poolName = _poolName;
    }

    // ──────────────────── Core functions ─────────────

    /**
     * @notice Add liquidity to the pool. First deposit sets the ratio.
     * @param amountA Amount of token A to add
     * @param amountB Amount of token B to add
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant returns (uint256 shares) {
        require(amountA > 0 && amountB > 0, "Pool: zero amounts");

        // Transfer tokens in
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        // Calculate LP shares
        if (totalLPShares == 0) {
            // First deposit — shares = sqrt(amountA * amountB) simplified
            shares = _sqrt(amountA * amountB);
        } else {
            // Proportional to existing reserves
            uint256 shareA = (amountA * totalLPShares) / reserveA;
            uint256 shareB = (amountB * totalLPShares) / reserveB;
            shares = shareA < shareB ? shareA : shareB; // min
        }

        require(shares > 0, "Pool: zero shares");

        lpShares[msg.sender] += shares;
        totalLPShares += shares;
        reserveA += amountA;
        reserveB += amountB;
        totalLiquidityAdded += amountA + amountB;

        emit LiquidityAdded(
            msg.sender,
            amountA,
            amountB,
            shares,
            reserveA,
            reserveB,
            block.timestamp
        );
    }

    /**
     * @notice Remove liquidity from the pool.
     * @param sharesToBurn How many LP shares to redeem
     */
    function removeLiquidity(uint256 sharesToBurn) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(sharesToBurn > 0, "Pool: zero shares");
        require(lpShares[msg.sender] >= sharesToBurn, "Pool: insufficient shares");

        // Calculate proportional withdrawal
        amountA = (sharesToBurn * reserveA) / totalLPShares;
        amountB = (sharesToBurn * reserveB) / totalLPShares;

        require(amountA > 0 && amountB > 0, "Pool: zero withdrawal");

        lpShares[msg.sender] -= sharesToBurn;
        totalLPShares -= sharesToBurn;
        reserveA -= amountA;
        reserveB -= amountB;
        totalLiquidityRemoved += amountA + amountB;

        // Transfer tokens out
        tokenA.safeTransfer(msg.sender, amountA);
        tokenB.safeTransfer(msg.sender, amountB);

        emit LiquidityRemoved(
            msg.sender,
            amountA,
            amountB,
            sharesToBurn,
            reserveA,
            reserveB,
            block.timestamp
        );
    }

    /**
     * @notice Swap tokens using constant-product formula (x * y = k).
     * @param tokenIn Address of token being sold
     * @param amountIn Amount of input token
     */
    function swap(address tokenIn, uint256 amountIn) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Pool: zero input");
        require(
            tokenIn == address(tokenA) || tokenIn == address(tokenB),
            "Pool: invalid token"
        );
        require(reserveA > 0 && reserveB > 0, "Pool: no liquidity");

        bool isAtoB = (tokenIn == address(tokenA));

        // Calculate fee
        uint256 fee = (amountIn * swapFeeNumerator) / swapFeeDenominator;
        uint256 amountInAfterFee = amountIn - fee;

        // Constant product: (rA + dA) * (rB - dB) = rA * rB
        if (isAtoB) {
            amountOut = (amountInAfterFee * reserveB) / (reserveA + amountInAfterFee);
            require(amountOut > 0 && amountOut < reserveB, "Pool: insufficient out");

            tokenA.safeTransferFrom(msg.sender, address(this), amountIn);
            tokenB.safeTransfer(msg.sender, amountOut);

            reserveA += amountIn; // includes fee
            reserveB -= amountOut;
            totalFeesCollectedA += fee;
        } else {
            amountOut = (amountInAfterFee * reserveA) / (reserveB + amountInAfterFee);
            require(amountOut > 0 && amountOut < reserveA, "Pool: insufficient out");

            tokenB.safeTransferFrom(msg.sender, address(this), amountIn);
            tokenA.safeTransfer(msg.sender, amountOut);

            reserveB += amountIn; // includes fee
            reserveA -= amountOut;
            totalFeesCollectedB += fee;
        }

        totalSwaps++;

        emit Swap(
            msg.sender,
            tokenIn,
            isAtoB ? address(tokenB) : address(tokenA),
            amountIn,
            amountOut,
            fee,
            reserveA,
            reserveB,
            block.timestamp
        );

        // Detect large swaps (> 5% of reserve)
        uint256 reserveIn = isAtoB ? reserveA : reserveB;
        if (amountIn * 100 > reserveIn * 5) { // > 5%
            uint256 priceImpactBps = (amountIn * 10000) / reserveIn;
            emit LargeSwapDetected(
                msg.sender,
                amountIn,
                amountOut,
                priceImpactBps,
                block.timestamp
            );
        }
    }

    /**
     * @notice Owner can inject tokens to rebalance (simulate market maker).
     */
    function rebalance(uint256 addA, uint256 addB, string calldata reason) external onlyOwner {
        uint256 oldA = reserveA;
        uint256 oldB = reserveB;

        if (addA > 0) {
            tokenA.safeTransferFrom(msg.sender, address(this), addA);
            reserveA += addA;
        }
        if (addB > 0) {
            tokenB.safeTransferFrom(msg.sender, address(this), addB);
            reserveB += addB;
        }

        emit PoolRebalanced(
            msg.sender,
            oldA, oldB,
            reserveA, reserveB,
            reason,
            block.timestamp
        );
    }

    // ──────────────────── View functions ─────────────

    function getReserves() external view returns (uint256, uint256) {
        return (reserveA, reserveB);
    }

    function getPoolStats() external view returns (
        uint256 _reserveA,
        uint256 _reserveB,
        uint256 _totalLPShares,
        uint256 _totalSwaps,
        uint256 _feesA,
        uint256 _feesB
    ) {
        return (reserveA, reserveB, totalLPShares, totalSwaps, totalFeesCollectedA, totalFeesCollectedB);
    }

    function getLPBalance(address user) external view returns (uint256) {
        return lpShares[user];
    }

    function getSwapQuote(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut, uint256 fee) {
        require(reserveA > 0 && reserveB > 0, "Pool: no liquidity");
        fee = (amountIn * swapFeeNumerator) / swapFeeDenominator;
        uint256 amountInAfterFee = amountIn - fee;

        bool isAtoB = (tokenIn == address(tokenA));
        if (isAtoB) {
            amountOut = (amountInAfterFee * reserveB) / (reserveA + amountInAfterFee);
        } else {
            amountOut = (amountInAfterFee * reserveA) / (reserveB + amountInAfterFee);
        }
    }

    // ──────────────────── Internal ──────────────────

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
