// index.js
const { ethers } = require("ethers");

// ---------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------
// Replace 'YOUR_INFURA_API_KEY' with the key you just got.
// It usually looks like a long string of random numbers and letters.
const INFURA_ID = '08431f7a779a4c79bb48427a5d53998c';

// This is the address for the Ethereum Mainnet via Infura
const providerUrl = `https://mainnet.infura.io/v3/${INFURA_ID}`;

// ---------------------------------------------------------
// THE SCRIPT
// ---------------------------------------------------------
async function main() {
    console.log("1. Attempting to connect to Ethereum Mainnet...");

    // Create the provider (the connection to the blockchain)
    const provider = new ethers.JsonRpcProvider(providerUrl);

    try {
        // Ask the blockchain for the current block number
        const blockNumber = await provider.getBlockNumber();
        
        console.log("2. Connection Successful! 🚀");
        console.log("------------------------------------------------");
        console.log(`   Current Ethereum Block Height: ${blockNumber}`);
        console.log("------------------------------------------------");
        
    } catch (error) {
        console.error("❌ Error connecting to blockchain:", error.message);
        console.log("   (Double check your API Key in the code)");
    }
}

main();