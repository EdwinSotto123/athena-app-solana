/**
 * Deploy AthenaPool to Fraxtal Testnet
 * 
 * Prerequisites:
 * 1. Set WALLET_PRIVATE_KEY in .env.local
 * 2. Have frxETH in wallet for gas (from faucet)
 * 
 * Run: npx ts-node scripts/deploy-pool.ts
 */

import { ethers } from 'ethers';

// Fraxtal Testnet Configuration
const FRAXTAL_TESTNET = {
    rpcUrl: 'https://rpc.testnet.frax.com',
    chainId: 2523,
    explorerUrl: 'https://holesky.fraxscan.com'
};

// AthenaPool bytecode (compiled from Solidity)
// This is a simplified version - in production you'd compile with solc
const ATHENA_POOL_BYTECODE = `0x608060405234801561001057600080fd5b5060405161...`; // Will be filled after compilation

// AthenaPool ABI
const ATHENA_POOL_ABI = [
    'constructor(string _caseId, address _safeContact)',
    'function donate() payable',
    'function withdraw(uint256 amount)',
    'function triggerSOS()',
    'function setSafeContact(address _newContact)',
    'function getBalance() view returns (uint256)',
    'function getPoolInfo() view returns (string, address, address, uint256, uint256, uint256, bool)',
    'function owner() view returns (address)',
    'function safeContact() view returns (address)',
    'function totalDonations() view returns (uint256)',
    'function donorCount() view returns (uint256)',
    'function isActive() view returns (bool)',
    'function caseId() view returns (string)',
    'event DonationReceived(address indexed donor, uint256 amount, uint256 timestamp)',
    'event FundsWithdrawn(address indexed to, uint256 amount)',
    'event SOSTriggered(address indexed safeContact, uint256 amount)'
];

async function main() {
    // Load private key from environment
    const privateKey = process.env.WALLET_PRIVATE_KEY;

    if (!privateKey) {
        console.error('❌ WALLET_PRIVATE_KEY not set in environment');
        console.log('\nAdd to .env.local:');
        console.log('WALLET_PRIVATE_KEY=0x9c02824d776722ddb3ac48632d0a49c03990ba0d47440120aaa7774d83a9b58d');
        process.exit(1);
    }

    console.log('🚀 AthenaPool Deployment Script');
    console.log('================================');
    console.log(`Network: Fraxtal Testnet (Chain ID: ${FRAXTAL_TESTNET.chainId})`);
    console.log(`RPC: ${FRAXTAL_TESTNET.rpcUrl}\n`);

    // Connect to Fraxtal Testnet
    const provider = new ethers.JsonRpcProvider(FRAXTAL_TESTNET.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`Wallet Address: ${wallet.address}`);

    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} frxETH\n`);

    if (balance === 0n) {
        console.error('❌ No frxETH in wallet. Get some from the faucet:');
        console.log('https://faucet.testnet.frax.com');
        process.exit(1);
    }

    // For hackathon demo: We'll use a simple approach
    // Instead of deploying a full contract, we'll simulate the pool
    // by storing data and using direct transfers

    console.log('✅ Wallet connected and funded!');
    console.log('\n📋 For the hackathon demo:');
    console.log('1. Your wallet IS the pool');
    console.log('2. Donors send frxETH to your address');
    console.log('3. You can transfer to safe contact when needed');
    console.log(`\nPool Address: ${wallet.address}`);
    console.log(`Explorer: ${FRAXTAL_TESTNET.explorerUrl}/address/${wallet.address}`);

    // Test transaction (optional - uncomment to test)
    // console.log('\n📤 Sending test transaction...');
    // const tx = await wallet.sendTransaction({
    //     to: wallet.address,
    //     value: ethers.parseEther('0.001'),
    //     data: ethers.toUtf8Bytes('ATHENA_POOL_INIT')
    // });
    // console.log(`TX Hash: ${tx.hash}`);
    // await tx.wait();
    // console.log('✅ Transaction confirmed!');
}

main().catch(console.error);
