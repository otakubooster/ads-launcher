/**
 * Naming templates (docs/spec.md → naming_templates): tokens in braces,
 * e.g. "{brand}_{market}_{angle}_{n}". Browser-safe.
 */
export const NAMING_TOKENS = ["brand", "market", "angle", "hook", "format", "date", "n"] as const;
export type NamingToken = (typeof NAMING_TOKENS)[number];
export type NamingValues = Partial<Record<NamingToken, string | number | null | undefined>>;

const TOKEN = /\{([a-z]+)\}/g;
/** Meta allows 400 characters in object names. */
export const MAX_NAME_LENGTH = 400;

export function unknownTokens(pattern: string) {
  return [...pattern.matchAll(TOKEN)].map((m) => m[1]!).filter((t) => !(NAMING_TOKENS as readonly string[]).includes(t));
}

/** Fills tokens; empty values collapse with their separator so no "__" is left behind. */
export function renderName(pattern: string, values: NamingValues) {
  const filled = pattern.replace(TOKEN, (whole, token: string) => {
    if (!(NAMING_TOKENS as readonly string[]).includes(token)) return whole;
    const v = values[token as NamingToken];
    return v === null || v === undefined ? "" : String(v).trim().replace(/\s+/g, "-");
  });
  return filled
    .replace(/([_\-|·. ])\1+/g, "$1")
    .replace(/^[_\-|·. ]+|[_\-|·. ]+$/g, "")
    .slice(0, MAX_NAME_LENGTH);
}

export const EXAMPLE_VALUES: NamingValues = { brand: "Lumen", market: "US", angle: "glow", hook: "morning-routine", format: "ugc", date: "2026-10-30", n: 1 };

/** Live example for the template editor. */
export function exampleName(pattern: string, values: NamingValues = EXAMPLE_VALUES) {
  return renderName(pattern, values) || "—";
}
