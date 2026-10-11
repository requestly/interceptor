import { describe, it, expect, vi } from "vitest";
import {
  CancelRule,
  RedirectRule,
  RuleSourceKey,
  RuleSourceOperator,
  RuleType,
} from "@requestly/shared/types/entities/rules";
import parseCancelRule from "./parseCancelRule";
import parseRedirectRule from "./parseRedirectRule";

vi.mock("../../../../../common/logger", () => ({ default: { log: () => {}, error: () => {} } }));

const regexSource = (key: RuleSourceKey, value: string) => ({ key, operator: RuleSourceOperator.MATCHES, value });

// Mirrors how Chrome evaluates a DNR regexFilter condition.
const blocks = (rule: CancelRule.Record, url: string) => {
  const { condition } = parseCancelRule(rule)[0]!;
  return new RegExp(condition.regexFilter!, condition.isUrlFilterCaseSensitive ? "" : "i").test(url);
};

describe("regex source with alternation", () => {
  const cancelHosts = ({
    ruleType: RuleType.CANCEL,
    pairs: [{ source: regexSource(RuleSourceKey.HOST, "/example\\.com|example\\.org/") }],
  } as unknown) as CancelRule.Record;

  it("blocks every host named in the alternation", () => {
    expect(blocks(cancelHosts, "https://example.com/a")).toBe(true);
    expect(blocks(cancelHosts, "https://example.org/a")).toBe(true);
  });

  it("does not block a different host that only has an alternative in its path or query", () => {
    expect(blocks(cancelHosts, "https://news.site/?ref=example.org")).toBe(false);
  });

  it("redirects the whole URL when a later alternative of a URL regex matches", () => {
    const rule = ({
      ruleType: RuleType.REDIRECT,
      pairs: [
        {
          source: regexSource(RuleSourceKey.URL, "/\\/legacy\\/(.*)|\\/old\\/(.*)/"),
          destination: "https://new.example.com/$1$2",
        },
      ],
    } as unknown) as RedirectRule.Record;
    const { condition, action } = parseRedirectRule(rule)[0]!;
    const url = "https://example.com/old/page";
    const redirected = url.replace(
      new RegExp(condition.regexFilter!),
      action.redirect!.regexSubstitution!.replace(/\\(\d)/g, "$$$1")
    );

    expect(redirected).toBe("https://new.example.com/page");
  });
});
