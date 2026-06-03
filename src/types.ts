/** Shared cross-phase type aliases used by the rest of the compiler. */

export type EmitterTarget =
  | "Web"
  | "Mobile"
  | "Server"
  | "Universal";

export type FrontendTarget = "react" | "vue" | "svelte" | "vanilla";
export type BackendTarget = "node" | "python" | "php" | "go";
export type DatabaseTarget = "postgres" | "mysql" | "sqlite";
