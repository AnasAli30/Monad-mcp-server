import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPublicClient, formatUnits, http } from "viem";
import { monadTestnet } from "viem/chains";
import { ethers } from "ethers";
require('dotenv').config();
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

const monadProvider = new ethers.JsonRpcProvider("https://monad-testnet.g.alchemy.com/v2/a7yt4T3V-ndJMoHBFdRmOmahf2Huaa2W");
const clientMonad = new ethers.Wallet(PRIVATE_KEY, monadProvider);

// Initialize the MCP server with expanded capabilities
const server = new McpServer({
    name: "monad-mcp",
    version: "0.1.0",
    capabilities: [
         "transfer-mon",
      "get-wallet-address",
      "get-mon-balance",
        "disperse-tokens",
        "disperse-mon",
        "compile-contract",
        "deploy-contract",
        "generate-sdk"
    ]
});

// Get MON balance tool with address extraction and user choice
  server.tool(
    "get-mon-balance",
    "Get MON balance for an address on Monad testnet",
    {
        checkOwnBalance: z.boolean().describe("Set to true to check your own balance, false to check another address"),
        address: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
            .optional()
            .describe("Address on Monad testnet to check MON balance for (required if checkOwnBalance is false)")
    },
    async ({ checkOwnBalance, address }) => {
        try {
            let targetAddress: string;
            
            if (checkOwnBalance) {
                // Extract address from private key
                targetAddress = clientMonad.address;
            } else {
                if (!address) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "❌ Address is required when checking another wallet's balance"
                            }
                        ]
                    };
                }
                targetAddress = address;
            }

            const balance = await monadProvider.getBalance(targetAddress);
            const formattedBalance = ethers.formatUnits(balance, 18);
            
        return {
            content: [
            {
                type: "text",
                text: `📍 **MON Balance Check (Monad Testnet)**
                
                        ${checkOwnBalance ? "**Your Address:**" : "**Target Address:**"} \`${targetAddress}\`
                        **Balance:** ${formattedBalance} MON
                        
                        ${checkOwnBalance ? "This is your wallet's balance" : "This is the balance of the specified address"}`
            }
            ]
        };
        } catch (error) {
        return {
            content: [
                {
                    type: "text",
                        text: `❌ Failed to retrieve MON balance.

                    **Error:** ${error instanceof Error ? error.message : String(error)}`
                }
            ]
        };
        }
    }
);
  
// Add contract address and ABI at the top
const DISPERSE_CONTRACT_ADDRESS = "0xb40682063d8E1E37Ae365D0f7C28292fEc63e938";
const DISPERSE_ABI = [
    {
        "constant": false,
        "inputs": [
            {
                "name": "recipients",
                "type": "address[]"
            },
            {
                "name": "values",
                "type": "uint256[]"
            }
        ],
        "name": "disperseEther",
        "outputs": [],
        "payable": true,
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "constant": false,
        "inputs": [
            {
                "name": "token",
                "type": "address"
            },
            {
                "name": "recipients",
                "type": "address[]"
            },
            {
                "name": "values",
                "type": "uint256[]"
            }
        ],
        "name": "disperseToken",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

// Disperse Tokens Tool
server.tool(
    "disperse-tokens",
    "Disperse tokens to multiple addresses",
    {
        tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token address format")
            .describe("Token contract address to disperse"),
        recipients: z.array(z.object({
            address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format"),
            amount: z.string().describe("Amount of tokens to send (in ether)")
        })).min(1).max(100).describe("List of recipients and amounts"),
        useEqualAmounts: z.boolean().optional().describe("Set to true to split total amount equally among recipients")
    },
    async ({ tokenAddress, recipients, useEqualAmounts }) => {
        try {
            // Create token contract instance for balance check and approval
            const tokenContract = new ethers.Contract(
                tokenAddress,
                [
                    "function balanceOf(address owner) view returns (uint256)",
                    "function decimals() view returns (uint8)",
                    "function approve(address spender, uint256 amount) returns (bool)",
                    "function allowance(address owner, address spender) view returns (uint256)"
                ],
                clientMonad
            );

            // Get token decimals
            const decimals = await tokenContract.decimals();

            // Create disperse contract instance
            const disperseContract = new ethers.Contract(
                DISPERSE_CONTRACT_ADDRESS,
                DISPERSE_ABI,
                clientMonad
            );

            // Check sender's balance
            const senderBalance = await tokenContract.balanceOf(clientMonad.address);
            
            // Convert amounts to token units and calculate total
            let totalAmount = 0n;
            const values: bigint[] = [];
            const addresses: string[] = [];

            if (useEqualAmounts) {
                const equalAmount = ethers.parseUnits(recipients[0].amount, decimals);
                totalAmount = equalAmount * BigInt(recipients.length);
                recipients.forEach(recipient => {
                    values.push(equalAmount);
                    addresses.push(recipient.address);
                });
            } else {
                recipients.forEach(recipient => {
                    const amount = ethers.parseUnits(recipient.amount, decimals);
                    totalAmount += amount;
                    values.push(amount);
                    addresses.push(recipient.address);
                });
            }

            // Verify sufficient balance
            if (senderBalance < totalAmount) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `❌ Insufficient token balance for dispersion
                            
                            **Your Balance:** ${ethers.formatUnits(senderBalance, decimals)}
                            **Required:** ${ethers.formatUnits(totalAmount, decimals)}`
                        }
                    ]
                };
            }

            // Check current allowance
            const currentAllowance = await tokenContract.allowance(
                clientMonad.address,
                DISPERSE_CONTRACT_ADDRESS
            );

            // If allowance is insufficient, approve the disperse contract
            if (currentAllowance < totalAmount) {
                const approveTx = await tokenContract.approve(
                    DISPERSE_CONTRACT_ADDRESS,
                    totalAmount
                );
                await approveTx.wait();

                return {
                    content: [
                        {
                            type: "text",
                            text: `✅ **Token Approval Successful**
                            
                            **Token:** \`${tokenAddress}\`
                            **Spender:** \`${DISPERSE_CONTRACT_ADDRESS}\`
                            **Amount:** ${ethers.formatUnits(totalAmount, decimals)}
                            **Transaction Hash:** \`${approveTx.hash}\`
                            
                            Please run the disperse command again to complete the token distribution.`
                        }
                    ]
                };
            }

            // Execute disperse transaction
            const tx = await disperseContract.disperseToken(tokenAddress, addresses, values);
            await tx.wait();

            return {
                content: [
                    {
                        type: "text",
                        text: `✅ **Tokens Dispersed Successfully**
                        
                        **Token:** \`${tokenAddress}\`
                        **Total Amount:** ${ethers.formatUnits(totalAmount, decimals)}
                        **Number of Recipients:** ${recipients.length}
                        **Transaction Hash:** \`${tx.hash}\`
                        
                        **Recipients and Amounts:**
                        ${recipients.map((r, i) => `
                        - To: \`${r.address}\`
                          Amount: ${useEqualAmounts ? recipients[0].amount : r.amount}`).join('\n')}`
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ Token dispersion failed: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);

// Disperse MON Tool
server.tool(
    "disperse-mon",
    "Disperse MON tokens to multiple addresses",
    {
        recipients: z.array(z.object({
            address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format"),
            amount: z.string().describe("Amount of MON to send (in ether)")
        })).min(1).max(100).describe("List of recipients and amounts"),
        useEqualAmounts: z.boolean().optional().describe("Set to true to split total amount equally among recipients")
    },
    async ({ recipients, useEqualAmounts }) => {
        try {
            // Create disperse contract instance
            const disperseContract = new ethers.Contract(
                DISPERSE_CONTRACT_ADDRESS,
                DISPERSE_ABI,
                clientMonad
            );

            // Check sender's balance
            const senderBalance = await monadProvider.getBalance(clientMonad.address);
            
            // Convert amounts from ether to wei and calculate total
            let totalAmount = 0n;
            const values: bigint[] = [];
            const addresses: string[] = [];

            if (useEqualAmounts) {
                const equalAmount = ethers.parseEther(recipients[0].amount);
                totalAmount = equalAmount * BigInt(recipients.length);
                recipients.forEach(recipient => {
                    values.push(equalAmount);
                    addresses.push(recipient.address);
                });
            } else {
                recipients.forEach(recipient => {
                    const amount = ethers.parseEther(recipient.amount);
                    totalAmount += amount;
                    values.push(amount);
                    addresses.push(recipient.address);
                });
            }

            // Verify sufficient balance
            if (senderBalance < totalAmount) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `❌ Insufficient MON balance for dispersion
                            
                            **Your Balance:** ${ethers.formatEther(senderBalance)} MON
                            **Required:** ${ethers.formatEther(totalAmount)} MON`
                        }
                    ]
                };
            }

            // Execute disperse transaction
            const tx = await disperseContract.disperseEther(addresses, values, {
                value: totalAmount
            });
            await tx.wait();

            return {
                content: [
                    {
                        type: "text",
                        text: `✅ **MON Dispersed Successfully**
                        
                        **Total Amount:** ${ethers.formatEther(totalAmount)} MON
                        **Number of Recipients:** ${recipients.length}
                        **Transaction Hash:** \`${tx.hash}\`
                        
                        **Recipients and Amounts:**
                        ${recipients.map((r, i) => `
                        - To: \`${r.address}\`
                          Amount: ${useEqualAmounts ? recipients[0].amount : r.amount} MON`).join('\n')}`
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ MON dispersion failed: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);


// Compile Contract Tool
server.tool(
    "compile-contract",
    "Compile Solidity contract code",
    {
        contractCode: z.string().describe("Solidity contract code to compile"),
        contractName: z.string().describe("Name of the contract to compile")
    },
    async ({ contractCode, contractName }) => {
        try {
            // Create a temporary file for the contract
            const fs = require('fs');
            const path = require('path');
            const contractPath = path.join(__dirname, 'temp', `${contractName}.sol`);
            
            // Ensure temp directory exists
            if (!fs.existsSync(path.join(__dirname, 'temp'))) {
                fs.mkdirSync(path.join(__dirname, 'temp'));
            }
            
            // Write contract code to file
            fs.writeFileSync(contractPath, contractCode);
            
            // Compile using solc
            const solc = require('solc');
            const input = {
                language: 'Solidity',
                sources: {
                    [contractName]: {
                        content: contractCode
                    }
                },
                settings: {
                    outputSelection: {
                        '*': {
                            '*': ['*']
                        }
                    }
                }
            };
            
            const output = JSON.parse(solc.compile(JSON.stringify(input)));
            
            if (output.errors) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `❌ Compilation Errors:
                            
                            ${output.errors.map((err: any) => err.formattedMessage).join('\n')}`
                        }
                    ]
                };
            }
            
            const contract = output.contracts[contractName][contractName];
            
            return {
                content: [
                    {
                        type: "text",
                        text: `🔨 **Contract Compiled Successfully**
                        
                        **Contract:** ${contractName}
                        **ABI:** \`\`\`json
                        ${JSON.stringify(contract.abi, null, 2)}
                        \`\`\`
                        **Bytecode:** \`0x${contract.evm.bytecode.object}\``
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ Contract compilation failed: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);

// Deploy Contract Tool
server.tool(
    "deploy-contract",
    "Deploy compiled contract to Monad testnet",
    {
        contractName: z.string().describe("Name of the contract to deploy"),
        bytecode: z.string().describe("Contract bytecode"),
        abi: z.string().describe("Contract ABI"),
        constructorArgs: z.array(z.any()).optional().describe("Constructor arguments"),
        gasLimit: z.number().optional().describe("Gas limit for deployment")
    },
    async ({ contractName, bytecode, abi, constructorArgs, gasLimit }) => {
        try {
            // Parse ABI if it's a string
            const parsedAbi = typeof abi === 'string' ? JSON.parse(abi) : abi;
            
            // Create contract factory
            const factory = new ethers.ContractFactory(parsedAbi, bytecode, clientMonad);
            
            // Deploy contract
            const contract = await factory.deploy(...(constructorArgs || []), {
                gasLimit: gasLimit || 3000000
            });
            
            // Wait for deployment
            const deploymentTx = contract.deploymentTransaction();
            if (!deploymentTx) {
                throw new Error("Deployment transaction not found");
            }
            await deploymentTx.wait();
            
            return {
                content: [
                    {
                        type: "text",
                        text: `🚀 **Contract Deployed Successfully**
                        
                        **Contract:** ${contractName}
                        **Address:** \`${await contract.getAddress()}\`
                        **Transaction Hash:** \`${deploymentTx.hash}\`
                        **Gas Used:** ${deploymentTx.gasLimit}`
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ Contract deployment failed: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);

// Generate SDK Tool
server.tool(
    "generate-sdk",
    "Generate SDK for a deployed contract",
    {
        contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address format")
            .describe("Address of the deployed contract"),
        contractName: z.string().describe("Name of the contract"),
        abi: z.string().describe("Contract ABI"),
        sdkName: z.string().optional().describe("Name for the generated SDK"),
        language: z.enum(["typescript", "javascript", "python"]).optional().describe("Programming language for SDK"),
        includeExamples: z.boolean().optional().describe("Include usage examples in SDK")
    },
    async ({ contractAddress, contractName, abi, sdkName, language, includeExamples }) => {
        try {
            // Parse ABI if it's a string
            const parsedAbi = typeof abi === 'string' ? JSON.parse(abi) : abi;
            
            // Generate SDK based on language
            const sdkCode = generateSDKCode({
                contractAddress,
                contractName,
                abi: parsedAbi,
                sdkName: sdkName || `${contractName}SDK`,
                language: language || "typescript",
                includeExamples: includeExamples || true
            });

            return {
                content: [
                    {
                        type: "text",
                        text: `✅ **SDK Generated Successfully**
                        
                        **Contract:** ${contractName}
                        **Address:** \`${contractAddress}\`
                        **SDK Name:** ${sdkName || `${contractName}SDK`}
                        **Language:** ${language || "typescript"}
                        
                        **SDK Code:**
                        \`\`\`${language || "typescript"}
                        ${sdkCode}
                        \`\`\`
                        
                        To use this SDK:
                        1. Save the code to a file (e.g., \`${sdkName || `${contractName}SDK`}.${getFileExtension(language || "typescript")}\`)
                        2. Install required dependencies
                        3. Import and use the SDK in your project`
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ SDK generation failed: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);

// Transfer MON Tool
server.tool(
    "transfer-mon",
    "Transfer MON tokens to another address",
    {
        to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
            .describe("Recipient address"),
        amount: z.string().describe("Amount of MON to transfer (in ether)"),
        gasLimit: z.number().optional().describe("Gas limit for the transaction")
    },
    async ({ to, amount, gasLimit }) => {
        try {
            // Convert amount from ether to wei
            const amountInWei = ethers.parseEther(amount);

            // Check sender's balance
            const senderBalance = await monadProvider.getBalance(clientMonad.address);
            if (senderBalance < amountInWei) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `❌ Insufficient MON balance
                            
                            **Your Balance:** ${ethers.formatEther(senderBalance)} MON
                            **Required:** ${amount} MON`
                        }
                    ]
                };
            }

            // Send transaction
            const tx = await clientMonad.sendTransaction({
                to,
                value: amountInWei,
                gasLimit: gasLimit || 21000
            });

            // Wait for transaction to be mined
            const receipt = await tx.wait();
            if (!receipt) {
                throw new Error("Transaction receipt not found");
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `✅ **MON Transfer Successful**
                        
                        **From:** \`${clientMonad.address}\`
                        **To:** \`${to}\`
                        **Amount:** ${amount} MON
                        **Transaction Hash:** \`${receipt.hash}\`
                        **Gas Used:** ${receipt.gasUsed}
                        
                        View transaction on explorer:
                        https://testnet.monadexplorer.com/tx/${receipt.hash}`
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ MON transfer failed: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);

// Helper function to generate SDK code
function generateSDKCode({
    contractAddress,
    contractName,
    abi,
    sdkName,
    language,
    includeExamples
}: {
    contractAddress: string;
    contractName: string;
    abi: any[];
    sdkName: string;
    language: string;
    includeExamples: boolean;
}): string {
    if (language === "typescript") {
        return generateTypeScriptSDK({
            contractAddress,
            contractName,
            abi,
            sdkName,
            includeExamples
        });
    } else if (language === "javascript") {
        return generateJavaScriptSDK({
            contractAddress,
            contractName,
            abi,
            sdkName,
            includeExamples
        });
    } else if (language === "python") {
        return generatePythonSDK({
            contractAddress,
            contractName,
            abi,
            sdkName,
            includeExamples
        });
    }
    throw new Error(`Unsupported language: ${language}`);
}

// Generate TypeScript SDK
function generateTypeScriptSDK({
    contractAddress,
    contractName,
    abi,
    sdkName,
    includeExamples
}: {
    contractAddress: string;
    contractName: string;
    abi: any[];
    sdkName: string;
    includeExamples: boolean;
}): string {
    const imports = `import { ethers } from 'ethers';
import { Contract } from 'ethers';
import { JsonRpcProvider } from 'ethers';
import { Wallet } from 'ethers';`;

    const classDefinition = `export class ${sdkName} {
    private contract: Contract;
    private provider: JsonRpcProvider;
    private signer: Wallet | undefined;

    constructor(providerUrl: string, privateKey?: string) {
        this.provider = new JsonRpcProvider(providerUrl);
        if (privateKey) {
            this.signer = new Wallet(privateKey, this.provider);
            this.contract = new Contract("${contractAddress}", ${JSON.stringify(abi)}, this.signer);
        } else {
            this.contract = new Contract("${contractAddress}", ${JSON.stringify(abi)}, this.provider);
        }
    }`;

    const methods = abi
        .filter(item => item.type === 'function')
        .map(func => {
            const inputs = func.inputs.map((input: any) => `${input.name}: ${getTypeScriptType(input.type)}`).join(', ');
            const outputs = func.outputs.length > 0 
                ? `: Promise<${getTypeScriptType(func.outputs[0].type)}>` 
                : ': Promise<void>';
            return `
    async ${func.name}(${inputs})${outputs} {
        return await this.contract.${func.name}(${func.inputs.map((input: any) => input.name).join(', ')});
    }`;
        })
        .join('\n');

    const examples = includeExamples ? `
    // Example usage:
    // const sdk = new ${sdkName}('https://monad-testnet.g.alchemy.com/v2/your-api-key');
    // const result = await sdk.someFunction(arg1, arg2);` : '';

    return `${imports}

${classDefinition}
${methods}
${examples}
}`;
}

// Generate JavaScript SDK
function generateJavaScriptSDK({
    contractAddress,
    contractName,
    abi,
    sdkName,
    includeExamples
}: {
    contractAddress: string;
    contractName: string;
    abi: any[];
    sdkName: string;
    includeExamples: boolean;
}): string {
    const imports = `const { ethers } = require('ethers');`;

    const classDefinition = `class ${sdkName} {
    constructor(providerUrl, privateKey) {
        this.provider = new ethers.JsonRpcProvider(providerUrl);
        if (privateKey) {
            this.signer = new ethers.Wallet(privateKey, this.provider);
            this.contract = new ethers.Contract("${contractAddress}", ${JSON.stringify(abi)}, this.signer);
        } else {
            this.contract = new ethers.Contract("${contractAddress}", ${JSON.stringify(abi)}, this.provider);
        }
    }`;

    const methods = abi
        .filter(item => item.type === 'function')
        .map(func => {
            const inputs = func.inputs.map((input: any) => input.name).join(', ');
            return `
    async ${func.name}(${inputs}) {
        return await this.contract.${func.name}(${inputs});
    }`;
        })
        .join('\n');

    const examples = includeExamples ? `
    // Example usage:
    // const sdk = new ${sdkName}('https://monad-testnet.g.alchemy.com/v2/your-api-key');
    // const result = await sdk.someFunction(arg1, arg2);` : '';

    return `${imports}

${classDefinition}
${methods}
${examples}

module.exports = ${sdkName};`;
}

// Generate Python SDK
function generatePythonSDK({
    contractAddress,
    contractName,
    abi,
    sdkName,
    includeExamples
}: {
    contractAddress: string;
    contractName: string;
    abi: any[];
    sdkName: string;
    includeExamples: boolean;
}): string {
    const imports = `from web3 import Web3
from eth_account import Account`;

    const classDefinition = `class ${sdkName}:
    def __init__(self, provider_url, private_key=None):
        self.web3 = Web3(Web3.HTTPProvider(provider_url))
        if private_key:
            self.account = Account.from_key(private_key)
            self.contract = self.web3.eth.contract(
                address="${contractAddress}",
                abi=${JSON.stringify(abi)}
            )
        else:
            self.contract = self.web3.eth.contract(
                address="${contractAddress}",
                abi=${JSON.stringify(abi)}
            )`;

    const methods = abi
        .filter(item => item.type === 'function')
        .map(func => {
            const inputs = func.inputs.map((input: any) => input.name).join(', ');
            return `
    def ${func.name}(self, ${inputs}):
        return self.contract.functions.${func.name}(${inputs}).call()`;
        })
        .join('\n');

    const examples = includeExamples ? `
    # Example usage:
    # sdk = ${sdkName}('https://monad-testnet.g.alchemy.com/v2/your-api-key')
    # result = sdk.some_function(arg1, arg2)` : '';

    return `${imports}

${classDefinition}
${methods}
${examples}`;
}

// Helper function to get TypeScript type from Solidity type
function getTypeScriptType(solidityType: string): string {
    if (solidityType.startsWith('uint') || solidityType.startsWith('int')) {
        return 'bigint';
    }
    if (solidityType === 'address') {
        return 'string';
    }
    if (solidityType === 'bool') {
        return 'boolean';
    }
    if (solidityType === 'string') {
        return 'string';
    }
    if (solidityType === 'bytes') {
        return 'string';
    }
    return 'any';
}

// Helper function to get file extension
function getFileExtension(language: string): string {
    switch (language) {
        case 'typescript':
            return 'ts';
        case 'javascript':
            return 'js';
        case 'python':
            return 'py';
        default:
            return 'ts';
    }
}

/**
 * Main function to start the MCP server
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Monad MCP Server running with DeFi and NFT capabilities ✅");
  }

// Start the server and handle any fatal errors
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
