/**
 * React + TypeScript frontend emitter.
 *
 * Turns the `ClientModuleIR` into a tree of files:
 *
 *   <out>/src/
 *     App.tsx              ← the entry component (`Main` Action)
 *     components/<Name>.tsx
 *     hooks/useReactiveState.ts (runtime helper)
 *     styles/<Name>.css
 *     api/<Endpoint>.ts    ← fetch wrappers (from bridge IR)
 *     main.tsx             ← ReactDOM root
 *     index.html
 *
 * The output is intentionally Vite-ready: drop into a fresh Vite
 * `react-ts` template and it builds.
 */

import type {
  BridgeModuleIR,
  ClientModuleIR,
  ComponentIR,
  StyleIR,
  StateDeclIR,
  UINode,
  ActionIR,
} from "./ir.js";

export interface FrontendFile {
  path: string;
  contents: string;
}

export function emitReact(
  client: ClientModuleIR,
  bridge: BridgeModuleIR,
): FrontendFile[] {
  const files: FrontendFile[] = [];

  // 0. Client-side runtime (stdlib helpers usable in components / actions)
  files.push({
    path: "src/runtime.ts",
    contents: renderClientRuntime(),
  });

  // 1. Components
  for (const comp of client.components) {
    files.push({
      path: `src/components/${comp.name}.tsx`,
      contents: renderComponent(comp),
    });
  }

  // 2. Styles → CSS files
  for (const style of client.styles) {
    files.push({
      path: `src/styles/${style.name}.css`,
      contents: renderStyle(style),
    });
  }

  // 3. API wrappers
  for (const ep of bridge.endpoints) {
    files.push({
      path: `src/api/${ep.name}.ts`,
      contents: renderApiWrapper(ep),
    });
  }
  if (bridge.endpoints.length > 0) {
    files.push({
      path: "src/api/index.ts",
      contents:
        bridge.endpoints
          .map((e) => `export { ${e.name} } from "./${e.name}.js";`)
          .join("\n") +
        "\n\nexport const Server = {\n" +
        bridge.endpoints.map((e) => `  ${e.name},`).join("\n") +
        "\n};\n",
    });
  }

  // 4. App.tsx (entry)
  files.push({ path: "src/App.tsx", contents: renderApp(client, bridge) });

  // 5. main.tsx
  const entryName = client.components.some((c) => c.name === "App") ? "ModraApp" : "App";
  files.push({
    path: "src/main.tsx",
    contents: `import React from "react";
import ReactDOM from "react-dom/client";
import { ${entryName} } from "./App.js";
${client.styles.map((s) => `import "./styles/${s.name}.css";`).join("\n")}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <${entryName} />
  </React.StrictMode>,
);
`,
  });

  // 6. index.html
  files.push({
    path: "index.html",
    contents: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Modra app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  });

  return files;
}

// ─── Component renderer ─────────────────────────────────────
function renderComponent(comp: ComponentIR): string {
  const importLine = `import React from "react";`;
  const apiImport =
    "import { Server } from \"../api/index.js\";";
  const paramsTs = comp.params
    .map((p) => `${p.name}: ${p.tsType}`)
    .join("; ");
  const propsTypeDecl = comp.params.length
    ? `interface ${comp.name}Props { ${paramsTs}; }`
    : "";
  const propsArg = comp.params.length
    ? `(props: ${comp.name}Props)`
    : "()";
  const destructure = comp.params.length
    ? `const { ${comp.params.map((p) => p.name).join(", ")} } = props;`
    : "";
  const hooks = comp.localState.map(renderHook).join("\n  ");
  const jsx = comp.ui ? renderUI(comp.ui, "    ") : '<div>"' + comp.name + '"</div>';
  return [
    importLine,
    apiImport,
    "",
    propsTypeDecl,
    "",
    `export function ${comp.name}${propsArg} {`,
    destructure ? "  " + destructure : "",
    hooks ? "  " + hooks : "",
    "  return (",
    jsx.replace(/^/gm, ""),
    "  );",
    "}",
    "",
  ].filter((s) => s !== null).join("\n");
}

function renderHook(s: StateDeclIR): string {
  if (s.reads.length > 0 && s.reads.every((r) => r !== s.name)) {
    return `const ${s.name} = React.useMemo<${s.tsType}>(() => ${s.initExpr}, [${s.reads.join(", ")}]);`;
  }
  return `const [${s.name}, set${cap(s.name)}] = React.useState<${s.tsType}>(${s.initExpr});`;
}

// ─── UI renderer ────────────────────────────────────────────
function renderUI(node: UINode, indent: string): string {
  switch (node.kind) {
    case "Text":
      return `${indent}${JSON.stringify(node.value)}`;
    case "Interp":
      return `${indent}{${node.expr}}`;
    case "If":
      return `${indent}{${node.condition} ? (\n${renderUI(node.then, indent + "  ")}\n${indent}) : ${
        node.otherwise ? `(\n${renderUI(node.otherwise, indent + "  ")}\n${indent})` : "null"
      }}`;
    case "ForEach":
      return `${indent}{${node.iterable}.map((${node.binding}: any) => (\n${renderUI(node.body, indent + "  ")}\n${indent}))}`;
    case "Element": {
      const propsStr = node.props.map(renderProp).join(" ");
      const propsSep = propsStr ? " " + propsStr : "";
      if (node.children.length === 0) {
        return `${indent}<${node.tag}${propsSep} />`;
      }
      const childrenStr = node.children
        .map((c) => renderUI(c, indent + "  "))
        .join("\n");
      return `${indent}<${node.tag}${propsSep}>\n${childrenStr}\n${indent}</${node.tag}>`;
    }
  }
}

function renderProp(p: { name: string; value?: string; expr?: string; twoWay?: boolean }): string {
  if (p.twoWay) {
    return `value={${p.expr}} onChange={(e) => set${cap(p.expr ?? "value")}((e.target as HTMLInputElement).value as any)}`;
  }
  if (p.expr !== undefined) return `${p.name}={${p.expr}}`;
  if (p.value !== undefined) return `${p.name}=${p.value === "true" ? "{true}" : JSON.stringify(p.value)}`;
  return "";
}

// ─── Style renderer ─────────────────────────────────────────
function renderStyle(style: StyleIR): string {
  const selector = `.${style.name}`;
  const rules = style.rules
    .map((r) => `  --modra-${toKebab(r.property)}: ${r.value};`)
    .join("\n");
  return `/* Style: ${style.name}${style.base ? ` from ${style.base}` : ""} */
${selector} {
${rules}
}
`;
}

// ─── API wrapper renderer ───────────────────────────────────
function renderApiWrapper(ep: import("./ir.js").BridgeEndpointIR): string {
  const params = ep.params.map((p) => `${p.name}: ${p.tsType}`).join(", ");
  const paramNames = ep.params.map((p) => p.name).join(", ");
  return `export async function ${ep.name}(${params}): Promise<${ep.returnType}> {
  const response = await fetch("${ep.path}", {
    method: "${ep.method}",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ${paramNames} }),
  });
  if (!response.ok) throw new Error(\`Server error \${response.status}\`);
  return (await response.json()) as ${ep.returnType};
}
`;
}

// ─── App.tsx (entry) ────────────────────────────────────────
function renderApp(client: ClientModuleIR, _bridge: BridgeModuleIR): string {
  // If the user already has a Component named `App`, rename our entry
  // to `ModraApp` to avoid collision.
  const hasUserApp = client.components.some((c) => c.name === "App");
  const entryName = hasUserApp ? "ModraApp" : "App";

  const componentImports = client.components
    .map((c) => `import { ${c.name} } from "./components/${c.name}.js";`)
    .join("\n");
  const entry = client.entry;
  const stateHooks = client.state.map(renderHook).join("\n  ");
  const actionDefs = client.actions.map(renderActionFunction).join("\n\n");
  const entryUI =
    entry && entry.ui
      ? renderUI(entry.ui, "      ")
      : client.components.length > 0
        ? `      <${client.components[0]!.name} />`
        : '      <div>Modra app</div>';
  return `import React from "react";
${componentImports}
import { Server } from "./api/index.js";

${actionDefs}

export function ${entryName}() {
  ${stateHooks}
  return (
    <div className="modra-root">
${entryUI}
    </div>
  );
}
`;
}

function renderActionFunction(action: ActionIR): string {
  const params = action.params.map((p) => `${p.name}: ${p.tsType}`).join(", ");
  return `export async function ${action.name}(${params}) {
${action.body.map((l) => "  " + l).join("\n")}
}`;
}

// ─── Client runtime ─────────────────────────────────────────
function renderClientRuntime(): string {
  return `// Modra client-side stdlib helpers.

export function UUID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  return "uuid-" + Math.random().toString(36).slice(2);
}

export function Now(): Date {
  return new Date();
}

export function Log(...args: unknown[]): void {
  console.log("[modra]", ...args);
}

export const DateTime = {
  now: (): Date => new Date(),
  fromISO: (s: string): Date => new Date(s),
  toISO: (d: Date): string => d.toISOString(),
  format: (d: Date): string => d.toLocaleString(),
};

export const MathX = {
  clamp: (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v)),
  round: (v: number, decimals = 0): number => {
    const f = Math.pow(10, decimals);
    return Math.round(v * f) / f;
  },
};

export const StringX = {
  capitalize: (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s),
  slug: (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
};

/** Show a transient notification toast. Replace with your UI lib. */
export function Toast(message: string): void {
  console.log("[toast]", message);
  // A real app might use react-hot-toast / sonner / etc.
}

/** Navigate to a route — uses window.location by default. */
export function Navigate(path: string): void {
  if (typeof window !== "undefined") window.location.href = path;
}
`;
}

// ─── Helpers ────────────────────────────────────────────────
function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function toKebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[.\s]/g, "-").toLowerCase();
}
