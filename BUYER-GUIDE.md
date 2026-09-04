# BlockRun Nano — Buyer Guide

For account billing, [register](https://user.blockrun.ai), [create a key](https://user.blockrun.ai/dashboard/keys), and [add credits](https://user.blockrun.ai/dashboard/credits). Use `BlockRunAccountClient` with `BLOCKRUN_API_KEY`; see the [account quick start](README.md#account-api-quick-start) for release availability and examples. This mode needs no wallet or deposit.

For native wallet billing, choose [Solana](https://sol.blockrun.ai) first or [Base](https://blockrun.ai) with the [main SDK](https://github.com/BlockRunAI/blockrun-llm-ts). The remaining guide covers Circle Gateway EVM billing.

Pay BlockRun's full AI model catalog with **gas-free batched USDC** via Circle Gateway across **10 mainnet EVM chains**: Polygon, Arbitrum, Optimism, Unichain, Avalanche, Sonic, Sei, WorldChain, HyperEVM, Ethereum.

**Endpoint** (mainnet): `https://nano.blockrun.ai`

---

## What it is

BlockRun Nano is the multi-chain entry point to [blockrun.ai](https://blockrun.ai)'s OpenAI-compatible model catalog (GPT, Claude, Gemini, Grok, DeepSeek...) — same models, same pricing, but payments settle through **Circle Gateway** batched USDC:

- **Deposit once** → every API call after is **offchain-signed, zero-gas**
- Pay from any of 10 mainnet chains
- Funds consolidate into BlockRun's single EVM treasury

## Day-1 chains

| Chain | `SupportedChainName` | Chain ID | Native gas |
|---|---|---|---|
| Polygon | `polygon` | 137 | POL |
| Arbitrum | `arbitrum` | 42161 | ETH |
| OP Mainnet | `optimism` | 10 | ETH |
| Unichain | `unichain` | 130 | ETH |
| Avalanche C-Chain | `avalanche` | 43114 | AVAX |
| Sonic | `sonic` | 146 | S |
| Sei EVM | `sei` | 1329 | SEI |
| WorldChain | `worldChain` | 480 | ETH |
| HyperEVM | `hyperEvm` | 999 | HYPE |
| Ethereum | `ethereum` | 1 | ETH |

> **Base** is intentionally not in nano — buyers on Base should use [`blockrun.ai`](https://blockrun.ai) directly (native x402, no Gateway deposit step required).

## 30-second quickstart

```bash
npm install @blockrun/nano-client
```

```ts
import { NanoClient } from "@blockrun/nano-client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// 1. Wallet (in production, load from env / KMS)
const privateKey = generatePrivateKey();
console.log("address:", privateKeyToAccount(privateKey).address);
//  ↑ Send $5 USDC + a small amount of native gas to this address on your chosen chain

// 2. One-time deposit into Circle Gateway
const gateway = new NanoClient({ chain: "polygon", privateKey });
await gateway.deposit("5");

// 3. Call APIs (unlimited, gas-free)
const r = await gateway.chat({
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(r.data.choices[0].message.content);
console.log(r.payment.formattedAmount);  // "$0.001000"
```

## Prerequisites

| Item | Requirement |
|---|---|
| EVM wallet | self-custodial (generate / MetaMask / Rabby / Coinbase / Privy / etc.) |
| USDC (any of the 10 chains) | 5–20 USDC covers thousands of calls |
| Native gas on that chain | Polygon ≈ 0.05 POL ($0.025); Arb/Op/Unichain/WorldChain/Ethereum ≈ 0.001–0.01 ETH; Avalanche ≈ 0.01 AVAX; Sonic ≈ 0.5 S; Sei ≈ 0.05 SEI; HyperEVM ≈ 0.01 HYPE |

**Onramp routes** (USDC to target chain):

| Source | Most chains | Notes |
|---|---|---|
| Coinbase exchange withdrawal | Polygon, Arbitrum, Optimism, Avalanche, Ethereum | Most common; Coinbase doesn't yet support Sonic / Sei / WorldChain / Unichain / HyperEVM |
| Coinbase Onramp / MoonPay / Stripe Crypto | Polygon, Arbitrum, Optimism, Ethereum | Card → USDC |
| Binance / Bybit / Kraken / OKX withdrawal | Most majors | Polygon is the most universally supported |
| Bridges (Across / Stargate / Jumper) | All 10 | Use if you have USDC on a different chain |
| **Circle CCTP (USDC-native)** | All 10 | Best for moving USDC between Circle-supported chains; no slippage |

> **Polygon is the day-1 sweet spot** — most onramps, cheapest gas, ~15-minute Circle batch interval. For chains with limited onramp coverage (Sonic, Sei, WorldChain, HyperEVM), deposit on another chain and use `client.withdraw({ chain })` to bridge instantly via CCTP.

## Depositing USDC into Circle Gateway

`gateway.deposit()` issues up to two onchain transactions (one after first call):

```
[Tx 1, first time only] USDC.approve(GatewayWallet, MAX_UINT)
[Tx 2, every deposit  ] GatewayWallet.deposit(USDC, amount)
```

```ts
const client = new NanoClient({ chain: "polygon", privateKey });

const before = await client.getBalances();
console.log("Wallet USDC:", before.wallet.formatted);
console.log("Gateway   :", before.gateway.formattedAvailable);

const result = await client.deposit("5");
console.log("approve tx:", result.approvalTxHash);  // only on first deposit
console.log("deposit tx:", result.depositTxHash);

await new Promise(r => setTimeout(r, 12_000));   // Circle indexer ~10s

const after = await client.getBalances();
console.log("Gateway   :", after.gateway.formattedAvailable);
```

**Notes:**
- ~10s indexer lag. Calling `client.chat()` immediately can report "balance 0"; retry shortly.
- Each chain has its own balance; deposit on each, or deposit once and `withdraw({ chain })` (CCTP) to move.
- Once MAX_UINT approve is set, future deposits on that chain need only one tx.

## Calling APIs (zero gas per call)

Every paid call is signed off-chain. The SDK handles the 402 challenge → signature → resend flow internally.

```ts
const r = await client.chat({
  model: "anthropic/claude-haiku-4.5",
  messages: [{ role: "user", content: "Explain MEV in one sentence." }],
});

const reply = await client.ask("openai/gpt-4o-mini", "Quick answer please");

// Smart routing: let ClawRouter pick the cheapest capable model
const smart = await client.smartChat({
  prompt: "What is 2+2?",
  routing_profile: "auto",  // or 'free' / 'eco' / 'premium'
});

// X / Twitter intel, image generation, video, music, search, prices...
const trending = await client.x.trending();
const img = await client.images.generate({
  model: "openai/dall-e-3",
  prompt: "voxel cat",
});
```

Every paid call returns `{ data, payment }`:

```ts
{
  data: <typed response>,
  payment: {
    transaction: "1b2192d3-aaed-4457-a740-a6abafcadb04",  // Circle nanopayment intent UUID
    formattedAmount: "$0.001000",
    amount: 1000n,                                          // micro-USDC
    status: 200,
  }
}
```

Settlement is asynchronous: Circle batches ~every 15 min on Polygon (varies by chain). Track via `client.getPaymentStatus(intentId)` or `client.waitForSettlement(intentId)`.

## Withdrawing

**Normal withdraws are instant.** Same chain → directly to wallet; cross-chain → via Circle CCTP (~13 min).

```ts
// Back to wallet on the same chain
await client.withdraw("2");

// Or move to a different chain (CCTP, ~13 min)
await client.withdraw("2", { chain: "base" });

const b = await client.getBalances();
console.log("withdrawing:", b.gateway.formattedWithdrawing);
console.log("withdrawable:", b.gateway.formattedWithdrawable);
```

> ⚠️ The SDK also exposes `initiateTrustlessWithdrawal()` / `completeTrustlessWithdrawal()` with a **7-day delay**. Emergency-only — for when Circle's API is down.

## Cross-chain

```ts
// withdraw with destination chain == cross-chain transfer over CCTP
await client.withdraw("5", { chain: "arbitrum" });
```

USDC-native, no slippage, ~13 minutes.

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `insufficient funds for gas` | wallet has no native gas | top up native gas on the chain |
| `Gateway available 0` | indexer lag | wait 10–15s, retry |
| `payment verification failed: insufficient` | Gateway balance < price | deposit more |
| `authorization_validity_too_short` | server set `maxTimeoutSeconds` < ~3600s | nano server defaults to 345600s (4 days), matching Circle's spec |
| `payment expired` | signing exceeded `maxTimeoutSeconds` | re-call (auto re-signs) |
| `Unsupported buyer network` | wrong chain | nano accepts only the 10 chains listed above |

## Production tips

1. **Key management** — KMS / Vault, not raw `.env`
2. **Balance monitoring** — alert + auto-top-up when `client.getBalances()` drops below your threshold
3. **Retries** — exponential backoff on 429 / 503 from `pay()` (built into the SDK with `maxRetries`)
4. **High-frequency agents** — pace requests; one signature = one call
5. **Reconciliation** — trust `client.getBalances()` per chain over reading the chain yourself
6. **Settlement tracking** — `client.getPaymentStatus(intentId)` queries Circle's `/v1/x402/transfers/{id}` for the `Received → Batched → Confirmed → Completed` flow

---

## Reference

### Endpoints

| Path | Method | Auth | Notes |
|---|---|---|---|
| `/api/v1/chat/completions` | POST | Circle Gateway | per-model pricing |
| `/api/v1/images/generations` | POST | Circle Gateway | per-image |
| `/api/v1/images/image2image` | POST | Circle Gateway | image edit |
| `/api/v1/videos/generations` | POST | Circle Gateway | submit job |
| `/api/v1/videos/generations/:id` | GET | Circle Gateway | poll job |
| `/api/v1/audio/generations` | POST | Circle Gateway | TTS / music |
| `/api/v1/search` | POST | Circle Gateway | Grok live search |
| `/api/v1/x/users/*`, `/api/v1/x/tweets/*`, `/api/v1/x/search`, `/api/v1/x/trending`, `/api/v1/x/articles/rising` | GET/POST | Circle Gateway | AttentionVC |
| `/api/v1/price`, `/api/v1/price/history`, `/api/v1/pm/*` | GET | Circle Gateway | Pyth / Predexon |
| `/api/v1/models` | GET | free | model catalog |
| `/api/health` | GET | free | health |

### Circle GatewayWallet (escrow contract)

Same address on every chain (CREATE2 deterministic deploy):

`0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`

This is **Circle's contract**, not BlockRun's. It holds buyers' deposited USDC in escrow.

### BlockRun treasury (`payTo`)

`0xe9030014F5DAe217d0A152f02A043567b16c1aBf`

This is **BlockRun's address** that Circle's facilitator settles to during the batch. You'll see it in every 402 challenge's `accepts[i].payTo` field.

### Settlement status flow

| Status | Meaning |
|---|---|
| `Received` | Verified, queued for next batch (seller can rely on this as "accepted") |
| `Batched` | On-chain batching in progress |
| `Confirmed` | Batch tx submitted on-chain |
| `Completed` | Batch finalised → seller's Circle Gateway available balance increased |

When `Completed`, the seller's funds sit in their **Gateway available balance**. The seller mints to their wallet via `client.withdraw()` on whichever chain they want (same chain instant, cross-chain via CCTP ~13 min).

### Useful links

- npm: https://www.npmjs.com/package/@blockrun/nano-client
- GitHub: https://github.com/BlockRunAI/blockrun-nano-client
- Circle Gateway docs: https://developers.circle.com/gateway
- Underlying SDK: [`@circle-fin/x402-batching`](https://www.npmjs.com/package/@circle-fin/x402-batching)
- Sister SDK (Python, Base / Solana): [`blockrun-llm`](https://pypi.org/project/blockrun-llm/)
