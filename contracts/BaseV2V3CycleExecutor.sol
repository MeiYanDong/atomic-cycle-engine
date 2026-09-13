// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20BaseCycleMinimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IWETHBaseCycleMinimal {
    function deposit() external payable;
}

interface IV2FactoryBaseCycleMinimal {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IV2PairBaseCycleMinimal {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IConcentratedFactoryBaseCycleMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee)
        external
        view
        returns (address pool);
}

interface IConcentratedPoolBaseCycleMinimal {
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

/// @title Base bounded multi-venue atomic-cycle executor
/// @notice Executes a WETH -> token -> WETH cycle across typed, canonical pools
/// on Base. It exposes no arbitrary target, calldata, approval, delegatecall,
/// or external-call route.
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

    enum Venue {
        UNISWAP_V2,
        UNISWAP_V3,
        PANCAKESWAP_V3
    }

    struct Route {
        address intermediateToken;
        uint24 entryFee;
        uint24 exitFee;
        Venue entryVenue;
        Venue exitVenue;
    }

    event ArmedStateChanged(bool armed);
    event TokenApprovalChanged(address indexed token, bool approved);
    event Executed(
        bytes32 indexed routeHash,
        address indexed intermediateToken,
        address indexed entryPool,
        address exitPool,
        uint8 entryVenue,
        uint8 exitVenue,
        uint256 amountIn,
        uint256 amountOut,
        uint256 grossProfit
    );
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    uint256 public constant BASE_CHAIN_ID = 8453;
    bytes32 public constant EXECUTOR_VERSION = keccak256("BASE_MULTI_VENUE_V1");
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant UNISWAP_V2_FACTORY = 0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6;
    address public constant UNISWAP_V3_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address public constant PANCAKESWAP_V3_FACTORY =
        0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;

    uint160 private constant MIN_SQRT_RATIO_PLUS_ONE = 4_295_128_740;
    uint160 private constant MAX_SQRT_RATIO_MINUS_ONE =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;

    address public immutable operator;
    uint256 public immutable maximumAmountIn;
    uint256 public immutable minimumGrossProfit;
    bool public armed;
    mapping(address token => bool approved) public approvedToken;

    uint256 private executionPhase;
    address private expectedConcentratedPool;
    address private expectedConcentratedInputToken;
    uint256 private expectedConcentratedInputAmount;
    bool private expectedConcentratedInputIsToken0;
    Venue private expectedCallbackVenue;

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
                || PANCAKESWAP_V3_FACTORY.code.length == 0
        ) revert InvalidConfiguration();

        operator = operator_;
        maximumAmountIn = maximumAmountIn_;
        minimumGrossProfit = minimumGrossProfit_;
        if (initialApprovedTokens.length > 16) revert TooManyTokens();
        for (uint256 index = 0; index < initialApprovedTokens.length; ++index) {
            address token = initialApprovedTokens[index];
            if (token == address(0) || token == WETH || token.code.length == 0) {
                revert InvalidRoute();
            }
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

    /// @notice Executes a typed two-pool cycle. The off-chain planner raises
    /// minProfit above full L2 gas, L1 data fee, operator fee and the net floor.
    function execute(
        Route calldata route,
        uint256 amountIn,
        uint256 minProfit,
        uint48 deadline,
        uint64 validThroughBlock
    ) external onlyOperator returns (uint256 amountOut, uint256 grossProfit) {
        if (!armed) revert NotArmed();
        if (executionPhase != 0) revert Reentered();
        if (block.timestamp > deadline) revert Expired();
        if (block.number > validThroughBlock) revert StaleBlock();
        if (amountIn == 0 || amountIn > maximumAmountIn) revert InvalidAmount();
        if (minProfit < minimumGrossProfit) revert ProfitFloorTooLow();

        (address entryPool, address exitPool) = _canonicalPools(route);
        uint256 wethBefore = _balanceOf(WETH, address(this));
        if (wethBefore < amountIn) revert InsufficientPrincipal();
        uint256 tokenBefore = _balanceOf(route.intermediateToken, address(this));

        executionPhase = 1;
        uint256 finalOutput = _runCycle(route, entryPool, exitPool, amountIn);

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
            entryPool,
            exitPool,
            uint8(route.entryVenue),
            uint8(route.exitVenue),
            amountIn,
            amountOut,
            grossProfit
        );
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata)
        external
    {
        if (expectedCallbackVenue != Venue.UNISWAP_V3) revert UnauthorizedCallback();
        _handleConcentratedCallback(amount0Delta, amount1Delta);
    }

    function pancakeV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata)
        external
    {
        if (expectedCallbackVenue != Venue.PANCAKESWAP_V3) revert UnauthorizedCallback();
        _handleConcentratedCallback(amount0Delta, amount1Delta);
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

    function canonicalPools(Route calldata route)
        external
        view
        returns (address entryPool, address exitPool)
    {
        return _canonicalPools(route);
    }

    function _canonicalPools(Route calldata route)
        private
        view
        returns (address entryPool, address exitPool)
    {
        address token = route.intermediateToken;
        if (token == address(0) || token == WETH) revert InvalidRoute();
        if (!approvedToken[token]) revert TokenNotApproved();
        entryPool = _canonicalPool(route.entryVenue, token, route.entryFee);
        exitPool = _canonicalPool(route.exitVenue, token, route.exitFee);
        if (entryPool == exitPool) revert InvalidPoolIdentity();
    }

    function _canonicalPool(Venue venue, address token, uint24 fee)
        private
        view
        returns (address pool)
    {
        if (venue == Venue.UNISWAP_V2) {
            if (fee != 0) revert InvalidRoute();
            pool = IV2FactoryBaseCycleMinimal(UNISWAP_V2_FACTORY).getPair(WETH, token);
        } else {
            if (!_allowedV3Fee(venue, fee)) revert InvalidRoute();
            address factory = venue == Venue.UNISWAP_V3
                ? UNISWAP_V3_FACTORY
                : PANCAKESWAP_V3_FACTORY;
            pool = IConcentratedFactoryBaseCycleMinimal(factory).getPool(WETH, token, fee);
        }
        if (pool == address(0)) revert MissingCanonicalPool();
        _validatePoolTokens(pool, WETH, token);
    }

    function _runCycle(
        Route calldata route,
        address entryPool,
        address exitPool,
        uint256 amountIn
    ) private returns (uint256 finalOutput) {
        uint256 intermediate = _swap(
            route.entryVenue,
            entryPool,
            WETH,
            route.intermediateToken,
            route.entryFee,
            amountIn
        );
        return _swap(
            route.exitVenue,
            exitPool,
            route.intermediateToken,
            WETH,
            route.exitFee,
            intermediate
        );
    }

    function _swap(
        Venue venue,
        address pool,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn
    ) private returns (uint256 amountOut) {
        if (venue == Venue.UNISWAP_V2) return _swapV2(pool, tokenIn, tokenOut, amountIn);
        return _swapConcentrated(venue, pool, tokenIn, tokenOut, fee, amountIn);
    }

    function _swapV2(address pair, address tokenIn, address tokenOut, uint256 amountIn)
        private
        returns (uint256 amountOut)
    {
        IV2PairBaseCycleMinimal typedPair = IV2PairBaseCycleMinimal(pair);
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
        typedPair.swap(
            zeroForOne ? 0 : amountOut,
            zeroForOne ? amountOut : 0,
            address(this),
            bytes("")
        );

        uint256 observedOutput = _balanceOf(tokenOut, address(this)) - outputBefore;
        if (observedOutput != amountOut) revert NonStandardTokenBehavior();
    }

    function _swapConcentrated(
        Venue venue,
        address pool,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn
    ) private returns (uint256 amountOut) {
        address factory = venue == Venue.UNISWAP_V3
            ? UNISWAP_V3_FACTORY
            : PANCAKESWAP_V3_FACTORY;
        if (
            IConcentratedFactoryBaseCycleMinimal(factory).getPool(tokenIn, tokenOut, fee) != pool
        ) revert MissingCanonicalPool();

        IConcentratedPoolBaseCycleMinimal typedPool = IConcentratedPoolBaseCycleMinimal(pool);
        address token0 = typedPool.token0();
        bool zeroForOne = tokenIn == token0;
        if (
            (zeroForOne && typedPool.token1() != tokenOut)
                || (!zeroForOne && (typedPool.token1() != tokenIn || token0 != tokenOut))
        ) revert InvalidPoolIdentity();

        _setExpectedCallback(venue, pool, tokenIn, amountIn, zeroForOne);
        uint256 outputBefore = _balanceOf(tokenOut, address(this));

        (int256 amount0, int256 amount1) = typedPool.swap(
            address(this),
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE,
            bytes("")
        );

        _clearExpectedCallback();

        int256 inputDelta = zeroForOne ? amount0 : amount1;
        int256 outputDelta = zeroForOne ? amount1 : amount0;
        if (inputDelta <= 0 || outputDelta >= 0 || uint256(inputDelta) != amountIn) {
            revert InvalidSwapDelta();
        }
        amountOut = uint256(-outputDelta);
        uint256 observedOutput = _balanceOf(tokenOut, address(this)) - outputBefore;
        if (amountOut == 0 || observedOutput != amountOut) revert NonStandardTokenBehavior();
    }

    function _setExpectedCallback(
        Venue venue,
        address pool,
        address tokenIn,
        uint256 amountIn,
        bool inputIsToken0
    ) private {
        expectedConcentratedPool = pool;
        expectedConcentratedInputToken = tokenIn;
        expectedConcentratedInputAmount = amountIn;
        expectedConcentratedInputIsToken0 = inputIsToken0;
        expectedCallbackVenue = venue;
    }

    function _clearExpectedCallback() private {
        expectedConcentratedPool = address(0);
        expectedConcentratedInputToken = address(0);
        expectedConcentratedInputAmount = 0;
        expectedConcentratedInputIsToken0 = false;
        expectedCallbackVenue = Venue.UNISWAP_V2;
    }

    function _handleConcentratedCallback(int256 amount0Delta, int256 amount1Delta) private {
        if (executionPhase != 1 || msg.sender != expectedConcentratedPool) {
            revert UnauthorizedCallback();
        }
        int256 inputDelta = expectedConcentratedInputIsToken0 ? amount0Delta : amount1Delta;
        int256 outputDelta = expectedConcentratedInputIsToken0 ? amount1Delta : amount0Delta;
        if (
            inputDelta <= 0 || outputDelta >= 0
                || uint256(inputDelta) != expectedConcentratedInputAmount
        ) revert InvalidSwapDelta();
        _safeTransfer(expectedConcentratedInputToken, msg.sender, uint256(inputDelta));
    }

    function _validatePoolTokens(address pool, address tokenA, address tokenB) private view {
        address token0 = IConcentratedPoolBaseCycleMinimal(pool).token0();
        address token1 = IConcentratedPoolBaseCycleMinimal(pool).token1();
        if (!((token0 == tokenA && token1 == tokenB) || (token0 == tokenB && token1 == tokenA))) {
            revert InvalidPoolIdentity();
        }
    }

    function _allowedV3Fee(Venue venue, uint24 fee) private pure returns (bool) {
        if (venue == Venue.UNISWAP_V3) {
            return fee == 100 || fee == 500 || fee == 3000 || fee == 10_000;
        }
        if (venue == Venue.PANCAKESWAP_V3) {
            return fee == 100 || fee == 500 || fee == 2500 || fee == 10_000;
        }
        return false;
    }

    function _balanceOf(address token, address account) private view returns (uint256) {
        return IERC20BaseCycleMinimal(token).balanceOf(account);
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20BaseCycleMinimal.transfer, (to, amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenCallFailed();
        }
    }
}
