# Monad MCP
An MCP (Model Context Protocol) server for interacting with the Monad blockchain, providing tools for token management, contract deployment, and more.

![Built on Monad Badge](https://cdn.zekeosborn.xyz/built-on-monad-badge.png)

## Supported Tools

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `get-wallet-address` | Get the wallet address | None |
| `get-mon-balance` | Get MON token balance | `checkOwnBalance`: boolean, `address`: string (optional) |
| `disperse-tokens` | Disperse tokens to multiple addresses | `tokenAddress`: string, `recipients`: array of {address, amount}, `useEqualAmounts`: boolean (optional) |
| `disperse-mon` | Disperse MON tokens to multiple addresses | `recipients`: array of {address, amount}, `useEqualAmounts`: boolean (optional) |
| `compile-contract` | Compile Solidity contracts | `contractCode`: string, `contractName`: string |
| `deploy-contract` | Deploy contracts to Monad testnet | `contractName`: string, `bytecode`: string, `abi`: string, `constructorArgs`: array (optional), `gasLimit`: number (optional) |
| `generate-sdk` | Generate SDK for deployed contracts | `contractAddress`: string, `contractName`: string, `abi`: string, `sdkName`: string (optional), `language`: string (optional), `includeExamples`: boolean (optional) |
| `transfer-mon` | Transfer MON tokens to another address | `to`: string, `amount`: string, `gasLimit`: number (optional) |

## Requirements
- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download)
- [Claude Desktop](https://claude.ai/download)

## Getting Started

1. Clone this repository
```bash
git clone https://github.com/AnasAli30/monad-mcp-server.git
```

2. Install dependencies
```bash
npm install
```

## Build the Project
```bash
npm run build
```

## Add the MCP server to Claude Desktop

1. Open "Claude Desktop"
2. Open Settings (Claude > Settings > Developer)
3. Click Edit Config and open `claude_desktop_config.json`
4. Add details about the MCP server and save the file

```json
{
  "mcpServers": {
    "monad-mcp": {
      "command": "node",
      "args": [
        "<absolute-path-to-project>/build/index.js"
      ],
      "env": {
        "PRIVATE_KEY": "",
        "RPC_URL": "https://monad-testnet.g.alchemy.com/v2/your-api-key"
      }
    }
  }
}
```

Add your private key (with the 0x prefix).  
You can also add your own RPC, or leave it empty to use the default RPC.

5. Restart "Claude Desktop"

## Usage Examples

### Get MON Balance
```typescript
{
  checkOwnBalance: true
}
```

### Disperse MON Tokens
```typescript
{
  recipients: [
    { address: "0x...", amount: "1.0" },
    { address: "0x...", amount: "2.0" }
  ],
  useEqualAmounts: false
}
```

### Deploy Contract
```typescript
{
  contractName: "MyContract",
  bytecode: "0x...",
  abi: "[...]",
  constructorArgs: ["arg1", "arg2"],
  gasLimit: 3000000
}
```

### Generate SDK
```typescript
{
  contractAddress: "0x...",
  contractName: "MyContract",
  abi: "[...]",
  language: "typescript",
  includeExamples: true
}
```

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## License
This project is licensed under the MIT License - see the LICENSE file for details.
