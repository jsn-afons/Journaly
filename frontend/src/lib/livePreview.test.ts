import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { activeLines, parseAll, type Piece, previewPieces, toggleTask } from "./livePreview";

const make = (doc: string, cursor = 0) => parseAll(EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage })] }));

/** Renders the document as it would look: hidden ranges removed, widgets shown as tokens. */
function render(state: EditorState, active = new Set<number>()) {
  const pieces = previewPieces(state, active).filter((p): p is Extract<Piece, { from: number }> => "from" in p && p.kind !== "mark").sort((a, b) => a.from - b.from);
  let text = ""; let pos = 0;
  for (const p of pieces) {
    if (p.from < pos) continue;
    text += state.doc.sliceString(pos, p.from);
    text += p.kind === "bullet" ? "•" : p.kind === "rule" ? "———" : p.kind === "task" ? (p.checked ? "☑" : "☐") : "";
    pos = p.to;
  }
  return text + state.doc.sliceString(pos);
}

const classes = (state: EditorState, active = new Set<number>()) => previewPieces(state, active).filter((p) => p.kind === "line" || p.kind === "mark").map((p) => (p as { cls: string }).cls);

describe("live preview", () => {
  it("hides heading, emphasis and code syntax away from the cursor", () => {
    const state = make("# Morning\n\nI felt **really** _calm_ and ~~tired~~ ran `npm test`.");
    expect(render(state)).toBe("Morning\n\nI felt really calm and tired ran npm test.");
    expect(classes(state)).toEqual(expect.arrayContaining(["cm-lp-h cm-lp-h1", "cm-lp-strong", "cm-lp-em", "cm-lp-strike", "cm-lp-code"]));
  });

  it("shows raw Markdown on the line being edited", () => {
    const doc = "# Morning\n\nI felt **really** calm.";
    const state = make(doc, 3);
    expect(render(state, activeLines(state, true))).toBe("# Morning\n\nI felt really calm.");
    expect(render(state, activeLines(state, false))).toBe("Morning\n\nI felt really calm.");
  });

  it("renders links as their text only", () => {
    expect(render(make("See [the plan](https://example.com/plan \"title\") today."))).toBe("See the plan today.");
    expect(render(make("Reference [link][1] stays."))).toBe("Reference [link][1] stays.");
  });

  it("renders bullets, quotes and rules", () => {
    expect(render(make("- one\n- two\n\n> a quote\n\n---\n\n1. first"))).toBe("• one\n• two\n\na quote\n\n———\n\n1. first");
    expect(classes(make("> a quote"))).toContain("cm-lp-quote");
  });

  it("renders task items as checkboxes and toggles them", () => {
    const state = make("- [ ] buy milk\n- [x] call mum");
    expect(render(state)).toBe("☐ buy milk\n☑ call mum");
    expect(classes(state)).toContain("cm-lp-task cm-lp-task-done");
    const task = previewPieces(state, new Set()).find((p) => p.kind === "task" && !p.checked) as Extract<Piece, { kind: "task" }>;
    const ticked = state.update(toggleTask(state, task.marker)).state;
    expect(ticked.doc.toString()).toBe("- [x] buy milk\n- [x] call mum");
    expect(ticked.update(toggleTask(ticked, task.marker)).state.doc.toString()).toBe("- [ ] buy milk\n- [x] call mum");
  });

  it("hides code fences unless the cursor is inside the block", () => {
    const doc = "```js\nlet a = 1;\n```\n\nafter";
    expect(render(make(doc))).toBe("js\nlet a = 1;\n\n\nafter");
    const inside = make(doc, 8);
    expect(render(inside, activeLines(inside, true))).toBe(doc);
    expect(classes(make(doc))).toEqual(expect.arrayContaining(["cm-lp-codeblock", "cm-lp-codeblock-first", "cm-lp-codeblock-last"]));
  });

  it("never changes the document text when rendering", () => {
    const doc = "## Title ##\n\n**a** _b_";
    const state = make(doc);
    previewPieces(state, new Set());
    expect(state.doc.toString()).toBe(doc);
    expect(render(state)).toBe("Title \n\na b");
  });
});
