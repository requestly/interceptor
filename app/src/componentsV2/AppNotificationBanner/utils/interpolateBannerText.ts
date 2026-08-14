const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Substitutes {{key}} placeholders in GrowthBook-authored banner copy.
 * An unknown or empty value leaves the placeholder in place on purpose, so a typo in the
 * GrowthBook entry reads as an obvious "{{foo}}" rather than as "undefined".
 */
export const interpolateBannerText = (text: string, values: Record<string, string>): string => {
  if (!text) {
    return text;
  }

  // The replacer must stay a function — it keeps "$&" and friends inside the value literal.
  return text.replace(PLACEHOLDER_PATTERN, (placeholder, key) => values[key] || placeholder);
};
