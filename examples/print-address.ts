/**
 * Print the test buyer wallet address derived from CLIENT_PRIVATE_KEY.
 * If CLIENT_PRIVATE_KEY is unset, generates a fresh one and prints both
 * the key and the address (so you can save the key to .env and fund the
 * address).
 *
 * Usage:
 *   tsx examples/print-address.ts
 */

import "dotenv/config";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const existing = process.env.CLIENT_PRIVATE_KEY as Hex | undefined;
const key: Hex = existing ?? generatePrivateKey();
const address = privateKeyToAccount(key).address;

console.log("");
if (!existing) {
  console.log("# Generated a fresh test wallet:");
  console.log("");
  console.log(`CLIENT_PRIVATE_KEY=${key}`);
  console.log("");
  console.log("# Save the line above to .env so the rest of the test scripts can find it.");
  console.log("");
}

console.log("Wallet address (fund this on Polygon mainnet):");
console.log(`  ${address}`);
console.log("");
console.log("Send to this address on Polygon mainnet:");
console.log("  - 0.50 USDC  (USDC contract: 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)");
console.log("  - 0.05 MATIC (for gas — approve + deposit)");
console.log("");
console.log("Then run:  tsx examples/e2e-test.ts");
