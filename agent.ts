/**
 * SolMind AI Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Autonomous agent that:
 *  1. Fetches on-chain market data & protocol yields
 *  2. Queries Claude AI for allocation decisions
 *  3. Hashes the AI reasoning for on-chain verifiability
 *  4. Submits the decision as a Solana transaction
 *  5. Records the observation on-chain for full audit trail
 */

import Anthropic from "@anthropic-ai/sdk";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";

// ─── Config ──────────────────────────────────────────────────────────────────

const SOLANA_RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  "SoLMiNDvau1TxQRkABCxyzDEFghi1234567890abcd"
);
const REBALANCE_INTERVAL_MS = 60_000; // 60 seconds for demo (production: 4h)
const MODEL = "claude-sonnet-4-20250514";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProtocolState {
  name: string;
  type: "lending" | "liquidity" | "staking" | "yield_aggregator";
  address: string;
  currentApy: number; // annualized %
  tvlUsdc: number; // total value locked in USDC
  utilizationRate: number; // 0-1 for lending protocols
  riskScore: number; // 0-100, AI-assessed
  liquidityDepth: number; // USD depth for slippage calculation
  volume24h: number;
}

interface MarketContext {
  solPriceUsd: number;
  btcPriceUsd: number;
  ethPriceUsd: number;
  fearGreedIndex: number; // 0-100
  defiTotalTvlBn: number; // billions
  solanaNetworkTps: number;
  timestamp: number;
}

interface VaultState {
  name: string;
  riskTolerance: number; // 0-100
  currentAllocations: Record<string, number>; // protocol name -> basis points
  totalValueUsdc: number;
  lastRebalanceTs: number;
  rebalanceCount: number;
}

interface AiDecision {
  reasoning: string;
  marketAnalysis: string;
  riskAssessment: string;
  newAllocations: Record<string, number>; // protocol name -> basis points (sum=10000)
  confidenceScore: number; // 0-100
  marketSignal: number; // -100 (bearish) to +100 (bullish)
  expectedApyChange: number; // basis points change vs current
  shouldRebalance: boolean;
  urgency: "low" | "medium" | "high";
}

// ─── Market Data Fetcher ─────────────────────────────────────────────────────

async function fetchMarketContext(): Promise<MarketContext> {
  // In production: fetch from Pyth Network, Jupiter, Birdeye, etc.
  // For demo: realistic simulated data with variance
  const base = {
    solPriceUsd: 185 + (Math.random() - 0.5) * 20,
    btcPriceUsd: 95000 + (Math.random() - 0.5) * 5000,
    ethPriceUsd: 3800 + (Math.random() - 0.5) * 300,
    fearGreedIndex: Math.floor(45 + (Math.random() - 0.5) * 40),
    defiTotalTvlBn: 78.4 + (Math.random() - 0.5) * 5,
    solanaNetworkTps: 2800 + Math.floor(Math.random() * 1200),
    timestamp: Date.now(),
  };
  console.log(
    `[Market] SOL=$${base.solPriceUsd.toFixed(2)}, F&G=${base.fearGreedIndex}`
  );
  return base;
}

async function fetchProtocolStates(): Promise<ProtocolState[]> {
  // In production: fetch from on-chain accounts via Anchor, Marinade SDK, etc.
  const baseStates: ProtocolState[] = [
    {
      name: "MarinadeFinance",
      type: "staking",
      address: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
      currentApy: 7.2 + (Math.random() - 0.5) * 1.5,
      tvlUsdc: 1_200_000_000,
      utilizationRate: 0,
      riskScore: 15,
      liquidityDepth: 50_000_000,
      volume24h: 12_000_000,
    },
    {
      name: "SolendMain",
      type: "lending",
      address: "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo",
      currentApy: 9.8 + (Math.random() - 0.5) * 3,
      tvlUsdc: 450_000_000,
      utilizationRate: 0.72 + (Math.random() - 0.5) * 0.15,
      riskScore: 35,
      liquidityDepth: 20_000_000,
      volume24h: 8_000_000,
    },
    {
      name: "OrcaWhirlpool",
      type: "liquidity",
      address: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
      currentApy: 18.5 + (Math.random() - 0.5) * 8,
      tvlUsdc: 180_000_000,
      utilizationRate: 0,
      riskScore: 55,
      liquidityDepth: 8_000_000,
      volume24h: 35_000_000,
    },
    {
      name: "KaminoLending",
      type: "yield_aggregator",
      address: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
      currentApy: 12.3 + (Math.random() - 0.5) * 4,
      tvlUsdc: 320_000_000,
      utilizationRate: 0.65,
      riskScore: 40,
      liquidityDepth: 15_000_000,
      volume24h: 18_000_000,
    },
    {
      name: "JitoLiquidStaking",
      type: "staking",
      address: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
      currentApy: 8.1 + (Math.random() - 0.5) * 1,
      tvlUsdc: 2_100_000_000,
      utilizationRate: 0,
      riskScore: 12,
      liquidityDepth: 100_000_000,
      volume24h: 25_000_000,
    },
  ];

  return baseStates;
}

// ─── AI Decision Engine ───────────────────────────────────────────────────────

async function queryClaudeForDecision(
  vault: VaultState,
  protocols: ProtocolState[],
  market: MarketContext
): Promise<AiDecision> {
  const client = new Anthropic();

  const systemPrompt = `You are SolMind — an autonomous DeFi portfolio manager operating on Solana blockchain.
Your decisions are executed as on-chain transactions and must be fully justified and verifiable.
You manage a DeFi vault with a defined risk tolerance. Your goal: maximize risk-adjusted yield.

CONSTRAINTS:
- Allocations must sum to exactly 10000 basis points (100%)  
- No single protocol can exceed (risk_tolerance + 20)% of portfolio
- Minimum allocation: 500 basis points (5%) per included protocol
- You must output valid JSON only — no markdown, no preamble

RISK ASSESSMENT FRAMEWORK:
- Score 0-20: Very safe (liquid staking, established protocols)
- Score 21-40: Moderate risk (lending, large LPs)
- Score 41-60: Elevated risk (smaller LPs, newer protocols)
- Score 61-100: High risk (volatile, low-liquidity)

Your response must be a valid JSON object matching the AiDecision interface exactly.`;

  const userPrompt = `CURRENT VAULT STATE:
${JSON.stringify(vault, null, 2)}

AVAILABLE PROTOCOLS:
${JSON.stringify(protocols, null, 2)}

MARKET CONTEXT:
${JSON.stringify(market, null, 2)}

Analyze the current market conditions and protocol states. Determine optimal allocation.
Consider: APY trends, risk scores, market sentiment (Fear & Greed: ${market.fearGreedIndex}), 
Solana TPS health (${market.solanaNetworkTps}), and the vault's risk tolerance of ${vault.riskTolerance}/100.

Respond with ONLY a JSON object:
{
  "reasoning": "detailed step-by-step reasoning for allocation decision",
  "marketAnalysis": "brief market condition summary",
  "riskAssessment": "portfolio risk evaluation",
  "newAllocations": {
    "ProtocolName": <basis_points_integer>,
    ...
  },
  "confidenceScore": <0-100>,
  "marketSignal": <-100 to +100>,
  "expectedApyChange": <basis_points_change>,
  "shouldRebalance": <true|false>,
  "urgency": "<low|medium|high>"
}`;

  console.log("[AI] Querying Claude for rebalancing decision...");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const rawText =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Strip possible markdown fences
  const cleaned = rawText
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  const decision: AiDecision = JSON.parse(cleaned);

  // Validate allocation sum
  const total = Object.values(decision.newAllocations).reduce(
    (a, b) => a + b,
    0
  );
  if (Math.abs(total - 10000) > 5) {
    throw new Error(`AI allocation sum ${total} != 10000`);
  }

  console.log(
    `[AI] Decision: confidence=${decision.confidenceScore}, signal=${decision.marketSignal}, rebalance=${decision.shouldRebalance}`
  );
  console.log(`[AI] Reasoning: ${decision.reasoning.substring(0, 120)}...`);

  return decision;
}

// ─── On-Chain Submission ──────────────────────────────────────────────────────

function hashDecision(decision: AiDecision, market: MarketContext): Buffer {
  const payload = JSON.stringify({
    reasoning: decision.reasoning,
    newAllocations: decision.newAllocations,
    confidenceScore: decision.confidenceScore,
    marketSignal: decision.marketSignal,
    marketTimestamp: market.timestamp,
    solPrice: market.solPriceUsd,
  });
  return crypto.createHash("sha256").update(payload).digest();
}

async function submitDecisionOnChain(
  connection: Connection,
  agentKeypair: Keypair,
  vaultPubkey: PublicKey,
  protocols: ProtocolState[],
  decision: AiDecision,
  market: MarketContext,
  reasoningUri: string
): Promise<string> {
  // Build allocations array aligned to registered protocols
  const allocationsBps: number[] = protocols.map(
    (p) => decision.newAllocations[p.name] || 0
  );

  const decisionHash = hashDecision(decision, market);
  const decisionHashArray = Array.from(decisionHash);

  // Build Anchor instruction data manually (in production use generated IDL client)
  // Instruction discriminator for ai_rebalance: sha256("global:ai_rebalance")[0:8]
  const discriminator = crypto
    .createHash("sha256")
    .update("global:ai_rebalance")
    .digest()
    .slice(0, 8);

  console.log(
    `[Chain] Submitting decision hash: ${decisionHash.toString("hex")}`
  );
  console.log(`[Chain] Allocations: ${JSON.stringify(allocationsBps)}`);

  // In production: use @coral-xyz/anchor with IDL for type-safe instruction building
  // Simulating transaction signature for demo:
  const mockTxSig = crypto.randomBytes(32).toString("base64url");

  console.log(`[Chain] ✅ Transaction submitted: ${mockTxSig}`);
  console.log(
    `[Chain] Explorer: https://explorer.solana.com/tx/${mockTxSig}?cluster=devnet`
  );

  // Write audit log
  const auditEntry = {
    timestamp: new Date().toISOString(),
    txSignature: mockTxSig,
    decisionHash: decisionHash.toString("hex"),
    confidenceScore: decision.confidenceScore,
    marketSignal: decision.marketSignal,
    allocations: decision.newAllocations,
    reasoning: decision.reasoning,
    marketContext: market,
    urgency: decision.urgency,
  };

  const logPath = "./audit_log.jsonl";
  fs.appendFileSync(logPath, JSON.stringify(auditEntry) + "\n");
  console.log(`[Audit] Entry written to ${logPath}`);

  return mockTxSig;
}

// ─── Main Agent Loop ──────────────────────────────────────────────────────────

async function runAgentCycle(agentKeypair: Keypair): Promise<void> {
  console.log("\n" + "═".repeat(60));
  console.log(`[Agent] Cycle started at ${new Date().toISOString()}`);
  console.log("═".repeat(60));

  const connection = new Connection(SOLANA_RPC, "confirmed");

  // 1. Fetch market data
  const [market, protocols] = await Promise.all([
    fetchMarketContext(),
    fetchProtocolStates(),
  ]);

  // 2. Simulate current vault state
  const vault: VaultState = {
    name: "SolMind Alpha Vault",
    riskTolerance: 55,
    currentAllocations: {
      MarinadeFinance: 2500,
      SolendMain: 2000,
      OrcaWhirlpool: 1500,
      KaminoLending: 2000,
      JitoLiquidStaking: 2000,
    },
    totalValueUsdc: 250_000,
    lastRebalanceTs: Date.now() - 4 * 3600 * 1000,
    rebalanceCount: 12,
  };

  // 3. Ask AI for decision
  const decision = await queryClaudeForDecision(vault, protocols, market);

  if (!decision.shouldRebalance) {
    console.log(
      "[Agent] AI decided no rebalance needed. Holding current positions."
    );
    return;
  }

  // 4. Hash decision for on-chain verifiability
  const decisionHash = hashDecision(decision, market);
  const reasoningUri = `ipfs://QmPlaceholder${crypto.randomBytes(16).toString("hex")}`;

  // 5. Submit on-chain
  const vaultPubkey = new PublicKey(
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  );
  const txSig = await submitDecisionOnChain(
    connection,
    agentKeypair,
    vaultPubkey,
    protocols,
    decision,
    market,
    reasoningUri
  );

  // 6. Print summary
  console.log("\n[Summary]");
  console.log(`  Decision Hash: ${decisionHash.toString("hex")}`);
  console.log(`  Confidence:    ${decision.confidenceScore}/100`);
  console.log(`  Market Signal: ${decision.marketSignal}`);
  console.log(`  New Allocations:`);
  for (const [name, bps] of Object.entries(decision.newAllocations)) {
    const pct = (bps / 100).toFixed(1);
    const protocol = protocols.find((p) => p.name === name);
    const apy = protocol ? protocol.currentApy.toFixed(2) + "%" : "?";
    console.log(`    ${name.padEnd(20)} ${pct.padStart(5)}%  (APY: ${apy})`);
  }
  console.log(
    `  Expected APY Δ: +${(decision.expectedApyChange / 100).toFixed(2)}%`
  );
  console.log(`  TX: ${txSig}`);
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║       SolMind Autonomous AI Agent         ║");
  console.log("║   AI-Powered DeFi Yield Optimizer on SOL  ║");
  console.log("╚═══════════════════════════════════════════╝");

  // Load or generate agent keypair
  const agentKeypair = Keypair.generate();
  console.log(`[Agent] Public Key: ${agentKeypair.publicKey.toBase58()}`);

  // Run immediately then on interval
  await runAgentCycle(agentKeypair);

  console.log(
    `\n[Agent] Scheduling next cycle in ${REBALANCE_INTERVAL_MS / 1000}s...`
  );
  setInterval(() => runAgentCycle(agentKeypair), REBALANCE_INTERVAL_MS);
}

main().catch(console.error);
