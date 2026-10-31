import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { closeFenceOnEnter, exitCodeBlockAtEnd } from "./codeBlocks";

const make = (doc: string, cursor = doc.length) => EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage })] });
const apply = (state: EditorState, spec: ReturnType<typeof exitCodeBlockAtEnd>) => { const next = state.update(spec!).state; return { doc: next.doc.toString(), line: next.doc.lineAt(next.selection.main.head).number }; };

describe("code block exits", () => {
  it("adds the closing fence when you press Enter on a new opening fence", () => {
    const state = make("Intro\n```python");
    expect(apply(state, closeFenceOnEnter(state))).toEqual({ doc: "Intro\n```python\n\n```", line: 3 });
  });

  it("leaves Enter alone when the fence is already closed or the cursor isn't on a fence", () => {
    expect(closeFenceOnEnter(make("```js\nlet a\n```", 5))).toBeNull();
    expect(closeFenceOnEnter(make("plain text"))).toBeNull();
  });

  it("closes an unfinished block at the end and moves below it", () => {
    const state = make("```python\ndef hello():\n  pass");
    expect(apply(state, exitCodeBlockAtEnd(state))).toEqual({ doc: "```python\ndef hello():\n  pass\n```\n", line: 5 });
    const blankEnd = make("```python\npass\n");
    expect(apply(blankEnd, exitCodeBlockAtEnd(blankEnd)).doc).toBe("```python\npass\n```\n");
  });

  it("adds a line below a closed block that ends the document", () => {
    const state = make("```\ncode\n```");
    expect(apply(state, exitCodeBlockAtEnd(state))).toEqual({ doc: "```\ncode\n```\n", line: 4 });
  });

  it("does nothing when the document doesn't end in a code block", () => {
    expect(exitCodeBlockAtEnd(make("```\ncode\n```\n\nafter"))).toBeNull();
  });
});
