import type {
  AudioRequest,
  ChatCompletion,
  ChatCompletionsRequest,
  ImageEditRequest,
  ImagesRequest,
  MusicRequest,
  SearchRequest,
  VideosRequest,
} from "./index.js";

export const BLOCKRUN_ACCOUNT_API_URL = "https://api.blockrun.ai";
export const BLOCKRUN_ACCOUNT_PORTAL_URL = "https://user.blockrun.ai";

export interface BlockRunAccountClientConfig {
  /** Account key created at https://user.blockrun.ai/dashboard/keys. */
  apiKey: string;
  /** Account API origin. Default: https://api.blockrun.ai. */
  baseUrl?: string;
  /** Deadline per request, including streamed response reads. Default 120 seconds. */
  timeoutMs?: number;
}

export interface AccountBillingReceipt {
  mode: "account";
  status: number;
}

export interface AccountCallResult<T> {
  data: T;
  billing: AccountBillingReceipt;
}

export class BlockRunAccountError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter: string | null) {
    super(message);
    this.name = "BlockRunAccountError";
  }
}

export interface AccountMediaJob {
  status?: string;
  poll_url?: string;
  [field: string]: unknown;
}

export type AccountRequestInit = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * Account-billed companion to NanoClient.
 *
 * NanoClient retains Circle Gateway receipt semantics. This separate client
 * exposes the same product routes without inventing a wallet transaction for
 * account-billed requests.
 */
export class BlockRunAccountClient {
  readonly baseUrl: string;
  readonly authMode = "account" as const;
  readonly images = new AccountImagesHelpers(this);
  readonly videos = new AccountVideosHelpers(this);
  readonly music = new AccountMusicHelpers(this);
  readonly audio = new AccountAudioHelpers(this);
  readonly price = new AccountPriceHelpers(this);
  readonly x = new AccountXHelpers(this);
  readonly #apiKey: string;
  readonly #timeoutMs: number;

  constructor(config: BlockRunAccountClientConfig) {
    if (!/^brk_[A-Za-z0-9_-]+$/.test(config.apiKey.trim())) {
      throw new Error(`Invalid BlockRun API key. Create one at ${BLOCKRUN_ACCOUNT_PORTAL_URL}/dashboard/keys.`);
    }
    const base = (config.baseUrl ?? BLOCKRUN_ACCOUNT_API_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("Account API base URL must be a credential-free HTTPS origin.");
    }
    this.#timeoutMs = config.timeoutMs ?? 120_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) throw new Error("timeoutMs must be positive and finite.");
    this.baseUrl = url.origin;
    this.#apiKey = config.apiKey.trim();
  }

  async chat(body: ChatCompletionsRequest): Promise<AccountCallResult<ChatCompletion>> {
    if ((body as { stream?: boolean }).stream) {
      throw new Error("Use chatStream() for streaming account responses.");
    }
    return this.post<ChatCompletion>("/v1/chat/completions", body);
  }

  async ask(model: string, prompt: string, options: { system?: string; max_tokens?: number; temperature?: number } = {}): Promise<string> {
    const messages: ChatCompletionsRequest["messages"] = [];
    if (options.system) messages.push({ role: "system", content: options.system });
    messages.push({ role: "user", content: prompt });
    const result = await this.chat({
      model,
      messages,
      ...(options.max_tokens !== undefined ? { max_tokens: options.max_tokens } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    });
    return result.data.choices[0]?.message.content ?? "";
  }

  async *chatStream(body: ChatCompletionsRequest): AsyncGenerator<unknown> {
    const response = await this.fetchResponse("/v1/chat/completions", {
      method: "POST",
      body: { ...body, stream: true },
      headers: { accept: "text/event-stream" },
    });
    if (!response.body) throw new Error("Account API stream returned no response body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dataLines: string[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        // Flush an unterminated final event; CRLF may span network chunks.
        if (done) buffer += "\n\n";
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end).replace(/\r$/, "");
          buffer = buffer.slice(end + 1);
          if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
          if (line !== "" || !dataLines.length) continue;
          const data = dataLines.join("\n");
          dataLines = [];
          if (data === "[DONE]") return;
          let chunk: unknown;
          try { chunk = JSON.parse(data); }
          catch { throw new Error("Invalid JSON in account API stream."); }
          if (chunk && typeof chunk === "object" && "error" in chunk) {
            throw new Error("Account API stream reported an error.");
          }
          yield chunk;
        }
        if (done) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  /** Poll the returned signed URL; never resubmits the generation request. */
  async poll<T extends AccountMediaJob = AccountMediaJob>(pollUrl: string, options: { intervalMs?: number; maxAttempts?: number } = {}): Promise<AccountCallResult<T>> {
    const interval = options.intervalMs ?? 5_000;
    const attempts = options.maxAttempts ?? 60;
    if (!Number.isFinite(interval) || interval < 0 || !Number.isInteger(attempts) || attempts < 1) {
      throw new Error("Polling requires a nonnegative interval and positive integer maxAttempts.");
    }
    for (let attempt = 0; attempt < attempts; attempt++) {
      const result = await this.get<T>(pollUrl);
      if (result.data.status === "completed" || result.data.status === "succeeded") return result;
      if (["failed", "cancelled", "canceled", "error"].includes(result.data.status ?? "")) {
        throw new Error("Account media generation failed or was cancelled.");
      }
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error("Account media polling timed out. Resume polling the same poll_url; do not resubmit the job.");
  }

  search<T = unknown>(body: SearchRequest): Promise<AccountCallResult<T>> {
    return this.post<T>("/v1/search", body);
  }

  listModels<T = unknown>(): Promise<AccountCallResult<T>> {
    return this.request<T>("/v1/models", { method: "GET" });
  }

  call<T = unknown>(path: string, init: AccountRequestInit = {}): Promise<AccountCallResult<T>> {
    return this.request<T>(path, init);
  }

  /** @internal Used by account product helpers. */
  post<T>(path: string, body: unknown): Promise<AccountCallResult<T>> {
    return this.request<T>(path, { method: "POST", body });
  }

  /** @internal Used by account product helpers. */
  get<T>(path: string, params: Record<string, unknown> = {}): Promise<AccountCallResult<T>> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      query.set(name, Array.isArray(value) ? value.join(",") : String(value));
    }
    return this.request<T>(query.size ? `${path}?${query}` : path, { method: "GET" });
  }

  private async request<T>(path: string, init: AccountRequestInit): Promise<AccountCallResult<T>> {
    const response = await this.fetchResponse(path, init);
    const data = await response.json() as T;
    return { data, billing: { mode: "account", status: response.status } };
  }

  private async fetchResponse(path: string, init: AccountRequestInit): Promise<Response> {
    const url = new URL(path, `${this.baseUrl}/`);
    if (url.origin !== this.baseUrl || url.username || url.password || url.hash ||
        !/^\/(?:api\/)?v1\//.test(url.pathname) || url.pathname.includes("\\")) {
      throw new Error("Account API URLs must stay on the configured origin under /v1/ or /api/v1/.");
    }
    const headers = new Headers(init.headers);
    for (const name of [...headers.keys()]) {
      if (name.toLowerCase().includes("payment") || name.toLowerCase() === "x-api-key") headers.delete(name);
    }
    headers.set("authorization", `Bearer ${this.#apiKey}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      const raw = (await response.text()).split(this.#apiKey).join("[REDACTED]").slice(0, 500);
      const hint = response.status === 401
        ? ` Check your key at ${BLOCKRUN_ACCOUNT_PORTAL_URL}/dashboard/keys.`
        : response.status === 402
          ? ` Add credits at ${BLOCKRUN_ACCOUNT_PORTAL_URL}/dashboard/credits.`
          : "";
      throw new BlockRunAccountError(`BlockRun account API error ${response.status}.${hint}${raw ? ` ${raw}` : ""}`, response.status, response.headers.get("retry-after"));
    }
    return response;
  }
}

export class AccountImagesHelpers {
  constructor(private readonly account: BlockRunAccountClient) {}
  generate<T = unknown>(body: ImagesRequest): Promise<AccountCallResult<T>> {
    return this.account.post<T>("/v1/images/generations", body);
  }
  edit<T = unknown>(body: ImageEditRequest): Promise<AccountCallResult<T>> {
    return this.account.post<T>("/v1/images/image2image", body);
  }
}

export class AccountVideosHelpers {
  constructor(private readonly account: BlockRunAccountClient) {}
  generate<T = unknown>(body: VideosRequest): Promise<AccountCallResult<T>> {
    const { duration, ...request } = body;
    return this.account.post<T>("/v1/videos/generations", {
      ...request,
      ...(request.duration_seconds === undefined && duration !== undefined ? { duration_seconds: duration } : {}),
    });
  }
  /** Pass the full poll_url from generate(), including its signed query. */
  status<T = unknown>(pollUrl: string): Promise<AccountCallResult<T>> {
    return this.account.get<T>(pollUrl);
  }
}

export class AccountMusicHelpers {
  constructor(private readonly account: BlockRunAccountClient) {}
  generate<T = unknown>(body: MusicRequest): Promise<AccountCallResult<T>> {
    return this.account.post<T>("/v1/audio/generations", body);
  }
}

export class AccountAudioHelpers {
  constructor(private readonly account: BlockRunAccountClient) {}
  generate<T = unknown>(body: AudioRequest): Promise<AccountCallResult<T>> {
    return this.account.post<T>("/v1/audio/generations", body);
  }
  soundEffects<T = unknown>(body: { model: string; text: string; duration_seconds?: number; [field: string]: unknown }): Promise<AccountCallResult<T>> {
    return this.account.post<T>("/v1/audio/sound-effects", body);
  }
  tts<T = unknown>(body: AudioRequest): Promise<AccountCallResult<T>> {
    const { format, ...request } = body;
    return this.account.post<T>("/v1/audio/speech", {
      ...request,
      ...(request.response_format === undefined && format !== undefined ? { response_format: format } : {}),
    });
  }
}

export class AccountPriceHelpers {
  constructor(private readonly account: BlockRunAccountClient) {}
  price<T = unknown>(symbol: string): Promise<AccountCallResult<T>> {
    return this.account.get<T>(`/v1/crypto/price/${encodeURIComponent(symbol.replace("/", "-"))}`);
  }
  history<T = unknown>(symbol: string, options: { from: number; to: number; resolution?: string }): Promise<AccountCallResult<T>> {
    return this.account.get<T>(`/v1/crypto/history/${encodeURIComponent(symbol.replace("/", "-"))}`, options);
  }
  pm<T = unknown>(path: string, params: Record<string, unknown> = {}): Promise<AccountCallResult<T>> {
    return this.account.get<T>(`/v1/pm/${path.replace(/^\/+/, "")}`, params);
  }
}

export class AccountXHelpers {
  constructor(private readonly account: BlockRunAccountClient) {}
  call<T = unknown>(path: string, params: Record<string, unknown> = {}): Promise<AccountCallResult<T>> {
    return this.account.get<T>(`/v1/x/${path.replace(/^\/+/, "")}`, params);
  }
}
