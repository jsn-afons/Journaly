import { useEffect, useState } from "react";
import { settingsRpc } from "../lib/rpc";
import { describeFailure } from "../lib/errors";
import { PRESETS, detectPreset, isLocalUrl } from "../lib/presets";
import type { KeyChange, KeyRole, ProviderSettings, ProviderTestResult, SettingsView } from "../types/settings";

interface Props { onSaved(view: SettingsView): void }
type Keys = Record<KeyRole, { typed: string; clear: boolean }>;
const EMPTY_KEYS: Keys = { chat: { typed: "", clear: false }, embedding: { typed: "", clear: false } };

/** Only the fields the backend stores; the view also carries has_*_key flags that must never be written back. */
const toSettings = (v: ProviderSettings): ProviderSettings => ({ chat_base_url: v.chat_base_url, chat_model: v.chat_model, embedding_base_url: v.embedding_base_url, embedding_model: v.embedding_model, embedding_dimensions: v.embedding_dimensions });

/** Everything a user needs to switch AI provider without touching files: endpoint, model, key, test. */
export function Settings({ onSaved }: Props) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<ProviderSettings | null>(null);
  const [keys, setKeys] = useState<Keys>(EMPTY_KEYS);
  const [models, setModels] = useState<Record<KeyRole, string[]>>({ chat: [], embedding: [] });
  const [modelNote, setModelNote] = useState<Record<KeyRole, string>>({ chat: "", embedding: "" });
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<Partial<ProviderTestResult> | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => { void settingsRpc.get().then((v) => { setView(v); setDraft(toSettings(v)); }); }, []);
  if (!view || !draft) return <section className="settings"><p className="notice">Loading settings…</p></section>;

  const urlOf = (role: KeyRole) => role === "chat" ? draft.chat_base_url : draft.embedding_base_url;
  const modelOf = (role: KeyRole) => role === "chat" ? draft.chat_model : draft.embedding_model;
  const hasSavedKey = (role: KeyRole) => (role === "chat" ? view.has_chat_key : view.has_embedding_key) && !keys[role].clear;
  const patch = (changes: Partial<ProviderSettings>) => { setDraft({ ...draft, ...changes }); setResult(null); };
  const setUrl = (role: KeyRole, url: string) => patch(role === "chat" ? { chat_base_url: url } : { embedding_base_url: url });
  const setModel = (role: KeyRole, model: string) => patch(role === "chat" ? { chat_model: model } : { embedding_model: model });
  const setKey = (role: KeyRole, change: Partial<Keys[KeyRole]>) => setKeys({ ...keys, [role]: { ...keys[role], ...change } });

  const refreshModels = async (role: KeyRole) => {
    setModelNote((n) => ({ ...n, [role]: "Looking up models…" }));
    try {
      const { models: found } = await settingsRpc.models(urlOf(role), role, keys[role].typed || undefined);
      setModels((m) => ({ ...m, [role]: found }));
      setModelNote((n) => ({ ...n, [role]: found.length ? `${found.length} models available` : "No models found on that server" }));
    } catch (error) { setModels((m) => ({ ...m, [role]: [] })); setModelNote((n) => ({ ...n, [role]: describeFailure(error) })); }
  };

  const keyChanges = (): KeyChange[] => (["chat", "embedding"] as KeyRole[]).flatMap((role): KeyChange[] =>
    keys[role].typed ? [{ role, action: "set", value: keys[role].typed }] : keys[role].clear ? [{ role, action: "clear" }] : []);

  const saveAndTest = async () => {
    setMessage(""); setResult(null);
    try {
      setBusy("Saving…");
      let saved = await settingsRpc.save(draft, keyChanges());
      setKeys(EMPTY_KEYS); setView(saved); onSaved(saved);
      setBusy("Testing both endpoints (local models can take a minute or two)…");
      let tested = await settingsRpc.test();
      const detected = tested.embedding?.detected_dimensions;
      if (tested.embedding && !tested.embedding.ok && detected && detected !== draft.embedding_dimensions) {
        // The model's real vector size is authoritative; correct the setting rather than make the user hunt for it.
        const fixed = { ...draft, embedding_dimensions: detected };
        setDraft(fixed); saved = await settingsRpc.save(fixed, []); setView(saved); onSaved(saved);
        tested = { ...tested, ...(await settingsRpc.test(["embedding"])) }; // chat result is unchanged, so skip the slow re-test
        setMessage(`Embedding size was set to ${detected} to match the model.`);
      }
      setResult(tested);
      if (tested.embedding?.ok) setMessage((m) => `${m} Your journal is being indexed for semantic search in the background; progress shows in the sidebar.`.trim());
    } catch (error) { setMessage(describeFailure(error)); }
    finally { setBusy(""); }
  };

  const section = (role: KeyRole, title: string, blurb: string) => {
    const preset = detectPreset(urlOf(role));
    return <fieldset disabled={!!busy}>
      <legend>{title}</legend>
      <p className="notice">{blurb}</p>
      <label>Provider
        <select value={preset.id} onChange={(e) => { const next = PRESETS.find((p) => p.id === e.target.value)!; if (next.baseUrl) setUrl(role, next.baseUrl); else setUrl(role, ""); setModels((m) => ({ ...m, [role]: [] })); }}>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <p className="notice">{preset.hint}</p>
      <label>Server URL<input value={urlOf(role)} onChange={(e) => setUrl(role, e.target.value)} placeholder="http://localhost:11434/v1" /></label>
      <label>Model
        <span className="row">
          <input list={`models-${role}`} value={modelOf(role)} onChange={(e) => setModel(role, e.target.value)} placeholder="model name" />
          <button type="button" onClick={() => void refreshModels(role)}>Find models</button>
        </span>
        <datalist id={`models-${role}`}>{models[role].map((m) => <option key={m} value={m} />)}</datalist>
        {modelNote[role] && <small>{modelNote[role]}</small>}
      </label>
      <label>API key {preset.needsKey ? "" : "(optional)"}
        {hasSavedKey(role) && !keys[role].typed
          ? <span className="row"><span className="saved-key">Saved in macOS Keychain</span><button type="button" onClick={() => setKey(role, { clear: true })}>Remove</button></span>
          : <input type="password" autoComplete="off" value={keys[role].typed} onChange={(e) => setKey(role, { typed: e.target.value, clear: false })} placeholder={preset.needsKey ? "Paste your API key" : "Not needed for local servers"} />}
      </label>
      {!isLocalUrl(urlOf(role)) && urlOf(role) && <p className="notice warn">This server is not on your computer: the journal excerpts used to answer questions (chat) or your entry text (embeddings) will be sent to it.</p>}
    </fieldset>;
  };

  const check = (label: string, outcome: { ok: boolean; error?: string; seconds: number }) =>
    <li className={outcome.ok ? "pass" : "fail"}>{outcome.ok ? "✓" : "✗"} {label}: {outcome.ok ? `working (${outcome.seconds.toFixed(1)} s)` : outcome.error}</li>;

  return <section className="settings">
    <h2>AI provider</h2>
    <p className="notice">Your journal files never leave your computer unless you choose a hosted provider below. Search and editing work with no provider at all.</p>
    {!view.configured && <p className="notice">No provider saved yet — pick one below to turn on AI chat and meaning-based search.</p>}
    {section("chat", "Chat", "Answers your questions using your journal.")}
    {section("embedding", "Semantic search (embeddings)", "Lets search find entries by meaning. Changing this model re-indexes your journal in the background; your files are not touched.")}
    <fieldset disabled={!!busy}>
      <legend>Embedding size</legend>
      <label>Dimensions<input type="number" min={1} max={8192} value={draft.embedding_dimensions} onChange={(e) => patch({ embedding_dimensions: Number(e.target.value) })} /></label>
      <p className="notice">Set automatically when you press Save &amp; test.</p>
    </fieldset>
    <div className="actions"><button className="primary" onClick={() => void saveAndTest()} disabled={!!busy}>Save &amp; test</button></div>
    {busy && <p className="notice" role="status">{busy}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {result && <ul className="results" aria-label="Test results">{result.chat && check(`Chat (${result.chat.model})`, result.chat)}{result.embedding && check(`Embeddings (${result.embedding.model})`, result.embedding)}</ul>}
  </section>;
}
