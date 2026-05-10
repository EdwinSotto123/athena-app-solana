#!/usr/bin/env node
/**
 * scripts/solana-export-key.cjs
 *
 * Exports an existing Solana keypair JSON file (array of 64 bytes) to
 * base58 for VITE_SOLANA_KEYPAIR_BASE58.
 *
 * Usage:
 *   node scripts/solana-export-key.cjs
 *   node scripts/solana-export-key.cjs /path/to/keypair.json
 *   SOLANA_KEYPAIR_PATH=... node ...
 *
 * WSL2 + Windows Node: when `npm` runs **Windows** Node, POSIX paths like
 * `/home/usuario/.config/solana/id.json` must be read via `wsl.exe` or
 * `\\\\wsl$\\<distro>\\...` — this script handles that.
 *
 * WARNING: prints the SECRET to stdout.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const bs58 = require('bs58').default || require('bs58');
const { Keypair } = require('@solana/web3.js');

/** @param {string} p */
function isPosixAbs(p) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//');
}

/** @returns {string[]} */
function wslDistroCandidates() {
  const list = [
    process.env.WSL_DISTRO_NAME,
    process.env.WSL_DISTRO,
    'Ubuntu',
    'ubuntu',
    'Ubuntu-22.04',
    'Ubuntu-24.04',
  ].filter(Boolean);
  return [...new Set(list)];
}

/**
 * Windows UNC paths that map a POSIX path inside each WSL distro
 * (e.g. /home/u/a -> \\wsl$\Ubuntu\home\u\a).
 * @param {string} posixAbs
 * @returns {string[]}
 */
function uncPathsForPosix(posixAbs) {
  const rel = posixAbs.replace(/^\//, '').split('/').join('\\');
  return wslDistroCandidates().map((d) => `\\\\wsl$\\${d}\\${rel}`);
}

/**
 * True if `p` exists as a file. On Windows + POSIX path, prefer UNC then wsl.
 * @param {string} p
 */
function fileExistsSmart(p) {
  if (!isPosixAbs(p) || process.platform !== 'win32') {
    return fs.existsSync(p);
  }
  for (const unc of uncPathsForPosix(p)) {
    try {
      if (fs.existsSync(unc)) return true;
    } catch (_) {
      /* ignore */
    }
  }
  try {
    execFileSync('wsl.exe', ['test', '-f', p], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Read UTF-8 file; on Windows Node + POSIX path, prefer UNC (no nested WSL
 * noise) then wsl cat with stderr discarded.
 * @param {string} p
 */
function readFileUtf8Smart(p) {
  if (!isPosixAbs(p) || process.platform !== 'win32') {
    return fs.readFileSync(p, 'utf8');
  }
  for (const unc of uncPathsForPosix(p)) {
    try {
      if (fs.existsSync(unc)) return fs.readFileSync(unc, 'utf8');
    } catch (_) {
      /* continue */
    }
  }
  try {
    return execFileSync('wsl.exe', ['cat', p], {
      encoding: 'utf8',
      maxBuffer: 65536,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    /* fall through */
  }
  return fs.readFileSync(p, 'utf8');
}

/**
 * @returns {string[]}
 */
function keypairSearchPaths() {
  const out = new Set();

  const add = (p) => {
    if (!p || typeof p !== 'string') return;
    let q = p.replace(/^~(?=$|[\\/])/, os.homedir());
    if (isPosixAbs(q) || q.includes('/') && process.platform === 'win32') {
      out.add(q);
    } else {
      out.add(path.resolve(q));
    }
  };

  if (process.env.SOLANA_KEYPAIR_PATH) add(process.env.SOLANA_KEYPAIR_PATH);
  if (process.env.HOME && process.env.HOME.startsWith('/')) {
    add(path.posix.join(process.env.HOME, '.config/solana/id.json'));
  } else if (process.env.HOME) {
    add(path.join(process.env.HOME, '.config/solana/id.json'));
  }
  add(path.join(os.homedir(), '.config/solana/id.json'));

  const user =
    process.env.USER || process.env.USERNAME || process.env.LOGNAME;
  if (user && user !== 'root') {
    add(path.posix.join('/home', user, '.config/solana/id.json'));
  }

  return [...out];
}

const argRaw = process.argv[2];
let logicalPath = null;

if (argRaw) {
  logicalPath = argRaw.replace(/^~(?=$|[\\/])/, os.homedir());
  if (!isPosixAbs(logicalPath)) logicalPath = path.resolve(logicalPath);
} else if (process.env.SOLANA_KEYPAIR_PATH) {
  logicalPath = process.env.SOLANA_KEYPAIR_PATH.replace(
    /^~(?=$|[\\/])/,
    os.homedir(),
  );
  if (!isPosixAbs(logicalPath)) logicalPath = path.resolve(logicalPath);
} else {
  logicalPath =
    keypairSearchPaths().find((p) => fileExistsSmart(p)) || null;
}

if (!logicalPath || !fileExistsSmart(logicalPath)) {
  console.error('Keypair file not found.');
  console.error(
    'Tried:',
    argRaw ? [logicalPath] : keypairSearchPaths(),
  );
  console.error('');
  console.error('Fix one of:');
  console.error(
    '  • Use Linux Node for npm (recommended in WSL): which node should be /usr/bin/node',
  );
  console.error(
    '  • Or pass the Windows UNC path, e.g. \\\\wsl$\\Ubuntu\\home\\usuario\\.config\\solana\\id.json',
  );
  console.error(
    '  • Or: npm run sol:export-key -- /home/$USER/.config/solana/id.json',
  );
  console.error(
    '     (this script now reads POSIX paths via wsl.exe when npm uses Windows Node)',
  );
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileUtf8Smart(logicalPath));
} catch (e) {
  console.error(`Failed to parse JSON at ${logicalPath}: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(raw) || raw.length !== 64) {
  console.error(
    `File at ${logicalPath} is not a Solana keypair JSON (expected array of 64 bytes).`,
  );
  process.exit(1);
}

const secret = Uint8Array.from(raw);
const kp = Keypair.fromSecretKey(secret);
const base58Secret = bs58.encode(Buffer.from(secret));

console.log('=== Athena Solana custodial wallet (from existing id.json) ===');
console.log('Source file :', logicalPath);
console.log('Pubkey      :', kp.publicKey.toBase58());
console.log('');
console.log('Paste this into .env.local:');
console.log(`VITE_SOLANA_KEYPAIR_BASE58=${base58Secret}`);
