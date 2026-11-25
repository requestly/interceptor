import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collapseAllBut,
  deletedMessage,
  emptyGroupText,
  footerSummary,
  groupCheckState,
  matchesFilter,
  movedMessage,
  pruneSelection,
  reusedGroupNotice,
  rowLabel,
  toggleGroupSelection,
} from "../../../common/src/sidepanel/network-recording/groupedPanelModel";

const entry = (method: string, url: string, type = "xhr") => ({ request: { method, url }, _resourceType: type });

describe("grouped panel filters", () => {
  const get = entry("GET", "https://api.example.com/api/config", "xhr");
  const post = entry("POST", "https://api.example.com/api/signin", "xhr");
  const doc = entry("GET", "https://www.example.com/", "document");

  it("All matches everything", () => {
    [get, post, doc].forEach((e) => assert.equal(matchesFilter(e, { text: "", chip: "ALL" }), true));
  });

  it("GET and POST match the method", () => {
    assert.deepEqual(
      [get, post, doc].map((e) => matchesFilter(e, { text: "", chip: "GET" })),
      [true, false, true]
    );
    assert.deepEqual(
      [get, post, doc].map((e) => matchesFilter(e, { text: "", chip: "POST" })),
      [false, true, false]
    );
  });

  it("XHR matches the resource type, whatever the method", () => {
    assert.deepEqual(
      [get, post, doc].map((e) => matchesFilter(e, { text: "", chip: "XHR" })),
      [true, true, false]
    );
  });

  it("search is a case-insensitive URL match combined with the chip", () => {
    assert.equal(matchesFilter(get, { text: "CONFIG", chip: "GET" }), true);
    assert.equal(matchesFilter(get, { text: "config", chip: "POST" }), false);
  });
});

describe("grouped panel copy", () => {
  it("footer counts requests and hosts with a middle dot", () => {
    assert.equal(
      footerSummary(["https://www.example.com/", "https://api.example.com/a", "https://api.example.com/b"]),
      "3 requests · 2 hosts"
    );
    assert.equal(footerSummary(["https://www.example.com/"]), "1 request · 1 host");
    assert.equal(footerSummary([]), "0 requests · 0 hosts");
  });

  it("names the moved count and the deleted count", () => {
    assert.equal(movedMessage(1), "Moved 1 request to");
    assert.equal(movedMessage(2), "Moved 2 requests to");
    assert.equal(deletedMessage(1), "Deleted 1 request.");
  });

  it("explains an empty group being reopened by New group", () => {
    assert.equal(
      reusedGroupNotice("Group 2"),
      "Group 2 has no requests yet, so “New group” reopened its name instead of adding an empty group."
    );
  });

  it("tells the user how an empty group fills, and what to do while paused", () => {
    assert.equal(
      emptyGroupText({ hasRequests: false, active: true, paused: false }),
      "No requests yet. Use the site and they land here."
    );
    assert.equal(
      emptyGroupText({ hasRequests: false, active: true, paused: true }),
      "No requests yet. Resume, then use the site."
    );
    assert.equal(emptyGroupText({ hasRequests: false, active: false, paused: false }), "No requests yet.");
    assert.equal(
      emptyGroupText({ hasRequests: true, active: true, paused: false }),
      "No requests match the current filter."
    );
  });

  it("shows the host for the page document and the path for everything else", () => {
    assert.equal(rowLabel("https://www.bstackdemo.com/", "document"), "www.bstackdemo.com/");
    assert.equal(rowLabel("https://api.bstackdemo.com/api/hotels?city=goa", "xhr"), "/api/hotels?city=goa");
  });
});

describe("grouped panel selection", () => {
  it("shows a dash when only some visible rows of a group are selected", () => {
    assert.equal(groupCheckState(["a", "b"], new Set()), "unchecked");
    assert.equal(groupCheckState(["a", "b"], new Set(["a"])), "partial");
    assert.equal(groupCheckState(["a", "b"], new Set(["a", "b", "z"])), "checked");
  });

  it("selects every visible row of a group, then clears them on the next click", () => {
    const once = toggleGroupSelection(["a", "b"], new Set(["a", "z"]));
    assert.deepEqual([...once].sort(), ["a", "b", "z"]);
    const twice = toggleGroupSelection(["a", "b"], once);
    assert.deepEqual([...twice], ["z"]);
  });

  it("drops deleted rows and never adds new ones", () => {
    const next = pruneSelection(new Set(["a", "b"]), new Set(["a", "c", "d"]));
    assert.deepEqual([...next], ["a"]);
  });

  it("collapses every other group when a new one is created", () => {
    assert.deepEqual([...collapseAllBut(["g1", "g2", "g3"], "g3")], ["g1", "g2"]);
  });
});
