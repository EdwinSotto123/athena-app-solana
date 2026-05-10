/**
 * Athena Agent - ADK-TS Pattern Implementation
 * 
 * This agent follows the IQAI ADK-TS philosophy:
 * Perception → Reasoning/Planning → Action Execution
 * 
 * Core capabilities:
 * - createAnonymousCase(): Generate unique Case ID + Deposit Address
 * - secureEvidence(): Hash evidence and store on-chain
 * - planEscape(): AI-powered escape planning with Gemini
 * - optimizeYield(): Auto-stake idle funds into sFRAX
 * - triggerSOS(): Emergency liquidation protocol
 */

import { VaultState, SOSResult, TransactionResult } from './frax-service';
import { getActiveVaultService, ACTIVE_CHAIN } from './chain-router';
import { generateHash } from '../services/cryptoUtils';

// ============ TYPES ============

export interface AthenaCase {
    caseId: string;
    depositAddress: string;
    createdAt: number;
    status: 'ACTIVE' | 'EVACUATED' | 'ARCHIVED';
}

export interface EvidenceRecord {
    id: string;
    hash: string;
    type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO';
    timestamp: number;
    txHash?: string;
    status: 'PENDING' | 'ON_CHAIN' | 'FAILED';
    metadata?: {
        category?: string;
        riskLevel?: number;
        summary?: string;
    };
}

export interface EscapePlan {
    isReady: boolean;
    freedomGoal: {
        targetAmount: number;
        currentAmount: number;
        currency: string;
    };
    strategy: {
        step1: string;
        step2: string;
        step3: string;
    };
    riskLevel: number;
    destination: string;
}

export interface YieldOptimizationResult {
    success: boolean;
    previousBalance: number;
    newBalance: number;
    apy: number;
    projectedMonthlyYield: number;
    message: string;
}

export interface AgentState {
    case: AthenaCase | null;
    evidence: EvidenceRecord[];
    escapePlan: EscapePlan | null;
    vaultState: VaultState | null;
    lastUpdated: number;
}

// ============ AGENT CLASS ============

export class AthenaAgent {
    private state: AgentState;
    // Chain-agnostic backend chosen by VITE_CHAIN (`fraxtal` | `solana`).
    // Field name kept as `fraxService` to minimize churn against the rest of
    // the agent — both backends implement the same surface.
    private fraxService = getActiveVaultService();
    public readonly chain = ACTIVE_CHAIN;

    constructor() {
        this.state = {
            case: null,
            evidence: [],
            escapePlan: null,
            vaultState: null,
            lastUpdated: Date.now()
        };

        // Try to restore state from localStorage
        this.loadState();
    }

    // ============ PERCEPTION ============

    /**
     * Perceive current financial state
     */
    async perceiveFinancialState(): Promise<VaultState> {
        const vaultState = await this.fraxService.getVaultState();
        this.state.vaultState = vaultState;
        this.state.lastUpdated = Date.now();
        this.saveState();
        return vaultState;
    }

    /**
     * Get current agent state
     */
    getState(): AgentState {
        return { ...this.state };
    }

    // ============ REASONING/PLANNING ============

    /**
     * Create anonymous case with unique ID and deposit address
     * This is the entry point for a new user.
     *
     * Case ID format depends on the active chain:
     *   - EVM (fraxtal):  `ATHENA-{timestamp}-{rand}` (legacy string)
     *   - Solana:         RFC4122 UUID v4 (decoded to [u8; 16] for the PDA)
     */
    async createAnonymousCase(): Promise<AthenaCase> {
        const timestamp = Date.now();

        let caseId: string;
        if (this.chain === 'solana') {
            // Lazy import to avoid pulling Solana deps in EVM mode.
            const { getSolanaPoolClient } = await import('./solana-pool-client');
            caseId = getSolanaPoolClient().generateCaseId();
        } else {
            const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
            caseId = `ATHENA-${timestamp}-${randomPart}`;
        }

        const depositAddress = this.fraxService.getAddress();

        const newCase: AthenaCase = {
            caseId,
            depositAddress,
            createdAt: timestamp,
            status: 'ACTIVE'
        };

        this.state.case = newCase;
        this.saveState();

        console.log(`[AthenaAgent][${this.chain}] Case created: ${caseId}`);
        return newCase;
    }

    /**
     * Analyze situation and create escape plan
     * Uses reasoning to determine budget based on inputs
     */
    calculateFreedomBudget(params: {
        dependents: number;
        destination: string;
        hasOwnMoney: boolean;
        riskLevel: number;
    }): EscapePlan {
        // Base costs (in USD)
        const TRANSPORT_PER_PERSON = 30;
        const EMERGENCY_FOOD = 100;
        const TEMP_SHELTER_PER_NIGHT = 75;
        const NIGHTS_NEEDED = params.riskLevel >= 8 ? 1 : 3;

        // Calculate target
        const transportCost = (params.dependents + 1) * TRANSPORT_PER_PERSON;
        const shelterCost = params.hasOwnMoney ? 0 : TEMP_SHELTER_PER_NIGHT * NIGHTS_NEEDED;
        const totalTarget = transportCost + EMERGENCY_FOOD + shelterCost;

        // Generate strategy based on risk
        let strategy: EscapePlan['strategy'];

        if (params.riskLevel >= 8) {
            strategy = {
                step1: '🚨 IMMEDIATE: Document any visible injuries and leave when safe.',
                step2: '📞 Contact emergency services or trusted ally for extraction.',
                step3: '🏃 Head directly to nearest safe shelter or family.'
            };
        } else if (params.riskLevel >= 5) {
            strategy = {
                step1: '📝 Start collecting evidence discreetly (photos, messages).',
                step2: '💰 Build freedom fund gradually - target ready in 2-4 weeks.',
                step3: '🗺️ Plan exit route and coordinate with trusted contact.'
            };
        } else {
            strategy = {
                step1: '💭 Assess situation and identify safe communication methods.',
                step2: '💰 Set up stealth savings - small amounts regularly.',
                step3: '📋 Create long-term independence plan with support network.'
            };
        }

        const plan: EscapePlan = {
            isReady: false,
            freedomGoal: {
                targetAmount: totalTarget,
                currentAmount: this.state.vaultState?.totalValueUsd || 0,
                currency: 'USD'
            },
            strategy,
            riskLevel: params.riskLevel,
            destination: params.destination || 'Nearest Safe City'
        };

        this.state.escapePlan = plan;
        this.saveState();

        return plan;
    }

    // ============ ACTION EXECUTION ============

    /**
     * Secure evidence on-chain
     * Hashes content and stores hash in blockchain transaction calldata
     */
    async secureEvidence(
        content: string,
        type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO',
        metadata?: { category?: string; riskLevel?: number; summary?: string }
    ): Promise<EvidenceRecord> {
        // Generate SHA-256 hash
        const hash = await generateHash(content + Date.now().toString());

        const record: EvidenceRecord = {
            id: `EVD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            hash,
            type,
            timestamp: Date.now(),
            status: 'PENDING',
            metadata
        };

        // Store hash on-chain
        const result = await this.fraxService.storeEvidenceHash(
            hash,
            metadata ? JSON.stringify(metadata) : undefined
        );

        if (result.success) {
            record.txHash = result.txHash;
            record.status = 'ON_CHAIN';
        } else {
            record.status = 'FAILED';
            console.warn(`[AthenaAgent] Evidence on-chain falló: ${result.message}`);
        }

        // Add to state
        this.state.evidence.push(record);
        this.saveState();

        console.log(`[AthenaAgent] Evidence secured: ${record.id} -> ${record.status}`);
        return record;
    }

    /**
     * Optimize yield by staking idle FRAX into sFRAX
     */
    async optimizeYield(): Promise<YieldOptimizationResult> {
        const currentState = await this.perceiveFinancialState();

        // Check if there's idle FRAX to stake
        if (currentState.fraxBalance < 1) {
            return {
                success: false,
                previousBalance: currentState.sFraxBalance,
                newBalance: currentState.sFraxBalance,
                apy: currentState.apy,
                projectedMonthlyYield: 0,
                message: 'No idle FRAX available to stake'
            };
        }

        // Deposit all idle FRAX into sFRAX vault
        const result = await this.fraxService.depositToVault(currentState.fraxBalance);

        if (result.success) {
            const newState = await this.perceiveFinancialState();
            const monthlyYield = (newState.sFraxBalance * (currentState.apy / 100)) / 12;

            return {
                success: true,
                previousBalance: currentState.sFraxBalance,
                newBalance: newState.sFraxBalance,
                apy: currentState.apy,
                projectedMonthlyYield: monthlyYield,
                message: `Optimized: +${currentState.fraxBalance.toFixed(2)} FRAX staked at ${currentState.apy}% APY`
            };
        }

        return {
            success: false,
            previousBalance: currentState.sFraxBalance,
            newBalance: currentState.sFraxBalance,
            apy: currentState.apy,
            projectedMonthlyYield: 0,
            message: result.message
        };
    }

    /**
     * Execute SOS Protocol
     * Liquidates all positions and transfers to safe contact
     */
    async triggerSOS(safeContactAddress: string): Promise<SOSResult> {
        console.log('[AthenaAgent] ⚠️ SOS PROTOCOL INITIATED');

        // Update case status
        if (this.state.case) {
            this.state.case.status = 'EVACUATED';
        }

        if (ACTIVE_CHAIN === 'solana') {
            const poolLogs: string[] = [];
            const poolTxHashes: string[] = [];
            let poolDrainedSol = 0;
            let poolOk = false;

            const rawCaseId = this.state.case?.caseId?.trim() ?? '';
            if (rawCaseId) {
                try {
                    const { normalizeCaseListingCaseId } = await import('./firebase');
                    const { getSolanaPoolClient } = await import('./solana-pool-client');
                    const uuid = normalizeCaseListingCaseId(rawCaseId);
                    if (uuid) {
                        const res = await getSolanaPoolClient().triggerSOS(uuid);
                        poolOk = res.success;
                        if (res.txHash) poolTxHashes.push(res.txHash);
                        if (res.success) {
                            poolDrainedSol = typeof res.amount === 'number' ? res.amount : 0;
                            poolLogs.push(
                                `[Solana] Fondos acumulados en tu caso se enviaron al contacto seguro registrado al crear el plan. Tx: ${(res.txHash ?? '').slice(0, 12)}…`,
                            );
                        } else {
                            poolLogs.push(
                                `[Solana] Vaciar el caso on-chain no fue posible: ${res.error ?? 'desconocido'} (p. ej. ya vacío, inactivo o permisos).`,
                            );
                        }
                    }
                } catch (e: unknown) {
                    poolLogs.push(
                        `[Solana] Error en SOS del caso: ${e instanceof Error ? e.message : String(e)}`,
                    );
                }
            } else {
                poolLogs.push(
                    '[Solana] No hay Case ID en esta sesión: solo se usará el flujo de wallet de respaldo.',
                );
            }

            const vaultResult = await this.fraxService.triggerSOS(safeContactAddress);
            const success = poolOk || vaultResult.success;
            const merged: SOSResult = {
                success,
                liquidatedAmount: vaultResult.liquidatedAmount + poolDrainedSol,
                transferredAmount: vaultResult.transferredAmount,
                destinationAddress: safeContactAddress,
                txHashes: [...poolTxHashes, ...vaultResult.txHashes],
                logs: [...poolLogs, ...vaultResult.logs],
            };

            if (success) {
                this.clearLocalState();
            }
            return merged;
        }

        const result = await this.fraxService.triggerSOS(safeContactAddress);
        if (result.success) {
            this.clearLocalState();
        }
        return result;
    }

    /**
     * Quick balance check (for Flash Check command)
     */
    async quickBalanceCheck(): Promise<{ balance: string; isOnline: boolean }> {
        const state = await this.perceiveFinancialState();
        return {
            balance: `$${state.totalValueUsd.toFixed(2)}`,
            isOnline: state.isOnline
        };
    }

    /**
     * Get pool/donation status
     */
    async getPoolStatus(): Promise<{ percentage: number; donors: number }> {
        const state = await this.perceiveFinancialState();
        const plan = this.state.escapePlan;

        if (!plan) {
            return { percentage: 0, donors: 0 };
        }

        const percentage = Math.min(
            (state.totalValueUsd / plan.freedomGoal.targetAmount) * 100,
            100
        );

        // Simulated donor count (in production, would track real donations)
        const donors = Math.floor(percentage / 8) + 1;

        return { percentage, donors };
    }

    // ============ STATE MANAGEMENT ============

    private saveState(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('athena_agent_state', JSON.stringify(this.state));
            }
        } catch (e) {
            // Storage might be unavailable
        }
    }

    private loadState(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                const saved = localStorage.getItem('athena_agent_state');
                if (saved) {
                    this.state = JSON.parse(saved);
                }
            }
        } catch (e) {
            // Storage might be unavailable or corrupted
        }
    }

    /**
     * Clear all local state (used after SOS or Wipe)
     */
    clearLocalState(): void {
        this.state = {
            case: null,
            evidence: [],
            escapePlan: null,
            vaultState: null,
            lastUpdated: Date.now()
        };

        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem('athena_agent_state');
                localStorage.removeItem('athena_evidence');
                localStorage.removeItem('athena_plan');
            }
        } catch (e) {
            // Ignore storage errors
        }

        console.log('[AthenaAgent] Local state cleared');
    }

    /**
     * Check if agent is connected to blockchain
     */
    isOnline(): boolean {
        return this.fraxService.isOnline();
    }
}

// ============ SINGLETON INSTANCE ============

let athenaAgentInstance: AthenaAgent | null = null;

export const getAthenaAgent = (): AthenaAgent => {
    if (!athenaAgentInstance) {
        athenaAgentInstance = new AthenaAgent();
    }
    return athenaAgentInstance;
};

export default AthenaAgent;
