/**
 * Modra's type system.
 *
 * Phase 3 ships with a deliberately *small* nominal type system —
 * just enough to drive the emitters. Every type is one of:
 *
 *   Primitive   : Number | String | Bool | Color | None | DateTime
 *   Generic     : Array<T> | Map<K,V> | Option<T> | Record (row object)
 *   Object      : { key: Type, … } structural shape
 *   Function    : (params) -> ret  (for endpoints / actions / components)
 *   Reference   : `EmailAddress`  (alias name resolved later by the
 *                 type-checker)
 *   Any / Error : escape hatches
 *
 * Types are immutable values; equality is structural via `equalsType`.
 */

import type { TypeRef } from "../ast/index.js";

export type Type =
  | { kind: "Number" }
  | { kind: "String" }
  | { kind: "Bool" }
  | { kind: "Color" }
  | { kind: "DateTime" }
  | { kind: "None" }
  | { kind: "Any" }
  | { kind: "Error" }
  | { kind: "Array"; element: Type }
  | { kind: "Map"; key: Type; value: Type }
  | { kind: "Option"; inner: Type }
  | { kind: "Record"; columns: { name: string; type: Type }[] }
  | { kind: "Object"; fields: { name: string; type: Type }[] }
  | { kind: "Function"; params: Type[]; ret: Type }
  | { kind: "Reference"; name: string };

// ─── Atom builders ───────────────────────────────────────────
export const TNumber: Type = { kind: "Number" };
export const TString: Type = { kind: "String" };
export const TBool: Type = { kind: "Bool" };
export const TColor: Type = { kind: "Color" };
export const TDateTime: Type = { kind: "DateTime" };
export const TNone: Type = { kind: "None" };
export const TAny: Type = { kind: "Any" };
export const TError: Type = { kind: "Error" };

export function tArray(element: Type): Type {
  return { kind: "Array", element };
}
export function tMap(key: Type, value: Type): Type {
  return { kind: "Map", key, value };
}
export function tOption(inner: Type): Type {
  return { kind: "Option", inner };
}
export function tObject(fields: { name: string; type: Type }[]): Type {
  return { kind: "Object", fields };
}
export function tFunction(params: Type[], ret: Type): Type {
  return { kind: "Function", params, ret };
}
export function tRef(name: string): Type {
  return { kind: "Reference", name };
}

/**
 * Convert an AST `TypeRef` into a `Type`. Unknown identifiers become
 * `Reference` types so the type-checker can resolve them later (after
 * all Type aliases are gathered).
 */
export function fromTypeRef(ref: TypeRef): Type {
  const base = baseFromName(ref.name.name, ref.generics);
  return ref.optional ? tOption(base) : base;
}

function baseFromName(name: string, generics: TypeRef[]): Type {
  switch (name) {
    case "Number":
    case "Int":
    case "Float":
    case "Decimal":
      return TNumber;
    case "String":
    case "Text":
      return TString;
    case "Bool":
    case "Boolean":
      return TBool;
    case "Color":
      return TColor;
    case "DateTime":
    case "Date":
    case "Time":
      return TDateTime;
    case "None":
      return TNone;
    case "Any":
    case "Object":
      return TAny;
    case "Array":
    case "List":
      return tArray(generics[0] ? fromTypeRef(generics[0]) : TAny);
    case "Map":
    case "Dict": {
      const k = generics[0] ? fromTypeRef(generics[0]) : TString;
      const v = generics[1] ? fromTypeRef(generics[1]) : TAny;
      return tMap(k, v);
    }
    case "Option":
    case "Maybe":
      return tOption(generics[0] ? fromTypeRef(generics[0]) : TAny);
    default:
      return tRef(name);
  }
}

/** Structural equality of types. Used sparingly — most checks use
 *  `isAssignable` which is more permissive. */
export function equalsType(a: Type, b: Type): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "Number":
    case "String":
    case "Bool":
    case "Color":
    case "DateTime":
    case "None":
    case "Any":
    case "Error":
      return true;
    case "Array":
      return equalsType(a.element, (b as { element: Type }).element);
    case "Map": {
      const bb = b as { key: Type; value: Type };
      return equalsType(a.key, bb.key) && equalsType(a.value, bb.value);
    }
    case "Option":
      return equalsType(a.inner, (b as { inner: Type }).inner);
    case "Reference":
      return a.name === (b as { name: string }).name;
    case "Function": {
      const bb = b as { params: Type[]; ret: Type };
      if (a.params.length !== bb.params.length) return false;
      for (let i = 0; i < a.params.length; i++) {
        if (!equalsType(a.params[i]!, bb.params[i]!)) return false;
      }
      return equalsType(a.ret, bb.ret);
    }
    case "Record":
    case "Object": {
      const bb = b as { fields?: { name: string; type: Type }[]; columns?: { name: string; type: Type }[] };
      const af = (a as { fields?: { name: string; type: Type }[]; columns?: { name: string; type: Type }[] }).fields ?? (a as { columns?: { name: string; type: Type }[] }).columns ?? [];
      const bf = bb.fields ?? bb.columns ?? [];
      if (af.length !== bf.length) return false;
      for (let i = 0; i < af.length; i++) {
        if (af[i]!.name !== bf[i]!.name) return false;
        if (!equalsType(af[i]!.type, bf[i]!.type)) return false;
      }
      return true;
    }
  }
}

/**
 * Subtyping / coercion rule:
 *   - `Any` is assignable both directions.
 *   - `None` is assignable to any `Option<T>`.
 *   - Otherwise structural equality.
 */
export function isAssignable(value: Type, target: Type): boolean {
  if (value.kind === "Any" || target.kind === "Any") return true;
  if (value.kind === "Error" || target.kind === "Error") return true;
  if (value.kind === "None" && target.kind === "Option") return true;
  if (target.kind === "Option" && isAssignable(value, target.inner)) return true;
  return equalsType(value, target);
}

export function describeType(t: Type): string {
  switch (t.kind) {
    case "Array":
      return `Array<${describeType(t.element)}>`;
    case "Map":
      return `Map<${describeType(t.key)}, ${describeType(t.value)}>`;
    case "Option":
      return `${describeType(t.inner)}?`;
    case "Function":
      return `(${t.params.map(describeType).join(", ")}) -> ${describeType(t.ret)}`;
    case "Record":
      return `Record(${t.columns.map((c) => `${c.name}: ${describeType(c.type)}`).join(", ")})`;
    case "Object":
      return `{ ${t.fields.map((f) => `${f.name}: ${describeType(f.type)}`).join(", ")} }`;
    case "Reference":
      return t.name;
    default:
      return t.kind;
  }
}
