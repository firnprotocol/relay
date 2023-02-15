const https = require("https");
const fs = require("fs");
const optimism = require("@eth-optimism/sdk");
const { ethers } = require("ethers");

const FIRN_ABI = require("./abis");

// I've suppressed my API keys from the below. highly recommended: get Alchemy projects running and substitute real API keys.
const mainnetProvider = new ethers.providers.AlchemyProvider("homestead"); // , "abcdefghijklmnopqrstuvwxyzABCDEF");
const mainnetFirn = new ethers.Contract( // this is a proxy
  "0x6cb5b67ebe8af11a8b88d740f95dd1316c26b701",
  FIRN_ABI,
  new ethers.Wallet(process.argv[2], mainnetProvider)
);
const optimismProvider = optimism.asL2Provider(new ethers.providers.AlchemyProvider("optimism")); // , "GHIJKLMNOPQRSTUVWXYZ0123456789-_"));
const optimismFirn = new ethers.Contract( // also a proxy
  "0x3C6c27072356016F05a4736FaaBA91d3c2b26E90",
  FIRN_ABI,
  new ethers.Wallet(process.argv[2], optimismProvider)
);
const arbitrumProvider = new ethers.providers.AlchemyProvider("arbitrum"); // , "firnfirnfirnfirnfirnfirnfirnfirn");
const arbitrumFirn = new ethers.Contract( // proxy
  "0x4115Cb2612E1699F3605Fd1f12b1D1D05D207916",
  FIRN_ABI,
  new ethers.Wallet(process.argv[2], arbitrumProvider)
);

//  you will need to replace the below with appropriate actual certificates on your filesystem.
const options = {
  key: fs.readFileSync("/etc/letsencrypt/live/www.firn.link/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/www.firn.link/fullchain.pem")
};

const maxPriorityFeePerGas = ethers.utils.parseUnits("3", "gwei");

const TRANSFER_TX_DATA_GAS = 52800; // 52776;
const WITHDRAWAL_TX_DATA_GAS = 46500; // 46420;
const FIXED_OVERHEAD = 2100;
const DYNAMIC_OVERHEAD = 1.24; // ???
// l1_data_fee = l1_gas_price * (tx_data_gas + fixed_overhead) * dynamic_overhead
// https://community.optimism.io/docs/developers/build/transaction-fees/#the-l1-data-fee

const optimismTxDataGas = (data) => {
  // assumes txData isBytesLike
  data = data.slice(2); // cut off 0x
  let zeroBytes = 0;
  let nonZeroBytes = 0;
  for (let i = 0; i < data.length; i += 2) {
    if (data.slice(i, i + 2) === "00") zeroBytes++;
    else nonZeroBytes++;
  }
  return zeroBytes * 4 + nonZeroBytes * 16;
};

const getOptimismGasFunc = async () => {
  const [l1GasPrice, l2GasPrice] = await Promise.all([
    optimism.getL1GasPrice(optimismProvider),
    optimismProvider.getGasPrice(),
  ]);
  return {
    optimismGasFunc: (l2Gas, txDataGas) => {
      const l1DataFee = l1GasPrice.mul(ethers.BigNumber.from(Math.ceil((txDataGas + FIXED_OVERHEAD) * DYNAMIC_OVERHEAD)));
      const l2ExecutionFee = l2GasPrice.mul(l2Gas);
      return l1DataFee.add(l2ExecutionFee);
    },
    l2GasPrice,
  };
};

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
  if (req.method === "GET") {
    let path = req.url;
    if (path === "/") path = "/index.html";
    path = "./dist" + path;
    fs.readFile(path, function (error, content) {
      if (error) {
        res.writeHead(
          500,
          "Something happened.",
          {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
            "Content-Type": "application/json",
          });
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(content);
      }
    });
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
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Content-Type": "application/json",
      });
      if (req.url === "/health") {
        res.end(JSON.stringify({})); // or i could do empty?
        return;
      }
      try {
        console.log(body);
        const post = JSON.parse(body);
        let transactionResponse;
        if (req.url === "/transfer1") {
          const feeData = await mainnetProvider.getFeeData();
          const maxFeePerGas = feeData.lastBaseFeePerGas.add(maxPriorityFeePerGas);
          const transferGas = await mainnetFirn.estimateGas.transfer(post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof); // do i need gas limit for call static?
          const totalFee = maxFeePerGas.mul(transferGas);
          if (post.tip < parseFloat(ethers.utils.formatUnits(totalFee, 15)) * 0.95) throw new Error("Tip too low");
          transactionResponse = await mainnetFirn.transfer(post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof, {
            gasLimit: transferGas,
            maxPriorityFeePerGas,
            maxFeePerGas,
          });
        } else if (req.url === "/withdrawal1") {
          const feeData = await mainnetProvider.getFeeData(); // this line and the below are duplicated
          const maxFeePerGas = feeData.lastBaseFeePerGas.add(maxPriorityFeePerGas);
          const withdrawalGas = await mainnetFirn.estimateGas.withdraw(post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data);
          const totalFee = maxFeePerGas.mul(withdrawalGas);
          if (post.tip < parseFloat(ethers.utils.formatUnits(totalFee, 15)) * 0.95) throw new Error("Tip too low");
          transactionResponse = await mainnetFirn.withdraw(post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data, {
            gasLimit: withdrawalGas, // no buffer...revisit
            maxPriorityFeePerGas,
            maxFeePerGas,
          });
        } else if (req.url === "/transfer10") {
          const { optimismGasFunc, l2GasPrice } = await getOptimismGasFunc();
          const transferGas = await optimismFirn.estimateGas.transfer(post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof);
          const totalFee = optimismGasFunc(transferGas, TRANSFER_TX_DATA_GAS);
          if (post.tip < parseFloat(ethers.utils.formatUnits(totalFee, 15)) * 0.95) throw new Error("Tip too low");
          transactionResponse = await optimismFirn.transfer(post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof, {
            gasLimit: transferGas,
            gasPrice: l2GasPrice
          });
        } else if (req.url === "/withdrawal10") {
          const { optimismGasFunc, l2GasPrice } = await getOptimismGasFunc();
          const txDataGas = optimismTxDataGas(post.data);
          const withdrawalGas = await optimismFirn.estimateGas.withdraw(post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data);
          const totalFee = optimismGasFunc(withdrawalGas, WITHDRAWAL_TX_DATA_GAS + txDataGas);
          if (post.tip < parseFloat(ethers.utils.formatUnits(totalFee, 15)) * 0.95) throw new Error("Tip too low");
          transactionResponse = await optimismFirn.withdraw(post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data, {
            gasLimit: withdrawalGas,
            gasPrice: l2GasPrice
          });
        } else if (req.url === "/transfer42161") {
          const l2GasPrice = await arbitrumProvider.getGasPrice();
          const transferGas = await arbitrumFirn.estimateGas.transfer(post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof);
          const totalFee = l2GasPrice.mul(transferGas);
          if (post.tip < parseFloat(ethers.utils.formatUnits(totalFee, 15)) * 0.95) throw new Error("Tip too low");
          transactionResponse = await arbitrumFirn.transfer(post.Y, post.C, post.D, post.u, post.epoch, post.tip, post.proof, {
            gasLimit: transferGas,
            gasPrice: l2GasPrice
          });
        } else if (req.url === "/withdrawal42161") {
          const l2GasPrice = await arbitrumProvider.getGasPrice();
          const withdrawalGas = await arbitrumFirn.estimateGas.withdraw(post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data);
          const totalFee = l2GasPrice.mul(withdrawalGas);
          if (post.tip < parseFloat(ethers.utils.formatUnits(totalFee, 15)) * 0.95) throw new Error("Tip too low");
          transactionResponse = await arbitrumFirn.withdraw(post.Y, post.C, post.D, post.u, post.epoch, post.amount, post.tip, post.proof, post.destination, post.data, {
            gasLimit: withdrawalGas,
            gasPrice: l2GasPrice
          });
        } else {
          throw new Error("Unsupported endpoint");
        }
        res.write(JSON.stringify({
          hash: transactionResponse.hash,
        }));
      } catch (error) {
        console.error(error);
        // could try to separate out the case of a reversion... (or detect it earlier!)
        const wrongEpoch = "Error: VM Exception while processing transaction: reverted with reason string 'Wrong epoch.'";
        let statusMessage = "Unknown error";
        if (error.message === "Tip too low") statusMessage = "Tip too low";
        else if (error.error?.code === ethers.errors.TIMEOUT) statusMessage = "Took too long";
        else if (error.message === wrongEpoch || error.reason === wrongEpoch || error.reason === "Wrong epoch.") statusMessage = "Wrong epoch";

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
