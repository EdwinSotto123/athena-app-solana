/**
 * Deploy AthenaPool to Fraxtal Testnet
 * 
 * Run: node scripts/deploy-pool.cjs
 * 
 * Prerequisites:
 * 1. Set WALLET_PRIVATE_KEY in .env.local
 * 2. Have frxETH for gas (from faucet)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

// Fraxtal Testnet
const FRAXTAL_TESTNET = {
    rpcUrl: 'https://rpc.testnet.frax.com',
    chainId: 2523,
    explorerUrl: 'https://holesky.fraxscan.com'
};

async function main() {
    console.log('\n🚀 AthenaPool Deployment');
    console.log('========================\n');

    // Load private key
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
        console.error('❌ WALLET_PRIVATE_KEY not set');
        console.log('\nAdd to .env.local:');
        console.log('WALLET_PRIVATE_KEY=0x...');
        process.exit(1);
    }

    // Load compiled contract
    const abiPath = path.join(__dirname, '../contracts/AthenaPool.abi.json');
    const bytecodePath = path.join(__dirname, '../contracts/AthenaPool.bytecode.json');

    if (!fs.existsSync(abiPath) || !fs.existsSync(bytecodePath)) {
        console.error('❌ Contract not compiled. Run:');
        console.log('   node scripts/compile-contract.cjs');
        process.exit(1);
    }

    const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    const { bytecode } = JSON.parse(fs.readFileSync(bytecodePath, 'utf8'));

    // Connect to Fraxtal Testnet
    console.log(`Network: ${FRAXTAL_TESTNET.rpcUrl}`);
    const provider = new ethers.JsonRpcProvider(FRAXTAL_TESTNET.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`Wallet: ${wallet.address}`);

    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} frxETH\n`);

    if (balance === 0n) {
        console.error('❌ No frxETH for gas. Get some from faucet.');
        process.exit(1);
    }

    // Deploy contract
    console.log('📤 Deploying AthenaPool...\n');

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    // Deploy with gas estimation
    const deployTx = await factory.deploy();

    console.log(`TX Hash: ${deployTx.deploymentTransaction().hash}`);
    console.log('Waiting for confirmation...\n');

    await deployTx.waitForDeployment();

    const contractAddress = await deployTx.getAddress();

    console.log('✅ CONTRACT DEPLOYED!');
    console.log('=====================');
    console.log(`Address: ${contractAddress}`);
    console.log(`Explorer: ${FRAXTAL_TESTNET.explorerUrl}/address/${contractAddress}`);
    console.log(`TX: ${FRAXTAL_TESTNET.explorerUrl}/tx/${deployTx.deploymentTransaction().hash}`);

    // Save deployment info
    const deploymentInfo = {
        network: 'Fraxtal Testnet',
        chainId: FRAXTAL_TESTNET.chainId,
        contractAddress,
        deployedBy: wallet.address,
        deployedAt: new Date().toISOString(),
        txHash: deployTx.deploymentTransaction().hash
    };

    const deploymentPath = path.join(__dirname, '../contracts/deployment.json');
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\n📋 Deployment info saved to: ${deploymentPath}`);
}

main().catch(err => {
    console.error('❌ Deploy failed:', err.message);
    process.exit(1);
});
