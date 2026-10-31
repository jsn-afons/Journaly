# Building Journaly.app

One command builds a self-contained Mac app that runs without this source folder, Python, Node, or a dev server:

```bash
scripts/build_app.sh
```

The result is `src-tauri/target/release/bundle/macos/Journaly.app`. Drag it into **Applications** and open it like any other app.

## What the script does

| Step | Tool | Output |
|---|---|---|
| 1. Freeze the Python AI service | PyInstaller (`scripts/build_daemon.sh`) | `build/daemon/journaly-ai/`: the service plus its own Python interpreter and libraries (~29 MB) |
| 2. Build the interface | Vite (`npm run build`, run by Tauri) | `frontend/dist/`: plain HTML, CSS and JavaScript files |
| 3. Compile the app | Cargo, release mode (run by `tauri build`) | the `journaly` program, with the interface files embedded in it |
| 4. Assemble the bundle | Tauri bundler | `Journaly.app` with `Info.plist` (name, id, icon, version) |
| 5. Add the AI service | `ditto` (keeps the bundled Python framework's symlinks intact) | `Journaly.app/Contents/Resources/journaly-ai/` |
| 6. Sign | `codesign --sign -` (ad hoc) | a signature macOS accepts on this Mac |

Inside the app:

```
Journaly.app/Contents/
  Info.plist                    name, bundle id com.journaly.app, version, icon
  MacOS/journaly                the Rust app (window, files, Keychain) with the interface built in
  Resources/icon.icns
  Resources/journaly-ai/        the frozen Python AI service, started by the app
```

## Where the installed app keeps things

`tauri dev` still works from the source folder exactly as before. The installed app uses normal Mac locations instead:

| What | Installed app | `tauri dev` |
|---|---|---|
| Journal entries | `~/Documents/Journaly/Journal` | `./Journal` |
| Saved chats | `~/Documents/Journaly/Chats` | `./Chats` |
| Search index | `~/Library/Application Support/com.journaly.app/journal_index.db` | `./journal_index.db` |
| AI settings | `~/Library/Application Support/com.journaly.app/provider-settings.json` | same |
| API keys | macOS Keychain (`com.journaly.app`) | same |

The two journals are separate copies; edits in one don't appear in the other. `JOURNALY_JOURNAL_DIR` / `JOURNALY_CHATS_DIR` override the folders for either.

## Signing, and sharing with other Macs

The app is signed *ad hoc*: macOS can check it hasn't been altered, but it isn't tied to a verified developer. On the Mac that built it that's fine, because files you create yourself are never marked as downloaded ("quarantined").

**Sharing with a friend (Apple Silicon Mac, macOS 11 or later):**

1. Zip it in a way that keeps symlinks (the bundled Python needs them): `ditto -c -k --keepParent Journaly.app Journaly.zip`, or right-click → Compress in Finder. Plain `zip -r` without `-y` breaks the app.
2. Send it. Over AirDrop, Messages, email or a download, macOS marks the file as quarantined; copying from a USB drive in Finder usually doesn't.
3. If quarantined, macOS refuses to open it at first ("Apple could not verify…"). Your friend opens **System Settings → Privacy & Security**, scrolls to the message about Journaly, and clicks **Open Anyway** (one time only).

Their journal, chats, settings and API keys are their own: nothing of yours is inside the app. They need their own AI provider (a key, or Ollama). The bundle was checked for links to Homebrew or other files outside it (`otool -L`): none, so it shouldn't need anything installed.

To share without the security warning, it would need an Apple Developer account ($99/year), signing with a Developer ID certificate, and *notarization* (uploading to Apple for an automated malware scan). Not set up.

## Updates

There is no automatic updater yet. To update: change the code, run `scripts/build_app.sh`, and replace Journaly.app in Applications (and send friends the new zip). Data lives outside the app, so replacing it never touches journals, chats, settings or keys. Bump `version` in `src-tauri/tauri.conf.json` so you can tell builds apart (Journaly → About).

Automatic updates are possible later with Tauri's updater plugin: the app checks a URL you host (for example GitHub Releases) for a newer version, downloads it, verifies it with a signing key, and replaces itself. That needs a place to publish releases and, in practice, Developer ID signing.

## Rebuilding after changes

Run `scripts/build_app.sh` again and replace the copy in Applications. Your journal, chats, settings and keys are outside the app, so replacing it never touches them. Because each build has a new ad hoc signature, macOS may ask once for Keychain access to your API key.
