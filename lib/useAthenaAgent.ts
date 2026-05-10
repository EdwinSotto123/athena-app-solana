/**
 * React Hook for Athena Agent
 * Provides easy access to agent functionality in React components
 */

import { useState, useEffect, useCallback } from 'react';
import { getAthenaAgent, AthenaAgent, AgentState, EvidenceRecord, EscapePlan, YieldOptimizationResult } from './athena-agent';
import { VaultState, SOSResult } from './frax-service';

interface UseAthenaAgentReturn {
    // State
    agent: AthenaAgent;
    agentState: AgentState;
    vaultState: VaultState | null;
    isOnline: boolean;
    isLoading: boolean;

    // Actions
    refreshVaultState: () => Promise<VaultState>;
    createCase: () => Promise<void>;
    secureEvidence: (content: string, type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO', metadata?: any) => Promise<EvidenceRecord>;
    optimizeYield: () => Promise<YieldOptimizationResult>;
    triggerSOS: (address: string) => Promise<SOSResult>;
    calculateBudget: (params: { dependents: number; destination: string; hasOwnMoney: boolean; riskLevel: number }) => EscapePlan;
    quickBalance: () => Promise<string>;
    clearState: () => void;
}

export const useAthenaAgent = (): UseAthenaAgentReturn => {
    const [agent] = useState<AthenaAgent>(() => getAthenaAgent());
    const [agentState, setAgentState] = useState<AgentState>(agent.getState());
    const [vaultState, setVaultState] = useState<VaultState | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Initial load
    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                const state = await agent.perceiveFinancialState();
                setVaultState(state);
                setAgentState(agent.getState());
            } catch (e) {
                console.error('[useAthenaAgent] Init failed:', e);
            } finally {
                setIsLoading(false);
            }
        };
        init();
    }, [agent]);

    // Auto-refresh vault state every 30 seconds
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const state = await agent.perceiveFinancialState();
                setVaultState(state);
            } catch (e) {
                // Silent fail on background refresh
            }
        }, 30000);

        return () => clearInterval(interval);
    }, [agent]);

    const refreshVaultState = useCallback(async (): Promise<VaultState> => {
        setIsLoading(true);
        try {
            const state = await agent.perceiveFinancialState();
            setVaultState(state);
            setAgentState(agent.getState());
            return state;
        } finally {
            setIsLoading(false);
        }
    }, [agent]);

    const createCase = useCallback(async (): Promise<void> => {
        await agent.createAnonymousCase();
        setAgentState(agent.getState());
    }, [agent]);

    const secureEvidence = useCallback(async (
        content: string,
        type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO',
        metadata?: any
    ): Promise<EvidenceRecord> => {
        setIsLoading(true);
        try {
            const record = await agent.secureEvidence(content, type, metadata);
            setAgentState(agent.getState());
            return record;
        } finally {
            setIsLoading(false);
        }
    }, [agent]);

    const optimizeYield = useCallback(async (): Promise<YieldOptimizationResult> => {
        setIsLoading(true);
        try {
            const result = await agent.optimizeYield();
            await refreshVaultState();
            return result;
        } finally {
            setIsLoading(false);
        }
    }, [agent, refreshVaultState]);

    const triggerSOS = useCallback(async (address: string): Promise<SOSResult> => {
        const result = await agent.triggerSOS(address);
        setAgentState(agent.getState());
        setVaultState(null);
        return result;
    }, [agent]);

    const calculateBudget = useCallback((params: {
        dependents: number;
        destination: string;
        hasOwnMoney: boolean;
        riskLevel: number;
    }): EscapePlan => {
        const plan = agent.calculateFreedomBudget(params);
        setAgentState(agent.getState());
        return plan;
    }, [agent]);

    const quickBalance = useCallback(async (): Promise<string> => {
        const { balance } = await agent.quickBalanceCheck();
        return balance;
    }, [agent]);

    const clearState = useCallback((): void => {
        agent.clearLocalState();
        setAgentState(agent.getState());
        setVaultState(null);
    }, [agent]);

    return {
        agent,
        agentState,
        vaultState,
        isOnline: agent.isOnline(),
        isLoading,
        refreshVaultState,
        createCase,
        secureEvidence,
        optimizeYield,
        triggerSOS,
        calculateBudget,
        quickBalance,
        clearState
    };
};

export default useAthenaAgent;
