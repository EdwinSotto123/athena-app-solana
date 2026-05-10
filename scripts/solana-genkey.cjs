/* eslint-disable */
/**
 * scripts/solana-genkey.cjs
 *
 * Generates a fresh Solana keypair (no BIP39 passphrase), prints the
 * pubkey and the base58-encoded secret key for `.env.local`.
 *
 * Run with:
 *   node scripts/solana-genkey.cjs
 *
 * NOTE: this prints the SECRET KEY to the console. Use only on a local
 * machine you control, copy the value into `.env.local`, and clear the
 * terminal scrollback (Ctrl+L) afterwards.
 */

const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const kp = Keypair.generate();
const base58Secret = bs58.encode(Buffer.from(kp.secretKey));

console.log('=== Athena Solana custodial wallet ===');
console.log('Pubkey (base58):', kp.publicKey.toBase58());
console.log('');
console.log('Add this to .env.local:');
console.log(`VITE_SOLANA_KEYPAIR_BASE58=${base58Secret}`);
console.log('');
console.log('Then fund it on Devnet:');
console.log(`solana airdrop 2 ${kp.publicKey.toBase58()} --url https://api.devnet.solana.com`);
