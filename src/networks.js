const { arbitrum, mainnet, optimism, base } = require("viem/chains");

const CHAIN_PARAMS = {
  Ethereum: {
    chain: mainnet,
    rpcUrl:
      "https://eth-mainnet.g.alchemy.com/v2/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
  },
  "OP Mainnet": {
    chain: optimism,
    rpcUrl:
      "https://opt-mainnet.g.alchemy.com/v2/ghijklmnopqrstuvwxyz0123456789-_",
  },
  "Arbitrum One": {
    chain: arbitrum,
    rpcUrl:
      "https://arb-mainnet.g.alchemy.com/v2/firnfirnfirnfirnfirnfirnfirnfirn",
  },
  Base: {
    chain: base,
    rpcUrl:
      "https://base-mainnet.g.alchemy.com/v2/protocolprotocolprotocolprotocol",
  },
};

module.exports = CHAIN_PARAMS;
