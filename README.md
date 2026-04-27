# @blockrun/nano-client

TypeScript client for [blockrun-nano](https://nano.blockrun.ai) — pay BlockRun's
full AI model catalog with **gas-free batched USDC** via Circle Gateway, on
Polygon, Arbitrum, Optimism, or Unichain mainnet.

## Install

```bash
npm install @blockrun/nano-client
# or
pnpm add @blockrun/nano-client
```

## Quick start

```ts
import { NanoClient } from "@blockrun/nano-client";

const client = new NanoClient({
  chain: "polygon",
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// One-time: deposit USDC into Circle Gateway
await client.deposit("5");                          // $5 USDC

// Unlimited paid calls (zero gas per call)
const r = await client.chat({
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(r.data.choices[0].message.content);
console.log(r.payment.formattedAmount);             // "$0.001000"
```

## Methods

### Wallet / Gateway management

```ts
client.address;                                     // 0x... derived from privateKey
await client.getBalances();                         // wallet + Gateway, on configured chain
await client.deposit("5");                          // wallet → Circle Gateway escrow
await client.withdraw("2");                         // Gateway → wallet (instant, same chain)
await client.withdraw("2", { chain: "base" });      // Cross-chain via CCTP (~13 min)
```

### Paid endpoints

```ts
// Chat completions (OpenAI compatible)
const r = await client.chat({
  model: "anthropic/claude-haiku-4.5",
  messages: [{ role: "user", content: "..." }],
  max_tokens: 1024,
});

// Streaming chat
for await (const chunk of client.chatStream({
  model: "openai/gpt-4o-mini",
  messages: [...],
})) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}

// Image generation
const img = await client.images({
  model: "openai/dall-e-3",
  prompt: "A cat coding TypeScript",
  size: "1024x1024",
});

// Search
const search = await client.search({ query: "latest Solana TVL" });

// X / Twitter
const user = await client.xUserInfo("vitalikbuterin");

// Generic — any nano paid route
const audio = await client.call("/api/v1/audio/generations", {
  method: "POST",
  body: { model: "openai/tts-1", voice: "alloy", input: "Hello" },
});
```

Every paid call returns `{ data, payment }`:

```ts
{
  data: <typed response>,
  payment: {
    transaction: "batch_abc123...",        // Circle batch ID; resolves to onchain tx ~hourly
    network: "eip155:137",                 // CAIP-2 of the chain used
    formattedAmount: "$0.001000",
    amount: "1000",                        // micro-USDC
  }
}
```

## Configuration

```ts
const client = new NanoClient({
  privateKey: "0x...",                      // required
  chain: "polygon",                         // required: polygon | arbitrum | optimism | unichain
  baseUrl: "https://nano.blockrun.ai",      // default
  rpcUrl: "https://polygon-mainnet.g.alchemy.com/v2/KEY",  // optional
  maxRetries: 2,                            // default
});
```

For testing against the Cloud Run direct URL while DNS is being set up:

```ts
import { NanoClient, NANO_MAINNET_DIRECT_URL } from "@blockrun/nano-client";

const client = new NanoClient({
  chain: "polygon",
  privateKey: "0x...",
  baseUrl: NANO_MAINNET_DIRECT_URL,
});
```

## RPC

If you don't pass `rpcUrl`, the client uses a **vetted public RPC** per chain
from `RECOMMENDED_RPC_URLS` — needed because `@circle-fin/x402-batching`'s
default RPCs are often rate-limited or stale (e.g. Polygon defaults to
`poly.api.pocket.network` which routinely returns 401).

| Chain | Default RPC used |
|---|---|
| `polygon` | `https://1rpc.io/matic` |
| `arbitrum` | `https://arbitrum.llamarpc.com` |
| `optimism` | `https://optimism.llamarpc.com` |
| `unichain` | `https://unichain.drpc.org` |

For production traffic, **use your own RPC key** (Alchemy / QuickNode / Infura):

```ts
const client = new NanoClient({
  chain: "polygon",
  privateKey: "0x...",
  rpcUrl: "https://polygon-mainnet.g.alchemy.com/v2/YOUR-KEY",
});
```

## End-to-end test

```bash
git clone <this repo>
cd blockrun-nano-client
pnpm install

# 1) Generate a fresh test wallet
tsx examples/print-address.ts
# → prints CLIENT_PRIVATE_KEY=0x... and the wallet address

# 2) Save the private key to .env, fund the address with $0.50 USDC + 0.05 MATIC on Polygon mainnet

# 3) Run the e2e
tsx examples/e2e-test.ts
```

## See also

- [BlockRun Nano buyer guide (CN + EN)](https://github.com/blockrunai/blockrun-nano/blob/main/BUYER-GUIDE.md)
- [`@circle-fin/x402-batching`](https://www.npmjs.com/package/@circle-fin/x402-batching) — underlying SDK
- [BlockRun mainnet on Base](https://blockrun.ai)
- [BlockRun on Solana](https://sol.blockrun.ai)

## License

Apache-2.0
