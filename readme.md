# Athena (Liberta Agent)

**Escudo financiero autónomo y protocolo de respaldo para personas en situación de violencia económica.**

Athena es una aplicación web con un **agente de IA** que ayuda a planificar una salida segura, estimar recursos, organizar evidencia y coordinar acciones de emergencia. La interfaz puede disimularse como calculadora; el acceso al panel del agente se controla con códigos discretos definidos en el producto.

> Este software es una herramienta de apoyo y **no sustituye** emergencias (llama a los servicios de tu país), asesoría legal ni atención psicológica profesional.

---

## El problema

En muchos casos de violencia de entorno cercano interviene el **control económico**: acceso a cuentas, tarjetas o efectivo limitado, destrucción de pruebas en el teléfono y desorientación sobre cuánto hace falta para moverse con seguridad.

## La solución

Athena encarna un enfoque **agentico**: el sistema razona sobre el contexto que la persona comparte, propone un plan financiero y operativo simplificado, y conecta esas decisiones con **registros verificables** y movimientos de valor cuando corresponde.

### Capabilities principales

| Área | Qué hace |
|------|----------|
| **Modo discreto** | La app puede presentarse como calculadora; el agente se abre solo tras la secuencia correcta. |
| **Plan de escape** | Estimación de costes (transporte, alojamiento, etc.) según contexto (ubicación, dependientes). |
| **Fondo / volcado** | Seguimiento de saldo y operaciones de rescate alineadas con el modelo de “vault” del proyecto (incluye componentes simulados para demo donde aplica). |
| **Evidencia** | Subida a **IPFS** (Pinata) y referencia **on-chain** vía **SPL Memo** en Solana para anclar hashes de forma persistente. |
| **Protocolo SOS** | Flujo crítico para priorizar liquidez y envío hacia una dirección de confianza acordada. |
| **Pool de donaciones** | Casos vinculados a un programa **Anchor** (`athena_pool`) en Solana Devnet: donaciones, retiros y gatillo SOS a nivel contrato. |

---

## Arquitectura técnica (estado actual)

- **Frontend:** React 19, Vite, TypeScript.
- **Agente / IA:** Cliente llama a un **endpoint seguro** (p. ej. `/api/athena-ai` en Vercel que proxifica una Cloud Function con **Vertex AI / Gemini**). Las claves de modelo no van en el bundle público.
- **Cadena:** **Solana Devnet** — programa Anchor de pool, memos de evidencia, RPC configurable.
- **Custodia del agente (firmas):** En producción, la clave del wallet operativo puede vivir solo en **variables de entorno del servidor** (`SOLANA_AGENT_KEYPAIR_BASE58`) y las rutas bajo `api/solana/*` firman las transacciones sensibles; el navegador no tiene que empaquetar la secret.
- **Almacenamiento de archivos:** **Pinata** vía `POST /api/ipfs/upload` (JWT solo en servidor).
- **Identidad y datos de usuario:** Firebase (auth / Firestore según configuración del proyecto).
- **Despliegue típico:** **Vercel** (SPA + serverless `api/*`).

---

## Requisitos

- Node.js reciente (npm).
- Cuentas y claves según `.env.local.example` (AI, Firebase, Pinata, Solana).
- Para compilar o desplegar el programa on-chain: toolchain **Anchor / Rust** (ver `solana/SETUP.md` si existe en tu copia del repo).

---

## Puesta en marcha rápida

1. Clona el repositorio e instala dependencias:

   ```bash
   npm install
   ```

2. Copia variables de entorno:

   ```bash
   cp .env.local.example .env.local
   ```

   Rellena al menos: Firebase (web), `VITE_SOLANA_RPC_URL`, `VITE_SOLANA_PROGRAM_ID` si usas pool on-chain, endpoint de IA (`VITE_AI_ENDPOINT_URL`), y en servidor (Vercel): `PINATA_JWT`, `SOLANA_AGENT_KEYPAIR_BASE58`, URLs upstream del chat, etc., tal como indica el ejemplo.

3. Arranca en desarrollo:

   ```bash
   npm run dev
   ```

4. Build de producción:

   ```bash
   npm run build
   ```

5. Opcional — scripts Solana (genkey, airdrop devnet, deploy): ver `package.json` (`sol:genkey`, `sol:airdrop`, `sol:deploy`, …).

---

## Estructura del repositorio (referencia)

| Ruta | Contenido |
|------|-----------|
| `components/` | UI React (calculadora, chat, evidencia, donaciones, etc.). |
| `lib/` | Agente, clientes Solana, router de cadena, servicios compartidos. |
| `api/` | Handlers serverless (IA proxy, IPFS, operaciones firmadas Solana). |
| `solana/` | Programa Anchor y artefactos de despliegue. |
| `backend/` | Cloud Function de IA (si la usas desplegada aparte). |

---

## Créditos y contexto

Proyecto tipo hackathon / MVP en evolución, con foco en **soberanía financiera** y **trazabilidad de evidencia** como apoyo a quien enfrenta violencia económica. El stack prioriza un demo creíble en **Solana Devnet** y buenas prácticas de secretos en despliegue (claves solo en servidor).
