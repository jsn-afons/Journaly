import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { codeBlockExits } from "../lib/codeBlocks";
import { livePreview } from "../lib/livePreview";

interface Props { value: string; onChange(value: string): void; }

/** Markdown editor with live preview (GitHub-flavoured: tasks, strikethrough), undo/redo and list continuation on Enter. */
export function Editor({ value, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null); const view = useRef<EditorView>(); const callback = useRef(onChange); callback.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const extensions = [
      markdown({ base: markdownLanguage }), livePreview, codeBlockExits, history(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), EditorView.lineWrapping,
      EditorView.updateListener.of((update) => { if (update.docChanged) callback.current(update.state.doc.toString()); }),
    ];
    const editor = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current });
    view.current = editor; return () => editor.destroy();
  }, []);
  useEffect(() => { const editor = view.current; if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }); }, [value]);
  return <div className="editor" ref={host} />;
}
