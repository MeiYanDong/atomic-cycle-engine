// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20BaseCycleMinimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IWETHBaseCycleMinimal {
    function deposit() external payable;
}

interface IUniswapV2FactoryBaseCycleMinimal {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IUniswapV2PairBaseCycleMinimal {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IUniswapV3FactoryBaseCycleMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3PoolBaseCycleMinimal {
    function token0() external view returns (address);
    function token1() external view returns (address);

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @title Base Uniswap V2/V3 bounded atomic-cycle executor
/// @notice Executes one WETH -> token -> WETH cycle across the canonical
/// Uniswap V2 and V3 factories on Base. The contract deliberately exposes no
/// arbitrary target, calldata, approval, delegatecall, or external-call route.
contract BaseV2V3CycleExecutor {
    error NotOperator();
    error WrongChain();
    error NotArmed();
    error MustDisarm();
    error Reentered();
    error Expired();
    error StaleBlock();
    error InvalidConfiguration();
    error InvalidRoute();
    error TokenNotApproved();
    error DuplicateToken();
    error TooManyTokens();
    error InvalidAmount();
    error ProfitFloorTooLow();
    error InsufficientPrincipal();
    error MissingCanonicalPool();
    error InvalidPoolIdentity();
    error InvalidSwapDelta();
    error NonStandardTokenBehavior();
    error UnauthorizedCallback();
    error ResidualExposure(uint256 beforeBalance, uint256 afterBalance);
    error ProfitTooLow(uint256 actual, uint256 required);
    error TokenCallFailed();

    event ArmedStateChanged(bool armed);
    event TokenApprovalChanged(address indexed token, bool approved);
    event Executed(
        bytes32 indexed routeHash,
        address indexed intermediateToken,
        address indexed v3Pool,
        bool v2First,
        uint256 amountIn,
        uint256 amountOut,
        uint256 grossProfit
    );
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    struct Route {
        address intermediateToken;
        uint24 v3Fee;
        bool v2First;
    }

    uint256 public constant BASE_CHAIN_ID = 8453;
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant UNISWAP_V2_FACTORY = 0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6;
    address public constant UNISWAP_V3_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;

    uint160 private constant MIN_SQRT_RATIO_PLUS_ONE = 4_295_128_740;
    uint160 private constant MAX_SQRT_RATIO_MINUS_ONE =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;

    address public immutable operator;
    uint256 public immutable maximumAmountIn;
    uint256 public immutable minimumGrossProfit;
    bool public armed;
    mapping(address token => bool approved) public approvedToken;

    uint256 private executionPhase;
    address private expectedV3Pool;
    address private expectedV3InputToken;
    uint256 private expectedV3InputAmount;
    bool private expectedV3InputIsToken0;

    constructor(
        address operator_,
        uint256 maximumAmountIn_,
        uint256 minimumGrossProfit_,
        address[] memory initialApprovedTokens
    ) payable {
        if (block.chainid != BASE_CHAIN_ID) revert WrongChain();
        if (
            operator_ == address(0) || maximumAmountIn_ == 0
                || maximumAmountIn_ > uint256(type(int256).max) || minimumGrossProfit_ == 0
                || WETH.code.length == 0 || UNISWAP_V2_FACTORY.code.length == 0
                || UNISWAP_V3_FACTORY.code.length == 0
        ) {
            revert InvalidConfiguration();
        }
        operator = operator_;
        maximumAmountIn = maximumAmountIn_;
        minimumGrossProfit = minimumGrossProfit_;
        if (initialApprovedTokens.length > 16) revert TooManyTokens();
        for (uint256 index = 0; index < initialApprovedTokens.length; ++index) {
            address token = initialApprovedTokens[index];
            if (token == address(0) || token == WETH || token.code.length == 0) revert InvalidRoute();
            if (approvedToken[token]) revert DuplicateToken();
            approvedToken[token] = true;
            emit TokenApprovalChanged(token, true);
        }
        if (msg.value > maximumAmountIn_) revert InvalidAmount();
        if (msg.value != 0) IWETHBaseCycleMinimal(WETH).deposit{value: msg.value}();
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function setArmed(bool nextArmed) external onlyOperator {
        if (executionPhase != 0) revert Reentered();
        armed = nextArmed;
        emit ArmedStateChanged(nextArmed);
    }

    function setTokenApproval(address token, bool approved) external onlyOperator {
        if (executionPhase != 0) revert Reentered();
        if (armed) revert MustDisarm();
        if (token == address(0) || token == WETH) revert InvalidRoute();
        approvedToken[token] = approved;
        emit TokenApprovalChanged(token, approved);
    }

    /// @notice Executes a typed two-pool cycle and enforces the gross WETH
    /// profit floor on-chain. The off-chain planner must set `minProfit` high
    /// enough to cover the exact transaction gas and its approved net floor.
    function execute(
        Route calldata route,
        uint256 amountIn,
        uint256 minProfit,
        uint48 deadline,
        uint64 validThroughBlock
    )
        external
        onlyOperator
        returns (uint256 amountOut, uint256 grossProfit)
    {
        if (!armed) revert NotArmed();
        if (executionPhase != 0) revert Reentered();
        if (block.timestamp > deadline) revert Expired();
        if (block.number > validThroughBlock) revert StaleBlock();
        if (amountIn == 0 || amountIn > maximumAmountIn) revert InvalidAmount();
        if (minProfit < minimumGrossProfit) revert ProfitFloorTooLow();

        (address v2Pair, address v3Pool) = _canonicalPools(route);
        uint256 wethBefore = _balanceOf(WETH, address(this));
        if (wethBefore < amountIn) revert InsufficientPrincipal();
        uint256 tokenBefore = _balanceOf(route.intermediateToken, address(this));

        executionPhase = 1;
        uint256 finalOutput = _runCycle(route, v2Pair, v3Pool, amountIn);

        uint256 tokenAfter = _balanceOf(route.intermediateToken, address(this));
        if (tokenAfter != tokenBefore) revert ResidualExposure(tokenBefore, tokenAfter);

        uint256 wethAfter = _balanceOf(WETH, address(this));
        grossProfit = wethAfter > wethBefore ? wethAfter - wethBefore : 0;
        if (grossProfit < minProfit) revert ProfitTooLow(grossProfit, minProfit);
        amountOut = amountIn + grossProfit;
        if (finalOutput != amountOut) revert InvalidSwapDelta();

        executionPhase = 0;
        emit Executed(
            keccak256(abi.encode(route)),
            route.intermediateToken,
            v3Pool,
            route.v2First,
            amountIn,
            amountOut,
            grossProfit
        );
    }

    function _runCycle(Route calldata route, address v2Pair, address v3Pool, uint256 amountIn)
        private
        returns (uint256 finalOutput)
    {
        if (route.v2First) {
            uint256 intermediate = _swapV2(v2Pair, WETH, route.intermediateToken, amountIn);
            return _swapV3(v3Pool, route.intermediateToken, WETH, route.v3Fee, intermediate);
        }
        uint256 intermediate = _swapV3(
            v3Pool, WETH, route.intermediateToken, route.v3Fee, amountIn
        );
        return _swapV2(v2Pair, route.intermediateToken, WETH, intermediate);
    }

    /// @dev Only the exact canonical V3 pool selected by the active operator
    /// execution can request payment. The amount and token are also bound.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (executionPhase != 1 || msg.sender != expectedV3Pool) revert UnauthorizedCallback();

        int256 inputDelta = expectedV3InputIsToken0 ? amount0Delta : amount1Delta;
        int256 outputDelta = expectedV3InputIsToken0 ? amount1Delta : amount0Delta;
        if (
            inputDelta <= 0 || outputDelta >= 0
                || uint256(inputDelta) != expectedV3InputAmount
        ) revert InvalidSwapDelta();

        _safeTransfer(expectedV3InputToken, msg.sender, uint256(inputDelta));
    }

    function withdraw(address token, uint256 amount, address to) external onlyOperator {
        if (executionPhase != 0) revert Reentered();
        if (armed) revert MustDisarm();
        if (token == address(0) || to == address(0)) revert InvalidRoute();
        _safeTransfer(token, to, amount);
        emit Withdrawn(token, to, amount);
    }

    function routeHash(Route calldata route) external pure returns (bytes32) {
        return keccak256(abi.encode(route));
    }

    function canonicalPools(Route calldata route) external view returns (address v2Pair, address v3Pool) {
        return _canonicalPools(route);
    }

    function _canonicalPools(Route calldata route) private view returns (address v2Pair, address v3Pool) {
        address token = route.intermediateToken;
        if (token == address(0) || token == WETH || !_allowedV3Fee(route.v3Fee)) {
            revert InvalidRoute();
        }
        if (!approvedToken[token]) revert TokenNotApproved();

        v2Pair = IUniswapV2FactoryBaseCycleMinimal(UNISWAP_V2_FACTORY).getPair(WETH, token);
        v3Pool = IUniswapV3FactoryBaseCycleMinimal(UNISWAP_V3_FACTORY).getPool(
            WETH, token, route.v3Fee
        );
        if (v2Pair == address(0) || v3Pool == address(0)) revert MissingCanonicalPool();
        if (v2Pair == v3Pool) revert InvalidPoolIdentity();
        _validatePoolTokens(v2Pair, WETH, token);
        _validatePoolTokens(v3Pool, WETH, token);
    }

    function _swapV2(
        address pair,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) private returns (uint256 amountOut) {
        IUniswapV2PairBaseCycleMinimal typedPair = IUniswapV2PairBaseCycleMinimal(pair);
        address token0 = typedPair.token0();
        bool zeroForOne = tokenIn == token0;
        if (
            (zeroForOne && typedPair.token1() != tokenOut)
                || (!zeroForOne && (typedPair.token1() != tokenIn || token0 != tokenOut))
        ) revert InvalidPoolIdentity();

        (uint112 reserve0, uint112 reserve1,) = typedPair.getReserves();
        uint256 reserveIn = zeroForOne ? uint256(reserve0) : uint256(reserve1);
        uint256 reserveOut = zeroForOne ? uint256(reserve1) : uint256(reserve0);
        if (reserveIn == 0 || reserveOut == 0) revert InvalidSwapDelta();

        uint256 outputBefore = _balanceOf(tokenOut, address(this));
        _safeTransfer(tokenIn, pair, amountIn);
        uint256 actualInput = _balanceOf(tokenIn, pair) - reserveIn;
        if (actualInput != amountIn) revert NonStandardTokenBehavior();

        uint256 amountInWithFee = amountIn * 997;
        amountOut = amountInWithFee * reserveOut / (reserveIn * 1000 + amountInWithFee);
        if (amountOut == 0 || amountOut >= reserveOut) revert InvalidSwapDelta();
        typedPair.swap(zeroForOne ? 0 : amountOut, zeroForOne ? amountOut : 0, address(this), bytes(""));

        uint256 observedOutput = _balanceOf(tokenOut, address(this)) - outputBefore;
        if (observedOutput != amountOut) revert NonStandardTokenBehavior();
    }

    function _swapV3(
        address pool,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn
    ) private returns (uint256 amountOut) {
        if (
            IUniswapV3FactoryBaseCycleMinimal(UNISWAP_V3_FACTORY).getPool(tokenIn, tokenOut, fee)
                != pool
        ) revert MissingCanonicalPool();

        IUniswapV3PoolBaseCycleMinimal typedPool = IUniswapV3PoolBaseCycleMinimal(pool);
        address token0 = typedPool.token0();
        bool zeroForOne = tokenIn == token0;
        if (
            (zeroForOne && typedPool.token1() != tokenOut)
                || (!zeroForOne && (typedPool.token1() != tokenIn || token0 != tokenOut))
        ) revert InvalidPoolIdentity();

        expectedV3Pool = pool;
        expectedV3InputToken = tokenIn;
        expectedV3InputAmount = amountIn;
        expectedV3InputIsToken0 = zeroForOne;
        uint256 outputBefore = _balanceOf(tokenOut, address(this));

        (int256 amount0, int256 amount1) = typedPool.swap(
            address(this),
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE,
            bytes("")
        );

        expectedV3Pool = address(0);
        expectedV3InputToken = address(0);
        expectedV3InputAmount = 0;
        expectedV3InputIsToken0 = false;

        int256 inputDelta = zeroForOne ? amount0 : amount1;
        int256 outputDelta = zeroForOne ? amount1 : amount0;
        if (inputDelta <= 0 || outputDelta >= 0 || uint256(inputDelta) != amountIn) {
            revert InvalidSwapDelta();
        }
        amountOut = uint256(-outputDelta);
        uint256 observedOutput = _balanceOf(tokenOut, address(this)) - outputBefore;
        if (amountOut == 0 || observedOutput != amountOut) revert NonStandardTokenBehavior();
    }

    function _validatePoolTokens(address pool, address tokenA, address tokenB) private view {
        address token0 = IUniswapV2PairBaseCycleMinimal(pool).token0();
        address token1 = IUniswapV2PairBaseCycleMinimal(pool).token1();
        if (!((token0 == tokenA && token1 == tokenB) || (token0 == tokenB && token1 == tokenA))) {
            revert InvalidPoolIdentity();
        }
    }

    function _allowedV3Fee(uint24 fee) private pure returns (bool) {
        return fee == 100 || fee == 500 || fee == 3000 || fee == 10_000;
    }

    function _balanceOf(address token, address account) private view returns (uint256) {
        return IERC20BaseCycleMinimal(token).balanceOf(account);
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20BaseCycleMinimal.transfer, (to, amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert TokenCallFailed();
    }
}
