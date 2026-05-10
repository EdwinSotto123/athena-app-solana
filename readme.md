🛡️ Project Name: Athena (Liberta Agent)
Autonomous Financial Shield & Justice Protocol for Vulnerable Women
Track: ADK-TS Agent Team: [Tu Nombre / Equipo] University: Universidad Nacional de Ingeniería (UNI)

1. Executive Summary
Athena is an autonomous AI agent designed to empower victims of domestic violence through financial sovereignty and immutable justice. While traditional banking systems are easily controlled by abusers, Athena utilizes the IQAI Agent Tokenization Platform (ATP) and Frax Finance to create a hidden, censorship-resistant financial vault.

Built with ADK-TS, Athena goes beyond a simple wallet: it actively plans escape routes, calculates financial goals, earns yield on idle funds, and logs evidence of abuse on-chain, acting as a silent guardian when the victim is most vulnerable.

2. The Problem: Economic Violence
Globally, 99% of domestic violence cases involve financial abuse.

Censorship: Abusers control bank accounts and credit cards, making it impossible for victims to pay for transport or shelter.

Evidence Destruction: Abusers often destroy phones or delete messages to remove proof of assault.

Paralysis: Victims do not know "how much" they need to escape, leading to inaction.

3. The Solution: An Agentic Approach
Athena is not a passive app; it is an Agent that reasons, plans, and acts on behalf of the user using the ADK-TS framework.

Core Features:
🕵️‍♀️ Stealth Mode Interface: The application masquerades as a functional Calculator. Access to the Agent is only granted via a specific PIN code (e.g., 1999=).

🧠 Escape Planning (Reasoning): The Agent analyzes the user’s location and family size to calculate a concrete "Freedom Goal" (e.g., "$250 USD needed for transport + 2 nights hostel").

💸 Yield-Bearing Freedom Fund (DeFi): Auto-converts idle assets into sFRAX (Staked Frax) to generate APY, protecting the victim's savings from inflation.

⚖️ Immutable Evidence Locker: Logs text/audio evidence as transaction data on the blockchain, creating a permanent, timestamped record that cannot be deleted by smashing the phone.

🚨 Panic Protocol (Action): Upon receiving an "SOS" trigger, the Agent instantly liquidates positions and executes a transfer to a safe wallet or generates a QR code for immediate cash-out.

4. Technical Architecture & Stack
Para este Hackathon, la arquitectura está diseñada para correr sobre el ecosistema Ethereum / Fraxtal (L2), orquestado por IQAI ATP.

Infrastructure Layers:
Agent Logic Layer (The Brain) - ADK-TS:

Framework: IQAI ADK-TS (Agent Development Kit).

Role: Handles natural language understanding (NLU) to interpret user intent ("I need to leave", "He hit me"), executes the logic for the "Escape Calculator," and manages the decision tree for releasing funds.

Why ADK-TS? It allows us to build the reasoning loop: Input -> Analyze Safety Level -> Plan Budget -> Execute Transaction.

Blockchain Settlement Layer (The Vault) - Ethereum / Fraxtal:

Network: Compatible with Ethereum Mainnet or Fraxtal (L2) (Preferred for Frax sponsorship).

Assets:

FRAX: Stablecoin for storage (Zero volatility risk for the victim).

sFRAX: For earning yield via the Agent's automated staking strategies.

ATP (Agent Tokenization Platform): The agent is tokenized on IQAI's platform, giving it a unique identity and wallet address that functions autonomously.

Data Layer (The Evidence):

On-Chain Storage: Hashed evidence is stored in transaction calldata for immutability.

Diagrama de Flujo de Datos (Mental):
User (via Calculator UI) ➡️ ADK-TS Agent ➡️ Reasoning Engine ➡️ Blockchain Action (Frax Transfer / Evidence Log)

5. How we used ADK-TS (Hackathon Requirement)
We utilized ADK-TS to create a multi-step agentic workflow:

Planning: We implemented a planEscape() function where the agent queries internal logic to estimate costs based on user inputs (location, children).

Acting: The agent uses the wallet capabilities within ADK-TS to sign transactions autonomously without user technical intervention (Gasless experience).

Reasoning: The agent distinguishes between a "General Query" (chatting about safety) and a "Critical Command" (SOS), adapting its response latency and security protocols accordingly.

6. Social Impact & Viability
Sponsor Fit (Frax Finance): Showcases a real-world, humanitarian use case for sFRAX and stablecoins beyond trading.

Sponsor Fit (IQAI): Demonstrates the power of ATP to host agents that perform complex, life-saving logic autonomously.

Scalability: The model can be replicated for refugees or disaster relief (modifying the logic parameters).

7. Next Steps (Roadmap)
Phase 1 (Hackathon): MVP with Stealth Calculator, ADK-TS reasoning for budget, and Frax transfers.

Phase 2: Integration with Uber/Hotel APIs for direct booking via the Agent.

Phase 3: Deployment on IQAI ATP Mainnet (Dec 12th).

💡 Notas para Edwin (Tu estrategia de Codeo HOY):
Blockchain: No te compliques creando una blockchain nueva. Tu agente correrá sobre Ethereum (Sepolia Testnet) o Base para la demo, pero dirás que está optimizado para Fraxtal (L2 de Frax).

Wallet: Usa la librería estándar que viene con ADK-TS o ethers.js. El agente tendrá una Private Key en su configuración (.env). Esa es la "billetera custodia".

Launch: Recuerda que el requisito final es "Launch on ATP". Esto suele significar registrar tu agente en su plataforma web. Asegúrate de guardar tiempo para ese registro el día 12.

---

## 8. Solana migration (multi-chain runtime)

Athena now supports two settlement backends behind a single env flag,
`VITE_CHAIN`. The agent core (Gemini + ADK-TS), Pinata IPFS layer, and UI
components are chain-agnostic. The legacy Fraxtal stack is untouched; the
Solana stack lives under `solana/` and `lib/solana-*.ts`.

| `VITE_CHAIN` | Pool contract                                       | Vault asset           | Yield                        | Evidence            |
|---|---|---|---|---|
| `fraxtal`    | `AthenaPool.sol` on Fraxtal Testnet (chain 2523)    | sFRAX (ERC-4626)      | Real (sFRAX APY)             | Tx calldata         |
| `solana`     | `athena_pool` Anchor program on Devnet              | SOL native (lamports) | **Simulated** (Hybrid Mock)  | SPL Memo Program    |

### Bring up the Solana stack

```bash
# 1. Install the toolchain (see solana/SETUP.md, WSL2 recommended on Windows)
# 2. Generate a custodial wallet
npm run sol:genkey            # paste the printed VITE_SOLANA_KEYPAIR_BASE58 into .env.local

# 3. Fund it on Devnet
npm run sol:airdrop -- 2

# 4. Build + deploy the AthenaPool program (requires anchor + cargo)
npm run sol:deploy            # paste the printed VITE_SOLANA_PROGRAM_ID into .env.local

# 5. Run the app pointing at Solana
echo "VITE_CHAIN=solana" >> .env.local
npm run dev
```

When the deploy step is not yet possible, set `VITE_CHAIN=solana` anyway: the
client falls back to a demo mode (fake `demo_…` tx hashes) so the UI still
works for screenshots and storyboarding.

To switch back to legacy Fraxtal mode: `VITE_CHAIN=fraxtal`.

See [migracion.md](migracion.md) for the full design decisions and follow-up
roadmap (USDC SPL, Kamino yield, cNFT evidence, ZK confidential transfers).
