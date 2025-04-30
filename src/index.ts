
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPublicClient, formatUnits, http } from "viem";
import { ethers } from "ethers";
require('dotenv').config();
const PRIVATE_KEY = process.env.PRIVATE_KEY!;


const monadProvider = new ethers.JsonRpcProvider("https://monad-api.blockvision.org/testnet/api");



const clientMonad = new ethers.Wallet(PRIVATE_KEY, monadProvider);

// Initialize the MCP server with a name, version, and capabilities
const server = new McpServer({
    name: "monad-mcp",
    version: "0.1.0",
    capabilities: [
      "get-wallet-address",
      "get-mon-balance",
    
    ]
  });


  server.tool(
    "get-mon-balance",
    "Get MON balance for an address on Monad testnet",
    {
        address: z
        .string()
        .min(1, "Address is required")
        .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
        .describe("Address on Monad testnet to check MON balance for")
    },
    async ({ address }) => {
        try {
        const balance = await monadProvider.getBalance(address);
        return {
            content: [
            {
                type: "text",
                text: `📍 **MON Balance Check (Monad Testnet)**
                
                **Address:** \`${address}\`
                **Balance:** ${ethers.formatUnits(balance, 18)} MON`
            }
            ]
        };
        } catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `❌ Failed to retrieve MON balance for address: \`${address}\`.

                    **Error:** ${error instanceof Error ? error.message : String(error)}`
                }
            ]
        };
        }
    }
);
  

// Define a tool that gets the MON balance for a given address


/**
 * Main function to start the MCP server
 * Uses stdio for communication with LLM clients
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Monad MCP Server running with revoke support ✅");
  }

// Start the server and handle any fatal errors
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
