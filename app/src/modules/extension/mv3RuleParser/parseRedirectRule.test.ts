import { describe, it, expect, vi } from "vitest";
import { RedirectRule, RuleSourceKey, RuleSourceOperator, RuleType } from "@requestly/shared/types/entities/rules";
import parseRedirectRule from "./parseRedirectRule";

vi.mock("../../../../../common/logger", () => ({ default: { log: () => {}, error: () => {} } }));

const redirectRule = (value: string, destination: string) =>
  (({
    ruleType: RuleType.REDIRECT,
    pairs: [
      {
        source: { key: RuleSourceKey.URL, operator: RuleSourceOperator.WILDCARD_MATCHES, value },
        destination,
      },
    ],
  } as unknown) as RedirectRule.Record);

// Mirrors how Chrome applies a DNR redirect: the first match of regexFilter is replaced by regexSubstitution.
const applyDNRRedirect = (rule: RedirectRule.Record, url: string) => {
  const { condition, action } = parseRedirectRule(rule)[0]!;
  const regex = new RegExp(condition.regexFilter!, condition.isUrlFilterCaseSensitive ? "" : "i");
  if (!regex.test(url)) return null;
  if (action.redirect!.url) return action.redirect!.url;
  return url.replace(regex, action.redirect!.regexSubstitution!.replace(/\\(\d)/g, "$$$1"));
};

describe("parseRedirectRule wildcard source", () => {
  it("fills each * with the shortest text up to the next literal, like the desktop rule processor", () => {
    const rule = redirectRule("*-*", "$1_$2");

    expect(applyDNRRedirect(rule, "https://abcde-fghij-klmno")).toBe("https://abcde_fghij-klmno");
  });

  it("splits groups the same way as the rule processor's checkWildCardMatch spec", () => {
    // common/rule-processor/tests/RuleHelper.spec.js: "http://*.*" on http://cricket.yahoo.com gives "cricket" and "yahoo.com"
    const rule = redirectRule("http://*.*", "http://$1_$2");

    expect(applyDNRRedirect(rule, "http://cricket.yahoo.com")).toBe("http://cricket_yahoo.com");
  });

  it("keeps the first path segment in $1 when the path has more slashes", () => {
    const rule = redirectRule("https://example.com/*/*", "https://mirror.example.com/$1?rest=$2");

    expect(applyDNRRedirect(rule, "https://example.com/a/b/c")).toBe("https://mirror.example.com/a?rest=b/c");
  });

  it("still matches the whole URL when the wildcard is the last token", () => {
    const rule = redirectRule("https://example.com/*", "https://mirror.example.com/$1");

    expect(applyDNRRedirect(rule, "https://example.com/a/b?c=d")).toBe("https://mirror.example.com/a/b?c=d");
  });
});
