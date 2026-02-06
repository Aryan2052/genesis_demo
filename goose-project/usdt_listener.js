const { ethers } = require("ethers");

// ---------------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------------
// PASTE YOUR INFURA KEY HERE AGAIN
const INFURA_ID = '08431f7a779a4c79bb48427a5d53998c';
const providerUrl = `https://mainnet.infura.io/v3/${INFURA_ID}`;

// The "Home Address" of the USDT Coin on Ethereum
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

// The "ABI" is like a dictionary. It tells your code how to understand
// the "Transfer" language that the USDT contract speaks.
const USDT_ABI = [
    "event Transfer(address indexed from, address indexed to, uint value)"
];

async function main() {
    console.log("------------------------------------------------");
    console.log("🎧 Tuning in to USDT Transfers on Ethereum...");
    console.log("------------------------------------------------");

    const provider = new ethers.JsonRpcProvider(providerUrl);
    
    // Create a connection to the specific USDT contract
    const contract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);

    // ---------------------------------------------------------
    // 2. THE LISTENER
    // ---------------------------------------------------------
    // This function triggers AUTOMATICALLY every time a transfer happens anywhere in the world.
    contract.on("Transfer", (from, to, value, event) => {
        
        // USDT uses 6 decimal places (like $1.000000)
        // We convert the raw blockchain number to a human readable number
        const amount = ethers.formatUnits(value, 6);

        console.log(`
        🚨 NEW TRANSFER DETECTED!
        -------------------------
        📤 From:   ${from}
        📥 To:     ${to}
        💰 Amount: $${amount} USDT
        🔗 Block:  ${event.log.blockNumber}
        `);
    });
}

main();