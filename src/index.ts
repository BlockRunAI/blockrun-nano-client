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
   * Circle nanopayment intent UUID returned by `BatchFacilitatorClient.settle()`.
   * On-chain settlement happens asynchronously when Circle batches the seller
   * queue. Use {@link NanoClient.getPaymentStatus} (best-effort) or
   * {@link NanoClient.waitForSettlement} to track this intent's progress.
   */
  transaction: string;
  /** Human-readable USDC amount, e.g. "$0.001000". */
  formattedAmount: string;
  /** Amount paid in USDC atomic units (micro-USDC). */
  amount: bigint;
  /** HTTP status code from the underlying request. */
  status: number;
}

/**
 * Status of a Circle Gateway nanopayment intent.
 *
 * Note: as of Circle Gateway SDK v3.0.x, no public API endpoint exists to
 * query the live status of a nanopayment intent — `BatchFacilitatorClient`
 * only exposes `/verify`, `/settle`, `/supported`. {@link NanoClient.getPaymentStatus}
 * probes likely URL paths and falls back to `unknown` until Circle publishes
 * an official endpoint.
 */
export type PaymentStatus =
  | {
      status: "pending";
      intentId: string;
      note: string;
      facilitatorUrl: string;
    }
  | {
      status: "settled";
      intentId: string;
      transactionHash?: string;
      settledAt?: string;
      raw?: unknown;
    }
  | {
      status: "failed";
      intentId: string;
      reason?: string;
      raw?: unknown;
    }
  | {
      status: "unknown";
      intentId: string;
      note: string;
      facilitatorUrl: string;
    };

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

  // ── Payment intent tracking ──────────────────────────────────────────────

  /**
   * Look up a Circle Gateway nanopayment intent's status.
   *
   * Hits `GET https://gateway-api.circle.com/v1/x402/transfers/{id}`, which
   * returns the full transfer record including `status`, `fromAddress`,
   * `toAddress`, `amount`, `createdAt`, `updatedAt`.
   *
   * Note (2026-04): Circle's `status: "completed"` indicates the facilitator
   * has internally settled the intent — but the corresponding on-chain ERC-20
   * Transfer to the seller's `payTo` address may still be pending if the
   * seller's queue hasn't been swept on-chain yet. Treat the on-chain
   * `Transfer(from=GatewayWallet|GatewayMinter, to=payTo)` event as the
   * definitive settlement signal.
   *
   * @param intentId  the UUID returned in `PaymentReceipt.transaction`
   *                  (= `BatchFacilitatorClient.settle()`'s `transaction`)
   */
  async getPaymentStatus(intentId: string): Promise<PaymentStatus> {
    const facilitatorUrl = this.facilitatorUrlForChain();
    const url = `${facilitatorUrl}/v1/x402/transfers/${encodeURIComponent(intentId)}`;
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.status === 404) {
        return {
          status: "unknown",
          intentId,
          facilitatorUrl,
          note: "Circle returned 404 — intent not found. Either the ID is wrong or it hasn't been registered yet.",
        };
      }
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          status: "unknown",
          intentId,
          facilitatorUrl,
          note: `Circle returned HTTP ${r.status}: ${text.slice(0, 200)}`,
        };
      }
      const body = (await r.json()) as Record<string, unknown>;
      return interpretCircleStatus(intentId, body);
    } catch (err) {
      return {
        status: "unknown",
        intentId,
        facilitatorUrl,
        note: `Network error querying Circle: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Poll {@link getPaymentStatus} until the intent reaches a terminal state
   * (`settled` or `failed`) or the timeout expires. Returns the last status
   * observed; if Circle hasn't shipped the status endpoint, expect
   * `{ status: "unknown" }` and fall back to onchain Transfer event watching.
   */
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

  private facilitatorUrlForChain(): string {
    // Day-1 nano routes everything through Circle's public mainnet facilitator.
    return "https://gateway-api.circle.com";
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

/**
 * Best-effort interpretation of Circle's (hypothetical) status response. We
 * cover the most likely shapes — the actual API isn't documented yet, so this
 * is forward-compatible scaffolding. Once Circle publishes the spec, narrow
 * this function to the real shape.
 */
/**
 * Map Circle's `/v1/x402/transfers/{id}` response onto our PaymentStatus.
 *
 * Real response shape (verified 2026-04-28):
 *   { id, status: "completed" | "pending" | ..., token, sendingNetwork,
 *     recipientNetwork, fromAddress, toAddress, amount, createdAt, updatedAt }
 *
 * Caveat: `status: "completed"` from Circle means internally settled — does
 * NOT guarantee an on-chain Transfer to `toAddress` has been mined yet for
 * fresh seller addresses or sub-threshold amounts. Watch for the on-chain
 * Transfer event as the definitive signal.
 */
function interpretCircleStatus(
  intentId: string,
  body: Record<string, unknown>,
): PaymentStatus {
  const status = String(body.status ?? "").toLowerCase();
  const txHash =
    (body.transactionHash as string | undefined) ??
    (body.onchainTx as string | undefined);
  const settledAt =
    (body.updatedAt as string | undefined) ??
    (body.settledAt as string | undefined) ??
    (body.completedAt as string | undefined);

  if (status === "completed" || status === "settled" || status === "succeeded") {
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
    note: `Circle returned status="${status}" — still queued.`,
  };
}

// =============================================================================
// Re-exports
// =============================================================================

export { GatewayClient };
export type { SupportedChainName };
