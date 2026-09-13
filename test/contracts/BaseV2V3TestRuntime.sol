// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IBaseCycleCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

interface IBaseCyclePancakeCallback {
    function pancakeV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

error MockInvalidConfiguration();
error MockInsufficientBalance();
error MockInvalidSwap();

contract MockBaseCycleToken {
    mapping(address account => uint256 amount) public balanceOf;
    uint256 public feeBps;

    function configureFee(uint256 nextFeeBps) external {
        if (nextFeeBps > 1_000) revert MockInvalidConfiguration();
        feeBps = nextFeeBps;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) revert MockInsufficientBalance();
        balanceOf[msg.sender] -= amount;
        uint256 received = amount * (10_000 - feeBps) / 10_000;
        balanceOf[to] += received;
        return true;
    }
}

contract MockBaseCycleV2Factory {
    mapping(bytes32 key => address pair) private pairs;

    function setPair(address tokenA, address tokenB, address pair) external {
        pairs[_key(tokenA, tokenB)] = pair;
    }

    function getPair(address tokenA, address tokenB) external view returns (address pair) {
        return pairs[_key(tokenA, tokenB)];
    }

    function _key(address tokenA, address tokenB) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1));
    }
}

contract MockBaseCycleV3Factory {
    mapping(bytes32 key => address pool) private pools;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool) {
        return pools[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}

contract MockBaseCycleV2Pair {
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;

    function configure(address token0_, address token1_, uint112 reserve0_, uint112 reserve1_) external {
        if (token0_ >= token1_) revert MockInvalidConfiguration();
        token0 = token0_;
        token1 = token1_;
        reserve0 = reserve0_;
        reserve1 = reserve1_;
        MockBaseCycleToken(token0_).mint(address(this), reserve0_);
        MockBaseCycleToken(token1_).mint(address(this), reserve1_);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, uint32(block.timestamp));
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        if ((amount0Out == 0) == (amount1Out == 0)) revert MockInvalidSwap();
        if (amount0Out != 0) MockBaseCycleToken(token0).transfer(to, amount0Out);
        if (amount1Out != 0) MockBaseCycleToken(token1).transfer(to, amount1Out);
        reserve0 = uint112(MockBaseCycleToken(token0).balanceOf(address(this)));
        reserve1 = uint112(MockBaseCycleToken(token1).balanceOf(address(this)));
    }
}

contract MockBaseCycleV3Pool {
    address public token0;
    address public token1;
    address public weth;
    uint256 public wethPerTokenNumerator;
    uint256 public wethPerTokenDenominator;

    function configure(
        address token0_,
        address token1_,
        address weth_,
        uint256 numerator_,
        uint256 denominator_
    ) external {
        if (token0_ >= token1_ || numerator_ == 0 || denominator_ == 0) {
            revert MockInvalidConfiguration();
        }
        token0 = token0_;
        token1 = token1_;
        weth = weth_;
        wethPerTokenNumerator = numerator_;
        wethPerTokenDenominator = denominator_;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata)
        external
        returns (int256 amount0, int256 amount1)
    {
        if (amountSpecified <= 0) revert MockInvalidSwap();
        address tokenOut = zeroForOne ? token1 : token0;
        uint256 input = uint256(amountSpecified);
        uint256 output = tokenOut == weth
            ? input * wethPerTokenNumerator / wethPerTokenDenominator
            : input * wethPerTokenDenominator / wethPerTokenNumerator;
        if (output == 0) revert MockInvalidSwap();

        MockBaseCycleToken(tokenOut).mint(recipient, output);
        amount0 = zeroForOne ? int256(input) : -int256(output);
        amount1 = zeroForOne ? -int256(output) : int256(input);
        IBaseCycleCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, bytes(""));
    }
}

contract MockBaseCyclePancakeV3Pool {
    address public token0;
    address public token1;
    address public weth;
    uint256 public wethPerTokenNumerator;
    uint256 public wethPerTokenDenominator;

    function configure(
        address token0_,
        address token1_,
        address weth_,
        uint256 numerator_,
        uint256 denominator_
    ) external {
        if (token0_ >= token1_ || numerator_ == 0 || denominator_ == 0) {
            revert MockInvalidConfiguration();
        }
        token0 = token0_;
        token1 = token1_;
        weth = weth_;
        wethPerTokenNumerator = numerator_;
        wethPerTokenDenominator = denominator_;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata)
        external
        returns (int256 amount0, int256 amount1)
    {
        if (amountSpecified <= 0) revert MockInvalidSwap();
        address tokenOut = zeroForOne ? token1 : token0;
        uint256 input = uint256(amountSpecified);
        uint256 output = tokenOut == weth
            ? input * wethPerTokenNumerator / wethPerTokenDenominator
            : input * wethPerTokenDenominator / wethPerTokenNumerator;
        if (output == 0) revert MockInvalidSwap();

        MockBaseCycleToken(tokenOut).mint(recipient, output);
        amount0 = zeroForOne ? int256(input) : -int256(output);
        amount1 = zeroForOne ? -int256(output) : int256(input);
        IBaseCyclePancakeCallback(msg.sender).pancakeV3SwapCallback(
            amount0, amount1, bytes("")
        );
    }
}
