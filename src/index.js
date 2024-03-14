const https = require("https");
const fs = require("fs");
const { createWalletClient, formatUnits, getContract, http, parseGwei, createPublicClient } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const FIRN_ABI = require("./abis");
const ADDRESSES = require("./addresses");
const CHAIN_PARAMS = require("./networks");

//  you will need to replace the below with appropriate actual certificates on your filesystem.
const options = {
  key: fs.readFileSync("/etc/letsencrypt/live/www.firn.link/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/www.firn.link/fullchain.pem")
};

const account = privateKeyToAccount(process.argv[2]);

const clients = Object.fromEntries(Object.keys(CHAIN_PARAMS).map((name) => {
  return [name, createPublicClient({
    chain: CHAIN_PARAMS[name].chain,
    transport: http(CHAIN_PARAMS[name].rpcUrl),
  })];
}));

const contracts = Object.fromEntries(Object.keys(CHAIN_PARAMS).map((name) => {
  return [name, getContract({
    address: ADDRESSES[name].PROXY,
    abi: FIRN_ABI,
    client: {
      public: clients[name],
      wallet: createWalletClient({
        account,
        chain: CHAIN_PARAMS[name].chain,
        transport: http(CHAIN_PARAMS[name].rpcUrl),
      }),
    }
  })];
}));


const maxPriorityFeePerGas = parseGwei("1.5");


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
          const feeHistory = await clients["Ethereum"].getFeeHistory({
            blockCount: 1,
            rewardPercentiles: []
          });
          const maxFeePerGas = feeHistory.baseFeePerGas[0] + maxPriorityFeePerGas;
          const gas = await contracts["Ethereum"].estimateGas.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof]);
          const totalFee = maxFeePerGas * gas;
          if (post.tip < parseFloat(formatUnits(totalFee, 15)) * 0.9) throw new Error("Tip too low");
          hash = await contracts["Ethereum"].write.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof], {
            chain: CHAIN_PARAMS["Ethereum"].chain,
            gas
          });
        } else if (req.url === "/withdrawal1") {
          const feeHistory = await clients["Ethereum"].getFeeHistory({
            blockCount: 1,
            rewardPercentiles: []
          });
          const maxFeePerGas = feeHistory.baseFeePerGas[0] + maxPriorityFeePerGas;
          const gas = await contracts["Ethereum"].estimateGas.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data]);
          const totalFee = maxFeePerGas * gas;
          if (post.tip < parseFloat(formatUnits(totalFee, 15)) * 0.9) throw new Error("Tip too low");
          hash = await contracts["Ethereum"].write.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data], {
            chain: CHAIN_PARAMS["Ethereum"].chain,
            gas
          });
        } else if (req.url === "/transfer10") {
          const { request } = await contracts["OP Mainnet"].simulate.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof]);
          hash = await contracts["OP Mainnet"].write.transfer(request);
        } else if (req.url === "/withdrawal10") {
          const { request } = await contracts["OP Mainnet"].simulate.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data]);
          hash = await contracts["OP Mainnet"].write.withdraw(request);
        } else if (req.url === "/transfer8453") {
          const { request } = await contracts["Base"].simulate.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof]);
          hash = await contracts["Base"].write.transfer(request);
        } else if (req.url === "/withdrawal8453") {
          const { request } = await contracts["Base"].simulate.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data]);
          hash = await contracts["Base"].write.withdraw(request);
        } else if (req.url === "/transfer42161") {
          const { request } = await contracts["Arbitrum One"].simulate.transfer([post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof]);
          hash = await contracts["Arbitrum One"].write.transfer(request);
        } else if (req.url === "/withdrawal42161") {
          const { request } = await contracts["Arbitrum One"].simulate.withdraw([post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data]);
          hash = await contracts["Arbitrum One"].write.withdraw(request);
        } else {
          throw new Error("Unsupported endpoint");
        }
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
          "Content-Type": "application/json",
        });
        res.write(JSON.stringify({
          hash,
        }));
      } catch (error) {
        console.error(error);
        // could try to separate out the case of a reversion... (or detect it earlier!)
        let statusMessage = "Unknown error";
        if (error.message === "Tip too low") statusMessage = "Tip too low";
        else if (error.details === "execution reverted: Wrong epoch." || error.cause?.reason === "Wrong epoch.") statusMessage = "Wrong epoch";

        res.writeHead(
          500,
          statusMessage,
          {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
            "Content-Type": "application/json",
          }
        );
      } finally {
        res.end();
      }
    });
  }
});

server.listen(8000);
