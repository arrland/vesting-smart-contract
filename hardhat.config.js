require("@nomiclabs/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require('dotenv').config();

module.exports = {
  networks: {
    hardhat: {
      chainId: 1337
    },
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    // Configuration for the Polygon Mainnet
    polygon_mainnet: {
      url: "https://polygon-rpc.com/",
      accounts: [/* Your private keys here */],
      chainId: 137,
    },
    // Configuration for the Mumbai Testnet
    mumbai: {
      url: "https://rpc-mumbai.maticvigil.com",
      accounts: [/* Your private keys here */],
      chainId: 80001,
    },
  },
  solidity: {
    version: "0.8.25",
    settings: {
      optimizer: {
        enabled: true,
        details: {
          yulDetails: {
            optimizerSteps: "u",
          },
        },
        runs: 200,
      },
      viaIR: false,
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
};