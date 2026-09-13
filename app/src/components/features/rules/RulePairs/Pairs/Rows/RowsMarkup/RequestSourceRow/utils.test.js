import { describe, expect, it } from "vitest";
import { CONSTANTS as GLOBAL_CONSTANTS } from "@requestly/requestly-core";
import { getAdvancedFiltersCount } from "./utils";

const { PAGE_DOMAINS, PAGE_URL, REQUEST_DATA, REQUEST_METHOD, RESOURCE_TYPE } =
  GLOBAL_CONSTANTS.RULE_SOURCE_FILTER_TYPES;

describe("getAdvancedFiltersCount", () => {
  it("does not count empty default filters", () => {
    expect(
      getAdvancedFiltersCount({
        [PAGE_DOMAINS]: [],
        [REQUEST_METHOD]: "",
        [RESOURCE_TYPE]: {},
        [REQUEST_DATA]: { key: "", operator: "Equals", value: "" },
      })
    ).toBe(0);
  });

  it("does not count arrays that only contain empty entries", () => {
    expect(
      getAdvancedFiltersCount({
        [PAGE_DOMAINS]: ["", {}, null],
      })
    ).toBe(0);
  });

  it("requires request payload filters to have both key and value", () => {
    expect(
      getAdvancedFiltersCount({
        [REQUEST_DATA]: { key: "id", operator: "Equals", value: "" },
      })
    ).toBe(0);
    expect(
      getAdvancedFiltersCount({
        [REQUEST_DATA]: { key: "", operator: "Equals", value: "123" },
      })
    ).toBe(0);
    expect(
      getAdvancedFiltersCount({
        [REQUEST_DATA]: { key: "id", operator: "Equals", value: "123" },
      })
    ).toBe(1);
  });

  it("excludes page URL from the advanced filter count", () => {
    expect(
      getAdvancedFiltersCount({
        [PAGE_URL]: "https://example.com",
        [REQUEST_METHOD]: "GET",
      })
    ).toBe(1);
  });

  it("counts meaningful filter values", () => {
    expect(
      getAdvancedFiltersCount({
        [PAGE_DOMAINS]: ["example.com"],
        [REQUEST_METHOD]: "GET",
        [RESOURCE_TYPE]: { script: true },
      })
    ).toBe(3);
  });
});
