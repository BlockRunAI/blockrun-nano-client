# Changelog

## 0.8.0

Synced `NanoClient` with the live nano.blockrun.ai API and hardened the payment path. Breaking changes are marked **(breaking)**; see "Migrating from 0.7" in the README.

### Payment safety
- The x402 flow now runs in the SDK (signing still uses Circle's `BatchEvmScheme`). Before signing, quotes are checked: right chain, Circle's real `GatewayWallet` as `verifyingContract`, valid non-zero `payTo`, integer `amount`.
- New `maxPaymentPerCall` option: refuse to sign any quote above a USDC cap.
- Retries cover only the unpaid quote request. A signed request is never retried, which removes a double-charge path on 502/503/connection resets.
- New `NanoRequestError` (`status`, `body`, `paymentSigned`) and `NanoPaymentRejectedError`. Server error messages are surfaced instead of "Request failed with status 400".
- `client.paymentScheme` exposes the Circle `BatchEvmScheme` used for signing; lifecycle hooks registered there (e.g. `onBeforePaymentCreation`) run for every NanoClient payment. **(breaking)** hooks registered on `client.gateway` no longer apply to NanoClient calls, and `client.gateway.pay()` bypasses the pre-sign checks.
- Config is validated: `maxPaymentPerCall` must be a non-negative amount with at most 6 decimals (`"0"` = free-only), `maxRetries` a non-negative integer.
- Malformed 402 quotes and non-JSON responses raise `NanoRequestError`. A paid response with an unparseable body is still counted in spend and flagged `paymentSigned`.
- `call()` rejects `stream: true`.
- New `timeoutMs` option (default 300s). Requests use `redirect: "error"`, so a signed header is never forwarded to another origin.

### API sync
- **(breaking)** `videos.generate()` returns a job; `videos.wait(job)` / `videos.status(job)` replay the submit-time authorization, as the server requires. Spend is recorded once, on the poll that settles; repeat polls of a finished job are not counted again. A `baseUrl` with a path prefix is preserved when polling.
- Slow image models (HTTP 202) return a job: `isNanoAsyncJob(r.data)`, then `images.wait(job)` / `images.status(job)`. Every 202 receipt reports `amount: 0n` (authorized, not charged).
- Transfer ids are also read from `X-Payment-Response` (pm, exa and Solana RPC routes).
- **(breaking)** `audio.tts()` / new `audio.speech()` call `/api/v1/audio/speech` (previously the music endpoint). Added `audio.soundEffects()`. Removed `audio.generate()`.
- `duration` → `duration_seconds` for video and music; the old name is mapped. Previously it was ignored and billed at the model default (e.g. a 1s Grok video was billed as 8s).
- **(breaking)** Removed `smartChat()` (nano has no smart routing) and the `x.*` / `price.price` / `price.history` helpers (not served by nano). `price.pm()` → `client.pm()`.
- `pm()` now works: those routes put the 402 quote in the body, which the SDK reads when the header is absent.
- Chat messages accept multimodal content parts for vision models.
- `getPaymentStatus()` uses Circle's testnet API for testnet chains and returns `unknown` for an empty id instead of a bogus `pending`.
- `PaymentReceipt.transaction` is documented as Circle's transfer UUID; `network` was added.

### Models and docs
- README / BUYER-GUIDE model references refreshed against the live catalog (89 models): the four current free NVIDIA models, featured flagships (GPT-6 Astra, GPT-5.6, Claude Opus 4.8, Gemini 3.8 Flash, Grok 4.6, Kimi K3, GLM-5.3, ...), current image / video / music / speech models.
- Example defaults moved to `openai/gpt-5.6-luna`.

### Packaging
- `@circle-fin/x402-batching` ^3.5.0 (adds Arc mainnet).
- Added the Apache-2.0 `LICENSE` file that `package.json` already declared.
- Added CI (build + tests on Node 20 and 22).
