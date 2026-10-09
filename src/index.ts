/**
 * @blockrun/nano-client — TypeScript SDK for blockrun-nano.
 *
 * Account API access, or pay-per-request AI on 11 EVM mainnets via Circle
 * Gateway batched USDC. OpenAI-compatible chat plus images, video, music,
 * speech, search and prediction-market routes — with **gas-free off-chain
 * signatures after a one-time deposit**.
 *
 * Quick start:
 *   const client = new NanoClient({ chain: "polygon", privateKey: "0x...", maxPaymentPerCall: "0.50" });
 *   await client.deposit("5");                              // wallet → Circle Gateway
 *   const r = await client.chat({                           // pay-per-call (zero gas)
 *     model: "openai/gpt-5.6-luna",
 *     messages: [{ role: "user", content: "Hello!" }],
 *   });
 *
 * Mirror of `blockrun-llm` (Python) — same API surface, same model catalog,
 * different payment chain (Circle Gateway batched x402 instead of Base x402).
 */

import {
  BatchEvmScheme,
  CHAIN_CONFIGS,
  GatewayClient,
  GATEWAY_DOMAINS,
  type SupportedChainName,
} from "@circle-fin/x402-batching/client";
import { formatUnits, isAddress, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export {
  BLOCKRUN_ACCOUNT_API_URL,
  BLOCKRUN_ACCOUNT_PORTAL_URL,
  BlockRunAccountClient,
  BlockRunAccountError,
  type AccountMediaJob,
  type AccountRequestInit,
  type BlockRunAccountClientConfig,
  type AccountBillingReceipt,
  type AccountCallResult,
} from "./account.js";

// =============================================================================
// Endpoints
// =============================================================================

export const NANO_MAINNET_URL = "https://nano.blockrun.ai";
export const NANO_TESTNET_URL = "https://testnet-nano.blockrun.ai";
/**
 * Cloud Run direct URL — fallback only. Use `NANO_MAINNET_URL` for normal
 * traffic. This stays exported so you can route around DNS / Cloudflare
 * issues during incidents.
 */
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
  /** EVM private key (0x-prefixed). The same address controls every EVM chain. */
  privateKey: Hex;
  /** Which chain holds your Circle Gateway balance. */
  chain: SupportedChainName;
  /** Override base URL. Default: https://nano.blockrun.ai */
  baseUrl?: string;
  /** Optional custom RPC URL (defaults from RECOMMENDED_RPC_URLS). */
  rpcUrl?: string;
  /**
   * Retries for transient failures of the UNPAID quote request. A request is
   * never retried once a payment authorization has been signed, so a flaky
   * network cannot double-charge you. Default 2.
   */
  maxRetries?: number;
  /**
   * Refuse to sign any single payment above this many USDC (decimal string,
   * e.g. "0.50"). The server quotes the price; without a cap the SDK signs
   * whatever it quotes. Strongly recommended in production. Default: no cap.
   */
  maxPaymentPerCall?: string;
  /**
   * Deadline per HTTP request in ms. Music generation is a single 30-120s
   * call, so keep this above 150s. Default 300_000.
   */
  timeoutMs?: number;
}

/** OpenAI-compatible multimodal content part (vision models). */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

/** OpenAI-compatible message. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatContentPart[];
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
  /** e.g. `xai/grok-imagine-video`, `bytedance/seedance-2.0`, `azure/sora-2`. */
  model: string;
  prompt: string;
  /** Billed length in seconds (defaults to the model's default length). */
  duration_seconds?: number;
  /** Optional seed image URL for image-to-video. */
  image_url?: string;
  /** @deprecated Use `duration_seconds`. Mapped automatically; the server ignores `duration`. */
  duration?: number;
  [extra: string]: unknown;
}

export interface MusicRequest {
  /** e.g. `minimax/music-2.5+`. */
  model: string;
  prompt: string;
  /** Optional lyrics; omit for instrumental. */
  lyrics?: string;
  instrumental?: boolean;
  duration_seconds?: number;
  /** @deprecated Use `duration_seconds`. Mapped automatically. */
  duration?: number;
  [extra: string]: unknown;
}

/** Text-to-speech request (`POST /api/v1/audio/speech`). */
export interface SpeechRequest {
  /** e.g. `elevenlabs/flash-v2.5`, `elevenlabs/multilingual-v2`, `elevenlabs/v3`. */
  model?: string;
  /** Text to synthesize. Billed per character. */
  input: string;
  /** Voice alias (e.g. `sarah`, `george`) or raw ElevenLabs voice_id. */
  voice?: string;
  response_format?: "mp3" | "opus" | "pcm" | "wav";
  speed?: number;
  /** @deprecated Use `response_format`. Mapped automatically. */
  format?: "mp3" | "opus" | "pcm" | "wav";
  [extra: string]: unknown;
}

/** Sound-effect request (`POST /api/v1/audio/sound-effects`). */
export interface SoundEffectsRequest {
  model?: string;
  /** Description of the sound effect. */
  text: string;
  /** Up to 22 seconds. */
  duration_seconds?: number;
  prompt_influence?: number;
  response_format?: "mp3" | "opus" | "pcm" | "wav";
  [extra: string]: unknown;
}

/**
 * Loose audio request kept for `BlockRunAccountClient`. NanoClient uses
 * {@link SpeechRequest} and {@link MusicRequest} instead.
 */
export interface AudioRequest {
  model: string;
  input?: string;
  audio?: string;
  voice?: string;
  format?: string;
  [extra: string]: unknown;
}

export interface SearchRequest {
  query: string;
  /** Data sources to search, e.g. `["web", "news", "x"]`. */
  sources?: string[];
  max_results?: number;
  [extra: string]: unknown;
}

/** Receipt-style metadata returned alongside every paid call. */
export interface PaymentReceipt {
  /**
   * Circle Gateway transfer UUID (NOT an on-chain tx hash — funds move in
   * Circle's periodic batch). Pass it to `getPaymentStatus()` /
   * `waitForSettlement()` to track settlement. Empty string for free calls
   * and for authorizations that have not settled yet (video jobs).
   */
  transaction: string;
  formattedAmount: string;
  /** Amount in USDC atomic units (6 decimals). */
  amount: bigint;
  status: number;
  /** Chain the buyer signed against (mirrors `NanoClient.chain`). */
  network: SupportedChainName;
}

export interface NanoCallResult<T> {
  data: T;
  payment: PaymentReceipt;
}

/**
 * An async job (video, or a slow image model) whose payment is authorized but
 * not yet settled. Keep it until `wait()` / `status()` returns `completed`:
 * polling replays `paymentHeader`, so resubmitting would sign a second payment.
 */
export interface NanoAsyncJob {
  id: string;
  /** Signed poll path returned by the server. Use verbatim. */
  poll_url: string;
  status: string;
  model?: string;
  /** Signed x402 authorization from the submit; replayed on every poll. */
  paymentHeader: string;
  /** Authorized amount in USDC atomic units — charged on the first completed poll. */
  amount: bigint;
  [field: string]: unknown;
}
/** A submitted video job. */
export type NanoVideoJob = NanoAsyncJob;

export interface NanoJobStatus {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | string;
  /** `settled` on the poll that charged you; `already_settled` on later polls. */
  payment?: { status?: string; [field: string]: unknown };
  payment_status?: string;
  [field: string]: unknown;
}
export type NanoVideoStatus = NanoJobStatus;

/** True when a call returned an async job (HTTP 202 + `poll_url`) instead of a result. */
export function isNanoAsyncJob(data: unknown): data is NanoAsyncJob {
  const d = data as Partial<NanoAsyncJob> | null;
  return !!d && typeof d === "object" && typeof d.poll_url === "string" && typeof d.paymentHeader === "string";
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

/**
 * Non-2xx response or transport failure from nano.
 *
 * `paymentSigned` tells you whether a payment authorization left this
 * process. When it is `true` the server may still settle it, so check
 * `getPaymentStatus()` / your Gateway balance before retrying by hand.
 */
export class NanoRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly paymentSigned: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "NanoRequestError";
  }
}

/** The server's quote failed a pre-sign safety check; nothing was signed. */
export class NanoPaymentRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NanoPaymentRejectedError";
  }
}

interface PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  /** USDC contract on `network`. */
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string; verifyingContract?: string; [k: string]: unknown };
  [k: string]: unknown;
}

type CreatePaymentPayload = (x402Version: number, requirements: PaymentRequirement) => Promise<object>;

const RETRYABLE_ERRORS = [
  "etimedout", "econnreset", "econnrefused", "fetch failed", "network error",
  "socket hang up", "eai_again",
];
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function isRetryableError(err: unknown): boolean {
  const msg = (err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err)).toLowerCase();
  return RETRYABLE_ERRORS.some((e) => msg.includes(e));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// =============================================================================
// NanoClient
// =============================================================================

export class NanoClient {
  /**
   * Circle's wallet client — use it for balances, deposits and withdrawals.
   * Do not use `gateway.pay()` for nano calls: it bypasses NanoClient's
   * pre-sign checks, spend cap and no-re-sign retry policy.
   */
  readonly gateway: GatewayClient;
  /**
   * Circle signing scheme used for every NanoClient payment. Register Circle
   * lifecycle hooks here (e.g. `paymentScheme.onBeforePaymentCreation(...)`);
   * hooks registered on `gateway` only apply to `gateway.pay()`.
   */
  readonly paymentScheme: BatchEvmScheme;
  readonly baseUrl: string;
  readonly chain: SupportedChainName;
  readonly maxRetries: number;
  readonly timeoutMs: number;
  /** Per-call signing cap in USDC atomic units, or `undefined` for no cap. */
  readonly maxPaymentPerCall: bigint | undefined;

  /** Image generation + editing (`/api/v1/images/*`). */
  readonly images: ImagesHelpers;
  /** Async video generation (`/api/v1/videos/*`). */
  readonly videos: VideosHelpers;
  /** Music generation (`/api/v1/audio/generations`). */
  readonly music: MusicHelpers;
  /** Text-to-speech and sound effects (`/api/v1/audio/speech`, `/api/v1/audio/sound-effects`). */
  readonly audio: AudioHelpers;

  private readonly createPaymentPayload: CreatePaymentPayload;
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
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) throw new Error("maxRetries must be a non-negative integer.");
    this.timeoutMs = config.timeoutMs ?? 300_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("timeoutMs must be positive and finite.");
    if (config.maxPaymentPerCall !== undefined && !/^\d+(\.\d{1,6})?$/.test(config.maxPaymentPerCall)) {
      throw new Error(`maxPaymentPerCall must be a non-negative USDC amount with at most 6 decimals (e.g. "0.50"); got "${config.maxPaymentPerCall}".`);
    }
    this.maxPaymentPerCall =
      config.maxPaymentPerCall !== undefined ? parseUnits(config.maxPaymentPerCall, 6) : undefined;

    // The x402 flow runs here (not GatewayClient.pay) so the SDK can refuse a
    // quote before signing, never re-sign on retry, and keep the signed header
    // for job polling. Signing itself is Circle's public BatchEvmScheme.
    this.paymentScheme = new BatchEvmScheme(privateKeyToAccount(config.privateKey));
    this.createPaymentPayload = (version, requirements) => this.paymentScheme.createPaymentPayload(version, requirements);

    this.images = new ImagesHelpers(this);
    this.videos = new VideosHelpers(this);
    this.music = new MusicHelpers(this);
    this.audio = new AudioHelpers(this);
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
      throw new Error("Streaming chat is not supported by NanoClient; use non-streaming or BlockRunAccountClient.chatStream().");
    }
    return this.payJson<ChatCompletion>("/api/v1/chat/completions", body);
  }

  /**
   * Convenience: simple prompt → string response, no message-array boilerplate.
   *
   * @example
   *   const reply = await client.ask("openai/gpt-5.4-mini", "What is 2+2?");
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

  // ── Search ──────────────────────────────────────────────────────────────

  /** POST /api/v1/search — Grok live web / news / X search. */
  async search<T = unknown>(body: SearchRequest): Promise<NanoCallResult<T>> {
    return this.payJson<T>("/api/v1/search", body);
  }

  // ── Prediction markets ──────────────────────────────────────────────────

  /**
   * Predexon prediction-market data — `path` is appended to `/api/v1/pm/`.
   *
   * @example
   *   await client.pm("polymarket/markets", { limit: 5 });
   *   await client.pm("markets/search", { q: "election" });
   */
  pm<T = unknown>(path: string, params: Record<string, unknown> = {}): Promise<NanoCallResult<T>> {
    return this._payGet<T>(`/api/v1/pm/${path.replace(/^\/+/, "")}`, params);
  }

  // ── Models catalog (free) ───────────────────────────────────────────────

  /** GET /api/v1/models — free; lists all available models with pricing. */
  async listModels<T = unknown>(): Promise<T> {
    const r = await fetch(`${this.baseUrl}/api/v1/models`, {
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) throw new Error(`listModels failed: HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  // ── Generic raw call ────────────────────────────────────────────────────

  /**
   * Generic paid call — for endpoints not covered by typed helpers
   * (Exa, DefiLlama, 0x, phone, Modal, RPC...). See https://nano.blockrun.ai/api/openapi.
   */
  async call<T = unknown>(
    path: string,
    init: GatewayPayInit = {},
  ): Promise<NanoCallResult<T>> {
    if ((init.body as { stream?: unknown } | undefined)?.stream === true) {
      throw new Error("Streaming responses are not supported by NanoClient.call(); omit stream:true.");
    }
    return this.payRequest<T>(path, init);
  }

  // ── Payment intent tracking ─────────────────────────────────────────────

  /**
   * Look up a Circle Gateway transfer's status via
   * `GET https://gateway-api.circle.com/v1/x402/transfers/{id}` (testnet
   * chains use Circle's testnet host).
   *
   * Status flow: `Received` → `Batched` → `Confirmed` → `Completed`
   * `Completed` = seller's Circle Gateway available balance has increased.
   */
  async getPaymentStatus(intentId: string): Promise<PaymentStatus> {
    const facilitatorUrl = this.facilitatorUrlForChain();
    if (!intentId.trim()) {
      // An empty id would hit the list endpoint and read as a bogus "pending".
      return { status: "unknown", intentId, facilitatorUrl, note: "No transfer id — free calls and unsettled video jobs have none." };
    }
    const url = `${facilitatorUrl}/v1/x402/transfers/${encodeURIComponent(intentId)}`;
    try {
      const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(this.timeoutMs) });
      if (r.status === 404) {
        return { status: "unknown", intentId, facilitatorUrl, note: `Circle returned 404 — intent not found.` };
      }
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return { status: "unknown", intentId, facilitatorUrl, note: `Circle returned HTTP ${r.status}: ${text.slice(0, 200)}` };
      }
      const body = (await r.json()) as Record<string, unknown>;
      return interpretCircleStatus(intentId, body, facilitatorUrl);
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
      if (last.status === "settled" || last.status === "failed" || !intentId.trim()) return last;
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

  /** @internal Used by namespaced helpers (this.images, ...). */
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

  /** @internal Submit a video job, keeping the signed header for polling. */
  async _submitVideo(body: Record<string, unknown>): Promise<NanoCallResult<NanoAsyncJob>> {
    const path = "/api/v1/videos/generations";
    const r = await this.x402Fetch<Record<string, unknown>>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (r.status !== 202 || !r.paymentHeader || typeof r.data?.poll_url !== "string") {
      throw new NanoRequestError("Video submit did not return a payable job (expected HTTP 202 with poll_url).", r.status, JSON.stringify(r.data).slice(0, 2000), r.paymentHeader !== undefined);
    }
    // Authorized, not settled: amount is charged on the first completed poll.
    return {
      data: { ...r.data, paymentHeader: r.paymentHeader, amount: r.amount } as NanoAsyncJob,
      payment: { transaction: "", formattedAmount: "0", amount: 0n, status: r.status, network: this.chain },
    };
  }

  /** @internal Poll an async job once with its original authorization. */
  async _pollJob<T extends NanoJobStatus>(job: NanoAsyncJob, kindPath: string): Promise<NanoCallResult<T>> {
    const base = new URL(`${this.baseUrl}/`);
    const url = job.poll_url.startsWith("/") ? new URL(`${this.baseUrl}${job.poll_url}`) : new URL(job.poll_url);
    const prefix = `${base.pathname.replace(/\/$/, "")}${kindPath}/`;
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) {
      throw new Error(`poll_url must be the nano ${kindPath} poll path returned by the submit call.`);
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { "x-payment": job.paymentHeader },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new NanoRequestError(`Job poll failed: ${errMessage(err)}. Poll the same job again; do not resubmit.`, 0, "", true, { cause: err });
    }
    if (!res.ok) throw await this.httpError(res, true, "Job poll failed");
    const text = await res.text();
    const data = parseJson(text) as T | undefined;
    if (data === undefined) throw new NanoRequestError("Job poll returned a non-JSON body.", res.status, text.slice(0, 2000), true);
    const settlement = readPaymentResponse(res.headers);
    const payStatus = data.payment?.status;
    // Later polls of a finished job answer `already_settled`; only the
    // settling poll is a charge.
    const settledNow =
      res.status === 200 && data.status === "completed" &&
      (payStatus === "settled" || (payStatus === undefined && settlement !== undefined));
    if (settledNow) this.recordSpend(kindPath, job.amount);
    const amount = settledNow ? job.amount : 0n;
    return {
      data,
      payment: {
        transaction: settledNow ? settlement?.transaction ?? "" : "",
        formattedAmount: formatUnits(amount, 6),
        amount,
        status: res.status,
        network: this.chain,
      },
    };
  }

  /** @internal Poll until completed (returned) or failed (thrown). */
  async _waitJob<T extends NanoJobStatus>(
    job: NanoAsyncJob,
    kindPath: string,
    opts: { intervalMs?: number; maxAttempts?: number },
  ): Promise<NanoCallResult<T>> {
    const interval = opts.intervalMs ?? 5_000;
    const attempts = opts.maxAttempts ?? 72;
    if (!Number.isFinite(interval) || interval < 0 || !Number.isInteger(attempts) || attempts < 1) {
      throw new Error("Polling requires a nonnegative interval and positive integer maxAttempts.");
    }
    for (let attempt = 0; attempt < attempts; attempt++) {
      const r = await this._pollJob<T>(job, kindPath);
      if (r.data.status === "completed") return r;
      if (r.data.status === "failed") {
        throw new Error(`Job ${job.id} failed upstream (not charged): ${JSON.stringify(r.data.error ?? "")}`);
      }
      if (attempt + 1 < attempts) await sleep(interval);
    }
    throw new Error(`Job ${job.id} still running. Call wait(job) again later; do not resubmit.`);
  }

  private async payJson<T>(path: string, body: unknown): Promise<NanoCallResult<T>> {
    return this.payRequest<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }

  private async payRequest<T>(path: string, init: GatewayPayInit): Promise<NanoCallResult<T>> {
    const r = await this.x402Fetch<T>(path, init);
    // 202 = authorized, not charged. Hand back a job that can be polled.
    const pending = r.status === 202;
    const data =
      pending && r.paymentHeader && typeof (r.data as { poll_url?: unknown } | null)?.poll_url === "string"
        ? ({ ...(r.data as object), paymentHeader: r.paymentHeader, amount: r.amount } as T)
        : r.data;
    const amount = pending ? 0n : r.amount;
    return {
      data,
      payment: { transaction: r.transaction, formattedAmount: formatUnits(amount, 6), amount, status: r.status, network: this.chain },
    };
  }

  /**
   * x402 two-phase request. Phase 1 (unpaid) is retried on transient errors;
   * phase 2 (signed) never is — a lost response there may still be charged.
   * Spend is recorded here, before parsing, so a paid-but-unparseable
   * response is still counted.
   */
  private async x402Fetch<T>(
    path: string,
    init: GatewayPayInit,
  ): Promise<{ data: T; amount: bigint; transaction: string; status: number; paymentHeader?: string }> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const method = init.method ?? "GET";
    const headers: Record<string, string> = { ...init.headers };
    const body =
      init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
    const send = (extra: Record<string, string> = {}) =>
      fetch(url, {
        method,
        headers: { ...headers, ...extra },
        ...(body !== undefined ? { body } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });

    // Phase 1: unpaid request → 402 quote (or a free response).
    let quote: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        quote = await send();
        if (!RETRYABLE_STATUSES.has(quote.status) || attempt >= this.maxRetries) break;
      } catch (err) {
        if (attempt >= this.maxRetries || !isRetryableError(err)) {
          throw new NanoRequestError(`Request to ${path} failed: ${errMessage(err)}`, 0, "", false, { cause: err });
        }
      }
      await sleep(Math.min(500 * 2 ** attempt, 5000));
    }
    if (quote.status !== 402) {
      if (!quote.ok) throw await this.httpError(quote, false, `Request to ${path} failed`);
      const text = await quote.text();
      const data = parseJson(text);
      if (data === undefined) throw new NanoRequestError(`Request to ${path} returned a non-JSON body.`, quote.status, text.slice(0, 2000), false);
      return { data: data as T, amount: 0n, transaction: "", status: quote.status };
    }

    const required = await readPaymentRequired(quote);
    const option = this.selectPaymentOption(required.accepts);
    const payload = await this.createPaymentPayload(required.x402Version ?? 2, option);
    const paymentHeader = Buffer.from(
      JSON.stringify({ ...payload, resource: required.resource, accepted: option }),
    ).toString("base64");

    // Phase 2: signed request. Never retried.
    let paid: Response;
    try {
      paid = await send({ "Payment-Signature": paymentHeader });
    } catch (err) {
      throw new NanoRequestError(
        `Paid request to ${path} failed after signing: ${errMessage(err)}. It may still be charged — check getPaymentStatus()/getBalances() before retrying.`,
        0, "", true, { cause: err },
      );
    }
    if (!paid.ok) throw await this.httpError(paid, true, `Paid request to ${path} failed`);
    const amount = BigInt(option.amount);
    if (amount > 0n && paid.status !== 202) this.recordSpend(path, amount);
    const text = await paid.text();
    const data = parseJson(text);
    if (data === undefined) {
      throw new NanoRequestError(`Paid request to ${path} succeeded but returned a non-JSON body (charged).`, paid.status, text.slice(0, 2000), true);
    }
    return {
      data: data as T,
      amount,
      transaction: readPaymentResponse(paid.headers)?.transaction ?? "",
      status: paid.status,
      paymentHeader,
    };
  }

  /** Pick this chain's Gateway option and refuse unsafe quotes before signing. */
  private selectPaymentOption(accepts: PaymentRequirement[]): PaymentRequirement {
    const config = CHAIN_CONFIGS[this.chain];
    const expectedNetwork = `eip155:${config.chain.id}`;
    const option = accepts.find(
      (o) =>
        !!o && typeof o === "object" &&
        o.network === expectedNetwork &&
        o.extra?.name === "GatewayWalletBatched" &&
        o.extra?.version === "1" &&
        typeof o.extra?.verifyingContract === "string",
    );
    if (!option) {
      throw new NanoPaymentRejectedError(
        `No Gateway batching option for ${expectedNetwork} (${this.chain}). The seller may not support this chain.`,
      );
    }
    if (option.extra!.verifyingContract!.toLowerCase() !== config.gatewayWallet.toLowerCase()) {
      throw new NanoPaymentRejectedError(
        `Quote names verifyingContract ${option.extra!.verifyingContract}, not Circle's GatewayWallet ${config.gatewayWallet}. Refusing to sign.`,
      );
    }
    if (!isAddress(option.payTo) || option.payTo.toLowerCase() === ZERO_ADDRESS) {
      throw new NanoPaymentRejectedError(`Quote has an invalid payTo address: ${option.payTo}. Refusing to sign.`);
    }
    let amount: bigint;
    try {
      amount = BigInt(option.amount);
    } catch {
      throw new NanoPaymentRejectedError(`Quote has a non-integer amount: ${option.amount}. Refusing to sign.`);
    }
    if (amount < 0n) throw new NanoPaymentRejectedError(`Quote has a negative amount. Refusing to sign.`);
    if (this.maxPaymentPerCall !== undefined && amount > this.maxPaymentPerCall) {
      throw new NanoPaymentRejectedError(
        `Quoted ${formatUnits(amount, 6)} USDC exceeds maxPaymentPerCall ${formatUnits(this.maxPaymentPerCall, 6)} USDC. Nothing was signed.`,
      );
    }
    return option;
  }

  private async httpError(res: Response, paymentSigned: boolean, prefix: string): Promise<NanoRequestError> {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const j = JSON.parse(text) as { error?: unknown; details?: unknown; message?: unknown };
      detail = [j.error, j.details ?? j.message].filter((x) => x !== undefined).map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(": ") || text;
    } catch {
      // non-JSON body
    }
    return new NanoRequestError(`${prefix}: HTTP ${res.status}${detail ? ` ${detail.slice(0, 300)}` : ""}`, res.status, text.slice(0, 2000), paymentSigned);
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
    return circleApiBaseUrl(this.chain);
  }
}

/** Circle Gateway API host for a chain — testnets live on a separate host. */
function circleApiBaseUrl(chain: SupportedChainName): string {
  return CHAIN_CONFIGS[chain]?.chain.testnet
    ? "https://gateway-api-testnet.circle.com"
    : "https://gateway-api.circle.com";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Settlement receipt. Most routes use PAYMENT-RESPONSE; pm/exa/solana use X-Payment-Response. */
function readPaymentResponse(headers: Headers): { transaction: string; success?: boolean } | undefined {
  const header = headers.get("PAYMENT-RESPONSE") ?? headers.get("X-Payment-Response");
  if (!header) return undefined;
  const settle = parseJson(Buffer.from(header, "base64").toString("utf-8")) as { transaction?: unknown; success?: unknown } | undefined;
  if (!settle || typeof settle !== "object") return undefined;
  return {
    transaction: typeof settle.transaction === "string" ? settle.transaction : "",
    ...(typeof settle.success === "boolean" ? { success: settle.success } : {}),
  };
}

/** Parse a 402 quote from the PAYMENT-REQUIRED header, or the body when the header is absent (pm routes). */
async function readPaymentRequired(
  res: Response,
): Promise<{ x402Version?: number; resource?: unknown; accepts: PaymentRequirement[] }> {
  const header = res.headers.get("PAYMENT-REQUIRED");
  const raw = header ? Buffer.from(header, "base64").toString("utf-8") : await res.text().catch(() => "");
  const parsed = parseJson(raw) as { x402Version?: unknown; resource?: unknown; accepts?: unknown } | undefined;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.accepts)) {
    throw new NanoRequestError(
      header ? "402 PAYMENT-REQUIRED header is not a valid x402 quote" : "402 response carried no PAYMENT-REQUIRED header or accepts body",
      402, raw.slice(0, 2000), false,
    );
  }
  return {
    ...(typeof parsed.x402Version === "number" ? { x402Version: parsed.x402Version } : {}),
    resource: parsed.resource,
    accepts: parsed.accepts as PaymentRequirement[],
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function bucketOf(path: string): string {
  const parts = path.split("?")[0]!.split("/").filter(Boolean);
  // strip /api/v1 prefix
  while (parts.length && (parts[0] === "api" || parts[0] === "v1")) parts.shift();
  return "/" + parts.slice(0, 2).join("/");
}

/** Map a deprecated alias onto its canonical field without overriding it. */
function withAlias(body: object, alias: string, canonical: string): Record<string, unknown> {
  const { [alias]: value, ...rest } = body as Record<string, unknown>;
  return rest[canonical] === undefined && value !== undefined ? { ...rest, [canonical]: value } : rest;
}

// =============================================================================
// Namespaced helpers — accessed as client.images, client.videos, ...
// =============================================================================

/** Image generation + editing. */
export class ImagesHelpers {
  constructor(private readonly nano: NanoClient) {}

  /**
   * POST /api/v1/images/generations — GPT Image / Nano Banana / Grok Imagine / CogView.
   * Fast models return the image (HTTP 200). Slow models return HTTP 202 with
   * a job (`isNanoAsyncJob(r.data)`); pass it to {@link wait}.
   */
  generate<T = unknown>(body: ImagesRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/images/generations", body);
  }

  /** POST /api/v1/images/image2image — image editing / variation. May also return a 202 job. */
  edit<T = unknown>(body: ImageEditRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/images/image2image", body);
  }

  /** Poll a 202 image job once. */
  status<T extends NanoJobStatus = NanoJobStatus>(job: NanoAsyncJob): Promise<NanoCallResult<T>> {
    return this.nano._pollJob<T>(job, "/api/v1/images/generations");
  }

  /** Poll a 202 image job until `completed` (returned) or `failed` (thrown — not charged). */
  wait<T extends NanoJobStatus = NanoJobStatus>(job: NanoAsyncJob, opts: { intervalMs?: number; maxAttempts?: number } = {}): Promise<NanoCallResult<T>> {
    return this.nano._waitJob<T>(job, "/api/v1/images/generations", opts);
  }
}

/**
 * Async video generation. The POST authorizes payment; settlement happens on
 * the first poll that finds the job completed. Upstream failure = no charge.
 *
 * @example
 *   const { data: job } = await client.videos.generate({ model: "xai/grok-imagine-video", prompt: "a cat", duration_seconds: 6 });
 *   const done = await client.videos.wait(job);
 */
export class VideosHelpers {
  constructor(private readonly nano: NanoClient) {}

  /** Submit a job. Keep the returned job object; polling replays its authorization. */
  generate(body: VideosRequest): Promise<NanoCallResult<NanoVideoJob>> {
    return this.nano._submitVideo(withAlias(body, "duration", "duration_seconds"));
  }

  /** Poll once. Returns `queued` / `in_progress` (HTTP 202), then `completed` or `failed`. */
  status<T extends NanoJobStatus = NanoJobStatus>(job: NanoVideoJob): Promise<NanoCallResult<T>> {
    return this.nano._pollJob<T>(job, "/api/v1/videos/generations");
  }

  /** Poll until `completed` (returned) or `failed` (thrown — not charged). */
  wait<T extends NanoJobStatus = NanoJobStatus>(job: NanoVideoJob, opts: { intervalMs?: number; maxAttempts?: number } = {}): Promise<NanoCallResult<T>> {
    return this.nano._waitJob<T>(job, "/api/v1/videos/generations", opts);
  }
}

/** Music generation (one synchronous 30-120s call). */
export class MusicHelpers {
  constructor(private readonly nano: NanoClient) {}

  /** POST /api/v1/audio/generations — e.g. `minimax/music-2.5+`. */
  generate<T = unknown>(body: MusicRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/audio/generations", withAlias(body, "duration", "duration_seconds"));
  }
}

/** Text-to-speech and sound effects (ElevenLabs). */
export class AudioHelpers {
  constructor(private readonly nano: NanoClient) {}

  /** POST /api/v1/audio/speech — billed per input character; returns a hosted audio URL. */
  speech<T = unknown>(body: SpeechRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/audio/speech", withAlias(body, "format", "response_format"));
  }

  /** Alias of {@link speech}. */
  tts<T = unknown>(body: SpeechRequest): Promise<NanoCallResult<T>> {
    return this.speech<T>(body);
  }

  /** POST /api/v1/audio/sound-effects — up to 22s, flat price per generation. */
  soundEffects<T = unknown>(body: SoundEffectsRequest): Promise<NanoCallResult<T>> {
    return this.nano._payJson<T>("/api/v1/audio/sound-effects", body);
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
  const baseUrl = opts.facilitatorUrl ?? circleApiBaseUrl(chain);
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

function interpretCircleStatus(
  intentId: string,
  body: Record<string, unknown>,
  facilitatorUrl: string,
): PaymentStatus {
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
    facilitatorUrl,
    note: `Circle returned status="${status}" — ${status === "received" ? "verified, queued for next batch" : status === "batched" ? "batching in progress" : "still queued"}.`,
  };
}

// =============================================================================
// Re-exports
// =============================================================================

export { GatewayClient };
export type { SupportedChainName };
