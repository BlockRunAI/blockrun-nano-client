# @blockrun/nano-client

> Pay-per-call AI API for agents, paid in USDC through **Circle Gateway** — deposit once on any of 11 EVM chains (Arc included, where USDC is the gas), then pay for every model call with an off-chain signature. No API key, no gas per call. Also works with a BlockRun account API key. Chat, streaming, image, video, music, speech, search, X and market-data routes on one OpenAI-compatible transport.
>
> **Start here:** [30-second quickstart](https://nano.blockrun.ai/get-started) · [How Circle Gateway pays for AI calls](https://nano.blockrun.ai/x402/circle-gateway) · [Paying from USDC on Arc](https://nano.blockrun.ai/x402/arc)

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

All 11 mainnet chains Circle Gateway supports today (Base excluded by design). The live list is the `networks` array in [`/.well-known/x402`](https://nano.blockrun.ai/.well-known/x402) — a chain appears there the moment Circle's facilitator lists it:

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
| Arc | `arc` | 5042 | **USDC** — no second token needed |

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
  maxPaymentPerCall: "0.50",                              // refuse to sign any single quote above $0.50
});

// One-time: move USDC from your wallet into Circle Gateway escrow
await client.deposit("5");

// From here, every call is an off-chain EIP-712 signature → zero gas
const r = await client.chat({
  model: "openai/gpt-5.6-luna",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(r.data.choices[0].message.content);
console.log(r.payment.formattedAmount);                   // e.g. "0.000412" (USDC)
```

For an even-shorter shape:

```ts
const reply = await client.ask("openai/gpt-5.6-luna", "What is 2+2?");
console.log(reply);                                       // "4"
```

### Try it free (no USDC required)

Free models answer without a 402, so no deposit and no signature are needed:

```ts
const client = new NanoClient({ chain: "polygon", privateKey: process.env.PRIVATE_KEY as `0x${string}` });
const reply = await client.ask("nvidia/nemotron-3-super-120b", "Explain x402 in 1 sentence");
```

**Free models** (input + output both $0, NVIDIA-hosted; live list: `client.listModels()`, `billing_mode: "free"`; last checked 2026-10-09):

| Model ID | Context | Best for |
|----------|---------|----------|
| `nvidia/nemotron-3-super-120b` | 131K | Reasoning + coding, the strongest free model |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | 256K | Vision-capable reasoning (text + images) |
| `nvidia/llama-3.2-11b-vision` | 128K | Lightweight vision chat |
| `nvidia/gpt-oss-20b` | 128K | Fast general chat + coding |

---

## Configuration

```ts
const client = new NanoClient({
  privateKey: "0x...",                                    // required (Hex)
  chain: "polygon",                                       // required
  baseUrl: "https://nano.blockrun.ai",                    // default
  rpcUrl: "https://polygon-mainnet.g.alchemy.com/v2/KEY", // optional override
  maxPaymentPerCall: "0.50",                              // optional per-call signing cap (USDC); default: no cap
  timeoutMs: 300_000,                                     // default; music calls take 30-120s
  maxRetries: 2,                                          // default; unpaid quote request only
});
```

If `rpcUrl` is omitted, the SDK uses a vetted public RPC per chain from
`RECOMMENDED_RPC_URLS`. Override for production.

The default `baseUrl` is `https://nano.blockrun.ai`. A `NANO_MAINNET_DIRECT_URL`
constant is also exported for fallback during DNS / CDN incidents.

### Payment safety

Every paid call is two requests: an unpaid request that returns a `402` quote, then the same request with a signed authorization. The SDK checks the quote **before signing**:

- the option is for your `chain` and names Circle's real `GatewayWallet` contract,
- `payTo` is a valid non-zero address and `amount` is a non-negative integer,
- `amount` is at or below `maxPaymentPerCall` (when set).

A failed check throws `NanoPaymentRejectedError` and nothing is signed. Transient failures of the **unpaid** request are retried (`maxRetries`). The **signed** request is never retried, so a dropped connection cannot double-charge you.

Custom spend policy: register Circle lifecycle hooks on `client.paymentScheme`; they run before every NanoClient signature.

```ts
client.paymentScheme.onBeforePaymentCreation(async ({ selectedRequirements }) =>
  BigInt(selectedRequirements.amount) > dailyBudgetLeft ? { abort: true, reason: "daily budget" } : undefined);
```

`client.gateway` is Circle's `GatewayClient`, for balances, deposits and withdrawals. Don't call `client.gateway.pay()` for nano requests: it bypasses these checks.

### Errors

```ts
import { NanoRequestError, NanoPaymentRejectedError } from "@blockrun/nano-client";

try {
  await client.chat({ model: "openai/gpt-5.6-luna", messages });
} catch (err) {
  if (err instanceof NanoPaymentRejectedError) { /* quote refused, nothing signed */ }
  if (err instanceof NanoRequestError) {
    err.status;          // HTTP status (0 = network failure)
    err.body;            // server response body
    err.paymentSigned;   // true → an authorization was sent; it may still settle. Check before retrying.
  }
}
```

---

## Chat

### OpenAI-compatible chat

```ts
const r = await client.chat({
  model: "anthropic/claude-sonnet-4.6",
  messages: [
    { role: "system", content: "You answer in one sentence." },
    { role: "user", content: "Explain MEV." },
  ],
  max_tokens: 200,
});
```

### Vision

```ts
const r = await client.chat({
  model: "google/gemini-3.8-flash",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What is in this image?" },
      { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
    ],
  }],
});
```

### Simple `ask(model, prompt)`

```ts
const reply = await client.ask("qwen/qwen3.8-flash", "List 3 EVM rollups");
```

### Featured models

89 models are live; `client.listModels()` returns the full catalog with pricing. Prices are USD per 1M tokens (input / output), last checked 2026-10-09.

| Model | Price | Notes |
|---|---|---|
| `openai/gpt-6-astra` | $10 / $50 | OpenAI flagship, 1M context |
| `openai/gpt-5.6-sol` · `-terra` · `-luna` | $2 / $10 · $2 / $12 · $0.2 / $1.2 | GPT-5.6 family; `-pro` variants available |
| `anthropic/claude-opus-4.8` | $5 / $25 | Anthropic flagship, 1M context |
| `anthropic/claude-sonnet-4.6` | $3 / $15 | |
| `google/gemini-3.8-flash` | $0.75 / $3.75 | Vision, 1M context |
| `google/gemini-3.1-pro` | $2 / $12 | |
| `xai/grok-4.6` | $2 / $6 | Built-in search |
| `moonshot/kimi-k3` | $3 / $15 | |
| `zai/glm-5.3` · `zai/glm-5.3-flash` | $1.4 / $4.4 · $0.15 / $0.5 | |
| `deepseek/deepseek-v4-pro` | $0.957 / $1.914 | |
| `minimax/minimax-m3` | $0.3 / $1.2 | 1M context |
| `qwen/qwen3.8-flash` · `qwen/qwen3.7-max` | $0.15 / $0.47 · $1.475 / $4.425 | |
| `xiaomi/mimo-v2.5-pro` · `tencent/hy3` | $0.435 / $0.87 · $0.132 / $0.528 | |

---

## Image generation

```ts
const r = await client.images.generate({
  model: "openai/gpt-image-2",                            // also: google/nano-banana(-pro), xai/grok-imagine-image(-pro), zai/cogview-4
  prompt: "A cat coding TypeScript at sunset, isometric voxel art",
  size: "1024x1024",
});
console.log(r.data);                                      // OpenAI-compatible response
```

Fast models return the image directly. Slow models answer HTTP 202 with a job; poll it like a video (charged only on completion):

```ts
import { isNanoAsyncJob } from "@blockrun/nano-client";

const r = await client.images.generate({ model: "google/nano-banana-pro", prompt: "…" });
const result = isNanoAsyncJob(r.data) ? (await client.images.wait(r.data)).data : r.data;
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

## Video

Video is an async job. `generate()` signs the payment but nothing is charged yet; the charge settles on the first poll that finds the job `completed`. If upstream fails, you pay nothing.

```ts
const { data: job } = await client.videos.generate({
  model: "xai/grok-imagine-video",                        // also: bytedance/seedance-2.0(-fast), bytedance/seedance-1.5-pro, azure/sora-2
  prompt: "A red apple slowly rotating on a wooden table",
  duration_seconds: 6,                                    // billed per second; omit for the model default
});
const done = await client.videos.wait(job);               // polls every 5s, throws if upstream failed
console.log(done.data.url, done.payment.formattedAmount);
```

Keep the `job` object until it completes. Polling replays the authorization signed at submit time (`job.paymentHeader`). If `wait()` times out, call it again with the same job; resubmitting would sign a second payment. `videos.status(job)` does a single poll. The submit receipt shows `amount: 0n`; the settling poll's receipt carries the charge, and later polls of the same finished job show `0n` again.

## Music

One synchronous call of 30-120s; the track is in the response.

```ts
const m = await client.music.generate({
  model: "minimax/music-2.5+",
  prompt: "Lo-fi hip hop, soft piano, rainy night",
  instrumental: true,
});
```

## Speech & sound effects

```ts
const tts = await client.audio.speech({                   // alias: audio.tts
  model: "elevenlabs/flash-v2.5",                         // also: turbo-v2.5, multilingual-v2, v3
  input: "Hello from nano",
  voice: "sarah",
  response_format: "mp3",
});
const sfx = await client.audio.soundEffects({ model: "elevenlabs/sound-effects", text: "Glass shattering", duration_seconds: 3 });
```

---

## Search

```ts
const r = await client.search({ query: "latest Solana TVL changes this week", sources: ["web", "news"] });
```

---

## Prediction markets (Predexon)

```ts
const markets = await client.pm("polymarket/markets", { limit: 5 });
const found = await client.pm("markets/search", { q: "election" });  // Polymarket, Kalshi, Limitless, Opinion, Predict.Fun
```

X / Twitter and Pyth price routes are not served by nano; use `BlockRunAccountClient` (`x.call()`, `price.price()`) for those.

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

Every paid call returns `payment.transaction`: Circle's transfer UUID (not an on-chain hash). It is empty for free calls.

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

Every settled paid call increments an in-process counter (video jobs count when they complete):

```ts
const s = client.getSpending();
console.log(`Spent $${s.total_usd.toFixed(4)} across ${s.calls} calls`);
console.log(s.by_endpoint);                               // { "/chat/completions": {...}, "/videos/generations": {...} }

client.resetSpending();                                   // reset for the next session
```

---

## Generic raw call

For endpoints without a typed helper (Exa, DefiLlama, 0x, phone, Modal, RPC; full list in [`/api/openapi`](https://nano.blockrun.ai/api/openapi)):

```ts
const r = await client.call("/api/v1/exa/search", {
  method: "POST",
  body: { query: "x402 micropayments", numResults: 5 },
});
```

The same payment-safety checks apply.

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
5. Circle settles in periodic batches and credits the seller's Gateway balance
6. Seller `withdraw()`s to wallet (instant, any Gateway-supported chain)

**Your private key never leaves your machine.** The SDK signs locally, only the signature is sent.

---

## Production tips

- **Key management** — KMS / Vault, not raw `.env`
- **RPC** — provide your own Alchemy / QuickNode key for production traffic
- **Balance monitoring** — `await client.getBalances()` and alert when `gateway.available` drops below your threshold
- **Spending cap** — set `maxPaymentPerCall` so a bad quote or misconfigured `baseUrl` cannot drain your Gateway balance
- **Retries** — `maxRetries: 2` retries the unpaid quote request only; on `NanoRequestError.paymentSigned === true`, check `getPaymentStatus()` before retrying by hand
- **Reconciliation** — trust `client.getBalances()` per chain over reading the chain yourself

## Documentation

- **Quickstart (deposit once, then call)**: https://nano.blockrun.ai/get-started
- **Circle Gateway for AI agents — how a call is paid**: https://nano.blockrun.ai/x402/circle-gateway
- **Paying from USDC on Arc**: https://nano.blockrun.ai/x402/arc
- **Agent-readable surface**: [`llms.txt`](https://nano.blockrun.ai/llms.txt) · [`openapi.json`](https://nano.blockrun.ai/openapi.json) · [`/.well-known/x402`](https://nano.blockrun.ai/.well-known/x402)
- **Full docs**: https://blockrun.ai/docs
- **Gateways & networks** (incl. the nano / Circle Gateway gateway): https://blockrun.ai/docs/x402/endpoints
- **All BlockRun SDKs & APIs**: https://blockrun.ai/docs

## Links

- **Buyer guide**: [`BUYER-GUIDE.md`](./BUYER-GUIDE.md)
- **Server source**: [`BlockRunAI/blockrun-nano`](https://github.com/BlockRunAI/blockrun-nano)
- **Underlying SDK**: [`@circle-fin/x402-batching`](https://www.npmjs.com/package/@circle-fin/x402-batching) (Circle)
- **Circle Gateway docs**: https://developers.circle.com/gateway
- **Sister SDK (Python / Base / Solana)**: [`blockrun-llm`](https://pypi.org/project/blockrun-llm/)

## Migrating from 0.7

- `smartChat()` removed (nano has no smart routing; pick a model, see [Featured models](#featured-models)).
- `client.x.*` and `client.price.price/history` removed (not served by nano). `client.price.pm(...)` → `client.pm(...)`.
- `audio.tts()` now calls `/api/v1/audio/speech` (it previously hit the music endpoint); `audio.generate()` removed.
- `videos.generate()` returns a job; poll it with `videos.wait(job)` / `videos.status(job)` (not an id string).
- `duration` → `duration_seconds` for video and music (the old name is still mapped). Before 0.8 it was silently ignored and billed at the model default.
- Errors are now `NanoRequestError` / `NanoPaymentRejectedError` with the server's message.

## License

Apache-2.0 — see [LICENSE](LICENSE).
