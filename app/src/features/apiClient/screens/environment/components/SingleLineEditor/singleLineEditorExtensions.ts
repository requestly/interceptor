import { Decoration, DecorationSet, EditorView, keymap, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { EditorState, Extension, Prec, Text } from "@codemirror/state";

/**
 * Keeps a single-line editor single-line without freezing a value that already contains newlines:
 * only transactions that *grow* the line count are dropped, so a pre-existing multi-line value stays
 * navigable, editable and copyable (RQ-4135).
 *
 * ponytail: an external `defaultValue` switching to a multi-line string is still blocked here.
 * Consumers that need that should opt into `multiline` instead.
 */
export const singleLineConstraint: Extension = EditorState.transactionFilter.of((tr) =>
  tr.newDoc.lines > Math.max(1, tr.startState.doc.lines) ? [] : [tr]
);

/** Offsets that get a `↵` glyph — every line end except the last, which has no trailing newline. */
export const newlineGlyphPositions = (doc: Text): number[] => {
  const positions: number[] = [];
  for (let line = 1; line < doc.lines; line++) {
    positions.push(doc.line(line).to);
  }
  return positions;
};

class NewlineGlyphWidget extends WidgetType {
  toDOM() {
    const glyph = document.createElement("span");
    glyph.className = "cm-newline-glyph";
    glyph.textContent = "↵";
    return glyph;
  }

  ignoreEvent() {
    return true;
  }
}

const newlineGlyphDecoration = Decoration.widget({ widget: new NewlineGlyphWidget(), side: 1 });

const buildNewlineGlyphs = (view: EditorView): DecorationSet =>
  Decoration.set(newlineGlyphPositions(view.state.doc).map((pos) => newlineGlyphDecoration.range(pos)));

/** Renders a `↵` marker at every line end so multi-line values read as multi-line, Postman style. */
const newlineGlyphsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildNewlineGlyphs(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildNewlineGlyphs(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

/**
 * Postman parity for multi-line values: newlines survive untouched, `↵` glyphs mark line ends,
 * Shift+Enter inserts a newline and plain Enter commits (by blurring, which the editor's blur
 * handler turns into a save).
 */
export const multilineExtensions = (onCommit: (value: string) => void): Extension => [
  EditorView.lineWrapping,
  newlineGlyphsPlugin,
  Prec.high(
    keymap.of([
      {
        key: "Shift-Enter",
        run: (view) => {
          view.dispatch(view.state.replaceSelection("\n"), { scrollIntoView: true, userEvent: "input" });
          return true;
        },
      },
      {
        key: "Enter",
        run: (view) => {
          onCommit(view.state.doc.toString());
          view.contentDOM.blur();
          return true;
        },
      },
    ])
  ),
];
