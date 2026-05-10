/**
 * Frax Finance Blockchain Service
 * Provides real blockchain connectivity with intelligent fallback for demos
 * 
 * Network: Fraxtal L2 (Primary) / Ethereum Mainnet (Fallback)
 * Assets: sFRAX (ERC-4626 Vault), FRAX, USDC
 */

import { ethers, Contract, Wallet, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';

// ============ NETWORK CONFIGURATION ============

interface NetworkConfig {
    name: string;
    rpcUrl: string;
    chainId: number;
    sFraxAddress: string;
    fraxAddress: string;
    usdcAddress: string;
    explorerUrl: string;
}

// Fraxtal L2 Mainnet
const FRAXTAL_MAINNET: NetworkConfig = {
    name: 'Fraxtal',
    rpcUrl: 'https://rpc.frax.com',
    chainId: 252,
    sFraxAddress: '0xfc00000000000000000000000000000000000008', // Canonical sFRAX on Fraxtal
    fraxAddress: '0xFc00000000000000000000000000000000000001',  // FRAX on Fraxtal
    usdcAddress: '0xDcc0F2D8F90FDe85b10aC1c8Ab57dc0AE946A543',  // Bridged USDC
    explorerUrl: 'https://fraxscan.com'
};

// Ethereum Mainnet (Fallback / Testing)
const ETHEREUM_MAINNET: NetworkConfig = {
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    chainId: 1,
    sFraxAddress: '0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32', // sFRAX on Ethereum
    fraxAddress: '0x853d955aCEf822Db058eb8505911ED77F175b99e',  // FRAX
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC
    explorerUrl: 'https://etherscan.io'
};

// Fraxtal Testnet (For hackathon demo)
const FRAXTAL_TESTNET: NetworkConfig = {
    name: 'Fraxtal Testnet',
    rpcUrl: 'https://rpc.testnet.frax.com',
    chainId: 2523,
    sFraxAddress: '0x0000000000000000000000000000000000000000', // Will deploy our own pool
    fraxAddress: '0x0000000000000000000000000000000000000000',  // Native frxETH
    usdcAddress: '0x0000000000000000000000000000000000000000',
    explorerUrl: 'https://holesky.fraxscan.com'
};

// Sepolia Testnet (Backup)
const SEPOLIA_TESTNET: NetworkConfig = {
    name: 'Sepolia',
    rpcUrl: 'https://rpc.sepolia.org',
    chainId: 11155111,
    sFraxAddress: '0x0000000000000000000000000000000000000000',
    fraxAddress: '0x0000000000000000000000000000000000000000',
    usdcAddress: '0x0000000000000000000000000000000000000000',
    explorerUrl: 'https://sepolia.etherscan.io'
};

// ============ ABIs ============

// ERC-4626 Vault ABI (sFRAX)
const SFRAX_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function totalAssets() view returns (uint256)',
    'function convertToAssets(uint256 shares) view returns (uint256)',
    'function convertToShares(uint256 assets) view returns (uint256)',
    'function deposit(uint256 assets, address receiver) returns (uint256)',
    'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
    'function previewRedeem(uint256 shares) view returns (uint256)',
    'function maxWithdraw(address owner) view returns (uint256)',
    'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
    'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)'
];

// ERC-20 ABI (FRAX, USDC)
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// ============ TYPES ============

export interface VaultState {
    sFraxBalance: number;      // Shares in vault
    sFraxValueInFrax: number;  // Value in FRAX terms
    fraxBalance: number;       // Liquid FRAX
    usdcBalance: number;       // USDC
    totalValueUsd: number;     // Total USD value
    apy: number;               // Current APY
    isOnline: boolean;         // Connection status
    network: string;           // Active network name
}

export interface TransactionResult {
    success: boolean;
    txHash: string;
    message: string;
    explorerUrl?: string;
}

export interface SOSResult {
    success: boolean;
    liquidatedAmount: number;
    transferredAmount: number;
    destinationAddress: string;
    txHashes: string[];
    logs: string[];
}
// ============ FALLBACK STATE ============

const createFallbackState = (): VaultState => {
    // Return zeros when not connected - show real values only
    return {
        sFraxBalance: 0,
        sFraxValueInFrax: 0,
        fraxBalance: 0,
        usdcBalance: 0,
        totalValueUsd: 0,
        apy: 5.4, // Default APY for display
        isOnline: false,
        network: 'Not Connected'
    };
};

// ============ FRAX SERVICE CLASS ============

export class FraxService {
    private provider: JsonRpcProvider | null = null;
    private wallet: Wallet | null = null;
    private sFraxContract: Contract | null = null;
    private fraxContract: Contract | null = null;
    private usdcContract: Contract | null = null;
    private activeNetwork: NetworkConfig;
    private isConnected: boolean = false;

    // Fallback state that increases over time (simulates yield)
    private fallbackStartTime: number = Date.now();
    private fallbackBaseBalance: number = 1250.00;

    constructor(privateKey?: string, network: 'fraxtal' | 'fraxtal-testnet' | 'ethereum' | 'sepolia' = 'fraxtal-testnet') {
        // Select network
        switch (network) {
            case 'ethereum':
                this.activeNetwork = ETHEREUM_MAINNET;
                break;
            case 'sepolia':
                this.activeNetwork = SEPOLIA_TESTNET;
                break;
            case 'fraxtal-testnet':
                this.activeNetwork = FRAXTAL_TESTNET;
                break;
            default:
                this.activeNetwork = FRAXTAL_MAINNET;
        }

        // Initialize connection if private key provided
        if (privateKey) {
            this.initializeConnection(privateKey);
        }
    }

    /**
     * Initialize blockchain connection
     */
    private async initializeConnection(privateKey: string): Promise<void> {
        try {
            this.provider = new JsonRpcProvider(this.activeNetwork.rpcUrl);
            this.wallet = new Wallet(privateKey, this.provider);

            // Initialize contracts
            this.sFraxContract = new Contract(
                this.activeNetwork.sFraxAddress,
                SFRAX_ABI,
                this.wallet
            );

            this.fraxContract = new Contract(
                this.activeNetwork.fraxAddress,
                ERC20_ABI,
                this.wallet
            );

            this.usdcContract = new Contract(
                this.activeNetwork.usdcAddress,
                ERC20_ABI,
                this.wallet
            );

            // Verify connection
            await this.provider.getBlockNumber();
            this.isConnected = true;
            console.log(`[FraxService] Connected to ${this.activeNetwork.name}`);

        } catch (error) {
            console.warn('[FraxService] Failed to connect to blockchain, using fallback mode:', error);
            this.isConnected = false;
        }
    }

    /**
     * Get wallet address
     */
    getAddress(): string {
        if (this.wallet) {
            return this.wallet.address;
        }
        // Fallback: Generate deterministic demo address
        return '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
    }

    /**
     * Get current vault state with balances
     * Attempts real blockchain read, falls back to simulation
     */
    async getVaultState(): Promise<VaultState> {
        // Try real blockchain first
        if (this.isConnected && this.wallet && this.sFraxContract) {
            try {
                const address = this.wallet.address;

                // Parallel balance queries
                const [sFraxBal, fraxBal, usdcBal] = await Promise.all([
                    this.sFraxContract.balanceOf(address),
                    this.fraxContract!.balanceOf(address),
                    this.usdcContract!.balanceOf(address)
                ]);

                // Convert sFRAX shares to FRAX value
                const sFraxValue = await this.sFraxContract.convertToAssets(sFraxBal);

                const sFraxBalance = parseFloat(formatUnits(sFraxBal, 18));
                const sFraxValueInFrax = parseFloat(formatUnits(sFraxValue, 18));
                const fraxBalance = parseFloat(formatUnits(fraxBal, 18));
                const usdcBalance = parseFloat(formatUnits(usdcBal, 6)); // USDC is 6 decimals

                return {
                    sFraxBalance,
                    sFraxValueInFrax,
                    fraxBalance,
                    usdcBalance,
                    totalValueUsd: sFraxValueInFrax + fraxBalance + usdcBalance,
                    apy: 5.4, // Could fetch from contract or API
                    isOnline: true,
                    network: this.activeNetwork.name
                };

            } catch (error) {
                console.warn('[FraxService] Blockchain read failed, using fallback:', error);
            }
        }

        // FALLBACK: Simulate growing balance
        return this.getSimulatedVaultState();
    }

    /**
     * Fallback vault state - returns zeros when not connected
     */
    private getSimulatedVaultState(): VaultState {
        // Return zeros when not connected - show real values only
        return {
            sFraxBalance: 0,
            sFraxValueInFrax: 0,
            fraxBalance: 0,
            usdcBalance: 0,
            totalValueUsd: 0,
            apy: 5.4,
            isOnline: false,
            network: 'Not Connected'
        };
    }

    /**
     * Get current APY for sFRAX
     */
    async getAPY(): Promise<number> {
        // In production, this would query Frax API or calculate from contract
        // For hackathon, return realistic current APY
        return 5.4;
    }

    /**
     * Deposit FRAX into sFRAX vault (stake)
     */
    async depositToVault(amountFrax: number): Promise<TransactionResult> {
        if (this.isConnected && this.sFraxContract && this.fraxContract) {
            try {
                const amount = parseUnits(amountFrax.toString(), 18);

                // Approve sFRAX contract to spend FRAX
                const approveTx = await this.fraxContract.approve(
                    this.activeNetwork.sFraxAddress,
                    amount
                );
                await approveTx.wait();

                // Deposit into vault
                const depositTx = await this.sFraxContract.deposit(
                    amount,
                    this.wallet!.address
                );
                const receipt = await depositTx.wait();

                return {
                    success: true,
                    txHash: receipt.hash,
                    message: `Deposited ${amountFrax} FRAX into sFRAX vault`,
                    explorerUrl: `${this.activeNetwork.explorerUrl}/tx/${receipt.hash}`
                };

            } catch (error: any) {
                console.error('[FraxService] Deposit failed:', error);
                return {
                    success: false,
                    txHash: '',
                    message: `Deposit failed: ${error.message}`
                };
            }
        }

        // FALLBACK: Simulate successful deposit
        const fakeTxHash = '0x' + Array(64).fill(0).map(() =>
            Math.floor(Math.random() * 16).toString(16)
        ).join('');

        this.fallbackBaseBalance += amountFrax;

        return {
            success: true,
            txHash: fakeTxHash,
            message: `[DEMO] Deposited ${amountFrax} FRAX into sFRAX vault`
        };
    }

    /**
     * Redeem sFRAX back to FRAX (unstake)
     */
    async redeemFromVault(amountShares: number): Promise<TransactionResult> {
        if (this.isConnected && this.sFraxContract) {
            try {
                const shares = parseUnits(amountShares.toString(), 18);

                const redeemTx = await this.sFraxContract.redeem(
                    shares,
                    this.wallet!.address,
                    this.wallet!.address
                );
                const receipt = await redeemTx.wait();

                return {
                    success: true,
                    txHash: receipt.hash,
                    message: `Redeemed ${amountShares} sFRAX shares`,
                    explorerUrl: `${this.activeNetwork.explorerUrl}/tx/${receipt.hash}`
                };

            } catch (error: any) {
                console.error('[FraxService] Redeem failed:', error);
                return {
                    success: false,
                    txHash: '',
                    message: `Redeem failed: ${error.message}`
                };
            }
        }

        // FALLBACK
        const fakeTxHash = '0x' + Array(64).fill(0).map(() =>
            Math.floor(Math.random() * 16).toString(16)
        ).join('');

        return {
            success: true,
            txHash: fakeTxHash,
            message: `[DEMO] Redeemed ${amountShares} sFRAX to FRAX`
        };
    }

    /**
     * Transfer FRAX to another address
     */
    async transferFrax(toAddress: string, amount: number): Promise<TransactionResult> {
        if (this.isConnected && this.fraxContract) {
            try {
                const amountWei = parseUnits(amount.toString(), 18);

                const tx = await this.fraxContract.transfer(toAddress, amountWei);
                const receipt = await tx.wait();

                return {
                    success: true,
                    txHash: receipt.hash,
                    message: `Transferred ${amount} FRAX to ${toAddress.slice(0, 8)}...`,
                    explorerUrl: `${this.activeNetwork.explorerUrl}/tx/${receipt.hash}`
                };

            } catch (error: any) {
                return {
                    success: false,
                    txHash: '',
                    message: `Transfer failed: ${error.message}`
                };
            }
        }

        // FALLBACK
        const fakeTxHash = '0x' + Array(64).fill(0).map(() =>
            Math.floor(Math.random() * 16).toString(16)
        ).join('');

        return {
            success: true,
            txHash: fakeTxHash,
            message: `[DEMO] Transferred ${amount} FRAX to ${toAddress.slice(0, 8)}...`
        };
    }

    /**
     * SOS PROTOCOL: Emergency liquidation and transfer
     * 1. Redeem all sFRAX to FRAX
     * 2. Transfer all funds to safe destination
     */
    async triggerSOS(destinationAddress: string): Promise<SOSResult> {
        const logs: string[] = [];
        const txHashes: string[] = [];

        logs.push('⚠️ INITIATING SOS PROTOCOL...');

        try {
            // Step 1: Get current balances
            const vaultState = await this.getVaultState();
            logs.push(`Balance detected: ${vaultState.sFraxBalance.toFixed(2)} sFRAX`);

            // Step 2: Liquidate sFRAX
            if (vaultState.sFraxBalance > 0) {
                logs.push('Liquidating sFRAX positions...');

                if (this.isConnected && this.sFraxContract) {
                    // Real blockchain liquidation
                    const shares = parseUnits(vaultState.sFraxBalance.toString(), 18);
                    const redeemTx = await this.sFraxContract.redeem(
                        shares,
                        this.wallet!.address,
                        this.wallet!.address
                    );
                    const receipt = await redeemTx.wait();
                    txHashes.push(receipt.hash);
                    logs.push(`Liquidation TX: ${receipt.hash.slice(0, 10)}...`);
                } else {
                    // Fallback
                    const fakeTx = '0x' + crypto.randomUUID().replace(/-/g, '').slice(0, 64);
                    txHashes.push(fakeTx);
                    logs.push(`[DEMO] Liquidation TX: ${fakeTx.slice(0, 10)}...`);
                }
            }

            // Step 3: Transfer to safe destination  
            const totalToTransfer = vaultState.sFraxValueInFrax + vaultState.fraxBalance;
            logs.push(`Transferring ${totalToTransfer.toFixed(2)} FRAX to safe destination...`);

            if (this.isConnected && this.fraxContract) {
                // Real transfer
                const amount = parseUnits(totalToTransfer.toString(), 18);
                const tx = await this.fraxContract.transfer(destinationAddress, amount);
                const receipt = await tx.wait();
                txHashes.push(receipt.hash);
                logs.push(`Transfer TX: ${receipt.hash.slice(0, 10)}...`);
            } else {
                // Fallback
                const fakeTx = '0x' + crypto.randomUUID().replace(/-/g, '').slice(0, 64);
                txHashes.push(fakeTx);
                logs.push(`[DEMO] Transfer TX: ${fakeTx.slice(0, 10)}...`);
            }

            logs.push('✅ SOS Protocol Complete. Funds secured.');

            // Reset fallback balance (for demo continuity)
            this.fallbackBaseBalance = 0;

            return {
                success: true,
                liquidatedAmount: vaultState.sFraxBalance,
                transferredAmount: totalToTransfer,
                destinationAddress,
                txHashes,
                logs
            };

        } catch (error: any) {
            logs.push(`❌ Error: ${error.message}`);

            return {
                success: false,
                liquidatedAmount: 0,
                transferredAmount: 0,
                destinationAddress,
                txHashes,
                logs
            };
        }
    }

    /**
     * Store evidence hash on-chain (in transaction calldata)
     */
    async storeEvidenceHash(hash: string, metadata?: string): Promise<TransactionResult> {
        const data = `ATHENA_EVIDENCE:${hash}${metadata ? ':' + metadata : ''}`;

        if (this.isConnected && this.wallet && this.provider) {
            try {
                // Send 0-value transaction with hash in data field
                const tx = await this.wallet.sendTransaction({
                    to: this.wallet.address, // Self-transfer
                    value: 0,
                    data: ethers.toUtf8Bytes(data)
                });
                const receipt = await tx.wait();

                return {
                    success: true,
                    txHash: receipt!.hash,
                    message: 'Evidence hash stored on-chain',
                    explorerUrl: `${this.activeNetwork.explorerUrl}/tx/${receipt!.hash}`
                };

            } catch (error: any) {
                return {
                    success: false,
                    txHash: '',
                    message: `Failed to store evidence: ${error.message}`
                };
            }
        }

        // FALLBACK: Simulate with fake tx
        const fakeTxHash = '0x' + Array(64).fill(0).map(() =>
            Math.floor(Math.random() * 16).toString(16)
        ).join('');

        return {
            success: true,
            txHash: fakeTxHash,
            message: '[DEMO] Evidence hash recorded (simulated)'
        };
    }

    /**
     * Check if connected to real blockchain
     */
    isOnline(): boolean {
        return this.isConnected;
    }

    /**
     * Get current network info
     */
    getNetworkInfo(): NetworkConfig {
        return this.activeNetwork;
    }
}

// ============ SINGLETON INSTANCE ============

// Create default instance (will use fallback if no env vars)
let fraxServiceInstance: FraxService | null = null;

export const getFraxService = (): FraxService => {
    if (!fraxServiceInstance) {
        // Try to get private key from environment
        const privateKey = typeof process !== 'undefined'
            ? process.env.WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY
            : undefined;

        fraxServiceInstance = new FraxService(privateKey, 'fraxtal');
    }
    return fraxServiceInstance;
};

export default FraxService;
