import { describe, it, expect } from "vitest";
import { firstDecl } from "./helpers.js";

describe("Attribute lists (declarative `(... )` forms)", () => {
  it("parses static attribute (key: value)", () => {
    const decl = firstDecl(`
      Component: C -> (
        Text: Logo (color: "red")
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    const elem = decl.body.items[0]!;
    if (elem.kind !== "ElementDecl") throw new Error("type guard");
    expect(elem.attrs?.entries).toHaveLength(1);
    expect(elem.attrs?.entries[0]!.mode).toBe("static");
    expect(elem.attrs?.entries[0]!.key?.name).toBe("color");
  });

  it("parses reactive attribute (key <- value)", () => {
    const decl = firstDecl(`
      Component: C -> (
        Text: Count (label <- CartCount)
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    const elem = decl.body.items[0]!;
    if (elem.kind !== "ElementDecl") throw new Error("type guard");
    expect(elem.attrs?.entries[0]!.mode).toBe("reactive");
  });

  it("parses positional content (single value with no key)", () => {
    const decl = firstDecl(`
      Component: C -> (
        Text: Logo ("Refurbished")
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    const elem = decl.body.items[0]!;
    if (elem.kind !== "ElementDecl") throw new Error("type guard");
    expect(elem.attrs?.entries[0]!.key).toBeNull();
    expect(elem.attrs?.entries[0]!.value?.kind).toBe("StringLit");
  });

  it("parses two-way bind attribute (Element :: ref)", () => {
    const decl = firstDecl(`
      Component: C -> (
        form (
          InputField::Email placeholder: "..."
        )
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    const form = decl.body.items[0]!;
    if (form.kind !== "ElementDecl") throw new Error("type guard");
    const entries = form.attrs!.entries;
    expect(entries[0]!.mode).toBe("two-way");
    expect(entries[0]!.key?.name).toBe("InputField");
    expect(entries[0]!.bindTarget?.name).toBe("Email");
  });

  it("parses Event -> Handler inside attribute lists", () => {
    const decl = firstDecl(`
      Component: C -> (
        Button: Buy (Click -> SubmitOrder)
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    const btn = decl.body.items[0]!;
    if (btn.kind !== "ElementDecl") throw new Error("type guard");
    const entry = btn.attrs!.entries[0]!;
    expect(entry.key?.name).toBe("Click");
    expect(entry.value?.kind).toBe("Identifier");
  });

  it("supports multiple comma-separated attributes", () => {
    const decl = firstDecl(`
      Component: C -> (
        Text: T (color: "red", size: "large", weight: 700)
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    const t = decl.body.items[0]!;
    if (t.kind !== "ElementDecl") throw new Error("type guard");
    expect(t.attrs?.entries).toHaveLength(3);
  });

  it("merges multiple trailing paren groups on bare-element form", () => {
    const decl = firstDecl(`
      Component: C -> (
        Card(name: "X") (color: "red")
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    const card = decl.body.items[0]!;
    if (card.kind !== "ElementDecl") throw new Error("type guard");
    expect(card.attrs?.entries).toHaveLength(2);
  });
});
