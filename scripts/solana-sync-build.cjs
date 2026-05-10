#!/usr/bin/env node
/**
 * Copies SBPF build artifacts from CARGO_TARGET_DIR (e.g. ~/athena-target,
 * used in WSL2 to avoid filesystem permission issues) back into the project
 * tree at solana/target/deploy and solana/target/idl.
 *
 * Required after every `anchor build` when CARGO_TARGET_DIR is set, because
 * `anchor deploy` looks at ./target/deploy/<program>.so by default.
 *
 * Usage:  npm run sol:sync-build
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`  ✓ ${path.relative(process.cwd(), dst)}`);
  return true;
}

const projectRoot = path.resolve(__dirname, '..');
const solanaDir = path.join(projectRoot, 'solana');
if (!fs.existsSync(solanaDir)) {
  console.error('Could not find solana/ at project root');
  process.exit(1);
}

const cargoTargetDir =
  process.env.CARGO_TARGET_DIR ||
  path.join(os.homedir(), 'athena-target');

if (!fs.existsSync(cargoTargetDir)) {
  console.error(
    `External CARGO_TARGET_DIR not found at ${cargoTargetDir}.\n` +
    `Set CARGO_TARGET_DIR or run 'anchor build' inside solana/ first.`,
  );
  process.exit(1);
}

console.log(`Syncing artifacts from ${cargoTargetDir}`);

const programName = 'athena_pool';
let copied = 0;

if (copyIfExists(
  path.join(cargoTargetDir, 'deploy', `${programName}.so`),
  path.join(solanaDir, 'target', 'deploy', `${programName}.so`),
)) copied++;

if (copyIfExists(
  path.join(cargoTargetDir, 'deploy', `${programName}-keypair.json`),
  path.join(solanaDir, 'target', 'deploy', `${programName}-keypair.json`),
)) copied++;

if (copyIfExists(
  path.join(cargoTargetDir, 'idl', `${programName}.json`),
  path.join(solanaDir, 'target', 'idl', `${programName}.json`),
)) copied++;

if (copyIfExists(
  path.join(cargoTargetDir, 'idl', `${programName}.json`),
  path.join(projectRoot, 'lib', '_idl', `${programName}.json`),
)) copied++;

if (copied === 0) {
  console.error('Nothing was copied. Did you run "anchor build" yet?');
  process.exit(1);
}

console.log(`\nDone. ${copied} file(s) synced.`);
