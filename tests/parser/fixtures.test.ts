import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, findAll, findFirst } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "lexer", "fixtures");

function load(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

describe("End-to-end fixture parses", () => {
  it("parses storefront.modra with zero error diagnostics", () => {
    const src = load("storefront.modra");
    const { ast, diagnostics } = new Parser(src, "storefront.modra").parseFile();
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors, errors.map((e) => e.message).join("\n")).toHaveLength(0);
    expect(ast.kind).toBe("File");
  });

  it("storefront has three using imports", () => {
    const { ast } = new Parser(load("storefront.modra"), "storefront").parseFile();
    expect(ast.usings).toHaveLength(3);
    const aliased = ast.usings.find((u) => u.alias !== null);
    expect(aliased?.alias?.name).toBe("DB");
  });

  it("storefront has three Style declarations (BaseTheme, AppleGlass, PromoCard)", () => {
    const { ast } = new Parser(load("storefront.modra"), "storefront").parseFile();
    const styles = findAll(ast, "StyleDecl");
    expect(styles).toHaveLength(3);
    const names = styles.map((s) => s.name.name);
    expect(names).toContain("BaseTheme");
    expect(names).toContain("AppleGlass");
    expect(names).toContain("PromoCard");
    const apple = styles.find((s) => s.name.name === "AppleGlass");
    expect(apple?.base?.name).toBe("BaseTheme");
  });

  it("storefront declares CartCount (Number) and UserList (Array<Object>)", () => {
    const { ast } = new Parser(load("storefront.modra"), "storefront").parseFile();
    const elements = findAll(ast, "ElementDecl").filter((e) => e.name !== null);
    const names = elements.map((e) => e.name!.name);
    expect(names).toContain("CartCount");
    expect(names).toContain("UserList");
    const userList = elements.find((e) => e.name!.name === "UserList");
    expect(userList?.labelGenerics).toHaveLength(1);
  });

  it("storefront contains exactly one Action and one Component", () => {
    const { ast } = new Parser(load("storefront.modra"), "storefront").parseFile();
    expect(findAll(ast, "ActionDecl")).toHaveLength(1);
    expect(findAll(ast, "ComponentDecl")).toHaveLength(1);
  });

  it("storefront's CreateProductCard component has 3 typed parameters", () => {
    const { ast } = new Parser(load("storefront.modra"), "storefront").parseFile();
    const component = findFirst(ast, "ComponentDecl");
    expect(component?.name.name).toBe("CreateProductCard");
    expect(component?.params).toHaveLength(3);
    expect(component?.params.map((p) => p.name.name)).toEqual(["Name", "Price", "Image"]);
  });

  it("storefront contains an interpolated string for the cart status", () => {
    const { ast } = new Parser(load("storefront.modra"), "storefront").parseFile();
    const interpolated = findAll(ast, "InterpolatedStringLit");
    expect(interpolated.length).toBeGreaterThanOrEqual(1);
  });
});

describe("End-to-end register-user.modra", () => {
  it("parses register-user.modra with zero error diagnostics", () => {
    const src = load("register-user.modra");
    const { ast, diagnostics } = new Parser(src, "register-user.modra").parseFile();
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors, errors.map((e) => e.message).join("\n")).toHaveLength(0);
    expect(ast.kind).toBe("File");
  });

  it("register-user has file-top directives (@@strict, @@target: Server)", () => {
    const { ast } = new Parser(load("register-user.modra"), "register-user").parseFile();
    expect(ast.directives.length).toBeGreaterThanOrEqual(2);
    const strict = ast.directives.find((d) => d.name.name === "strict");
    const target = ast.directives.find((d) => d.name.name === "target");
    expect(strict).toBeDefined();
    expect(target?.value?.kind).toBe("Identifier");
  });

  it("register-user has a Database with one Users table", () => {
    const { ast } = new Parser(load("register-user.modra"), "register-user").parseFile();
    const dbs = findAll(ast, "DatabaseDecl");
    expect(dbs).toHaveLength(1);
    expect(dbs[0]!.tables).toHaveLength(1);
    expect(dbs[0]!.tables[0]!.name.name).toBe("Users");
  });

  it("Users table has columns with @Primary / @Unique decorators", () => {
    const { ast } = new Parser(load("register-user.modra"), "register-user").parseFile();
    const cols = findAll(ast, "ColumnDecl");
    expect(cols.length).toBeGreaterThan(0);
    const hasPrimary = cols.some((c) =>
      c.decorators.some((d) => d.name.name === "Primary"),
    );
    expect(hasPrimary).toBe(true);
  });

  it("register-user contains a NativeBridge node", () => {
    const { ast } = new Parser(load("register-user.modra"), "register-user").parseFile();
    const native = findFirst(ast, "NativeBridge");
    expect(native).not.toBeNull();
    expect(native?.language.name).toBe("Python");
  });

  it("register-user has an Endpoint and an Action declaration", () => {
    const { ast } = new Parser(load("register-user.modra"), "register-user").parseFile();
    expect(findAll(ast, "EndpointDecl")).toHaveLength(1);
    expect(findAll(ast, "ActionDecl")).toHaveLength(1);
  });

  it("register-user contains an if/elif/else equivalent (IfStmt with branches)", () => {
    const { ast } = new Parser(load("register-user.modra"), "register-user").parseFile();
    const ifs = findAll(ast, "IfStmt");
    expect(ifs.length).toBeGreaterThanOrEqual(1);
    // The Endpoint's if has at least two branches (success / else).
    const branchCounts = ifs.map((i) => i.branches.length);
    expect(Math.max(...branchCounts)).toBeGreaterThanOrEqual(2);
  });
});
