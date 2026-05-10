/**
 * AthenaPool Contract Integration
 * 
 * Provides functions to interact with the deployed AthenaPool contract
 * on Fraxtal Testnet for creating cases and tracking donations.
 */

import { ethers, Contract, Wallet, JsonRpcProvider, formatEther, parseEther } from 'ethers';

// Deployment info
const ATHENA_POOL_ADDRESS = '0x4Bca7ebC3Cba0ea5Ada962E319BfB8353De81605';

const FRAXTAL_TESTNET = {
    rpcUrl: 'https://rpc.testnet.frax.com',
    chainId: 2523,
    explorerUrl: 'https://holesky.fraxscan.com'
};

// ABI (simplified for frontend use)
const ATHENA_POOL_ABI = [
    // Read functions
    'function getCaseInfo(string caseId) view returns (address owner, address safeContact, uint256 balance, uint256 totalDonations, uint256 donorCount, bool isActive, uint256 createdAt)',
    'function getCaseBalance(string caseId) view returns (uint256)',
    'function caseExistsCheck(string caseId) view returns (bool)',
    'function getDonation(string caseId, address donor) view returns (uint256)',
    'function admin() view returns (address)',

    // Write functions (admin only)
    'function createCase(string caseId, address owner, address safeContact)',
    'function donate(string caseId) payable',
    'function withdraw(string caseId, uint256 amount)',
    'function triggerSOS(string caseId)',
    'function setSafeContact(string caseId, address newContact)',

    // Events
    'event CaseCreated(string indexed caseId, address owner, address safeContact, uint256 timestamp)',
    'event DonationReceived(string indexed caseId, address indexed donor, uint256 amount, uint256 timestamp)',
    'event FundsWithdrawn(string indexed caseId, address indexed to, uint256 amount)',
    'event SOSTriggered(string indexed caseId, address indexed safeContact, uint256 amount)'
];

// ============ TYPES ============

export interface PoolCaseInfo {
    caseId: string;
    owner: string;
    safeContact: string;
    balance: number;
    totalDonations: number;
    donorCount: number;
    isActive: boolean;
    createdAt: Date;
    donationUrl: string;
}

export interface DonationInfo {
    txHash: string;
    amount: number;
    timestamp: Date;
    donor: string;
}

// ============ POOL SERVICE CLASS ============

export class AthenaPoolService {
    private provider: JsonRpcProvider;
    private contract: Contract;
    private wallet: Wallet | null = null;
    private isAdmin: boolean = false;

    constructor(privateKey?: string) {
        this.provider = new JsonRpcProvider(FRAXTAL_TESTNET.rpcUrl);
        this.contract = new Contract(ATHENA_POOL_ADDRESS, ATHENA_POOL_ABI, this.provider);

        if (privateKey) {
            this.wallet = new Wallet(privateKey, this.provider);
            this.contract = new Contract(ATHENA_POOL_ADDRESS, ATHENA_POOL_ABI, this.wallet);
            this.checkAdminStatus();
        }
    }

    private async checkAdminStatus(): Promise<void> {
        if (this.wallet) {
            try {
                const admin = await this.contract.admin();
                this.isAdmin = admin.toLowerCase() === this.wallet.address.toLowerCase();
                console.log(`[AthenaPool] Admin status: ${this.isAdmin}`);
            } catch (e) {
                console.warn('[AthenaPool] Could not check admin status');
            }
        }
    }

    /**
     * Generate a unique case ID
     */
    generateCaseId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `ATHENA-${timestamp}-${random}`;
    }

    /**
     * Create a new case on the blockchain (admin only)
     */
    async createCase(
        caseId: string,
        ownerAddress: string,
        safeContactAddress: string
    ): Promise<{ success: boolean; txHash: string; error?: string }> {
        if (!this.wallet || !this.isAdmin) {
            // Fallback: return simulated success for demo
            console.log('[AthenaPool] Demo mode: simulating case creation');
            return {
                success: true,
                txHash: '0x' + 'demo'.repeat(16)
            };
        }

        try {
            const tx = await this.contract.createCase(caseId, ownerAddress, safeContactAddress);
            const receipt = await tx.wait();

            console.log(`[AthenaPool] Case created: ${caseId}`);

            return {
                success: true,
                txHash: receipt.hash
            };
        } catch (error: any) {
            console.error('[AthenaPool] Create case failed:', error);
            return {
                success: false,
                txHash: '',
                error: error.message
            };
        }
    }

    /**
     * Get case information
     */
    async getCaseInfo(caseId: string): Promise<PoolCaseInfo | null> {
        try {
            const exists = await this.contract.caseExistsCheck(caseId);
            if (!exists) return null;

            const info = await this.contract.getCaseInfo(caseId);

            return {
                caseId,
                owner: info[0],
                safeContact: info[1],
                balance: parseFloat(formatEther(info[2])),
                totalDonations: parseFloat(formatEther(info[3])),
                donorCount: Number(info[4]),
                isActive: info[5],
                createdAt: new Date(Number(info[6]) * 1000),
                donationUrl: this.getDonationUrl(caseId)
            };
        } catch (error) {
            console.error('[AthenaPool] Get case info failed:', error);
            return null;
        }
    }

    /**
     * Get case balance in ETH
     */
    async getCaseBalance(caseId: string): Promise<number> {
        try {
            const balance = await this.contract.getCaseBalance(caseId);
            return parseFloat(formatEther(balance));
        } catch (error) {
            return 0;
        }
    }

    /**
     * Check if case exists
     */
    async caseExists(caseId: string): Promise<boolean> {
        try {
            return await this.contract.caseExistsCheck(caseId);
        } catch (error) {
            return false;
        }
    }

    /**
     * Trigger SOS - transfer all funds to safe contact
     */
    async triggerSOS(caseId: string): Promise<{ success: boolean; txHash: string; amount?: number }> {
        if (!this.wallet) {
            return { success: false, txHash: '', amount: 0 };
        }

        try {
            const balance = await this.getCaseBalance(caseId);
            const tx = await this.contract.triggerSOS(caseId);
            const receipt = await tx.wait();

            return {
                success: true,
                txHash: receipt.hash,
                amount: balance
            };
        } catch (error: any) {
            console.error('[AthenaPool] SOS failed:', error);
            return {
                success: false,
                txHash: '',
                amount: 0
            };
        }
    }

    /**
     * Get the donation URL for a case
     */
    getDonationUrl(caseId: string): string {
        return `${FRAXTAL_TESTNET.explorerUrl}/address/${ATHENA_POOL_ADDRESS}#writeContract`;
    }

    /**
     * Get the contract address (for displaying to users)
     */
    getContractAddress(): string {
        return ATHENA_POOL_ADDRESS;
    }

    /**
     * Get explorer URL for the contract
     */
    getExplorerUrl(): string {
        return `${FRAXTAL_TESTNET.explorerUrl}/address/${ATHENA_POOL_ADDRESS}`;
    }

    /**
     * Generate a shareable donation link
     */
    getShareableLink(caseId: string, goalAmount?: number): string {
        const baseUrl = window?.location?.origin || 'https://athena-app.vercel.app';
        const params = new URLSearchParams({
            case: caseId,
            contract: ATHENA_POOL_ADDRESS,
            network: 'fraxtal-testnet'
        });
        if (goalAmount) {
            params.set('goal', goalAmount.toString());
        }
        return `${baseUrl}/donate?${params.toString()}`;
    }
}

// ============ SINGLETON ============

let poolServiceInstance: AthenaPoolService | null = null;

export const getAthenaPoolService = (privateKey?: string): AthenaPoolService => {
    if (!poolServiceInstance) {
        poolServiceInstance = new AthenaPoolService(privateKey);
    }
    return poolServiceInstance;
};

export default AthenaPoolService;
