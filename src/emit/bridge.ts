/**
 * Auto client-server bridge generator.
 *
 * The bridge IR is already populated during lowering; the React
 * emitter consumes it directly to produce `src/api/*.ts`. This module
 * exists to emit a *typed RPC manifest* — a shared file consumed by
 * both client and server so they stay in sync:
 *
 *   shared/rpc.ts → endpoint metadata (paths, types) used for codegen.
 *
 * It also produces a `shared/types.ts` containing every TypeRef and
 * Record alias used across the boundary, so the two sides agree.
 */

import type { BridgeModuleIR, SchemaModuleIR } from "./ir.js";

export interface BridgeFile {
  path: string;
  contents: string;
}

export function emitBridge(
  bridge: BridgeModuleIR,
  schema: SchemaModuleIR,
): BridgeFile[] {
  const rpc = `// Auto-generated RPC manifest. Edited by Modra emitter.
export const RPC = {
${bridge.endpoints
  .map(
    (e) =>
      `  ${e.name}: { path: "${e.path}", method: "${e.method}" as const },`,
  )
  .join("\n")}
};

${bridge.endpoints
  .map(
    (e) =>
      `export type ${e.name}Request = { ${e.params
        .map((p) => `${p.name}: ${p.tsType}`)
        .join("; ")} };`,
  )
  .join("\n")}

${bridge.endpoints
  .map((e) => `export type ${e.name}Response = ${e.returnType};`)
  .join("\n")}
`;
  const sharedTypes = `// Shared row types between client + server.
${schema.tables
  .map((t) => {
    const fields = t.columns
      .map((c) => `  ${c.name}: ${sqlToTs(c.sqlType, c.nullable)};`)
      .join("\n");
    return `export interface ${t.name} {
${fields}
}`;
  })
  .join("\n\n")}
`;
  return [
    { path: "shared/rpc.ts", contents: rpc },
    { path: "shared/types.ts", contents: sharedTypes },
  ];
}

function sqlToTs(sql: string, nullable: boolean): string {
  const base = sql.replace(/\s+NOT NULL$/i, "");
  let ts: string;
  if (/INTEGER|BIGINT|SMALLINT|DOUBLE|REAL|NUMERIC/i.test(base)) ts = "number";
  else if (/BOOLEAN/i.test(base)) ts = "boolean";
  else if (/TIMESTAMP|DATE|TIME/i.test(base)) ts = "Date";
  else ts = "string";
  return nullable ? `${ts} | null` : ts;
}
