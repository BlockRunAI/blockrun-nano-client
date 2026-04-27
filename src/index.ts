/**
 * @blockrun/nano-client — TypeScript client for blockrun-nano.
 *
 * Wraps Circle Gateway's `@circle-fin/x402-batching` GatewayClient with the
 * BlockRun nano endpoint pre-configured, plus typed helpers for the OpenAI-
 * compatible chat / images / search / x routes.
 *
 * Quick start:
 *   const client = new NanoClient({ chain: "polygon", privateKey: "0x..." });
 *   await client.deposit("5");
 *   const r = await client.chat({
 *     model: "openai/gpt-4o-mini",
 *     messages: [{ role: "user", content: "Hello!" }],
 *   });
 *   console.log(r.data.choices[0].message.content);
 */

import {
  GatewayClient,
  type SupportedChainName,
} from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

// =============================================================================
// Endpoints
// =============================================================================

export const NANO_MAINNET_URL = "https://nano.blockrun.ai";
export const NANO_TESTNET_URL = "https://testnet-nano.blockrun.ai";
/**
 * Direct Cloud Run URL for the production mainnet service. Use this when DNS
 * for nano.blockrun.ai is not yet in place.
 */
export const NANO_MAINNET_DIRECT_URL =
  "https://blockrun-nano-1092497648280.us-central1.run.app";

/**
 * Recommended public RPCs per chain. The default RPCs that ship with
 * `@circle-fin/x402-batching`'s CHAIN_CONFIGS are often rate-limited or stale
 * (e.g. polygon defaults to `poly.api.pocket.network` which routinely
 * returns 401 / lags blocks). When a buyer doesn't pass `rpcUrl` to
 * `NanoClient`, we fall back to one of these per chain.
 *
 * Override per chain via env: e.g. `RPC_URL_POLYGON=...`. For production,
 * use your own Alchemy / QuickNode / Infura key.
 */
export const RECOMMENDED_RPC_URLS: Partial<Record<SupportedChainName, string>> = {
  polygon: "https://1rpc.io/matic",
  arbitrum: "https://arbitrum.llamarpc.com",
  optimism: "https://optimism.llamarpc.com",
  unichain: "https://unichain.drpc.org",
  base: "https://base.llamarpc.com",
  // testnets — Circle Gateway sandbox
  polygonAmoy: "https://rpc-amoy.polygon.technology",
  arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc",
  optimismSepolia: "https://sepolia.optimism.io",
  unichainSepolia: "https://sepolia.unichain.org",
};

// =============================================================================
// Types
// =============================================================================

export interface NanoClientConfig {
  /** EVM private key (0x-prefixed). The address derived from this controls all 4 mainnet chains. */
  privateKey: Hex;
  /** Which chain holds your Circle Gateway balance. Buyer signs payments using this chain. */
  chain: SupportedChainName;
  /** Override base URL. Default: https://nano.blockrun.ai */
  baseUrl?: string;
  /** Optional custom RPC URL (defaults to public RPC from CHAIN_CONFIGS). */
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
  // Allow extra OpenAI-compatible fields.
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

export interface SearchRequest {
  query: string;
  [extra: string]: unknown;
}

/** Receipt-style metadata returned alongside every paid call. */
export interface PaymentReceipt {
  /**
   * Circle batch ID. Onchain settlement appears at the next batch boundary
   * (~hourly on the hour, moving toward ~15min).
   */
  transaction: string;
  /** Human-readable USDC amount, e.g. "$0.001000". */
  formattedAmount: string;
  /** Amount paid in USDC atomic units (micro-USDC). */
  amount: bigint;
  /** HTTP status code from the underlying request. */
  status: number;
}

export interface NanoCallResult<T> {
  data: T;
  payment: PaymentReceipt;
}

type GatewayPayInit = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

// =============================================================================
// NanoClient
// =============================================================================

export class NanoClient {
  readonly gateway: GatewayClient;
  readonly baseUrl: string;
  readonly chain: SupportedChainName;
  readonly maxRetries: number;

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
  }

  // ── Wallet / Gateway management (passthrough) ────────────────────────────

  /** Buyer wallet address derived from the private key. */
  get address(): `0x${string}` {
    return this.gateway.address;
  }

  /** Wallet + Gateway balances on the configured chain. */
  async getBalances() {
    return this.gateway.getBalances();
  }

  /** Move USDC from wallet → Circle Gateway escrow on the configured chain. */
  async deposit(amount: string) {
    return this.gateway.deposit(amount);
  }

  /**
   * Withdraw from Circle Gateway. Default: same chain (instant).
   * Pass `{ chain: 'X' }` to bridge across via Circle CCTP (~13 min).
   */
  async withdraw(amount: string, options?: { chain?: SupportedChainName }) {
    return options?.chain
      ? this.gateway.withdraw(amount, { chain: options.chain })
      : this.gateway.withdraw(amount);
  }

  // ── Paid endpoints (typed helpers) ────────────────────────────────────────

  /** POST /api/v1/chat/completions — OpenAI-compatible chat (non-streaming). */
  async chat(body: ChatCompletionsRequest): Promise<NanoCallResult<ChatCompletion>> {
    if ((body as { stream?: boolean }).stream) {
      throw new Error(
        "Streaming chat is not yet supported by @blockrun/nano-client v0.1. " +
          "Use the non-streaming form for now.",
      );
    }
    return this.payJson<ChatCompletion>("/api/v1/chat/completions", body);
  }

  /** POST /api/v1/images/generations — DALL-E / Flux / Gemini Nano Banana / etc. */
  async images<T = unknown>(body: ImagesRequest): Promise<NanoCallResult<T>> {
    return this.payJson<T>("/api/v1/images/generations", body);
  }

  /** POST /api/v1/search — Grok live search. */
  async search<T = unknown>(body: SearchRequest): Promise<NanoCallResult<T>> {
    return this.payJson<T>("/api/v1/search", body);
  }

  /** GET /api/v1/x/users/info?username=... — X/Twitter user lookup. */
  async xUserInfo<T = unknown>(username: string): Promise<NanoCallResult<T>> {
    const path = `/api/v1/x/users/info?username=${encodeURIComponent(username)}`;
    return this.payRequest<T>(path, { method: "GET" });
  }

  /**
   * Generic paid call. Use for endpoints not covered by typed helpers.
   *
   * @param path  e.g. "/api/v1/audio/generations"
   * @param init  pass `body` as a JS object — it will be JSON-encoded for you.
   */
  async call<T = unknown>(
    path: string,
    init: GatewayPayInit = {},
  ): Promise<NanoCallResult<T>> {
    return this.payRequest<T>(path, init);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async payJson<T>(path: string, body: unknown): Promise<NanoCallResult<T>> {
    return this.payRequest<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }

  private async payRequest<T>(
    path: string,
    init: GatewayPayInit,
  ): Promise<NanoCallResult<T>> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const result = await this.withRetry(() => this.gateway.pay<T>(url, init));
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
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err);
        if (!isRetryable(msg)) break;
        const delay = Math.min(500 * Math.pow(2, attempt), 5000);
        await sleep(delay);
      }
    }
    throw lastErr;
  }
}

const RETRYABLE_PAY_ERRORS = [
  "etimedout",
  "econnreset",
  "econnrefused",
  "fetch failed",
  "network error",
  "socket hang up",
  "service unavailable",
  "gateway timeout",
  "bad gateway",
  "status 502",
  "status 503",
  "status 504",
  "facilitator_timeout",
];

function isRetryable(msg: string): boolean {
  return RETRYABLE_PAY_ERRORS.some((e) => msg.includes(e));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// =============================================================================
// Re-exports
// =============================================================================

export { GatewayClient };
export type { SupportedChainName };
