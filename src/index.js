const https = require("https");
const fs = require("fs");
const {
  createWalletClient,
  formatUnits,
  getContract,
  http,
  parseGwei,
  createPublicClient,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const { FIRN_ABI, ORACLE_ABI } = require("./abis");
const ADDRESSES = require("./addresses");
const CHAIN_PARAMS = require("./networks");

// you will need to replace the below with appropriate actual certificates on your filesystem.
const options = {
  key: fs.readFileSync("/etc/letsencrypt/live/www.relay.url/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/www.relay.url/fullchain.pem"),
};

const account = privateKeyToAccount(process.argv[2]);

const clients = Object.fromEntries(
  Object.keys(CHAIN_PARAMS).map((name) => {
    return [
      name,
      createPublicClient({
        chain: CHAIN_PARAMS[name].chain,
        transport: http(CHAIN_PARAMS[name].rpcUrl),
      }),
    ];
  }),
);

const contracts = Object.fromEntries(
  Object.keys(CHAIN_PARAMS).map((name) => {
    return [
      name,
      getContract({
        address: ADDRESSES[name].FIRN,
        abi: FIRN_ABI,
        client: {
          wallet: createWalletClient({
            account,
            chain: CHAIN_PARAMS[name].chain,
            transport: http(CHAIN_PARAMS[name].rpcUrl),
          }),
        },
      }),
    ];
  }),
);

const oracles = Object.fromEntries(
  ["OP Mainnet", "Base"].map((name) => {
    return [
      name,
      getContract({
        address: ADDRESSES[name].ORACLE,
        abi: ORACLE_ABI,
        client: clients[name], // only a publicClient
      }),
    ];
  }),
);

const maxPriorityFeePerGas = parseGwei("0.001");

const TRANSFER_TX_COMPRESSED_SIZE = 3300n;
const WITHDRAWAL_TX_COMPRESSED_SIZE = 2900n;
const BLOB_BASE_FEE_SCALAR = 810949n;
const BASE_FEE_SCALAR = 1368n;

const server = https.createServer(options, (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
      "Access-Control-Max-Age": 2592000, // 30 days
    });
    res.end();
    return;
  }
  if (req.method === "POST") {
    let body = "";

    req.on("data", (data) => {
      body += data;
      if (body.length > 50000) {
        req.destroy(); // check this.
      }
    });

    req.on("end", async () => {
      if (req.url === "/health") {
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({})); // or i could do empty?
        return;
      }
      try {
        console.log(body);
        const post = JSON.parse(body);
        let hash;
        if (req.url === "/transfer1") {
          const feeHistory = await clients["Ethereum"].getFeeHistory({ blockCount: 1, rewardPercentiles: [] });
          const maxFeePerGas = feeHistory.baseFeePerGas[0] + maxPriorityFeePerGas;
          const gas = await contracts["Ethereum"].estimateGas.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof]);
          const totalFee = maxFeePerGas * gas;
          if (post.tip < parseFloat(formatUnits(totalFee, 15)) * 0.9) throw new Error("Tip too low");
          hash = await contracts["Ethereum"].write.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof], { gas });
        } else if (req.url === "/withdrawal1") {
          const feeHistory = await clients["Ethereum"].getFeeHistory({ blockCount: 1, rewardPercentiles: [] });
          const maxFeePerGas = feeHistory.baseFeePerGas[0] + maxPriorityFeePerGas;
          const gas = await contracts["Ethereum"].estimateGas.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data]);
          const totalFee = maxFeePerGas * gas;
          if (post.tip < parseFloat(formatUnits(totalFee, 15)) * 0.9) throw new Error("Tip too low");
          hash = await contracts["Ethereum"].write.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data], { gas });
        } else if (req.url === "/transfer10") {
          const l1BaseFee = await oracles["OP Mainnet"].read.l1BaseFee();
          const blobBaseFee = await oracles["OP Mainnet"].read.blobBaseFee();
          const weightedGasPrice = (16n * BASE_FEE_SCALAR * l1BaseFee + BLOB_BASE_FEE_SCALAR * blobBaseFee) / 1000000n;
          const gas = await contracts["OP Mainnet"].estimateGas.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof]);
          const l1DataFee = TRANSFER_TX_COMPRESSED_SIZE * weightedGasPrice;
          const { maxFeePerGas: l2GasPrice } = await clients["OP Mainnet"].estimateFeesPerGas();
          const l2ExecutionFee = l2GasPrice * gas;
          const totalFee = l1DataFee + l2ExecutionFee;
          if (parseFloat(formatUnits(totalFee, 15)) - post.tip >= 1) throw new Error("Tip too low");
          hash = await contracts["OP Mainnet"].write.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof], { gas });
        } else if (req.url === "/withdrawal10") {
          const l1BaseFee = await oracles["OP Mainnet"].read.l1BaseFee();
          const blobBaseFee = await oracles["OP Mainnet"].read.blobBaseFee();
          const weightedGasPrice = (16n * BASE_FEE_SCALAR * l1BaseFee + BLOB_BASE_FEE_SCALAR * blobBaseFee) / 1000000n;
          const gas = await contracts["OP Mainnet"].estimateGas.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data]);
          const l1DataFee = WITHDRAWAL_TX_COMPRESSED_SIZE * weightedGasPrice;
          const { maxFeePerGas: l2GasPrice } = await clients["OP Mainnet"].estimateFeesPerGas();
          const l2ExecutionFee = l2GasPrice * gas;
          const totalFee = l1DataFee + l2ExecutionFee;
          if (parseFloat(formatUnits(totalFee, 15)) - post.tip >= 1) throw new Error("Tip too low");
          hash = await contracts["OP Mainnet"].write.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data], { gas });
        } else if (req.url === "/transfer8453") {
          const l1BaseFee = await oracles["Base"].read.l1BaseFee();
          const blobBaseFee = await oracles["Base"].read.blobBaseFee();
          const weightedGasPrice = (16n * BASE_FEE_SCALAR * l1BaseFee + BLOB_BASE_FEE_SCALAR * blobBaseFee) / 1000000n;
          const gas = await contracts["Base"].estimateGas.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof]);
          const l1DataFee = TRANSFER_TX_COMPRESSED_SIZE * weightedGasPrice;
          const { maxFeePerGas: l2GasPrice } = await clients["Base"].estimateFeesPerGas();
          const l2ExecutionFee = l2GasPrice * gas;
          const totalFee = l1DataFee + l2ExecutionFee;
          if (parseFloat(formatUnits(totalFee, 15)) - post.tip >= 1) throw new Error("Tip too low");
          hash = await contracts["Base"].write.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof], { gas });
        } else if (req.url === "/withdrawal8453") {
          const l1BaseFee = await oracles["Base"].read.l1BaseFee();
          const blobBaseFee = await oracles["Base"].read.blobBaseFee();
          const weightedGasPrice = (16n * BASE_FEE_SCALAR * l1BaseFee + BLOB_BASE_FEE_SCALAR * blobBaseFee) / 1000000n;
          const gas = await contracts["Base"].estimateGas.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data]);
          const l1DataFee = WITHDRAWAL_TX_COMPRESSED_SIZE * weightedGasPrice;
          const { maxFeePerGas: l2GasPrice } = await clients["Base"].estimateFeesPerGas();
          const l2ExecutionFee = l2GasPrice * gas;
          const totalFee = l1DataFee + l2ExecutionFee;
          if (parseFloat(formatUnits(totalFee, 15)) - post.tip >= 1) throw new Error("Tip too low");
          hash = await contracts["Base"].write.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data], { gas });
        } else if (req.url === "/transfer42161") {
          const l2GasPrice = await clients["Arbitrum One"].getGasPrice();
          const gas = await contracts["Arbitrum One"].estimateGas.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof]);
          const totalFee = l2GasPrice * gas;
          if (parseFloat(formatUnits(totalFee, 15)) - post.tip >= 1) throw new Error("Tip too low");
          hash = await contracts["Arbitrum One"].write.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof], { gas });
        } else if (req.url === "/withdrawal42161") {
          const l2GasPrice = await clients["Arbitrum One"].getGasPrice();
          const gas = await contracts["Arbitrum One"].estimateGas.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data]);
          const totalFee = l2GasPrice * gas;
          if (parseFloat(formatUnits(totalFee, 15)) - post.tip >= 1) throw new Error("Tip too low");
          hash = await contracts["Arbitrum One"].write.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data], { gas });
        } else {
          throw new Error("Unsupported endpoint");
        }
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
          "Content-Type": "application/json",
        });
        res.write(JSON.stringify({ hash }));
      } catch (error) {
        console.error(error);
        // could try to separate out the case of a reversion... (or detect it earlier!)
        let statusMessage = "Unknown error";
        if (error.message === "Tip too low") statusMessage = "Tip too low";
        else if (
          error.details === "execution reverted: Wrong epoch." ||
          error.cause?.reason === "Wrong epoch."
        )
          statusMessage = "Wrong epoch";

        res.writeHead(500, statusMessage, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
          "Content-Type": "application/json",
        });
      } finally {
        res.end();
      }
    });
  }
});

server.listen(8000);
