/**
 * Node + Express backend emitter.
 *
 * Lowers `ServerModuleIR` into:
 *
 *   <out>/server/
 *     index.ts             ← Express entry, registers all routes
 *     routes/<Endpoint>.ts ← one file per endpoint
 *     db.ts                ← thin pg client + per-table helpers
 *     native/<Lang>.ts     ← stub bridges (e.g. spawn python)
 *
 * The emitted server reads the database URL from env and registers a
 * JSON-body POST route per endpoint. Each route validates required
 * parameters and forwards to the endpoint handler.
 */

import type { ServerModuleIR, EndpointIR, SchemaModuleIR } from "./ir.js";

export interface ServerFile {
  path: string;
  contents: string;
}

export function emitNode(
  server: ServerModuleIR,
  schema: SchemaModuleIR,
): ServerFile[] {
  const files: ServerFile[] = [];

  // 1. Per-endpoint route file
  for (const ep of server.endpoints) {
    files.push({
      path: `server/routes/${ep.name}.ts`,
      contents: renderRoute(ep),
    });
  }

  // 2. server/index.ts — Express boot
  files.push({
    path: "server/index.ts",
    contents: renderServerIndex(server),
  });

  // 3. db.ts — pg helpers
  files.push({
    path: "server/db.ts",
    contents: renderDbHelpers(schema),
  });

  // 4. Server-side runtime (stdlib stubs)
  files.push({
    path: "server/runtime.ts",
    contents: renderServerRuntime(),
  });

  // 5. Native bridge stubs (one per language used)
  const langs = new Set<string>();
  for (const ep of server.endpoints) {
    for (const nb of ep.nativeBridges) langs.add(nb.language);
  }
  for (const lang of langs) {
    files.push({
      path: `server/native/${lang.toLowerCase()}.ts`,
      contents: renderNativeBridgeStub(lang),
    });
  }

  return files;
}

// ─── Per-endpoint route ─────────────────────────────────────
function renderRoute(ep: EndpointIR): string {
  const params = ep.params.map((p) => `${p.name}: ${p.tsType}`).join(", ");
  const paramNames = ep.params.map((p) => p.name).join(", ");
  const nativeImports = ep.nativeBridges
    .map((nb) => `import { run${nb.language} } from "../native/${nb.language.toLowerCase()}.js";`)
    .join("\n");
  return `import { Request, Response } from "express";
import { db } from "../db.js";
import { AuthToken, UUID, Now, Log } from "../runtime.js";
${nativeImports}

export async function ${ep.name}(${params}): Promise<${ep.returnType}> {
${ep.body.map((l) => "  " + l).join("\n")}
}

export async function handle${ep.name}(req: Request, res: Response) {
  try {
    const { ${paramNames} } = req.body ?? {};
    const result = await ${ep.name}(${paramNames});
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
}
`;
}

// ─── Express bootstrap ──────────────────────────────────────
function renderServerIndex(server: ServerModuleIR): string {
  const imports = server.endpoints
    .map((ep) => `import { handle${ep.name} } from "./routes/${ep.name}.js";`)
    .join("\n");
  const routes = server.endpoints
    .map((ep) => `app.${ep.method.toLowerCase()}("${ep.path}", handle${ep.name});`)
    .join("\n  ");
  return `import express from "express";
${imports}

const app = express();
app.use(express.json());

if (true) {
  ${routes}
}

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(\`Server listening on http://localhost:\${PORT}\`));
`;
}

// ─── DB helpers ─────────────────────────────────────────────
function renderDbHelpers(schema: SchemaModuleIR): string {
  const tableHelpers = schema.tables
    .map((t) => {
      const cols = t.columns.map((c) => c.name);
      const colsList = cols.join(", ");
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      return `  ${t.name}: {
    async Insert(row: Partial<${t.name}Row>) {
      const cols = [${cols.map((c) => `"${c}"`).join(", ")}];
      const vals = cols.map((c) => (row as any)[c]);
      const { rows } = await pool.query(
        \`INSERT INTO ${t.name} (${colsList}) VALUES (${placeholders}) RETURNING *\`,
        vals,
      );
      return { ...rows[0], IsSuccessful: true };
    },
    async Select(where: Partial<${t.name}Row> = {}) {
      const keys = Object.keys(where);
      const sql = keys.length
        ? \`SELECT * FROM ${t.name} WHERE \${keys.map((k, i) => \`\${k} = $\${i + 1}\`).join(" AND ")}\`
        : "SELECT * FROM ${t.name}";
      const { rows } = await pool.query(sql, keys.map((k) => (where as any)[k]));
      return rows as ${t.name}Row[];
    },
    async Update(where: Partial<${t.name}Row>, set: Partial<${t.name}Row>) {
      const setKeys = Object.keys(set);
      const whereKeys = Object.keys(where);
      const sql = \`UPDATE ${t.name} SET \${setKeys.map((k, i) => \`\${k} = $\${i + 1}\`).join(", ")} WHERE \${whereKeys.map((k, i) => \`\${k} = $\${i + 1 + setKeys.length}\`).join(" AND ")} RETURNING *\`;
      const params = [...setKeys.map((k) => (set as any)[k]), ...whereKeys.map((k) => (where as any)[k])];
      const { rows } = await pool.query(sql, params);
      return rows as ${t.name}Row[];
    },
    async Delete(where: Partial<${t.name}Row>) {
      const keys = Object.keys(where);
      const sql = \`DELETE FROM ${t.name} WHERE \${keys.map((k, i) => \`\${k} = $\${i + 1}\`).join(" AND ")}\`;
      await pool.query(sql, keys.map((k) => (where as any)[k]));
    },
  },`;
    })
    .join("\n");

  const rowTypes = schema.tables
    .map((t) => {
      const fields = t.columns
        .map((c) => `  ${c.name}: ${sqlTypeToTs(c.sqlType, c.nullable)};`)
        .join("\n");
      return `export interface ${t.name}Row {\n${fields}\n}`;
    })
    .join("\n\n");

  return `import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

${rowTypes}

export const db = {
${tableHelpers}
};
`;
}

function sqlTypeToTs(sql: string, nullable: boolean): string {
  const base = sql.replace(/\s+NOT NULL$/i, "");
  let ts: string;
  if (/INTEGER|BIGINT|SMALLINT|DOUBLE|REAL|NUMERIC/i.test(base)) ts = "number";
  else if (/BOOLEAN/i.test(base)) ts = "boolean";
  else if (/TIMESTAMP|DATE|TIME/i.test(base)) ts = "Date";
  else ts = "string";
  return nullable ? `${ts} | null` : ts;
}

// ─── Server runtime (stdlib) ────────────────────────────────
function renderServerRuntime(): string {
  return `import { randomUUID, createHash } from "node:crypto";

// ─── Core helpers ───────────────────────────────────────────

/** Generate a v4 UUID. */
export function UUID(): string {
  return randomUUID();
}

/** Current timestamp (Date). */
export function Now(): Date {
  return new Date();
}

/** Console-style structured log. */
export function Log(...args: unknown[]): void {
  console.log("[modra]", ...args);
}

/** Throw a Modra-style error tagged with a code. */
export function Throw(message: string, code = "MOD-RT001"): never {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  throw err;
}

// ─── Auth helpers ───────────────────────────────────────────

/**
 * Issue a placeholder auth token for a user id. Replace with a real
 * JWT / session integration in production.
 */
export function AuthToken(userId: string | { ID?: string }): string {
  const id = typeof userId === "string" ? userId : (userId.ID ?? "");
  return Buffer.from(\`modra:\${id}:\${Date.now()}\`).toString("base64url");
}

/** Hash a string with SHA-256 (hex). */
export function Hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ─── DateTime helpers ───────────────────────────────────────

export const DateTime = {
  now: (): Date => new Date(),
  fromISO: (s: string): Date => new Date(s),
  toISO: (d: Date): string => d.toISOString(),
  addDays: (d: Date, n: number): Date => new Date(d.getTime() + n * 86400_000),
  diffDays: (a: Date, b: Date): number => Math.round((a.getTime() - b.getTime()) / 86400_000),
};

// ─── Math helpers ───────────────────────────────────────────

export const MathX = {
  clamp: (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v)),
  lerp: (a: number, b: number, t: number): number => a + (b - a) * t,
  round: (v: number, decimals = 0): number => {
    const f = Math.pow(10, decimals);
    return Math.round(v * f) / f;
  },
  randomInt: (min: number, max: number): number =>
    Math.floor(Math.random() * (max - min + 1)) + min,
};

// ─── HTTP helpers (server-side fetch wrapper) ───────────────

export async function HttpGet<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(\`GET \${url} -> \${res.status}\`);
  return (await res.json()) as T;
}

export async function HttpPost<T = unknown>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(\`POST \${url} -> \${res.status}\`);
  return (await res.json()) as T;
}

// ─── String helpers ─────────────────────────────────────────

export const StringX = {
  isEmpty: (s: string): boolean => s.length === 0,
  trim: (s: string): string => s.trim(),
  slug: (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  capitalize: (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s),
};
`;
}

// ─── Native bridge stub ─────────────────────────────────────
function renderNativeBridgeStub(language: string): string {
  if (language === "Python") {
    return `import { spawnSync } from "node:child_process";

/**
 * Invoke an inline Python script. Inputs are JSON-serialised on argv
 * after the script body; outputs are read from stdout as JSON.
 */
export function runPython(script: string, inputs: Record<string, unknown>): Record<string, unknown> {
  const wrapped = \`
import json, sys
inputs = json.loads(sys.argv[1])
locals().update(inputs)
${"${script}"}
outs = {k: v for k, v in locals().items() if k not in inputs and not k.startswith("_")}
print(json.dumps(outs, default=str))
\`;
  const proc = spawnSync("python3", ["-c", wrapped, JSON.stringify(inputs)], {
    encoding: "utf8",
  });
  if (proc.status !== 0) throw new Error(proc.stderr);
  return JSON.parse(proc.stdout.trim());
}
`;
  }
  return `// TODO: implement ${language} native bridge.
export function run${language}(_script: string, _inputs: Record<string, unknown>): Record<string, unknown> {
  throw new Error("Native bridge for ${language} is not implemented yet.");
}
`;
}
