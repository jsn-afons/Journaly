import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { App } from "./App";
import "./styles.css";

/** The UI only works inside the Tauri window; in a plain browser every call would fail with a cryptic error. */
function OpenInApp() {
  return <main className="grid-view empty-state">
    <h2>Open Journaly in its app window</h2>
    <p>This page is the app’s interface, served for the Journaly window. In a regular browser it can’t reach your journal or AI service.</p>
    <p>Start it with <code>tauri dev</code> (see the README) and use the window that opens.</p>
  </main>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isTauri() ? <App /> : <OpenInApp />}</React.StrictMode>,
);
