import { expect, test } from "@playwright/test";
import { RuleType, SourceKey, SourceOperator } from "../../../common/src/types";
import { matchSourceUrl, populateRedirectedUrl } from "../../src/common/ruleMatcher";

test("wildcard redirect captures stop at the first delimiter", () => {
  const source = {
    key: SourceKey.URL,
    operator: SourceOperator.WILDCARD_MATCHES,
    value: "https://example.com/*/*",
  };
  const url = "https://example.com/a/b/c";

  expect(matchSourceUrl(source, url)).toBe(true);
  expect(
    populateRedirectedUrl(
      { source, destination: "https://mirror.example.com/$1?rest=$2" } as Parameters<typeof populateRedirectedUrl>[0],
      RuleType.REDIRECT,
      { url, method: "GET", type: "xmlhttprequest" }
    )
  ).toBe("https://mirror.example.com/a?rest=b/c");
});
