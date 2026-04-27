/**
 * End-to-end test of @blockrun/nano-client against the live mainnet service.
 *
 * Flow:
 *   1. Load CLIENT_PRIVATE_KEY (Polygon mainnet wallet, must be pre-funded).
 *   2. Print balances. Bail with instructions if wallet is not funded.
 *   3. Deposit `DEPOSIT_USDC` into Circle Gateway (skipped if Gateway balance already sufficient).
 *   4. Call /api/v1/chat/completions with the cheapest mainnet model.
 *   5. Print the model response + payment receipt.
 *
 * Usage:
 *   tsx examples/e2e-test.ts
 *
 * Env:
 *   CLIENT_PRIVATE_KEY  required
 *   NANO_BASE_URL       optional override (defaults to Cloud Run direct URL)
 *   DEPOSIT_USDC        optional; default "0.10" (covers ~100 calls @ $0.001)
 *   TEST_MODEL          optional; default "openai/gpt-4o-mini"
 */

import "dotenv/config";
import {
  NanoClient,
  NANO_MAINNET_DIRECT_URL,
} from "../src/index.js";
import type { Hex } from "viem";

const PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY as Hex | undefined;
if (!PRIVATE_KEY) {
  console.error("❌ CLIENT_PRIVATE_KEY not set. Run `tsx examples/print-address.ts` first.");
  process.exit(1);
}

const BASE_URL = process.env.NANO_BASE_URL ?? NANO_MAINNET_DIRECT_URL;
const DEPOSIT_USDC = process.env.DEPOSIT_USDC ?? "0.10";
const TEST_MODEL = process.env.TEST_MODEL ?? "openai/gpt-4o-mini";

async function main() {
  console.log("=== blockrun-nano e2e test ===");
  console.log(`Endpoint    : ${BASE_URL}`);
  console.log(`Chain       : polygon (mainnet)`);
  console.log(`Test model  : ${TEST_MODEL}`);
  console.log("");

  const client = new NanoClient({
    chain: "polygon",
    privateKey: PRIVATE_KEY!,
    baseUrl: BASE_URL,
  });
  console.log(`Buyer wallet: ${client.address}`);
  console.log("");

  // ── Step 1: Check balances ────────────────────────────────────────────
  console.log("Step 1: Reading balances ...");
  const before = await client.getBalances();
  console.log(`  Wallet USDC (Polygon)       : ${before.wallet.formatted}`);
  console.log(`  Gateway available           : ${before.gateway.formattedAvailable}`);
  console.log(`  Gateway total               : ${before.gateway.formattedTotal}`);
  console.log("");

  if (
    before.wallet.balance === 0n &&
    before.gateway.available === 0n
  ) {
    console.error("❌ Wallet has 0 USDC and Gateway is empty.");
    console.error("");
    console.error("Fund this address on Polygon mainnet:");
    console.error(`  ${client.address}`);
    console.error("");
    console.error("Need:");
    console.error("  - 0.50 USDC  (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)");
    console.error("  - 0.05 MATIC (for approve + deposit gas)");
    console.error("");
    process.exit(2);
  }

  // ── Step 2: Deposit if Gateway balance is too low ─────────────────────
  const depositAtomic = BigInt(Math.floor(parseFloat(DEPOSIT_USDC) * 1_000_000));
  if (before.gateway.available < depositAtomic) {
    console.log(`Step 2: Depositing ${DEPOSIT_USDC} USDC into Circle Gateway ...`);
    if (before.wallet.balance < depositAtomic) {
      console.error(
        `❌ Wallet USDC (${before.wallet.formatted}) < deposit amount ($${DEPOSIT_USDC}).`,
      );
      process.exit(3);
    }
    try {
      const dep = await client.deposit(DEPOSIT_USDC);
      if (dep.approvalTxHash) {
        console.log(`  approve tx : ${dep.approvalTxHash}`);
      }
      console.log(`  deposit tx : ${dep.depositTxHash}`);
      console.log("  Waiting 12s for Circle indexer ...");
      await new Promise((r) => setTimeout(r, 12_000));
    } catch (err) {
      console.error("❌ Deposit failed:", err instanceof Error ? err.message : err);
      process.exit(4);
    }

    const mid = await client.getBalances();
    console.log(`  Gateway available now       : ${mid.gateway.formattedAvailable}`);
    console.log("");
  } else {
    console.log(
      `Step 2: Skipping deposit (Gateway already has ${before.gateway.formattedAvailable})`,
    );
    console.log("");
  }

  // ── Step 3: Make a paid chat completion call ──────────────────────────
  console.log("Step 3: Calling /api/v1/chat/completions ...");
  const start = Date.now();
  let result;
  try {
    result = await client.chat({
      model: TEST_MODEL,
      messages: [
        { role: "user", content: "Reply with exactly: blockrun-nano works ✓" },
      ],
      max_tokens: 40,
      temperature: 0,
    });
  } catch (err) {
    console.error("❌ Call failed:", err instanceof Error ? err.message : err);
    if (err instanceof Error && "cause" in err && err.cause) {
      console.error("   cause:", err.cause);
    }
    process.exit(5);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`  HTTP latency  : ${elapsed}s`);
  console.log(`  Paid          : ${result.payment.formattedAmount}`);
  console.log(`  Network       : ${result.payment.network}`);
  console.log(`  Batch ID      : ${result.payment.transaction}`);
  console.log("");
  console.log("Model response:");
  console.log(`  ${result.data.choices[0]?.message.content?.trim() ?? "<empty>"}`);
  console.log("");

  // ── Step 4: Final balance ─────────────────────────────────────────────
  const after = await client.getBalances();
  console.log(`Step 4: Gateway balance after call: ${after.gateway.formattedAvailable}`);
  console.log("");
  console.log("✅ End-to-end test complete.");
  console.log("");
  console.log(
    `Note: actual onchain settlement (debit + credit on Polygon) happens at the next
hourly batch boundary. Verify the seller treasury address gains USDC on
polygonscan.com/address/0xe9030014F5DAe217d0A152f02A043567b16c1aBf within 1 hour.`,
  );
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(99);
});
