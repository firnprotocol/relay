const { arbitrum, mainnet, optimism } = require("viem/chains");

const CHAIN_PARAMS = {
  "Ethereum": {
    chain: mainnet,
    rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
  },
  "Optimism": {
    chain: optimism,
    rpcUrl: "https://opt-mainnet.g.alchemy.com/v2/ghijklmnopqrstuvwxyz0123456789-_",
  },
  "Arbitrum One": {
    chain: arbitrum,
    rpcUrl: "https://arb-mainnet.g.alchemy.com/v2/firnfirnfirnfirnfirnfirnfirnfirn",
  },
};

module.exports = CHAIN_PARAMS;
