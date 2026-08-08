import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";

interface Props { value: string; onChange(value: string): void; }

export function Editor({ value, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null); const view = useRef<EditorView>(); const callback = useRef(onChange); callback.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({ state: EditorState.create({ doc: value, extensions: [markdown(), keymap.of([]), EditorView.lineWrapping, EditorView.updateListener.of((update) => { if (update.docChanged) callback.current(update.state.doc.toString()); })] }), parent: host.current });
    view.current = editor; return () => editor.destroy();
  }, []);
  useEffect(() => { const editor = view.current; if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }); }, [value]);
  return <div className="editor" ref={host} />;
}
