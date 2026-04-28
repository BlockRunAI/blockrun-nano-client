/**
 * @blockrun/nano-client — TypeScript SDK for blockrun-nano.
 *
 * Pay-per-request AI on Polygon / Arbitrum / Optimism / Unichain mainnet via
 * Circle Gateway batched USDC. Same OpenAI-compatible model catalog and
 * routes as blockrun.ai (chat, images, music, video, search, X/Twitter,
 * Pyth-backed market data) — but with **gas-free off-chain signatures
 * after a one-time deposit**.
 *
 * Quick start:
 *   const client = new NanoClient({ chain: "polygon", privateKey: "0x..." });
 *   await client.deposit("5");                              // wallet → Circle Gateway
 *   const r = await client.chat({                           // pay-per-call (zero gas)
 *     model: "openai/gpt-4o-mini",
 *     messages: [{ role: "user", content: "Hello!" }],
 *   });
 *
 * Mirror of `blockrun-llm` (Python) — same API surface, same model catalog,
 * different payment chain (Circle Gateway batched x402 instead of Base x402).
 */

import {
  GatewayClient,
  GATEWAY_DOMAINS,
  type SupportedChainName,
} from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

// =============================================================================
// Endpoints
// =============================================================================

export const NANO_MAINNET_URL = "https://nano.blockrun.ai";
export const NANO_TESTNET_URL = "https://testnet-nano.blockrun.ai";
export const NANO_MAINNET_DIRECT_URL =
  "https://blockrun-nano-1092497648280.us-central1.run.app";

/**
 * Recommended public RPCs per chain. The default RPCs that ship with
 * `@circle-fin/x402-batching`'s CHAIN_CONFIGS are often rate-limited or stale.
 */
export const RECOMMENDED_RPC_URLS: Partial<Record<SupportedChainName, string>> = {
  // Mainnets accepted by nano (Base intentionally excluded — covered by blockrun.ai's native x402)
  polygon: "https://1rpc.io/matic",
  arbitrum: "https://arbitrum.llamarpc.com",
  optimism: "https://optimism.llamarpc.com",
  unichain: "https://unichain.drpc.org",
  avalanche: "https://avalanche-c-chain-rpc.publicnode.com",
  sonic: "https://rpc.soniclabs.com",
  sei: "https://evm-rpc.sei-apis.com",
  worldChain: "https://worldchain-mainnet.g.alchemy.com/public",
  hyperEvm: "https://rpc.hyperliquid.xyz/evm",
  ethereum: "https://eth.llamarpc.com",
  // Base — only useful if you point baseUrl at blockrun.ai's native x402 service
  base: "https://base.llamarpc.com",
  // Testnets
  polygonAmoy: "https://rpc-amoy.polygon.technology",
  arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc",
  optimismSepolia: "https://sepolia.optimism.io",
  unichainSepolia: "https://sepolia.unichain.org",
};

// =============================================================================
// Types
// =============================================================================

export interface NanoClientConfig {
  /** EVM private key (0x-prefixed). The same address controls all 4 EVM chains. */
  privateKey: Hex;
  /** Which chain holds your Circle Gateway balance. */
  chain: SupportedChainName;
  /** Override base URL. Default: https://nano.blockrun.ai */
  baseUrl?: string;
  /** Optional custom RPC URL (defaults from RECOMMENDED_RPC_URLS). */
  rpcUrl?: string;
  /** Number of retries on transient pay() failures. Default 2. */
  maxRetries?: number;
}

/** OpenAI-compatible message. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  [extra: string]: unknown;
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** ClawRouter routing profiles — passed via `routing_profile` to /v1/chat/completions. */
export type RoutingProfile = "free" | "eco" | "auto" | "premium";

export interface SmartChatRequest {
  prompt: string;
  system?: string;
  max_tokens?: number;
  temperature?: number;
  routing_profile?: RoutingProfile;
}

export interface SmartChatResponse {
  /** Final text response. */
  response: string;
  /** Model that ClawRouter actually picked. */
  model: string;
  /** Routing decision metadata (if exposed by upstream). */
  routing?: {
    profile: RoutingProfile;
    tier?: "SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING";
    savings?: number;
  };
  /** Full upstream chat completion. */
  raw: ChatCompletion;
}

export interface ImagesRequest {
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  [extra: string]: unknown;
}

export interface ImageEditRequest {
  model: string;
  prompt: string;
  image: string;
  size?: string;
  n?: number;
  [extra: string]: unknown;
}

export interface VideosRequest {
  model: string;
  prompt: string;
  duration?: number;
  [extra: string]: unknown;
}

export interface MusicRequest {
  model?: string;
  prompt: string;
  duration?: number;
  [extra: string]: unknown;
}

export interface AudioRequest {
  model: string;
  /** Either a text-to-speech `input` or a base64 `audio` for transcription. */
  input?: string;
  audio?: string;
  voice?: string;
  format?: string;
  [extra: string]: unknown;
}

export interface SearchRequest {
  query: string;
  [extra: string]: unknown;
}

/** Receipt-style metadata returned alongside every paid call. */
export interface PaymentReceipt {
  /** Circle Gateway nanopayment intent UUID. */
  transaction: string;
  formattedAmount: string;
  amount: bigint;
  status: number;
}

export interface NanoCallResult<T> {
  data: T;
  payment: PaymentReceipt;
}

export type PaymentStatus =
  | { status: "pending"; intentId: string; note: string; facilitatorUrl: string }
  | { status: "settled"; intentId: string; transactionHash?: string; settledAt?: string; raw?: unknown }
  | { status: "failed"; intentId: string; reason?: string; raw?: unknown }
  | { status: "unknown"; intentId: string; note: string; facilitatorUrl: string };

export interface SpendingSummary {
  total_usd: number;
  total_micro_usdc: number;
  calls: number;
  by_endpoint: Record<string, { calls: number; total_usd: number }>;
}

type GatewayPayInit = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

const RETRYABLE_PAY_ERRORS = [
  "etimedout", "econnreset", "econnrefused", "fetch failed", "network error",
  "socket hang up", "service unavailable", "gateway timeout", "bad gateway",
  "status 502", "status 503", "status 504", "facilitator_timeout",
];

function isRetryable(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RETRYABLE_PAY_ERRORS.some((e) => lower.includes(e));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// =============================================================================
// NanoClient
// =============================================================================

export class NanoClient {
  readonly gateway: GatewayClient;
  readonly baseUrl: string;
  readonly chain: SupportedChainName;
  readonly maxRetries: number;

  /** X / Twitter helpers (`/api/v1/x/*`). */
  readonly x: XHelpers;
  /** Image generation + editing (`/api/v1/images/*`). */
  readonly images: ImagesHelpers;
  /** Video generation (`/api/v1/videos/*`). */
  readonly videos: VideosHelpers;
  /** Music / audio generation (`/api/v1/audio/*`, `/api/v1/music`). */
  readonly music: MusicHelpers;
  /** Text-to-speech / speech-to-text (`/api/v1/audio/*`). */
  readonly audio: AudioHelpers;
  /** Pyth-backed price + market data (`/api/v1/price`, `/api/v1/pm/*`). */
  readonly price: PriceHelpers;

  private _spending: SpendingSummary = {
    total_usd: 0,
    total_micro_usdc: 0,
    calls: 0,
    by_endpoint: {},
  };

  constructor(config: NanoClientConfig) {
    const rpcUrl = config.rpcUrl ?? RECOMMENDED_RPC_URLS[config.chain];
    this.gateway = new GatewayClient({
      chain: config.chain,
      privateKey: config.privateKey,
      ...(rpcUrl ? { rpcUrl } : {}),
    });
    this.baseUrl = (config.baseUrl ?? NANO_MAINNET_URL).replace(/\/+$/, "");
    this.chain = config.chain;
    this.maxRetries = config.maxRetries ?? 2;

    this.x = new XHelpers(this);
    this.images = new ImagesHelpers(this);
    this.videos = new VideosHelpers(this);
    this.music = new MusicHelpers(this);
    this.audio = new AudioHelpers(this);
    this.price = new PriceHelpers(this);
  }

  // ── Wallet / Gateway ────────────────────────────────────────────────────

  get address(): `0x${string}` {
    return this.gateway.address;
  }

  async getBalances() {
    return this.gateway.getBalances();
  }

  async deposit(amount: string) {
    return this.gateway.deposit(amount);
  }

  async withdraw(amount: string, options?: { chain?: SupportedChainName }) {
    return options?.chain
      ? this.gateway.withdraw(amount, { chain: options.chain })
      : this.gateway.withdraw(amount);
  }

  // ── Chat ────────────────────────────────────────────────────────────────

  /** POST /api/v1/chat/completions — OpenAI-compatible. */
  async chat(body: ChatCompletionsRequest): Promise<NanoCallResult<ChatCompletion>> {
    if ((body as { stream?: boolean }).stream) {
      throw new Error("Streaming chat is not yet supported in v0.x; use non-streaming.");
    }
    return this.payJson<ChatCompletion>("/api/v1/chat/completions", body);
  }

  /**
   * Convenience: simple prompt → string response, no message-array boilerplate.
   *
   * @example
   *   const reply = await client.ask("openai/gpt-4o-mini", "What is 2+2?");
   */
  async ask(model: string, prompt: string, opts: { system?: string; max_tokens?: number; temperature?: number } = {}): Promise<string> {
    const messages: ChatMessage[] = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: prompt });
    const r = await this.chat({
      model,
      messages,
      ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    });
    return r.data.choices[0]?.message.content ?? "";
  }

  /**
   * Smart chat — let ClawRouter pick the cheapest capable model for each
   * request based on a 14-dimension classifier. Add `routing_profile` to
   * bias toward `free` / `eco` / `auto` (default) / `premium`.
   *
   * @example
   *   const r = await client.smartChat({ prompt: "What is 2+2?" });
   *   console.log(r.model); // 'moonshot/kimi-k2.5'
   *
   *   const hard = await client.smartChat({
   *     prompt: "Prove the Riemann hypothesis",
   *     routing_profile: "premium",
   *   });
   */
  async smartChat(req: SmartChatRequest): Promise<NanoCallResult<SmartChatResponse>> {
    const messages: ChatMessage[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });
    const body: ChatCompletionsRequest & { routing: "smart"; routing_profile?: RoutingProfile } = {
      // dummy model — server replaces via ClawRouter
      model: "auto",
      messages,
      routing: "smart",
      routing_profile: req.routing_profile ?? "auto",
      ...(req.max_tokens !== undefined ? { max_tokens: req.max_tokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };
    const result = await this.payJson<ChatCompletion>("/api/v1/chat/completions", body);
    const text = result.data.choices[0]?.message.content ?? "";
    return {
      data: {
        response: text,
        model: result.data.model,
        routing: { profile: req.routing_profile ?? "auto" },
        raw: result.data,
      },
      payment: result.payment,
    };
  }

  // ── Search ──────────────────────────────────────────────────────────────

  async search<T = unknown>(body: SearchRequest): Promise<NanoCallResult<T>> {
    return this.payJson<T>("/api/v1/search", body);
  }

  // ── Models catalog (free) ───────────────────────────────────────────────

  /** GET /api/v1/models — free; lists all available models with pricing. */
  async listModels<T = unknown>(): Promise<T> {
    const r = await fetch(`${this.baseUrl}/api/v1/models`);
    if (!r.ok) throw new Error(`listModels failed: HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  // ── Generic raw call ────────────────────────────────────────────────────

  /** Generic paid call — for endpoints not covered by typed helpers. */
  async call<T = unknown>(
    path: string,
    init: GatewayPayInit = {},
  ): Promise<NanoCallResult<T>> {
    return this.payRequest<T>(path, init);
  }

  // ── Payment intent tracking ─────────────────────────────────────────────

  /**
   * Look up a Circle Gateway nanopayment intent's status via
   * `GET https://gateway-api.circle.com/v1/x402/transfers/{id}`.
   *
   * Status flow: `Received` → `Batched` → `Confirmed` → `Completed`
   * `Completed` = seller's Circle Gateway available balance has increased.
   * To get on-chain wallet USDC, the seller calls `withdraw()` on their key.
   */
  async getPaymentStatus(intentId: string): Promise<PaymentStatus> {
    const facilitatorUrl = this.facilitatorUrlForChain();
    const url = `${facilitatorUrl}/v1/x402/transfers/${encodeURIComponent(intentId)}`;
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.status === 404) {
        return { status: "unknown", intentId, facilitatorUrl, note: `Circle returned 404 — intent not found.` };
      }
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return { status: "unknown", intentId, facilitatorUrl, note: `Circle returned HTTP ${r.status}: ${text.slice(0, 200)}` };
      }
      const body = (await r.json()) as Record<string, unknown>;
      return interpretCircleStatus(intentId, body);
    } catch (err) {
      return { status: "unknown", intentId, facilitatorUrl, note: `Network error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** Poll {@link getPaymentStatus} until terminal state or timeout. */
  async waitForSettlement(
    intentId: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<PaymentStatus> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
    const start = Date.now();
    let last: PaymentStatus = { status: "unknown", intentId, facilitatorUrl: this.facilitatorUrlForChain(), note: "polling not yet started" };
    while (Date.now() - start < timeoutMs) {
      last = await this.getPaymentStatus(intentId);
      if (last.status === "settled" || last.status === "failed") return last;
      await sleep(pollIntervalMs);
    }
    return last;
  }

  // ── Spending tracker ────────────────────────────────────────────────────

  /** Cumulative spend on this client instance (this process / session). */
  getSpending(): SpendingSummary {
    return {
      total_usd: this._spending.total_usd,
      total_micro_usdc: this._spending.total_micro_usdc,
      calls: this._spending.calls,
      by_endpoint: { ...this._spending.by_endpoint },
    };
  }

  /** Reset the in-process spending counter. */
  resetSpending(): void {
    this._spending = { total_usd: 0, total_micro_usdc: 0, calls: 0, by_endpoint: {} };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /** @internal Used by namespaced helpers (this.x, this.images, ...). */
  async _payJson<T>(path: string, body: unknown): Promise<NanoCallResult<T>> {
    return this.payJson<T>(path, body);
  }

  /** @internal Used by namespaced helpers for GET endpoints. */
  async _payGet<T>(path: string, params: Record<string, unknown> = {}): Promise<NanoCallResult<T>> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      query.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    const qs = query.toString();
    const fullPath = qs ? `${path}?${qs}` : path;
    return this.payRequest<T>(fullPath, { method: "GET" });
  }

  private async payJson<T>(path: string, body: unknown): Promise<NanoCallResult<T>> {
    return this.payRequest<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }

  private async payRequest<T>(path: string, init: GatewayPayInit): Promise<NanoCallResult<T>> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const result = await this.withRetry(() => this.gateway.pay<T>(url, init));
    this.recordSpend(path, result.amount);
    return {
      data: result.data,
      payment: {
        transaction: result.transaction,
        formattedAmount: result.formattedAmount,
        amount: result.amount,
        status: result.status,
      },
    };
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt === this.maxRetries) break;
        const msg = err instanceof Error ? err.message : String(err);
        if (!isRetryable(msg)) break;
        const delay = Math.min(500 * Math.pow(2, attempt), 5000);
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  private recordSpend(path: string, microUsdc: bigint): void {
    const micro = Number(microUsdc);
    const usd = micro / 1_000_000;
    this._spending.total_usd += usd;
    this._spending.total_micro_usdc += micro;
    this._spending.calls += 1;
    const bucket = bucketOf(path);
    const cur = this._spending.by_endpoint[bucket] ?? { calls: 0, total_usd: 0 };
    cur.calls += 1;
    cur.total_usd += usd;
    this._spending.by_endpoint[bucket] = cur;
  }

  private facilitatorUrlForChain(): string {
    return "https://gateway-api.circle.com";
  }
}

function bucketOf(path: string): string {
  const parts = path.split("?")[0]!.split("/").filter(Boolean);
  // strip /api/v1 prefix
  while (parts.length && (parts[0] === "api" || parts[0] === "v1")) parts.shift();
  return "/" + parts.slice(0, 2).join("/");
}

// =============================================================================
// Namespaced helpers — accessed as client.x, client.images, ...
// =============================================================================

/** X / Twitter helpers (powered by AttentionVC). */
export class XHelpers {
  constructor(private readonly nano: NanoClient) {}

  /** Look up X user profile(s) by handle. $0.002/user. */
  userLookup<T = unknown>(usernames: string | string[]): Promise<NanoCallResult<T>> {
    const list = Array.isArray(usernames) ? usernames : [usernames];
    return this.nano._payGet<T>("/api/v1/x/users/lookup", { usernames: list.join(",") });
  }

  /** Look up a single X user's profile + intelligence info. */
  userInfo<T = unknown>(username: string): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/users/info", { username });
  }

  /** Followers of an X user. $0.05/page (~200 accounts). */
  followers<T = unknown>(username: string, opts: { cursor?: string } = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/users/followers", { username, ...opts });
  }

  /** Followings of an X user. */
  followings<T = unknown>(username: string, opts: { cursor?: string } = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/users/followings", { username, ...opts });
  }

  /** Verified followers of an X user. */
  verifiedFollowers<T = unknown>(username: string, opts: { cursor?: string } = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/users/verified-followers", { username, ...opts });
  }

  /** Recent tweets from a user. */
  userTweets<T = unknown>(username: string, opts: { cursor?: string; limit?: number } = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/users/tweets", { username, ...opts });
  }

  /** Recent mentions of a user. */
  userMentions<T = unknown>(username: string, opts: { cursor?: string; limit?: number } = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/users/mentions", { username, ...opts });
  }

  /** Look up a tweet by ID(s). */
  tweetLookup<T = unknown>(tweetIds: string | string[]): Promise<NanoCallResult<T>> {
    const list = Array.isArray(tweetIds) ? tweetIds : [tweetIds];
    return this.nano._payGet<T>("/api/v1/x/tweets/lookup", { tweet_ids: list.join(",") });
  }

  /** Replies under a tweet. */
  tweetReplies<T = unknown>(tweetId: string, opts: { cursor?: string } = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/tweets/replies", { tweet_id: tweetId, ...opts });
  }

  /** Full thread containing a tweet. */
  tweetThread<T = unknown>(tweetId: string, opts: { cursor?: string } = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/tweets/thread", { tweet_id: tweetId, ...opts });
  }

  /** X advanced search with operators. $0.032/page. */
  search<T = unknown>(query: string, opts: { query_type?: "Latest" | "Top"; cursor?: string } = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/search", { query, ...opts });
  }

  /** Current trending topics. $0.002/request. */
  trending<T = unknown>(): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/trending");
  }

  /** Rising long-form articles. */
  articlesRising<T = unknown>(): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/x/articles/rising");
  }
}

/** Image generation + editing. */
export class ImagesHelpers {
  constructor(private readonly nano: NanoClient) {}

  /** POST /api/v1/images/generations — DALL-E / Flux / Gemini Nano Banana / etc. */
  generate<T = unknown>(body: ImagesRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/images/generations", body);
  }

  /** POST /api/v1/images/image2image — image editing / variation. */
  edit<T = unknown>(body: ImageEditRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/images/image2image", body);
  }
}

/** Video generation. */
export class VideosHelpers {
  constructor(private readonly nano: NanoClient) {}

  /** Submit a video generation job. */
  generate<T = unknown>(body: VideosRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/videos/generations", body);
  }

  /** Poll a video job by ID. */
  status<T = unknown>(id: string): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>(`/api/v1/videos/generations/${encodeURIComponent(id)}`);
  }
}

/** Music + ambient audio generation. */
export class MusicHelpers {
  constructor(private readonly nano: NanoClient) {}

  /** Generate music. Some BlockRun deployments expose this at /api/v1/audio/generations with model:"music/*". */
  generate<T = unknown>(body: MusicRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/audio/generations", body);
  }
}

/** Speech-to-text and text-to-speech. */
export class AudioHelpers {
  constructor(private readonly nano: NanoClient) {}

  /** Audio generation (TTS) or transcription, depending on model. */
  generate<T = unknown>(body: AudioRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/audio/generations", body);
  }

  /** Convenience alias for text-to-speech. */
  tts<T = unknown>(body: AudioRequest): Promise<NanoCallResult<T>> {
    return this.generate<T>(body);
  }
}

/** Pyth-backed price + market data (`/api/v1/price`, `/api/v1/pm/*`). */
export class PriceHelpers {
  constructor(private readonly nano: NanoClient) {}

  /** Spot price for a symbol. */
  price<T = unknown>(symbol: string): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/price", { symbol });
  }

  /** Historical price points. */
  history<T = unknown>(symbol: string, opts: { range?: string; resolution?: string } = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>("/api/v1/price/history", { symbol, ...opts });
  }

  /** Generic Predexon market call — `path` is appended to /api/v1/pm/. */
  pm<T = unknown>(path: string, params: Record<string, unknown> = {}): Promise<NanoCallResult<T>> {
    return this.nano._payGet<T>(`/api/v1/pm/${path.replace(/^\/+/, "")}`, params);
  }
}

// =============================================================================
// Standalone Gateway-balance query (no private key required)
// =============================================================================

/**
 * Query a seller's Circle Gateway balance on a given chain (read-only).
 *
 * Use this to inspect how much USDC a seller has accumulated in Circle's
 * Gateway escrow before they `withdraw()` it to their on-chain wallet. Per
 * Circle's status flow, when an intent reaches `Completed`, funds land here
 * — NOT in the seller's wallet directly.
 *
 * @example
 * ```ts
 * const b = await querySellerGatewayBalance(
 *   "0xe9030014F5DAe217d0A152f02A043567b16c1aBf",
 *   "polygon",
 * );
 * console.log(b.available); // "0.057000"
 * ```
 */
export async function querySellerGatewayBalance(
  address: string,
  chain: SupportedChainName,
  opts: { facilitatorUrl?: string } = {},
): Promise<{
  available: string;
  withdrawing?: string;
  withdrawable?: string;
  raw: unknown;
}> {
  const domain = GATEWAY_DOMAINS[chain];
  if (domain === undefined) throw new Error(`Unknown chain: ${chain}`);
  const baseUrl = opts.facilitatorUrl ?? "https://gateway-api.circle.com";
  const r = await fetch(`${baseUrl}/v1/balances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "USDC",
      sources: [{ depositor: address, domain }],
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Circle balance query failed: HTTP ${r.status} ${text}`);
  }
  const body = (await r.json()) as {
    balances?: Array<{ depositor: string; domain: number; balance: string; withdrawing?: string; withdrawable?: string }>;
  };
  const entry = body.balances?.[0];
  if (!entry) return { available: "0", raw: body };
  return {
    available: entry.balance,
    ...(entry.withdrawing ? { withdrawing: entry.withdrawing } : {}),
    ...(entry.withdrawable ? { withdrawable: entry.withdrawable } : {}),
    raw: body,
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

function interpretCircleStatus(intentId: string, body: Record<string, unknown>): PaymentStatus {
  const status = String(body.status ?? "").toLowerCase();
  const txHash = (body.transactionHash as string | undefined) ?? (body.onchainTx as string | undefined);
  const settledAt = (body.updatedAt as string | undefined) ?? (body.settledAt as string | undefined);

  if (status === "completed" || status === "settled" || status === "succeeded" || status === "confirmed") {
    return {
      status: "settled",
      intentId,
      ...(txHash ? { transactionHash: txHash } : {}),
      ...(settledAt ? { settledAt } : {}),
      raw: body,
    };
  }
  if (status === "failed" || status === "error" || status === "rejected") {
    return {
      status: "failed",
      intentId,
      reason: String(body.reason ?? body.errorReason ?? body.error ?? "unknown"),
      raw: body,
    };
  }
  return {
    status: "pending",
    intentId,
    facilitatorUrl: "https://gateway-api.circle.com",
    note: `Circle returned status="${status}" — ${status === "received" ? "verified, queued for next batch" : status === "batched" ? "batching in progress" : "still queued"}.`,
  };
}

// =============================================================================
// Re-exports
// =============================================================================

export { GatewayClient };
export type { SupportedChainName };
