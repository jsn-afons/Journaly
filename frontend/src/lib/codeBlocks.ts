import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, Prec, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * Ways out of a fenced code block. A block with no closing fence runs to the end of the document, and a closed
 * block on the last line leaves nowhere below it to put the cursor, so without these you are stuck inside it.
 */

const OPENING_FENCE = /^(\s*)(`{3,}|~{3,})[^`]*$/;

function fencedCodeAt(state: EditorState, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = ensureSyntaxTree(state, state.doc.length, 200)?.resolveInner(pos, -1) ?? null; node; node = node.parent)
    if (node.name === "FencedCode") return node;
  return null;
}

const isClosed = (node: SyntaxNode) => node.getChildren("CodeMark").length >= 2;

/** Enter at the end of an opening fence with no closing fence: add the closing one and put the cursor between. */
export function closeFenceOnEnter(state: EditorState): TransactionSpec | null {
  const range = state.selection.main; if (!range.empty) return null;
  const line = state.doc.lineAt(range.head); const match = OPENING_FENCE.exec(line.text);
  if (!match || range.head !== line.to) return null;
  const block = fencedCodeAt(state, line.to);
  if (!block || state.doc.lineAt(block.from).number !== line.number || isClosed(block)) return null;
  const [, indent, fence] = match;
  return { changes: { from: line.to, insert: `\n${indent}\n${indent}${fence}` }, selection: EditorSelection.cursor(line.to + 1 + indent.length), scrollIntoView: true, userEvent: "input" };
}

/** If the document ends inside a code block, close it if needed and add an empty line after it, with the cursor there. */
export function exitCodeBlockAtEnd(state: EditorState): TransactionSpec | null {
  const end = state.doc.length; const block = fencedCodeAt(state, end);
  if (!block) return null;
  const fence = OPENING_FENCE.exec(state.doc.lineAt(block.from).text);
  const lastLine = state.doc.lineAt(end).text;
  const insert = isClosed(block) ? "\n" : `${lastLine.trim() === "" ? "" : "\n"}${fence?.[1] ?? ""}${fence?.[2] ?? "```"}\n`;
  return { changes: { from: end, insert }, selection: EditorSelection.cursor(end + insert.length), scrollIntoView: true, userEvent: "input" };
}

function run(view: EditorView, spec: TransactionSpec | null) { if (!spec) return false; view.dispatch(spec); return true; }

export const codeBlockExits = [
  // Highest precedence: the Markdown language registers its own Enter (list continuation) at high precedence.
  Prec.highest(keymap.of([
    { key: "Enter", run: (view) => run(view, closeFenceOnEnter(view.state)) },
    // ArrowDown on the last line of a document that ends in a code block steps out below it.
    { key: "ArrowDown", run: (view) => view.state.doc.lineAt(view.state.selection.main.head).number === view.state.doc.lines && run(view, exitCodeBlockAtEnd(view.state)) },
  ])),
  // Clicking in the empty space below the last line does the same.
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const last = view.lineBlockAt(view.state.doc.length);
      if (event.clientY <= view.documentTop + last.bottom) return false;
      const spec = exitCodeBlockAtEnd(view.state); if (!spec) return false;
      event.preventDefault(); view.dispatch(spec); view.focus(); return true;
    },
  }),
];
