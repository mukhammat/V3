const { Connection, PublicKey } = require('@solana/web3.js');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const connection = new Connection(process.env.SOLANA_WS_URL, 'confirmed');
const RAYDIUM_AMM_PROGRAM_ID = new PublicKey(process.env.RAYDIUM_AMM_PROGRAM_ID);

let db;  // To store the database instance

// Function to connect to MongoDB
async function connectToDatabase() {
    const mongoUri = process.env.MONGO_URI;
    const client = new MongoClient(mongoUri);
    try {
        await client.connect();
        db = client.db('test');  // Change 'bot' to your preferred database name
        console.log("Connected to MongoDB successfully.");
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        process.exit(1);  // Exit if MongoDB connection fails
    }
}

// Function to save data to MongoDB
async function saveToMongo(tokenData) {
    try {
        if (!db) {
            throw new Error('Database connection is not initialized');
        }

        const collection = db.collection('raydium_lp_transactions');  // Change collection name as needed
        const result = await collection.insertOne(tokenData);

        if (result.acknowledged) {
            console.log('Token data saved to MongoDB:', result.insertedId);
        } else {
            console.error('Failed to save token data to MongoDB.');
        }
    } catch (error) {
        console.error('Error saving token data to MongoDB:', error.message);
    }
}

// Asynchronous function to process LP transactions on Raydium
async function processRaydiumLpTransaction(connection, signature) {
    try {
        // Fetch transaction details by its signature
        const transactionDetails = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });

        // Check if transaction details were found
        if (!transactionDetails) {
            console.error(
                "No transaction details found for signature:",
                signature
            );
            return; // Exit the function if no details are found
        }

        // Extract the message from the transaction
        const message = transactionDetails.transaction?.message;

        //Check for the presence of message and accountKeys array
        if (!message || !Array.isArray(message.staticAccountKeys)) {
            console.error("accountKeys is undefined or not an array");
            return; // Exit the function if accountKeys is missing or not an array
        }

        // Get account keys, including those from lookup tables
        const accountKeys =
            message.staticAccountKeys.slice();

        if (message.addressTableLookups) {
            for (const lookup of message
                .addressTableLookups) {
                const lookupTable = await connection.getAddressLookupTable(
                    lookup.accountKey
                );
                if (lookupTable) {
                    accountKeys.push(...lookupTable.state.addresses);
                }
            }
        }

        // Convert account keys to string format
        const accounts = accountKeys.map((key) => key.toString());

        // Check if account keys are present
        if (accounts.length === 0) {
            console.error("No account keys found.");
            return; // Exit the function if no account keys are found
        }

        // Check for the presence of instructions in the message
        if (!message.instructions) {
            console.log(`Transaction ${signature} has been marked as empty.`);
            return;
        }

        console.log("Transaction Message:", message);
        console.log("Accounts:", accounts);

        // Loop through all instructions in the message
        for (const ix of message.instructions) {
            // Check if programIdIndex is within bounds of the accounts array
            if (ix.programIdIndex >= accounts.length) {
                console.error("programIdIndex out of bounds:", ix.programIdIndex);
                continue; // Skip to the next iteration if the index is out of bounds
            }

            // Get the program ID from the accounts array
            const programId = accounts[ix.programIdIndex];
            
            // Check if the program is Raydium AMM and if instruction data is present
            if (programId === RAYDIUM_AMM_PROGRAM_ID.toString() && ix.data.length > 0) {
                // Extract token data from the instruction
                const tokenData = extractTokenData(ix, accounts);
                
                // If token data is successfully extracted, save it to MongoDB
                if (tokenData) {
                    await saveToMongo(tokenData);
                    return tokenData; // Return the extracted data
                }
            }
        }
    } catch (error) {
        // Log any errors that occur during processing
        console.error('Error fetching/processing transaction:', error.message);
    } 
}

// Helper function to extract token data from instruction
function extractTokenData(ix, accounts) {
    try {
        // Extract various mint and account details from the instruction
        const mint0 = accounts[ix.accounts[8]];
        const mint1 = accounts[ix.accounts[9]];
        const lpTokenMint = accounts[ix.accounts[7]];
        const deployer = accounts[ix.accounts[17]];
        const poolId = accounts[ix.accounts[4]];
        const baseVault = accounts[ix.accounts[10]];
        const quoteVault = accounts[ix.accounts[11]];
        const ammAuthority = accounts[ix.accounts[5]];
        const ammTarget = accounts[ix.accounts[13]];
        const ammOpenOrder = accounts[ix.accounts[6]];
        const marketProgram = accounts[ix.accounts[15]];
        const marketId = accounts[ix.accounts[16]];

        // Return an object containing the extracted token data
        return {
            programId: new PublicKey(accounts[ix.accounts[0]]).toString(),
            ammId: new PublicKey(poolId).toString(),
            ammAuthority: new PublicKey(ammAuthority).toString(),
            ammOpenOrders: new PublicKey(ammOpenOrder).toString(),
            lpMint: new PublicKey(lpTokenMint).toString(),
            coinMint: new PublicKey(mint0).toString(),
            pcMint: new PublicKey(mint1).toString(),
            coinVault: new PublicKey(baseVault).toString(),
            pcVault: new PublicKey(quoteVault).toString(),
            ammTargetOrders: new PublicKey(ammTarget).toString(),
            serumMarket: new PublicKey(marketId).toString(),
            serumProgram: new PublicKey(marketProgram).toString(),
            deployer: new PublicKey(deployer).toString()
        };
    } catch (error) {
        // Log any errors that occur during token data extraction
        console.error("Error extracting token data:", error.message);
        return null; // Return null if extraction fails
    }
}


module.exports = {
    connectToDatabase,
    processRaydiumLpTransaction
};