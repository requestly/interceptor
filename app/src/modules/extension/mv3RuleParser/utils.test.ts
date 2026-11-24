import { describe, it, expect, vi } from "vitest";
import { RulePairSource, RuleSourceKey, RuleSourceOperator } from "@requestly/shared/types/entities/rules";
import { parseUrlParametersFromSourceV2 } from "./utils";

vi.mock("../../../../../common/logger", () => ({ default: { log: () => {}, error: () => {} } }));

const wildcardSource = (key: RuleSourceKey, value: string) =>
  (({ key, operator: RuleSourceOperator.WILDCARD_MATCHES, value } as unknown) as RulePairSource);

const regexFor = (source: RulePairSource) => {
  const { regexFilter, isUrlFilterCaseSensitive } = parseUrlParametersFromSourceV2(source);
  return new RegExp(regexFilter!, isUrlFilterCaseSensitive ? "" : "i");
};

describe("parseUrlParametersFromSourceV2 wildcard source", () => {
  it("treats + in the wildcard as a literal character", () => {
    const regex = regexFor(wildcardSource(RuleSourceKey.URL, "https://fonts.googleapis.com/css?family=Open+Sans*"));

    expect(regex.test("https://fonts.googleapis.com/css?family=Open+Sans:400,700")).toBe(true);
  });

  it("treats $ in the wildcard as a literal character", () => {
    const regex = regexFor(wildcardSource(RuleSourceKey.URL, "https://api.example.com/odata/Products?$filter=*"));

    expect(regex.test("https://api.example.com/odata/Products?$filter=Price%20gt%205")).toBe(true);
  });

  it("treats parentheses in the wildcard as literal characters, so only * creates $n groups", () => {
    const regex = regexFor(
      wildcardSource(RuleSourceKey.URL, "https://en.wikipedia.org/w/index.php?title=Mercury_(planet)&action=*")
    );
    const match = regex.exec("https://en.wikipedia.org/w/index.php?title=Mercury_(planet)&action=history");

    expect(match?.[1]).toBe("history");
    expect(regex.test("https://en.wikipedia.org/w/index.php?title=Mercury_planet&action=history")).toBe(false);
  });

  it("keeps matching ordinary wildcards", () => {
    expect(
      regexFor(wildcardSource(RuleSourceKey.URL, "https://*.example.com/*")).test("https://api.example.com/v1")
    ).toBe(true);
    expect(regexFor(wildcardSource(RuleSourceKey.HOST, "*.example.com")).test("https://api.example.com/v1")).toBe(true);
  });
});
