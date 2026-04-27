# BlockRun Nano — Buyer Guide / 用户指南

Pay BlockRun's full AI model catalog with **gas-free batched USDC** via Circle Gateway, on Polygon, Arbitrum, Optimism, or Unichain mainnet.

通过 Circle Gateway 在 Polygon / Arbitrum / Optimism / Unichain 主网用 **零 gas 批量 USDC** 付费调用 BlockRun 全套 AI 模型 API。

**Endpoint** (mainnet): `https://nano.blockrun.ai`
**Cloud Run direct** (until DNS): `https://blockrun-nano-1092497648280.us-central1.run.app`

- [中文 →](#中文版)
- [English →](#english)

---

## 中文版

### 它是什么

BlockRun Nano 是 [blockrun.ai](https://blockrun.ai) 的多链入口——同样的 OpenAI-compatible 模型目录（GPT、Claude、Gemini、Grok、DeepSeek...）和价格，但支付走 Circle Gateway 批量结算：

- **deposit 一次** → 之后每次 API 调用都是**离线签名零 gas**
- 4 条 mainnet 链任选（Polygon / Arbitrum / Optimism / Unichain）
- 收款汇总到 BlockRun 同一个 EVM treasury

### 30 秒上手

```bash
npm install @circle-fin/x402-batching viem
```

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// 1. 准备钱包（生产环境从 env 读已有私钥）
const privateKey = generatePrivateKey();
console.log("address:", privateKeyToAccount(privateKey).address);
//  ↑ 把 5 USDC + 0.1 MATIC 转到这个地址（任意 onramp）

// 2. 一次性 deposit 到 Circle Gateway
const gateway = new GatewayClient({ chain: "polygon", privateKey });
await gateway.deposit("5");                     // $5 USDC

// 3. 调 API（无限次零 gas）
const r = await gateway.pay("https://nano.blockrun.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "openai/gpt-4o-mini",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
console.log(r.data);            // OpenAI 格式回复
console.log(r.formattedAmount); // "$0.001000"
```

### 准备工作

| 项 | 要求 |
|---|---|
| EVM 钱包 | 生成 / MetaMask / Rabby / Coinbase / Privy 等任意自托管 |
| USDC（任一链） | 想充多少充多少；建议 5–20 USDC 起，覆盖几千次调用 |
| 该链 native gas | Polygon ≈ 0.1 MATIC（≈ $0.05）、Arbitrum/Optimism/Unichain ≈ 0.001 ETH |

**Onramp 渠道**（USDC 到目标链）：

| 渠道 | Polygon | Arbitrum | Optimism | Unichain |
|---|---|---|---|---|
| Coinbase 交易所提币 | ✓ | ✓ | ✓ | ✗ |
| Coinbase Onramp / MoonPay / Stripe Crypto | ✓ | ✓ | ✓ | ✗ |
| Binance / Bybit / Kraken 提币 | ✓ | ✓ | ✓ | ✗ |
| 跨链桥（Across / Stargate / Jumper） | ✓ | ✓ | ✓ | ✓ |
| Circle CCTP（USDC 原生跨链） | ✓ | ✓ | ✓ | ✓ |

> 💡 **Day-1 主战场是 Polygon**——onramp 渠道最多、gas 最便宜。Unichain 目前 onramp 少，建议从其他链 deposit 后用 `gateway.withdraw({ chain: 'unichain' })` 即时跨过去。

### 把 USDC 存进 Circle Gateway（详细）

`gateway.deposit()` 内部分两笔链上交易（第二次起只剩一笔）：

```
[第 1 笔，仅首次] USDC.approve(GatewayWallet, MAX_UINT)
[第 2 笔，每次 ] GatewayWallet.deposit(USDC, amount)
```

代码：

```ts
const gateway = new GatewayClient({ chain: "polygon", privateKey });

const before = await gateway.getBalances();
console.log("钱包 USDC :", before.wallet.formatted);            // "$5.000000"
console.log("Gateway   :", before.gateway.formattedAvailable); // "$0.000000"

const result = await gateway.deposit("5");
console.log("approve tx:", result.approvalTxHash);  // 仅首次有
console.log("deposit tx:", result.depositTxHash);

// Circle indexer ~10s 异步入账
await new Promise(r => setTimeout(r, 10_000));

const after = await gateway.getBalances();
console.log("Gateway   :", after.gateway.formattedAvailable); // "$5.000000"
```

**注意：**
- ~10 秒索引延迟。立刻 `gateway.pay()` 可能报"余额 0"，等等再试。
- 同一个钱包地址在每条链都需要分别 deposit；或者一条链 deposit 后用 `withdraw({ chain })` 移动（走 CCTP）。
- 已经 approve MAX_UINT 之后，该钱包该链 deposit 永远不再 approve。

### 调 API（每次零 gas）

`gateway.pay(url, init)` 自动做 4 件事：

1. 第一次访问拿 402 challenge
2. 选你 Gateway 余额所在的链
3. EIP-712 签个 TransferWithAuthorization（**离线**，零 gas）
4. 重发请求带 `Payment-Signature` header

收到响应后还会自动调 Circle facilitator 入批次队列。**实际链上结算由 Circle 每小时整点批量执行**——你的 Gateway 余额会在 1 小时内反映扣款；卖家钱包余额也是 1 小时内增加。

```ts
const r = await gateway.pay(url, init);
r.data;             // 真实业务响应（OpenAI compatible / image / search ...）
r.formattedAmount;  // "$0.001000"
r.transaction;      // batch ID（不是 tx hash；下次 batch 上链后可在区块浏览器查到对应 tx）
r.network;          // "eip155:137" 等
```

### 取出来（withdraw）

**正常 withdraw 是即时的，不需要等待。** 同链直接打回 wallet，跨链走 CCTP（~13 分钟）。

```ts
// 取回到当前链同钱包
await gateway.withdraw("2");

// 直接跨到 base mainnet（CCTP 走 USDC 原生通道，~13 分钟到账）
await gateway.withdraw("2", { chain: "base" });

// 看看进度
const b = await gateway.getBalances();
console.log("withdrawing:", b.gateway.formattedWithdrawing);  // "0.00" 表示已完成
console.log("withdrawable:", b.gateway.formattedWithdrawable);
```

> ⚠️ SDK 还有一组 `initiateTrustlessWithdrawal()` / `completeTrustlessWithdrawal()`，**7 天延迟**。仅在 Circle 服务整体不可用时使用，正常情况下不要碰。

### 跨链

```ts
// 同上：withdraw 到不同链 = 跨链转账
await gateway.withdraw("5", { chain: "arbitrum" });
```

底层走 Circle CCTP，无滑点、~13 分钟到账。

### 常见错误

| 错误信息 | 原因 | 修法 |
|---|---|---|
| `insufficient funds for gas` | 钱包没 native gas | 给钱包打一点 MATIC/ETH |
| `Gateway available 0` | indexer 延迟 | 等 10–15 秒重试 |
| `payment verification failed: insufficient` | 当前 Gateway 余额 < API price | 再 deposit 一些 |
| `payment expired` | 距离签名过了 maxTimeoutSeconds（300s 默认） | 重发请求会自动重新签名 |
| `Unsupported buyer network` | 调到了 nano 不接受的链 | nano 当前只接 polygon / arbitrum / optimism / unichain |

### 生产环境建议

1. **私钥用 KMS / Vault** 管理，别裸放 .env
2. **monitor `gateway.getBalances()`**，余额低于阈值（比如 $1）告警 + 自动 top-up
3. **加 retry**：`gateway.pay()` 偶发 429/503 时按指数退避重试
4. **批量场景**：单签名一次调一次。如果你的 agent 每秒上百次，错峰调用避免 facilitator 限流
5. **跨链对账**：用 `gateway.getBalances()` per chain 而非自己读链——Circle 后端权威

---

## English

### What it is

BlockRun Nano is the multi-chain entry point to [blockrun.ai](https://blockrun.ai)'s OpenAI-compatible model catalog (GPT, Claude, Gemini, Grok, DeepSeek...) — same models, same pricing, but payments settle through **Circle Gateway** batched USDC:

- **Deposit once** → every API call after is **offchain-signed, zero-gas**
- Pay from any of 4 mainnet chains (Polygon / Arbitrum / Optimism / Unichain)
- Funds consolidate into BlockRun's single EVM treasury

### 30-second quickstart

```bash
npm install @circle-fin/x402-batching viem
```

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// 1. Wallet (in production, load from env / KMS)
const privateKey = generatePrivateKey();
console.log("address:", privateKeyToAccount(privateKey).address);
//  ↑ Send $5 USDC + 0.1 MATIC to this address (any onramp)

// 2. One-time deposit into Circle Gateway
const gateway = new GatewayClient({ chain: "polygon", privateKey });
await gateway.deposit("5");                     // $5 USDC

// 3. Call APIs (unlimited, gas-free)
const r = await gateway.pay("https://nano.blockrun.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "openai/gpt-4o-mini",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
console.log(r.data);            // OpenAI-format response
console.log(r.formattedAmount); // "$0.001000"
```

### Prerequisites

| Item | Requirement |
|---|---|
| EVM wallet | self-custodial (generate / MetaMask / Rabby / Coinbase / Privy / etc.) |
| USDC (any of the 4 chains) | 5–20 USDC covers thousands of calls |
| Native gas on that chain | Polygon ≈ 0.1 MATIC (≈ $0.05); Arb/Op/Unichain ≈ 0.001 ETH |

**Onramp routes** (USDC to target chain):

| Source | Polygon | Arbitrum | Optimism | Unichain |
|---|---|---|---|---|
| Coinbase exchange withdrawal | ✓ | ✓ | ✓ | ✗ |
| Coinbase Onramp / MoonPay / Stripe Crypto | ✓ | ✓ | ✓ | ✗ |
| Binance / Bybit / Kraken withdrawal | ✓ | ✓ | ✓ | ✗ |
| Bridges (Across / Stargate / Jumper) | ✓ | ✓ | ✓ | ✓ |
| Circle CCTP (USDC-native) | ✓ | ✓ | ✓ | ✓ |

> 💡 **Polygon is the day-1 sweet spot** — most onramps, cheapest gas. Unichain has thin onramp coverage; deposit on another chain and use `gateway.withdraw({ chain: 'unichain' })` to bridge instantly.

### Depositing USDC into Circle Gateway (detail)

`gateway.deposit()` issues up to two onchain transactions (one after first call):

```
[Tx 1, first time only] USDC.approve(GatewayWallet, MAX_UINT)
[Tx 2, every deposit  ] GatewayWallet.deposit(USDC, amount)
```

```ts
const gateway = new GatewayClient({ chain: "polygon", privateKey });

const before = await gateway.getBalances();
console.log("Wallet USDC:", before.wallet.formatted);
console.log("Gateway   :", before.gateway.formattedAvailable);

const result = await gateway.deposit("5");
console.log("approve tx:", result.approvalTxHash);  // only on first deposit
console.log("deposit tx:", result.depositTxHash);

await new Promise(r => setTimeout(r, 10_000));   // Circle indexer ~10s

const after = await gateway.getBalances();
console.log("Gateway   :", after.gateway.formattedAvailable);
```

**Notes:**
- ~10s indexer lag. Calling `gateway.pay()` immediately can report "balance 0"; retry shortly.
- Each chain has its own balance; deposit on each, or deposit once and `withdraw({ chain })` (CCTP) to move.
- Once MAX_UINT approve is set, future deposits on that chain need only one tx.

### Calling APIs (zero gas per call)

`gateway.pay(url, init)` does four things:

1. First request triggers the 402 challenge
2. Picks the chain where your Gateway balance lives
3. Signs an EIP-712 TransferWithAuthorization **offchain** (zero gas)
4. Resends with `Payment-Signature` header

Server enqueues with Circle facilitator. **Onchain settlement happens hourly** in batches — your Gateway balance reflects the debit within an hour; the seller's wallet credits within the same hour.

```ts
const r = await gateway.pay(url, init);
r.data;             // actual API response (OpenAI / image / search / ...)
r.formattedAmount;  // "$0.001000"
r.transaction;      // batch ID (not a tx hash; resolves to onchain tx after next batch)
r.network;          // "eip155:137" etc.
```

### Withdrawing

**Normal withdraws are instant.** Same chain → directly to wallet; cross-chain → via CCTP (~13 min).

```ts
// Back to wallet on the same chain
await gateway.withdraw("2");

// Or move to a different chain (CCTP, ~13 min)
await gateway.withdraw("2", { chain: "base" });

const b = await gateway.getBalances();
console.log("withdrawing:", b.gateway.formattedWithdrawing);
console.log("withdrawable:", b.gateway.formattedWithdrawable);
```

> ⚠️ The SDK also exposes `initiateTrustlessWithdrawal()` / `completeTrustlessWithdrawal()` with a **7-day delay**. Emergency-only — for when Circle's API is down. Don't use under normal conditions.

### Cross-chain

```ts
// withdraw with destination chain == cross-chain transfer over CCTP
await gateway.withdraw("5", { chain: "arbitrum" });
```

USDC-native, no slippage, ~13 minutes.

### Common errors

| Error | Cause | Fix |
|---|---|---|
| `insufficient funds for gas` | wallet has no native gas | top up MATIC/ETH |
| `Gateway available 0` | indexer lag | wait 10–15s, retry |
| `payment verification failed: insufficient` | Gateway balance < price | deposit more |
| `payment expired` | signing exceeded `maxTimeoutSeconds` (300s default) | re-call `pay()` (auto re-signs) |
| `Unsupported buyer network` | wrong chain | nano accepts only `polygon`, `arbitrum`, `optimism`, `unichain` |

### Production tips

1. **Key management** — KMS / Vault, not raw `.env`
2. **Balance monitoring** — alert + auto-top-up when `gateway.getBalances()` drops below your threshold
3. **Retries** — exponential backoff on 429 / 503 from `pay()`
4. **High-frequency agents** — pace requests to avoid facilitator rate limits; one signature = one call
5. **Reconciliation** — trust `gateway.getBalances()` per chain over reading the chain yourself

---

## Reference

### Endpoints

| Path | Method | Auth | Pricing |
|---|---|---|---|
| `/api/v1/chat/completions` | POST | Circle Gateway | per-model (see /api/v1/models) |
| `/api/v1/images/generations` | POST | Circle Gateway | per-image |
| `/api/v1/search` | POST | Circle Gateway | per-query |
| `/api/v1/x/*` | GET/POST | Circle Gateway | per-call |
| `/api/v1/audio/generations` | POST | Circle Gateway | per-second |
| `/api/v1/videos/generations` | POST | Circle Gateway | per-video |
| `/api/v1/models` | GET | free | — |
| `/api/health` | GET | free | — |

### Mainnet supported chains

| Chain | `SupportedChainName` | CAIP-2 | USDC contract |
|---|---|---|---|
| Polygon | `polygon` | `eip155:137` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Arbitrum One | `arbitrum` | `eip155:42161` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| OP Mainnet | `optimism` | `eip155:10` | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |
| Unichain | `unichain` | `eip155:130` | `0x078D782b760474a361dDA0AF3839290b0EF57AD6` |

### Circle GatewayWallet (escrow contract)

Same address on every chain (CREATE2 deterministic deploy):

`0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`

This is **Circle's contract**, not BlockRun's. It holds buyers' deposited USDC in escrow. BlockRun never touches it directly — only signs payment authorizations against it.

### BlockRun treasury (`payTo`)

`0xe9030014F5DAe217d0A152f02A043567b16c1aBf`

This is **BlockRun's address** that Circle's facilitator settles to during the hourly batch. You'll see it in every 402 challenge's `accepts[i].payTo` field.

### Useful links

- Circle Gateway docs: https://developers.circle.com/gateway
- `@circle-fin/x402-batching` on npm: https://www.npmjs.com/package/@circle-fin/x402-batching
- BlockRun mainnet x402 (Base): https://blockrun.ai
- BlockRun Solana: https://sol.blockrun.ai
