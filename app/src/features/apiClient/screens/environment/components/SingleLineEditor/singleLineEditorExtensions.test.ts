import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { newlineGlyphPositions, singleLineConstraint } from "./singleLineEditorExtensions";

const stateWith = (doc: string) => EditorState.create({ doc, extensions: [singleLineConstraint] });

const applied = (state: EditorState, insert: string, at: number) =>
  state.update({ changes: { from: at, to: at, insert } }).state.doc.toString();

describe("singleLineConstraint", () => {
  it("blocks a newline typed into a single-line value", () => {
    expect(applied(stateWith("hello"), "\n", 5)).toBe("hello");
  });

  it("keeps a pre-existing multi-line value editable instead of inert (RQ-4135)", () => {
    expect(applied(stateWith("check\nthis"), "!", 10)).toBe("check\nthis!");
  });

  it("still refuses to grow a multi-line value", () => {
    expect(applied(stateWith("check\nthis"), "\n", 10)).toBe("check\nthis");
  });

  it("allows edits that shrink the line count", () => {
    const state = stateWith("check\nthis");
    expect(state.update({ changes: { from: 5, to: 6 } }).state.doc.toString()).toBe("checkthis");
  });
});

describe("newlineGlyphPositions", () => {
  it("marks every line end except the last", () => {
    expect(newlineGlyphPositions(EditorState.create({ doc: "a\nbb\nccc" }).doc)).toEqual([1, 4]);
  });

  it("marks nothing for a single-line value", () => {
    expect(newlineGlyphPositions(EditorState.create({ doc: "a" }).doc)).toEqual([]);
  });
});
