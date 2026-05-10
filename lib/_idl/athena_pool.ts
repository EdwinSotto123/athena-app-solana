/**
 * AthenaPool IDL type stub.
 *
 * IMPORTANT: This file is a HAND-WRITTEN PLACEHOLDER. After running
 * `anchor build` inside `solana/`, the real IDL types are emitted at
 * `solana/target/types/athena_pool.ts`. You can either:
 *   1. Re-export from there (preferred):
 *        export type { AthenaPool } from "../../solana/target/types/athena_pool";
 *   2. Run `npm run sol:sync-idl` to copy the JSON into `lib/_idl/athena_pool.json`.
 *
 * The stub below describes only the SHAPE we need so the rest of the app
 * type-checks before the first build. The real IDL is fetched at runtime
 * via `Program.fetchIdl(programId, provider)` so the cliente works as long
 * as the program is deployed on the target cluster.
 */

export type AthenaPool = {
    address: string;
    metadata: {
        name: string;
        version: string;
        spec: string;
        description: string;
    };
    instructions: any[];
    accounts: any[];
    events: any[];
    errors: any[];
    types: any[];
};
