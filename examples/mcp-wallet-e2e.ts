/**
 * End-to-end test using a LOCAL EVM wallet on Base (no native gas) → Eco
 * gasless ERC-3009 → Circle Gateway on Polygon → nano /v1/chat/completions.
 *
 * For this run we use the BlockRun MCP wallet (~/.blockrun/.session) which
 * holds ~$0.13 USDC on Base and 0 ETH (so we MUST use Eco's gasless path).
 *
 * Usage:
 *   tsx examples/mcp-wallet-e2e.ts
 *
 * Env (optional):
 *   PRIVATE_KEY      override the wallet private key
 *   AMOUNT_USDC      amount to bridge in USDC (default 0.10)
 *   NANO_BASE_URL    nano endpoint (default Cloud Run direct)
 *   TEST_MODEL       (default openai/gpt-4o-mini)
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import {
  createWalletClient,
  http,
  parseUnits,
  toHex,
  encodeAbiParameters,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  NanoClient,
  NANO_MAINNET_URL,
} from "../src/index.js";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ECO_API = "https://deposit-addresses.eco.com/api/v1";
const NANO_URL = process.env.NANO_BASE_URL ?? NANO_MAINNET_URL;
const AMOUNT_USDC = process.env.AMOUNT_USDC ?? "0.10";
const TEST_MODEL = process.env.TEST_MODEL ?? "openai/gpt-4o-mini";

function loadKey(): Hex {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY as Hex;
  const sessionFile = path.join(os.homedir(), ".blockrun", ".session");
  return fs.readFileSync(sessionFile, "utf8").trim() as Hex;
}

async function getEcoDepositAddress(buyer: Hex): Promise<{ depositAddress: Hex; addressID: string }> {
  const r = await fetch(`${ECO_API}/depositAddresses/gateway/polygon`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chainId: 8453,
      depositor: buyer,
      evmDestinationAddress: buyer,
    }),
  });
  if (!r.ok) throw new Error(`Eco depositAddresses failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { data: { evmDepositAddress: Hex; addressID: string } };
  return { depositAddress: j.data.evmDepositAddress, addressID: j.data.addressID };
}

async function signAndSubmitGasless(
  privateKey: Hex,
  depositAddress: Hex,
  amountUsdc: string,
): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: base, transport: http() });

  const value = parseUnits(amountUsdc, 6);
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex;

  const signature = await wallet.signTypedData({
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: BASE_USDC,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: depositAddress,
      value,
      validAfter,
      validBefore,
      nonce,
    },
  });

  const r = await fetch(`${ECO_API}/gasless/transferWithAuthorization`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chainId: 8453,
      from: account.address,
      to: depositAddress,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
      signature,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Eco gasless failed: ${r.status} ${text}`);

  const j = JSON.parse(text);
  // Try common keys for the job/intent id
  const id =
    j.data?.jobId ??
    j.data?.id ??
    j.data?.intentHash ??
    j.jobId ??
    j.id ??
    j.intentHash;
  if (!id) {
    console.warn("[eco] no job id found in response, raw:", text.slice(0, 600));
  }
  return id ?? text.slice(0, 80);
}

async function pollEcoJob(jobId: string, maxSec = 120): Promise<unknown> {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxSec) {
    const r = await fetch(`${ECO_API}/gasless/jobs/${encodeURIComponent(jobId)}`);
    if (r.ok) {
      const j = (await r.json()) as { data?: { status?: string; transferTxHash?: string; intentHash?: string } };
      const s = j.data?.status ?? "(unknown)";
      process.stdout.write(`\r  job ${jobId}: ${s}             `);
      if (s === "COMPLETED" || s === "FAILED") {
        process.stdout.write("\n");
        return j;
      }
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  process.stdout.write("\n");
  throw new Error("Eco job polling timeout");
}

async function main() {
  const privateKey = loadKey();
  const account = privateKeyToAccount(privateKey);
  console.log(`=== nano e2e via MCP wallet (Eco gasless bridge) ===`);
  console.log(`Buyer wallet : ${account.address}`);
  console.log(`Endpoint     : ${NANO_URL}`);
  console.log(`Amount       : $${AMOUNT_USDC} USDC (Base → Polygon Gateway)`);
  console.log(`Test model   : ${TEST_MODEL}`);
  console.log("");

  // Step 1: Eco deposit address
  console.log("Step 1: Generating Eco deposit address ...");
  const { depositAddress, addressID } = await getEcoDepositAddress(account.address);
  console.log(`  Eco deposit address (Base): ${depositAddress}`);
  console.log(`  Eco addressID            : ${addressID}`);
  console.log("");

  // Step 2: Sign & submit ERC-3009 (gasless)
  console.log("Step 2: Signing EIP-712 TransferWithAuthorization, submitting to Eco ...");
  const jobId = await signAndSubmitGasless(privateKey, depositAddress, AMOUNT_USDC);
  console.log(`  Eco job id : ${jobId}`);
  console.log("");

  // Step 3: Poll Eco job until COMPLETED
  console.log("Step 3: Waiting for Eco bridge to complete (~20-40s) ...");
  const job = await pollEcoJob(jobId);
  console.log(`  Eco bridge job result: ${JSON.stringify(job).slice(0, 400)}`);
  console.log("");

  // Step 4: Confirm Polygon Gateway balance for the buyer
  console.log("Step 4: Checking Polygon Gateway balance ...");
  const client = new NanoClient({
    chain: "polygon",
    privateKey,
    baseUrl: NANO_URL,
  });
  for (let i = 0; i < 12; i++) {
    const b = await client.getBalances();
    console.log(
      `  attempt ${i + 1}: gateway available = ${b.gateway.formattedAvailable} (wallet USDC ${b.wallet.formatted})`,
    );
    if (b.gateway.available >= 5_000n) break; // at least $0.005 to safely call once
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("");

  // Step 5: Call nano /v1/chat/completions
  console.log(`Step 5: Calling /api/v1/chat/completions on ${NANO_URL} ...`);
  const start = Date.now();
  const r = await client.chat({
    model: TEST_MODEL,
    messages: [
      { role: "user", content: "Reply with exactly: blockrun-nano works ✓" },
    ],
    max_tokens: 30,
    temperature: 0,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`  HTTP latency   : ${elapsed}s`);
  console.log(`  Paid           : ${r.payment.formattedAmount}`);
  console.log(`  Batch ID       : ${r.payment.transaction}`);
  console.log("");
  console.log("Model response :");
  console.log("  " + (r.data.choices[0]?.message.content?.trim() ?? "<empty>"));
  console.log("");

  const after = await client.getBalances();
  console.log(`Final Polygon Gateway balance: ${after.gateway.formattedAvailable}`);
  console.log("");
  console.log("✅ End-to-end test passed.");
}

main().catch((err) => {
  console.error("\n❌ Failed:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
});
