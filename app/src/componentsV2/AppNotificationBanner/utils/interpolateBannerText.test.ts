import { describe, it, expect } from "vitest";

import { interpolateBannerText } from "./interpolateBannerText";

describe("interpolateBannerText", () => {
  it("substitutes a single placeholder", () => {
    expect(interpolateBannerText("Link {{email}} now", { email: "jane@acme.com" })).toBe("Link jane@acme.com now");
  });

  it("substitutes the same placeholder more than once", () => {
    expect(interpolateBannerText("{{email}} and {{email}}", { email: "jane@acme.com" })).toBe(
      "jane@acme.com and jane@acme.com"
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(interpolateBannerText("Link {{ email }} now", { email: "jane@acme.com" })).toBe("Link jane@acme.com now");
  });

  it("leaves an unknown placeholder as literal text", () => {
    expect(interpolateBannerText("Hello {{name}}", { email: "jane@acme.com" })).toBe("Hello {{name}}");
  });

  it("leaves the placeholder alone when the value is an empty string", () => {
    expect(interpolateBannerText("Link {{email}} now", { email: "" })).toBe("Link {{email}} now");
  });

  it("treats replacement patterns in the value as literal characters", () => {
    expect(interpolateBannerText("Link {{email}}", { email: "a$&b@acme.com" })).toBe("Link a$&b@acme.com");
  });

  it("returns the text unchanged when it holds no placeholder", () => {
    expect(interpolateBannerText("Nothing to replace", { email: "jane@acme.com" })).toBe("Nothing to replace");
  });

  it("returns the input unchanged when it is empty", () => {
    expect(interpolateBannerText("", { email: "jane@acme.com" })).toBe("");
  });
});
