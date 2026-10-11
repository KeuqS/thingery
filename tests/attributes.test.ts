import { describe, expect, it } from "vitest";
import {
  attributeFilterClause,
  attributesToText,
  validateAttributes,
  type AttributeDefinition,
} from "../src/attributes.js";

const sneakerDefs: AttributeDefinition[] = [
  { key: "size_eu", type: "number", required: true },
  { key: "colorway", type: "string" },
  { key: "has_original_box", type: "boolean" },
];

describe("validateAttributes", () => {
  it("passes valid attributes and ignores undeclared keys (flexible by design)", () => {
    const errors = validateAttributes(sneakerDefs, {
      size_eu: 43,
      colorway: "white/grey",
      has_original_box: true,
      custom_future_field: "whatever",
    });
    expect(errors).toEqual([]);
  });

  it("flags missing required attributes", () => {
    const errors = validateAttributes(sneakerDefs, { colorway: "red" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("size_eu");
  });

  it("flags type mismatches", () => {
    const errors = validateAttributes(sneakerDefs, { size_eu: "43" });
    expect(errors[0]).toContain("must be a number");
  });

  it("validates enum values", () => {
    const defs: AttributeDefinition[] = [
      { key: "platform", type: "string", enum: ["ps5", "pc"] },
    ];
    expect(validateAttributes(defs, { platform: "ps5" })).toEqual([]);
    expect(validateAttributes(defs, { platform: "nes" })[0]).toContain("must be one of");
  });

  it("allows empty attributes when nothing is required", () => {
    expect(validateAttributes([], {})).toEqual([]);
  });
});

describe("attributeFilterClause", () => {
  it("builds a jsonb containment clause with a bound parameter", () => {
    const params: unknown[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const clause = attributeFilterClause({ size_eu: 43 }, add);
    expect(clause).toBe("i.attributes @> $1::jsonb");
    expect(params).toEqual(['{"size_eu":43}']);
  });
});

describe("attributesToText", () => {
  it("flattens attributes for semantic indexing", () => {
    expect(attributesToText({ size_eu: 43, colorway: "red" })).toBe("size eu: 43\ncolorway: red");
  });

  it("handles undefined", () => {
    expect(attributesToText(undefined)).toBe("");
  });
});
