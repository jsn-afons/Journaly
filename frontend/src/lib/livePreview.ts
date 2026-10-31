import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * Obsidian-style live preview: Markdown is rendered in place (headings, emphasis, links, lists, checkboxes,
 * quotes, code, rules), and the raw syntax reappears only on the lines the cursor is on, so you can still edit it.
 * The document text is never changed by rendering; only clicking a checkbox edits it (toggles `[ ]`/`[x]`).
 */

/** One rendering instruction. Kept as plain data so it can be unit-tested without a DOM. */
export type Piece =
  | { kind: "hide"; from: number; to: number }
  | { kind: "mark"; from: number; to: number; cls: string }
  | { kind: "line"; at: number; cls: string }
  | { kind: "bullet"; from: number; to: number }
  | { kind: "task"; from: number; to: number; checked: boolean; marker: number }
  | { kind: "rule"; from: number; to: number };

const INLINE: Record<string, string> = { Emphasis: "cm-lp-em", StrongEmphasis: "cm-lp-strong", Strikethrough: "cm-lp-strike", InlineCode: "cm-lp-code" };

/** Line numbers touched by the selection; empty when the editor isn't focused, so everything renders. */
export function activeLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>();
  if (!focused) return lines;
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) lines.add(n);
  }
  return lines;
}

export function previewPieces(state: EditorState, active: Set<number>, ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }]): Piece[] {
  const { doc } = state; const out: Piece[] = [];
  const lineOf = (pos: number) => doc.lineAt(pos).number;
  const isActive = (pos: number) => active.has(lineOf(pos));
  const spanActive = (from: number, to: number) => { for (let n = lineOf(from); n <= lineOf(to); n++) if (active.has(n)) return true; return false; };
  const eachLine = (from: number, to: number, cls: string) => { for (let n = lineOf(from); n <= lineOf(to); n++) out.push({ kind: "line", at: doc.line(n).from, cls }); };
  /** Hide a syntax mark plus the spaces after it (e.g. "## " or "> "), never past the end of its line. */
  const hideWithSpace = (from: number, to: number) => { const end = doc.lineAt(from).to; while (to < end && doc.sliceString(to, to + 1) === " ") to++; out.push({ kind: "hide", from, to }); };
  /** Inline marks (`**`, `_`, `` ` ``, `~~`) are dimmed on the cursor line and hidden elsewhere. */
  const syntax = (from: number, to: number) => out.push(isActive(from) ? { kind: "mark", from, to, cls: "cm-lp-syntax" } : { kind: "hide", from, to });

  for (const { from, to } of ranges) syntaxTree(state).iterate({ from, to, enter(ref) {
    const node = ref.node; const name = node.name;
    const heading = /^(ATX|Setext)Heading(\d)$/.exec(name);
    if (heading) { out.push({ kind: "line", at: doc.lineAt(node.from).from, cls: `cm-lp-h cm-lp-h${heading[2]}` }); return; }
    if (INLINE[name]) { out.push({ kind: "mark", from: node.from, to: node.to, cls: INLINE[name] }); return; }
    switch (name) {
      case "HeaderMark":
        if (isActive(node.from)) out.push({ kind: "mark", from: node.from, to: node.to, cls: "cm-lp-syntax" });
        else if (node.parent?.name.startsWith("Setext")) out.push({ kind: "hide", from: node.from, to: node.to });
        else if (node.from === node.parent?.from) hideWithSpace(node.from, node.to);
        else out.push({ kind: "hide", from: node.from, to: node.to }); // closing "##"
        return;
      case "EmphasisMark": case "StrikethroughMark": syntax(node.from, node.to); return;
      case "CodeMark":
        if (node.parent?.name === "InlineCode") syntax(node.from, node.to);
        else if (!spanActive(node.parent!.from, node.parent!.to)) out.push({ kind: "hide", from: node.from, to: node.to });
        else out.push({ kind: "mark", from: node.from, to: node.to, cls: "cm-lp-syntax" });
        return;
      case "CodeInfo": out.push({ kind: "mark", from: node.from, to: node.to, cls: "cm-lp-codeinfo" }); return;
      case "FencedCode": case "CodeBlock": {
        eachLine(node.from, node.to, "cm-lp-codeblock");
        out.push({ kind: "line", at: doc.lineAt(node.from).from, cls: "cm-lp-codeblock-first" }, { kind: "line", at: doc.lineAt(node.to).from, cls: "cm-lp-codeblock-last" });
        return;
      }
      case "Blockquote": eachLine(node.from, node.to, "cm-lp-quote"); return;
      case "QuoteMark": if (isActive(node.from)) out.push({ kind: "mark", from: node.from, to: node.to, cls: "cm-lp-syntax" }); else hideWithSpace(node.from, node.to); return;
      case "Link": link(node); return;
      case "URL": if (node.parent?.name !== "Link" && node.parent?.name !== "Image") out.push({ kind: "mark", from: node.from, to: node.to, cls: "cm-lp-link" }); return;
      case "ListMark": listMark(node); return;
      case "Task": task(node); return;
      case "HorizontalRule":
        if (isActive(node.from)) out.push({ kind: "mark", from: node.from, to: node.to, cls: "cm-lp-syntax" });
        else out.push({ kind: "rule", from: node.from, to: node.to });
        return;
    }
  } });
  return out;

  /** `[text](url)` shows only "text" styled as a link; reference-style links are left as typed. */
  function link(node: SyntaxNode) {
    const marks = node.getChildren("LinkMark");
    if (marks.length < 2) return;
    out.push({ kind: "mark", from: marks[0].to, to: marks[1].from, cls: "cm-lp-link" });
    if (isActive(node.from) || doc.sliceString(marks[1].to, marks[1].to + 1) !== "(") {
      for (const m of marks) out.push({ kind: "mark", from: m.from, to: m.to, cls: "cm-lp-syntax" });
      return;
    }
    out.push({ kind: "hide", from: marks[0].from, to: marks[0].to }, { kind: "hide", from: marks[1].from, to: node.to });
  }

  function listMark(node: SyntaxNode) {
    const item = node.parent; if (!item || item.getChild("Task")) return; // tasks render as checkboxes instead
    if (item.parent?.name === "BulletList" && !isActive(node.from)) out.push({ kind: "bullet", from: node.from, to: node.to });
    else out.push({ kind: "mark", from: node.from, to: node.to, cls: "cm-lp-listmark" });
  }

  function task(node: SyntaxNode) {
    const marker = node.getChild("TaskMarker"); const mark = node.parent?.getChild("ListMark");
    if (!marker || !mark) return;
    const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
    out.push({ kind: "line", at: doc.lineAt(node.from).from, cls: checked ? "cm-lp-task cm-lp-task-done" : "cm-lp-task" });
    if (isActive(node.from)) out.push({ kind: "mark", from: mark.from, to: marker.to, cls: "cm-lp-syntax" });
    else out.push({ kind: "task", from: mark.from, to: marker.to, checked, marker: marker.from });
  }
}

/** The edit that ticks or unticks the checkbox whose `[ ]` starts at `marker`. */
export function toggleTask(state: EditorState, marker: number) {
  const checked = /x/i.test(state.doc.sliceString(marker + 1, marker + 2));
  return { changes: { from: marker + 1, to: marker + 2, insert: checked ? " " : "x" } };
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const el = document.createElement("span"); el.className = "cm-lp-bullet"; el.textContent = "•"; return el; }
}

class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const el = document.createElement("span"); el.className = "cm-lp-rule"; el.setAttribute("aria-hidden", "true"); return el; }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly marker: number) { super(); }
  eq(other: CheckboxWidget) { return other.checked === this.checked && other.marker === this.marker; }
  toDOM(view: EditorView) {
    const box = document.createElement("input"); box.type = "checkbox"; box.className = "cm-lp-checkbox"; box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Mark as not done" : "Mark as done");
    // mousedown, not click: otherwise the editor moves the cursor onto this line first and the checkbox turns back into "- [ ]".
    box.addEventListener("mousedown", (event) => { event.preventDefault(); view.dispatch(toggleTask(view.state, this.marker)); });
    return box;
  }
  ignoreEvent() { return true; }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const hidden = Decoration.replace({});

function decorate(view: EditorView): DecorationSet {
  const pieces = previewPieces(view.state, activeLines(view.state, view.hasFocus), view.visibleRanges);
  const ranges: Range<Decoration>[] = [];
  for (const p of pieces) {
    if (p.kind === "line") ranges.push(Decoration.line({ class: p.cls }).range(p.at));
    else if (p.from >= p.to) continue;
    else if (p.kind === "mark") ranges.push(Decoration.mark({ class: p.cls }).range(p.from, p.to));
    else if (p.kind === "hide") ranges.push(hidden.range(p.from, p.to));
    else if (p.kind === "bullet") ranges.push(bullet.range(p.from, p.to));
    else if (p.kind === "rule") ranges.push(rule.range(p.from, p.to));
    else ranges.push(Decoration.replace({ widget: new CheckboxWidget(p.checked, p.marker) }).range(p.from, p.to));
  }
  return Decoration.set(ranges, true);
}

export const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorate(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state))
      this.decorations = decorate(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

/** For tests: parse the whole document synchronously so `previewPieces` sees every node. */
export function parseAll(state: EditorState) { ensureSyntaxTree(state, state.doc.length, 5000); return state; }
