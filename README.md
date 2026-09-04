# @blockrun/nano-client

> TypeScript access to BlockRun with an account API key or Circle Gateway batched USDC. Chat, streaming, image, video, music, speech, search, X and market-data routes use the same account transport.

[![npm](https://img.shields.io/npm/v/@blockrun/nano-client.svg)](https://www.npmjs.com/package/@blockrun/nano-client)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**Sister SDKs:** [`blockrun-llm`](https://pypi.org/project/blockrun-llm/) (Python, Solana / Base) · this package = mirror for Circle Gateway batched payments on multi-chain EVM.

---

## Account API quick start

[Register at BlockRun](https://user.blockrun.ai), [create an API key](https://user.blockrun.ai/dashboard/keys), and [add credits](https://user.blockrun.ai/dashboard/credits). Keep the key in your server environment; never bundle it into a browser app.

The account client below is included in this source branch; use it after the package containing this change is released, or build this checkout locally.

```ts
import { BlockRunAccountClient } from "@blockrun/nano-client";

const api = new BlockRunAccountClient({ apiKey: process.env.BLOCKRUN_API_KEY! });
const result = await api.chat({
  model: "openai/gpt-4.1-nano",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(result.data.choices[0]?.message.content);
console.log(result.billing.mode); // "account"; see the portal for charges/credits

for await (const chunk of api.chatStream({
  model: "openai/gpt-4.1-nano",
  messages: [{ role: "user", content: "Hello!" }],
})) console.log(chunk);
```

Account requests use `https://api.blockrun.ai/v1` and bearer authentication. They require no wallet, chain selection or Gateway deposit. HTTP errors expose `BlockRunAccountError.status` and `retryAfter`. Calls are not automatically replayed on 402, 429 or server errors. The default request deadline is 120 seconds (`timeoutMs` is configurable).

### Media and other services

```ts
const image = await api.images.generate({ model: "openai/gpt-image-1", prompt: "A blue square" });
const speech = await api.audio.tts({ model: "elevenlabs/flash-v2.5", input: "Hello", response_format: "mp3" });
const job = await api.videos.generate<{ poll_url: string }>({
  model: "xai/grok-imagine-video", prompt: "A cloud drifting slowly", duration_seconds: 5,
});
const video = await api.poll(job.data.poll_url);
```

Generation helpers return the server response directly. If image/music/video generation returns a `poll_url`, pass that complete URL to `api.poll()`; it preserves the signed query and only reads the existing job. A timeout does not resubmit it. `videos.status(pollUrl)` performs one status read. Account API availability still depends on the selected upstream provider and gateway configuration.

| API | Helper |
| --- | --- |
| Chat / model catalog | `chat`, `ask`, `chatStream`, `listModels` |
| Images | `images.generate`, `images.edit` |
| Video / music | `videos.generate`, `music.generate`, `poll` |
| Speech / sound effects | `audio.tts`, `audio.soundEffects` |
| Search / X | `search`, `x.call(path, params)` |
| Crypto prices / history | `price.price(symbol)`, `price.history(symbol, { from, to, resolution })` |
| Prediction markets | `price.pm("markets/search", { q: "bitcoin" })` |
| Signal / Surf | `call("/v1/surf/market/ranking")` |
| Other JSON services | `call("/v1/...", { method, body, headers })` |

`call()` accepts JSON services on the configured account origin; it is not a binary-download or general streaming transport. Media responses contain output URLs. Account billing results have `{ data, billing }`; Circle Gateway results retain `{ data, payment }`.

### Wallet access

For native x402, prefer **Solana** at [sol.blockrun.ai](https://sol.blockrun.ai), followed by **Base** at [blockrun.ai](https://blockrun.ai), using the [main TypeScript SDK](https://github.com/BlockRunAI/blockrun-llm-ts). Nano's Circle Gateway mode covers the EVM chains below. Its deposit, withdrawal and transaction tracking methods apply only to `NanoClient`.

## Supported chains

All 10 mainnet chains Circle Gateway supports today (Base excluded by design):

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

> **Base** is intentionally not in nano — buyers on Base should use [`blockrun.ai`](https://blockrun.ai) (native x402, no Gateway deposit step required).

## Install

```bash
npm install @blockrun/nano-client
# or
pnpm add @blockrun/nano-client
```

## Circle Gateway quick start

```ts
import { NanoClient } from "@blockrun/nano-client";

const client = new NanoClient({
  chain: "polygon",
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// One-time: move USDC from your wallet into Circle Gateway escrow
await client.deposit("5");                                // $5 covers ~5,000 calls @ $0.001

// From here, every call is offchain EIP-712 signature → zero gas
const r = await client.chat({
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(r.data.choices[0].message.content);
console.log(r.payment.formattedAmount);                   // "$0.001000"
```

For an even-shorter shape:

```ts
const reply = await client.ask("openai/gpt-4o-mini", "What is 2+2?");
console.log(reply);                                       // "4"
```

### Try It Free (No USDC Required)

Skip the Gateway deposit entirely — call free NVIDIA models directly:

```ts
import { NanoClient } from "@blockrun/nano-client";

const client = new NanoClient({
  chain: "polygon",
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// No deposit() call required for free models
const reply = await client.ask("nvidia/qwen3-next-80b-a3b-thinking", "Explain x402 in 1 sentence");
console.log(reply);
```

**Available free models** (input + output both $0, all NVIDIA-hosted, last refreshed 2026-04-28):

| Model ID | Context | Best For |
|----------|---------|----------|
| `nvidia/deepseek-v4-pro` | 1M | Flagship reasoning — MMLU-Pro 87.5, GPQA 90.1, SWE-bench 80.6, LiveCodeBench 93.5 |
| `nvidia/deepseek-v4-flash` | 1M | ~5× faster than V4 Pro — chat, summarization, light reasoning (weaker factual recall) |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | 256K | Only vision-capable free model — text + images + video (≤2 min) + audio (≤1 hr) |
| `nvidia/qwen3-next-80b-a3b-thinking` | 131K | 116 tok/s reasoning with thinking mode |
| `nvidia/mistral-small-4-119b` | 131K | 114 tok/s — fastest free chat |
| `nvidia/glm-4.7` | 131K | 237 tok/s — GLM-4.7 with thinking mode |
| `nvidia/llama-4-maverick` | 131K | Meta Llama 4 Maverick MoE |
| `nvidia/qwen3-coder-480b` | 131K | Coding-optimised 480B MoE |
| `nvidia/deepseek-v3.2` | 131K | Legacy V3.2 — auto-upgrades to V4 Pro via fallback |

> Note: `nvidia/gpt-oss-120b` and `nvidia/gpt-oss-20b` were retired 2026-04-28 — NVIDIA's free build.nvidia.com tier reserves the right to use prompts/outputs for service improvement, which conflicts with our data-privacy policy.

---

## Configuration

```ts
const client = new NanoClient({
  privateKey: "0x...",                                    // required (Hex)
  chain: "polygon",                                       // required
  baseUrl: "https://nano.blockrun.ai",                    // default
  rpcUrl: "https://polygon-mainnet.g.alchemy.com/v2/KEY", // optional override
  maxRetries: 2,                                          // default
});
```

If `rpcUrl` is omitted, the SDK uses a vetted public RPC per chain from
`RECOMMENDED_RPC_URLS` (Polygon → 1rpc.io, Arb/Op → llamarpc, Unichain →
drpc). Override for production.

The default `baseUrl` is `https://nano.blockrun.ai`. A `NANO_MAINNET_DIRECT_URL`
constant is also exported for fallback during DNS / CDN incidents.

---

## Chat

### OpenAI-compatible chat

```ts
const r = await client.chat({
  model: "anthropic/claude-haiku-4.5",
  messages: [
    { role: "system", content: "You answer in one sentence." },
    { role: "user", content: "Explain MEV." },
  ],
  max_tokens: 200,
});
```

### Simple `ask(model, prompt)`

```ts
const reply = await client.ask("openai/gpt-4o-mini", "List 3 EVM rollups");
```

### Smart routing (ClawRouter)

Let nano pick the cheapest capable model based on a 14-dimension classifier:

```ts
const r = await client.smartChat({ prompt: "What is 2+2?" });
console.log(r.data.model);                                // "moonshot/kimi-k2.5"

const hard = await client.smartChat({
  prompt: "Prove the Riemann hypothesis step by step",
  routing_profile: "premium",
});
console.log(hard.data.model);                             // "openai/gpt-5.4"
```

| `routing_profile` | Behaviour |
|---|---|
| `"free"` | NVIDIA free-tier models only (zero cost) |
| `"eco"` | Cheapest capable model per tier (DeepSeek, NVIDIA) |
| `"auto"` *(default)* | Best balance of cost / quality |
| `"premium"` | Top-tier (OpenAI, Anthropic) |

---

## Image generation

```ts
const r = await client.images.generate({
  model: "openai/dall-e-3",
  prompt: "A cat coding TypeScript at sunset, isometric voxel art",
  size: "1024x1024",
});
console.log(r.data);                                      // OpenAI-compatible response
```

Image-to-image edit:

```ts
const r = await client.images.edit({
  model: "google/nano-banana",
  prompt: "Make the sky purple",
  image: "data:image/png;base64,…",
});
```

---

## Video & music

```ts
const job = await client.videos.generate({
  model: "minimax/video-01",
  prompt: "A red apple slowly rotating on a wooden table",
  duration: 6,
});
const status = await client.videos.status(job.data.id);   // poll until ready

const m = await client.music.generate({
  prompt: "Lo-fi hip hop, soft piano, rainy night",
  duration: 30,
});
```

---

## Search

```ts
const r = await client.search({ query: "latest Solana TVL changes this week" });
```

---

## X / Twitter intelligence

Powered by AttentionVC. All methods return `{ data, payment }` — typed
generic so you can pass your own response shape.

```ts
const profile = await client.x.userInfo("vitalikbuterin");
const followers = await client.x.followers("vitalikbuterin", { cursor: "..." });
const search = await client.x.search("blockrun OR x402", { query_type: "Latest" });
const trending = await client.x.trending();
const tweet = await client.x.tweetLookup("1234567890123456789");
const thread = await client.x.tweetThread("1234567890123456789");
const mentions = await client.x.userMentions("vitalikbuterin");
const articles = await client.x.articlesRising();
```

Full method list:

| Method | Notes |
|---|---|
| `client.x.userLookup(usernames)` | Profile lookup, single or batch |
| `client.x.userInfo(username)` | Single profile + intel layer |
| `client.x.followers(username, {cursor?})` | $0.05/page (~200 accounts) |
| `client.x.followings(username, {cursor?})` | |
| `client.x.verifiedFollowers(username, {cursor?})` | |
| `client.x.userTweets(username, {cursor?, limit?})` | |
| `client.x.userMentions(username, {cursor?, limit?})` | |
| `client.x.tweetLookup(tweetIds)` | Single or batch |
| `client.x.tweetReplies(tweetId, {cursor?})` | |
| `client.x.tweetThread(tweetId, {cursor?})` | |
| `client.x.search(query, {query_type?, cursor?})` | $0.032/page |
| `client.x.trending()` | |
| `client.x.articlesRising()` | |

---

## Pyth-backed price + Predexon markets

```ts
const px = await client.price.price("BTC/USD");
const hist = await client.price.history("ETH/USD", { range: "7d", resolution: "1h" });
const market = await client.price.pm("polymarket", { id: "..." });
```

---

## Wallet & Gateway management

```ts
client.address;                                            // 0x... derived from privateKey
await client.getBalances();                                // wallet + Gateway, on configured chain
await client.deposit("5");                                 // wallet → Circle Gateway escrow
await client.withdraw("2");                                // Gateway → wallet (instant, same chain)
await client.withdraw("2", { chain: "base" });             // Cross-chain via CCTP (~13 min)
```

### Where do my paid funds end up? (seller-side)

When a payment intent reaches `Completed`, funds land in the **seller's
Circle Gateway available balance** — not directly in their wallet. The
seller mints to their wallet on whichever chain they want.

Query a seller's Gateway balance — read-only, no private key:

```ts
import { querySellerGatewayBalance } from "@blockrun/nano-client";

const b = await querySellerGatewayBalance(
  "0xe9030014F5DAe217d0A152f02A043567b16c1aBf",            // seller payTo
  "polygon",
);
console.log(b.available);                                  // "0.057000"
```

To mint to wallet (seller-side, requires seller's private key):

```ts
const seller = new NanoClient({ chain: "polygon", privateKey: SELLER_KEY });
await seller.withdraw("5");                                // → wallet on Polygon
await seller.withdraw("5", { chain: "base" });             // → wallet on Base via CCTP
```

---

## Payment intent tracking

Every paid call returns `payment.transaction` — Circle's nanopayment intent UUID.

```ts
const r = await client.chat({ ... });
const status = await client.getPaymentStatus(r.payment.transaction);
// → { status: "settled", settledAt: "2026-04-27T23:06:08.267Z" }

// Or block until terminal state:
const final = await client.waitForSettlement(r.payment.transaction, {
  timeoutMs: 5 * 60_000,
  pollIntervalMs: 10_000,
});
```

Status flow (per Circle's docs):

| Status | Meaning |
|---|---|
| `Received` | Verified, queued for next batch |
| `Batched` | On-chain batching in progress |
| `Confirmed` | Batch tx submitted on-chain |
| `Completed` | Batch finalised → seller's Circle Gateway balance increased |

---

## Spending tracker

Every paid call increments an in-process counter:

```ts
const s = client.getSpending();
console.log(`Spent $${s.total_usd.toFixed(4)} across ${s.calls} calls`);
console.log(s.by_endpoint);                               // { "/v1/chat": {...}, "/v1/x/users": {...} }

client.resetSpending();                                   // reset for the next session
```

---

## Generic raw call

For endpoints not covered by typed helpers:

```ts
const r = await client.call("/api/v1/audio/generations", {
  method: "POST",
  body: { model: "openai/tts-1", voice: "alloy", input: "Hello" },
});
```

---

## End-to-end example

```bash
git clone https://github.com/BlockRunAI/blockrun-nano-client
cd blockrun-nano-client
pnpm install

# 1) Generate fresh test wallet
pnpm exec tsx examples/print-address.ts
# → prints CLIENT_PRIVATE_KEY=0x... and address

# 2) Fund that address on Polygon: 0.5 USDC + 0.05 POL

# 3) Run e2e
CLIENT_PRIVATE_KEY=0x... pnpm exec tsx examples/e2e-test.ts
```

---

## How it works

1. Buyer deposits USDC once into Circle's `GatewayWallet` contract on chosen chain
2. Every API call returns `402 Payment Required` with a multi-chain `accepts` array
3. SDK signs an EIP-712 `TransferWithAuthorization` against `GatewayWallet`
4. Server forwards to Circle's facilitator → Circle queues for batch
5. Circle batches every ~15 min on Polygon; pushes USDC into seller's Gateway balance
6. Seller `withdraw()`s to wallet (instant, any Gateway-supported chain)

**Your private key never leaves your machine.** The SDK signs locally, only the signature is sent.

---

## Production tips

- **Key management** — KMS / Vault, not raw `.env`
- **RPC** — provide your own Alchemy / QuickNode key for production traffic
- **Balance monitoring** — `await client.getBalances()` and alert when `gateway.available` drops below your threshold
- **Retries** — built-in `maxRetries: 2` with exponential backoff handles transient 5xx; bump for high-volume agents
- **Reconciliation** — trust `client.getBalances()` per chain over reading the chain yourself

## Documentation

- **Full docs**: https://blockrun.ai/docs
- **Gateways & networks** (incl. the nano / Circle Gateway gateway): https://blockrun.ai/docs/x402/endpoints
- **All BlockRun SDKs & APIs**: https://blockrun.ai/docs

## Links

- **Buyer guide (CN + EN)**: [`BUYER-GUIDE.md`](./BUYER-GUIDE.md)
- **Server source**: [`BlockRunAI/blockrun-nano`](https://github.com/BlockRunAI/blockrun-nano)
- **Underlying SDK**: [`@circle-fin/x402-batching`](https://www.npmjs.com/package/@circle-fin/x402-batching) (Circle)
- **Circle Gateway docs**: https://developers.circle.com/gateway
- **Sister SDK (Python / Base / Solana)**: [`blockrun-llm`](https://pypi.org/project/blockrun-llm/)

## License

Apache-2.0
