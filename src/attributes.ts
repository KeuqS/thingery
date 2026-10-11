// Flexible attribute handling: category-declared definitions (validation +
// self-description for agents) and JSONB containment filters for search.
// Deliberately permissive: keys not declared by the category pass through
// unchanged — flexibility is the point; definitions are guidance, not law.

export interface AttributeDefinition {
  key: string;
  type: "string" | "number" | "boolean";
  enum?: string[];
  required?: boolean;
  unit?: string;
  description?: string;
}

export interface CategoryRow {
  name: string;
  description: string;
  attribute_definitions: AttributeDefinition[];
}

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

/** Validate attributes against a category's definitions.
 *  Returns error messages; empty array = valid. */
export function validateAttributes(
  definitions: AttributeDefinition[],
  attributes: Attributes,
): string[] {
  const errors: string[] = [];

  for (const def of definitions) {
    const value = attributes[def.key];
    if (value === undefined || value === null || value === "") {
      if (def.required) errors.push(`missing required attribute "${def.key}"${def.description ? ` (${def.description})` : ""}`);
      continue;
    }
    if (def.type === "number" && typeof value !== "number") {
      errors.push(`attribute "${def.key}" must be a number, got ${JSON.stringify(value)}`);
    } else if (def.type === "boolean" && typeof value !== "boolean") {
      errors.push(`attribute "${def.key}" must be a boolean, got ${JSON.stringify(value)}`);
    } else if (def.type === "string" && typeof value !== "string") {
      errors.push(`attribute "${def.key}" must be a string, got ${JSON.stringify(value)}`);
    } else if (def.enum && (typeof value !== "string" || !def.enum.includes(value))) {
      errors.push(`attribute "${def.key}" must be one of: ${def.enum.join(", ")}`);
    }
  }

  return errors;
}

/** Build the JSONB containment clause for attribute filters.
 *  `addParam` registers the JSON string and returns its $n placeholder. */
export function attributeFilterClause(
  attributes: Attributes,
  addParam: (value: unknown) => string,
): string {
  return `i.attributes @> ${addParam(JSON.stringify(attributes))}::jsonb`;
}

/** Flatten attributes into text for semantic indexing ("size_eu: 43"). */
export function attributesToText(attributes: Attributes | undefined): string {
  if (!attributes) return "";
  return Object.entries(attributes)
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`)
    .join("\n");
}
