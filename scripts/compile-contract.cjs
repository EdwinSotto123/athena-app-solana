/**
 * Compile AthenaPool.sol using solc-js
 * Run: node scripts/compile-contract.js
 */

const solc = require('solc');
const fs = require('fs');
const path = require('path');

// Read contract source
const contractPath = path.join(__dirname, '../contracts/AthenaPool.sol');
const source = fs.readFileSync(contractPath, 'utf8');

// Solc input
const input = {
    language: 'Solidity',
    sources: {
        'AthenaPool.sol': {
            content: source
        }
    },
    settings: {
        outputSelection: {
            '*': {
                '*': ['*']
            }
        },
        optimizer: {
            enabled: true,
            runs: 200
        }
    }
};

console.log('🔧 Compiling AthenaPool.sol...\n');

// Compile
const output = JSON.parse(solc.compile(JSON.stringify(input)));

// Check for errors
if (output.errors) {
    output.errors.forEach(err => {
        if (err.severity === 'error') {
            console.error('❌ Error:', err.message);
            process.exit(1);
        } else {
            console.warn('⚠️ Warning:', err.message);
        }
    });
}

// Extract contract
const contract = output.contracts['AthenaPool.sol']['AthenaPool'];

// Save ABI
const abiPath = path.join(__dirname, '../contracts/AthenaPool.abi.json');
fs.writeFileSync(abiPath, JSON.stringify(contract.abi, null, 2));
console.log('✅ ABI saved to:', abiPath);

// Save Bytecode
const bytecodePath = path.join(__dirname, '../contracts/AthenaPool.bytecode.json');
fs.writeFileSync(bytecodePath, JSON.stringify({
    bytecode: contract.evm.bytecode.object,
    deployedBytecode: contract.evm.deployedBytecode.object
}, null, 2));
console.log('✅ Bytecode saved to:', bytecodePath);

console.log('\n📋 Contract compiled successfully!');
console.log('   ABI entries:', contract.abi.length);
console.log('   Bytecode size:', contract.evm.bytecode.object.length / 2, 'bytes');
