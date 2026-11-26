import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchCallKey, fetchStartKey, FetchStarts } from "../../src/page-scripts/fetchStarts";

const make = () => {
  let clock = 0;
  return {
    starts: new FetchStarts(() => clock),
    at: (t: number) => {
      clock = t;
    },
  };
};

const K = fetchStartKey("GET", "https://app.test/api/items");
const LATER = Number.POSITIVE_INFINITY;

describe("FetchStarts", () => {
  it("gives a lone call's start to its report, once", () => {
    const { starts, at } = make();
    at(100);
    starts.begin(K);
    at(900);
    assert.equal(starts.take(K, 500), 100);
    assert.equal(starts.take(K, 500), undefined);
  });

  it("answers nothing for calls that overlapped under one key, until all of them finished", () => {
    const { starts, at } = make();
    at(100);
    starts.begin(K);
    at(200);
    starts.begin(K);
    assert.equal(starts.take(K, LATER), undefined);
    at(300);
    starts.begin(K);
    assert.equal(starts.take(K, LATER), undefined);
    assert.equal(starts.take(K, LATER), undefined);
    at(400);
    starts.begin(K);
    assert.equal(starts.take(K, LATER), 400);
  });

  it("keeps calls to different methods or URLs apart", () => {
    const { starts, at } = make();
    const post = fetchStartKey("POST", "https://app.test/api/items");
    const other = fetchStartKey("GET", "https://app.test/api/other");
    at(100);
    starts.begin(K);
    at(200);
    starts.begin(post);
    at(300);
    starts.begin(other);
    assert.equal(starts.take(other, LATER), 300);
    assert.equal(starts.take(K, LATER), 100);
    assert.equal(starts.take(post, LATER), 200);
  });

  it("frees the key of a call that failed before its response, once", () => {
    const { starts, at } = make();
    at(100);
    const failedA = starts.begin(K);
    at(200);
    starts.begin(K);
    failedA();
    failedA();
    assert.equal(starts.take(K, LATER), undefined, "B overlapped A, so it stays unanswered");
    at(300);
    starts.begin(K)();
    at(400);
    starts.begin(K);
    assert.equal(starts.take(K, LATER), 400);
  });

  it("answers nothing when the start is later than the report allows, and ends the call", () => {
    const { starts, at } = make();
    at(300);
    starts.begin(K);
    assert.equal(starts.take(K, 250), undefined);
    at(400);
    starts.begin(K);
    assert.equal(starts.take(K, LATER), 400);
  });

  it("stops tracking new keys past 1000, and answers nothing for them", () => {
    const { starts, at } = make();
    at(100);
    for (let i = 0; i < 1000; i += 1) starts.begin(fetchStartKey("GET", `https://app.test/${i}`));
    const extra = fetchStartKey("GET", "https://app.test/extra");
    starts.begin(extra)();
    assert.equal(starts.take(extra, LATER), undefined);
    assert.equal(starts.take(fetchStartKey("GET", "https://app.test/7"), LATER), 100);
  });

  it("forgets every call on clear", () => {
    const { starts, at } = make();
    at(100);
    starts.begin(K);
    starts.clear();
    assert.equal(starts.take(K, LATER), undefined);
  });
});

describe("fetchCallKey", () => {
  const BASE = "https://app.test/dashboard/";
  // What the SDK reports for a call: its Request's method and absolute URL.
  const reportKey = (resource: unknown, init?: RequestInit) => {
    const request = resource instanceof Request ? resource.clone() : new Request(new URL(String(resource), BASE), init);
    return fetchStartKey(request.method, request.url);
  };

  const cases: [string, unknown, RequestInit | undefined][] = [
    ["a relative URL", "../api/items?page=2", undefined],
    ["an absolute URL with a fragment", "https://api.test/v1/items#top", undefined],
    ["a URL object", new URL("https://api.test/v1/items"), undefined],
    ["a lower-case method", "/api/items", { method: "post", body: "{}" }],
    ["a Request", new Request("https://api.test/v1/items", { method: "DELETE" }), undefined],
    ["a Request with a method override in init", new Request("https://api.test/v1/items"), { method: "POST" }],
  ];

  for (const [name, resource, init] of cases) {
    it(`matches the SDK's report for ${name}`, () => {
      assert.equal(fetchCallKey(resource, init, BASE), reportKey(resource, init));
    });
  }
});
