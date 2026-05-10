# Solana Toolchain Setup (Windows)

Esta carpeta contiene el workspace Anchor de Athena (`programs/athena_pool`).
Para compilar y desplegar el programa necesitas el toolchain de Solana.

## Opción A — WSL2 (RECOMENDADA)

Anchor en Windows nativo es históricamente flaky. Usa WSL2 (Ubuntu) para una
experiencia limpia.

### 1. Instalar WSL2 + Ubuntu (si no lo tienes)
PowerShell como administrador:
```powershell
wsl --install -d Ubuntu
```
Reinicia y abre la terminal Ubuntu.

### 2. Dentro de Ubuntu, instalar dependencias del sistema
```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libudev-dev llvm libclang-dev \
    protobuf-compiler libssl-dev curl git
```

### 3. Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
rustc --version   # debe imprimir 1.78+
```

### 4. Solana CLI (Agave)
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
solana --version
```

### 5. Anchor (via avm)

El programa de Athena se mantiene en **Anchor 0.31.x** (la 0.30.1 tiene un
bug con proc-macro2 nuevo y rustc reciente que no se puede patchear).

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.31.1
avm use 0.31.1
anchor --version       # debe imprimir 0.31.1
```

### 6. Configurar Devnet + wallet
```bash
solana config set --url https://api.devnet.solana.com

# Si ya existe un keypair y prefieres regenerar, añade --force.
# Si ya tienes uno con saldo, omite este paso.
solana-keygen new --outfile ~/.config/solana/id.json --no-bip39-passphrase

solana airdrop 2          # Devnet rate-limit ~2 SOL/min
solana balance
```

### 6.5. (CRÍTICO si usas WSL2) Redirigir el `target/` fuera de `/mnt/c`

Cuando trabajas dentro de `/mnt/c/...` (carpetas Windows montadas en WSL),
`llvm-objcopy` falla con `Operation not permitted` al final del build de
Anchor porque el filesystem montado no soporta los `chmod` que necesita.

Solución: forzar a Cargo a escribir el `target/` en una ruta nativa Linux.

```bash
# Crea la carpeta destino (una sola vez)
mkdir -p ~/athena-target

# Exporta CARGO_TARGET_DIR ANTES de cada anchor build/deploy.
# Añade esto a ~/.bashrc para que sea persistente:
echo 'export CARGO_TARGET_DIR=~/athena-target' >> ~/.bashrc
source ~/.bashrc
```

A partir de ese momento, todos los binarios y el IDL se generan en
`~/athena-target/` en lugar de `solana/target/`. **Importante:** los
scripts del repo y `npm run sol:sync-idl` esperan el IDL en
`solana/target/idl/athena_pool.json`. Cuando uses `CARGO_TARGET_DIR`,
copia el IDL a su lugar manualmente o usa estos atajos:

```bash
# después de cada `anchor build`
mkdir -p /mnt/c/Users/usuario/Desktop/PROYECTOS/Athena/solana/target/idl
cp ~/athena-target/idl/athena_pool.json \
   /mnt/c/Users/usuario/Desktop/PROYECTOS/Athena/solana/target/idl/

mkdir -p /mnt/c/Users/usuario/Desktop/PROYECTOS/Athena/solana/target/deploy
cp ~/athena-target/deploy/athena_pool.so \
   ~/athena-target/deploy/athena_pool-keypair.json \
   /mnt/c/Users/usuario/Desktop/PROYECTOS/Athena/solana/target/deploy/
```

> **Atajo:** desde la raíz del proyecto (`Athena/`) puedes correr
> `npm run sol:sync-build` y eso copia el `.so`, el keypair del programa
> y el IDL desde `~/athena-target` a `solana/target/` y a `lib/_idl/` de un
> tirón. Ejecútalo después de **cada** `anchor build`.

> Alternativa "limpia": `git clone` el repo en `~/athena-wsl/` (path
> Linux nativo) y trabaja desde ahí. El IDE de Windows todavía puede
> abrir esos archivos vía `\\wsl.localhost\Ubuntu\home\usuario\athena-wsl`.

### 6.6. (Solo informativo) Por qué NO usar Anchor 0.30.1

Si por alguna razón vuelves a Anchor 0.30.1, te encontrarás con:

```
error[E0599]: no method named `source_file` found for struct `proc_macro2::Span`
```

Esto se debe a que el IDL extractor de 0.30.1 usa `Span::source_file()`,
una API que fue eliminada de `proc-macro2 ≥ 1.0.95`. La versión anterior
(`1.0.94`) tampoco compila con rustc 1.79+ porque depende de
`proc_macro::SourceFile` que también fue removido del stdlib.

**Conclusión:** quédate en Anchor 0.31.x.

### 7. First-time build: sincronizar el Program ID

El repo viene con un Program ID placeholder (`Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS`)
en `programs/athena_pool/src/lib.rs` y en `Anchor.toml`. **El primer `anchor build`
genera un keypair propio del programa** (`target/deploy/athena_pool-keypair.json`)
y debes reemplazar el placeholder por su pubkey real.

```bash
cd /mnt/c/Users/usuario/Desktop/PROYECTOS/Athena/solana

# (a) Build inicial — crea target/deploy/athena_pool-keypair.json
NO_DNA=1 anchor build

# (b) Lee el Program ID que Anchor generó
anchor keys list
#   athena_pool: <REAL_PROGRAM_ID>

# (c) Sincroniza ese Program ID en lib.rs y Anchor.toml automáticamente
anchor keys sync

# (d) Rebuild con el ID correcto
NO_DNA=1 anchor build
```

Si te da el error `Error: String is the wrong size`, casi seguro hay un
placeholder inválido en `Anchor.toml` o `declare_id!` (Solana exige una
base58 pubkey de 32 bytes — 43-44 caracteres). Vuelve a correr `anchor keys sync`.

### 8. Deploy a Devnet
```bash
NO_DNA=1 anchor deploy --provider.cluster devnet
```

Toma nota del **Program ID** y guárdalo en `.env.local` (raíz) como:
```
VITE_SOLANA_PROGRAM_ID=<REAL_PROGRAM_ID>
```

> Atajo: desde la raíz del repo puedes correr `npm run sol:deploy`,
> que ejecuta `anchor build && anchor deploy --provider.cluster devnet`,
> copia el IDL a `lib/_idl/athena_pool.json` e inicializa el PDA `Global`
> en una sola pasada.

Los scripts `npm run sol:deploy` y `npm run sol:airdrop` cargan **desde la raíz del repo**
primero `.env` y luego `.env.local` (como Vite), así que las variables `VITE_*` van bien en `.env.local`.

Para volcar en un `.txt` el Program ID, PDA Global, dirección del wallet del agente,
RPC y enlaces a Solscan:

```bash
npm run sol:info
# opcional: incluir la clave base58 en el archivo (¡no lo subas a git!)
npm run sol:info -- --secret --out=./mi-notas-solana.txt
```

### 9. Exportar la clave privada para el agente custodio

La app necesita la clave del wallet en formato base58 (no el array JSON).
Tienes dos formas:

**Opción A — generar uno nuevo dedicado al agente (recomendado):**

```bash
# desde la raíz del repo
cd /mnt/c/Users/usuario/Desktop/PROYECTOS/Athena
npm run sol:genkey
# imprime la pubkey y la línea VITE_SOLANA_KEYPAIR_BASE58=...
# copia esa línea en .env.local

# luego financia ese wallet en Devnet
solana airdrop 2 <PUBKEY> --url https://api.devnet.solana.com
```

**Opción B — reusar el wallet de Solana CLI (`~/.config/solana/id.json`):**

```bash
cd /mnt/c/Users/usuario/Desktop/PROYECTOS/Athena
npm run sol:export-key
```

Si Node resuelve `os.homedir()` al perfil de Windows (`C:\Users\...`) pero tu
`id.json` está en el home de Linux (típico en WSL2), pasa la ruta explícita:

```bash
npm run sol:export-key -- /home/$USER/.config/solana/id.json
```

Pega la línea `VITE_SOLANA_KEYPAIR_BASE58=...` en `.env.local`.

## Opción B — Windows nativo (no recomendado)

1. Rust: instalar [rustup-init.exe](https://rustup.rs/).
2. Solana CLI: `cmd /c "curl https://release.anza.xyz/stable/solana-install-init-x86_64-pc-windows-msvc.exe --output C:\solana-install.exe && C:\solana-install.exe"`.
3. Anchor: requiere build-tools de C++ y a menudo falla con LLVM. Si insistes, instala via `cargo install --git https://github.com/coral-xyz/anchor avm`.
4. Resto idéntico al de WSL.

## Verificación rápida (en WSL o Windows)

```bash
rustc --version
cargo --version
solana --version
anchor --version
```

Si los cuatro responden, estás listo para `anchor build`.
