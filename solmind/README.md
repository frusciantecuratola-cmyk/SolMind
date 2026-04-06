# ⚡ SolMind — Autonomous AI Yield Optimizer on Solana

> **National Solana Hackathon by Decentrathon** | Track: AI + Blockchain: Autonomous Smart Contracts

---

## 🧠 What is SolMind?

SolMind is a **fully autonomous DeFi portfolio management system** where an AI agent (Claude) continuously analyzes on-chain market conditions and executes rebalancing decisions — all verifiable on the Solana blockchain.

### The Core Loop

```
Market Data → Claude AI Analysis → Decision Hash → Solana Transaction → State Change
     ↑                                                                         ↓
     └─────────────────────── On-chain Audit Trail ──────────────────────────┘
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SolMind System                              │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  Data Layer  │    │    AI Engine     │    │  On-Chain Layer  │  │
│  │              │    │                  │    │                  │  │
│  │ • Pyth feeds │───▶│ Claude Sonnet 4  │───▶│ Solana Program   │  │
│  │ • Protocol   │    │                  │    │ (Anchor/Rust)    │  │
│  │   on-chain   │    │ • Risk scoring   │    │                  │  │
│  │   accounts   │    │ • Yield analysis │    │ • Vault state    │  │
│  │ • Jupiter    │    │ • Allocation opt │    │ • Decision hash  │  │
│  │   aggregator │    │ • Market signal  │    │ • Audit trail    │  │
│  │              │    │                  │    │ • Access control │  │
│  └──────────────┘    └────────┬─────────┘    └────────▲─────────┘  │
│                               │                        │            │
│                               │   SHA-256 hash +       │            │
│                               └───── tx submission ────┘            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     Frontend Dashboard                       │   │
│  │  Live allocations • AI reasoning • Decision history • Chat   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ✅ How it meets the requirements

| Requirement | Implementation |
|-------------|----------------|
| **AI takes part in decision-making** | Claude Sonnet 4 analyzes 5 protocols' APY, TVL, risk, utilization + market context |
| **Decisions lead to on-chain state change** | `ai_rebalance` instruction updates vault allocation state + emits events |
| **AI decision is verifiable on-chain** | SHA-256 hash of full AI reasoning JSON stored in vault account |
| **Semi/fully autonomous operation** | Agent runs on 4h interval; triggers rebalance automatically when warranted |
| **Solana blockchain** | Anchor program deployed on Devnet |
| **Demo** | React dashboard with live AI chat + decision history |

---

## 🔒 Verifiability Design

Every AI decision is **cryptographically anchored on-chain**:

```typescript
// Agent computes this before submitting transaction
const decisionHash = sha256(JSON.stringify({
  reasoning: decision.reasoning,
  newAllocations: decision.newAllocations,
  confidenceScore: decision.confidenceScore,
  marketSignal: decision.marketSignal,
  marketTimestamp: market.timestamp,
  solPrice: market.solPriceUsd,
}));

// Stored in vault account as last_decision_hash: [u8; 32]
// Full reasoning stored on IPFS, referenced via last_reasoning_uri
```

Anyone can:
1. Fetch `last_decision_hash` from the Solana vault account
2. Download the full reasoning from the IPFS URI (`last_reasoning_uri`)
3. Recompute the hash and verify it matches — proving the AI made exactly that decision

---

## 🤖 AI Decision Framework

Claude receives a structured prompt with:
- Current vault state (risk tolerance, existing allocations, TVL)
- All protocol states (APY, TVL, utilization, risk score)
- Market context (SOL price, Fear & Greed index, Solana TPS, BTC/ETH)

And outputs:
```json
{
  "reasoning": "Step-by-step analysis...",
  "newAllocations": {"MarinadeFinance": 3000, "SolendMain": 1500, ...},
  "confidenceScore": 82,
  "marketSignal": 35,
  "shouldRebalance": true,
  "urgency": "medium"
}
```

**Risk enforcement on-chain:**
- No single allocation > `(risk_tolerance + 20)%` — enforced in Rust
- Allocations must sum to exactly 10,000 basis points
- Minimum confidence threshold enforced by smart contract
- Vault can be paused by authority (human override)

---

## 📁 Project Structure

```
solmind/
├── programs/solmind/src/
│   └── lib.rs              # Anchor smart contract (Rust)
│       ├── initialize_vault  — create AI-managed vault
│       ├── ai_rebalance      — execute AI allocation decision
│       ├── register_protocol — add DeFi protocol to vault
│       ├── set_ai_agent      — authorize agent keypair
│       ├── record_observation— store market data on-chain
│       └── emergency_pause   — human override
│
├── agent/src/
│   └── agent.ts            # Autonomous AI agent (TypeScript)
│       ├── fetchMarketContext  — Pyth + on-chain data
│       ├── fetchProtocolStates — lending/LP/staking data
│       ├── queryClaudeForDecision — Claude API call
│       ├── hashDecision       — SHA-256 for verifiability
│       └── submitDecisionOnChain — Anchor transaction
│
├── frontend/src/
│   └── App.tsx             # React dashboard
│       ├── Portfolio overview + allocation pie chart
│       ├── AI market signal meter
│       ├── Decision history with hashes
│       └── Real AI chat via Claude API
│
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- Rust + Anchor CLI (`cargo install --git https://github.com/coral-xyz/anchor anchor-cli`)
- Solana CLI + devnet wallet
- Node.js 18+
- Anthropic API key

### 1. Deploy the Smart Contract

```bash
cd programs/solmind
anchor build
anchor deploy --provider.cluster devnet
```

### 2. Initialize a Vault

```bash
anchor run initialize -- \
  --vault-name "Alpha Vault" \
  --risk-tolerance 55
```

### 3. Start the AI Agent

```bash
cd agent
npm install
ANTHROPIC_API_KEY=sk-... SOLANA_RPC=https://api.devnet.solana.com npm start
```

### 4. Launch Dashboard

```bash
cd frontend
npm install && npm run dev
# Open http://localhost:5173
```

---

## 🌍 Real-World Applicability

- **Asset Managers**: Institutional DeFi portfolios managed autonomously
- **DAOs**: Treasury rebalancing without manual governance proposals
- **Retail Users**: Set risk tolerance once, AI does the rest
- **Audit Firms**: On-chain hash proves AI behavior — no black box

---

## 📜 License

MIT — Built for National Solana Hackathon by Decentrathon 2026
