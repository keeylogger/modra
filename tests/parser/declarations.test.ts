import { describe, it, expect } from "vitest";
import { firstDecl, parseOk } from "./helpers.js";
import { findFirst } from "../../src/index.js";

describe("Top-level declarations", () => {
  it("parses 'using' imports", () => {
    const ast = parseOk("using Web.UI\nusing Backend.Database as DB\n");
    expect(ast.usings).toHaveLength(2);
    expect(ast.usings[0]!.path.parts.map((p) => p.name)).toEqual(["Web", "UI"]);
    expect(ast.usings[1]!.alias?.name).toBe("DB");
  });

  it("parses a Style declaration with body", () => {
    const decl = firstDecl(`
      Style: Card (
        Color: Background <- #FFFFFF
        Number: Radius <- 12
      )
    `);
    if (decl.kind !== "StyleDecl") throw new Error("type guard");
    expect(decl.name.name).toBe("Card");
    expect(decl.body).toHaveLength(2);
    expect(decl.body[0]!.label.name).toBe("Color");
    expect(decl.body[1]!.name?.name).toBe("Radius");
  });

  it("parses Style with 'from' base", () => {
    const decl = firstDecl(`
      Style: Highlight from Card (
        Color: Border <- #FF3B30
      )
    `);
    if (decl.kind !== "StyleDecl") throw new Error("type guard");
    expect(decl.base?.name).toBe("Card");
  });

  it("parses Component declaration with params and body", () => {
    const decl = firstDecl(`
      Component: Card(Name: String, Price: Number) -> (
        Title: Name
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    expect(decl.name.name).toBe("Card");
    expect(decl.params).toHaveLength(2);
    expect(decl.params[0]!.name.name).toBe("Name");
    expect(decl.params[0]!.type?.name.name).toBe("String");
    expect(decl.body.items).toHaveLength(1);
  });

  it("parses Component with composes / emits / consumes", () => {
    const decl = firstDecl(`
      Component: Form composes Validated emits FormSubmitted consumes UserChanged -> (
        Title: "Form"
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    expect(decl.composes.map((c) => c.name)).toEqual(["Validated"]);
    expect(decl.emits.map((e) => e.name)).toEqual(["FormSubmitted"]);
    expect(decl.consumes.map((c) => c.name)).toEqual(["UserChanged"]);
  });

  it("parses Endpoint with parameters and body", () => {
    const decl = firstDecl(`
      Endpoint: GetUser(Id: String) -> (
        Return: Id
      )
    `);
    if (decl.kind !== "EndpointDecl") throw new Error("type guard");
    expect(decl.name.name).toBe("GetUser");
    expect(decl.params).toHaveLength(1);
  });

  it("parses Action with emits / consumes and body", () => {
    const decl = firstDecl(`
      Action: SubmitForm emits Submitted -> (
        Return: true
      )
    `);
    if (decl.kind !== "ActionDecl") throw new Error("type guard");
    expect(decl.emits.map((e) => e.name)).toEqual(["Submitted"]);
  });

  it("parses Type alias declarations", () => {
    const decl = firstDecl(`Type: EmailAddress: String @Format(email)`);
    if (decl.kind !== "TypeDecl") throw new Error("type guard");
    expect(decl.name.name).toBe("EmailAddress");
    expect(decl.alias.name.name).toBe("String");
    expect(decl.decorators[0]!.name.name).toBe("Format");
  });

  it("parses top-level variable ElementDecl", () => {
    const decl = firstDecl(`Number: CartCount <- 0`);
    if (decl.kind !== "ElementDecl") throw new Error("type guard");
    expect(decl.label.name).toBe("Number");
    expect(decl.name?.name).toBe("CartCount");
    expect(decl.init?.kind).toBe("NumberLit");
  });

  it("parses generic-typed variable declarations", () => {
    const decl = firstDecl(`Array<Object>: UserList <- []`);
    if (decl.kind !== "ElementDecl") throw new Error("type guard");
    expect(decl.label.name).toBe("Array");
    expect(decl.labelGenerics).toHaveLength(1);
    expect(decl.labelGenerics[0]!.name.name).toBe("Object");
  });

  it("parses nested generic types", () => {
    const decl = firstDecl(`Map<String, Array<Number>>: M <- {}`);
    if (decl.kind !== "ElementDecl") throw new Error("type guard");
    expect(decl.labelGenerics).toHaveLength(2);
    expect(decl.labelGenerics[1]!.generics).toHaveLength(1);
  });

  it("parses a generic-typed declaration that follows blank lines", () => {
    // Regression: blank lines preceding a generic top-level declaration
    // used to leave the cursor sitting on Newline tokens, causing
    // `isGenericLabelAhead` to short-circuit on the first newline it
    // saw (instead of skipping past them to find the actual generic).
    const ast = parseOk(
      "// header comment\n\n\nArray<String>: Items <- []\nNumber: Count <- 0\n",
    );
    expect(ast.declarations).toHaveLength(2);
    const first = ast.declarations[0]!;
    if (first.kind !== "ElementDecl") throw new Error("type guard");
    expect(first.label.name).toBe("Array");
    expect(first.labelGenerics).toHaveLength(1);
    expect(first.labelGenerics[0]!.name.name).toBe("String");
  });

  it("preserves declaration order in the file node", () => {
    const ast = parseOk(`
      Number: A <- 1
      Number: B <- 2
      Number: C <- 3
    `);
    expect(ast.declarations.map((d) => (d as { name?: { name: string } }).name?.name)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("makes the FileNode span cover the whole input", () => {
    const ast = parseOk(`Number: A <- 1\n\nNumber: B <- 2`);
    expect(findFirst(ast, "File")?.span.start.line).toBe(1);
  });
});
