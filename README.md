# Journaly

A private journaling app for Mac with an AI you can talk to about your own life.

You write in plain Markdown. When you ask the AI something, it searches your entries, answers from what you actually wrote, notices how your thinking has changed over time, and links to the entries it used. Your journal stays on your Mac as ordinary files you can open with any text editor.

Journaly is not a substitute for therapy or professional mental health care.

## What you need

- **A Mac with an M-series chip** (M1 or newer). Intel Macs aren't supported. To check, open the Apple menu → **About This Mac** and look at **Chip**.
- **macOS 11 or later.**
- **About 6 GB of free disk space** for the tools and the build. The finished app is only about 45 MB.
- **An internet connection** for setup.
- **For the AI features:** an AI chat model and an embedding model. See [Choose your AI](#6-choose-your-ai) for what those are. Writing and keyword search work without them.

## Install

There's no ready-made download yet, so you build the app on your Mac once. Then it works like any other app. These steps assume a brand-new Mac with nothing installed.

Open **Terminal** (press ⌘ Space, type `Terminal`, press Return). Paste each command below and press Return, waiting for each to finish before starting the next.

### 1. Install Apple's developer tools

```bash
xcode-select --install
```

Click **Install** in the window that appears, and wait for it to finish before continuing. This also installs `git`.

### 2. Install Homebrew

[Homebrew](https://brew.sh) installs developer tools from the command line.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It asks for your Mac password. Nothing appears on screen as you type; that's normal. Press Return when it asks you to confirm.

Then make the `brew` command available:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
```

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 3. Install Node.js and Python

```bash
brew install node python@3.12
```

### 4. Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

```bash
source "$HOME/.cargo/env"
```

### 5. Download and build Journaly

```bash
git clone https://github.com/jsn-afons/Journaly.git
```

```bash
cd Journaly
```

```bash
npm --prefix frontend install
```

```bash
scripts/build_app.sh
```

The build can take 10 minutes or more the first time. It's finished when you see a line starting with `Built`.

Now show the app in Finder:

```bash
open src-tauri/target/release/bundle/macos
```

Drag **Journaly** into your **Applications** folder and open it. You can start writing now.

### 6. Choose your AI

Journaly needs two models for its AI features:

- **A chat model** writes the answers.
- **An embedding model** lets the app find entries by meaning, so a search for "football" can find an entry about a Chelsea match.

Pick one of these setups:

| Setup | Chat | Embeddings | Cost | Your journal text goes to |
|---|---|---|---|---|
| **A. What I use** | DeepSeek | Ollama, on your Mac | Pay per use for DeepSeek | DeepSeek, for chat only |
| **B. Everything on your Mac** | Ollama | Ollama | Free | Nowhere |

Setup B keeps everything private, but chat models need much more memory than embedding models and answer more slowly, especially with 8 GB of RAM. Journaly also gives the AI long instructions, which small local models may not follow as well. Any other OpenAI-compatible provider works too, such as OpenAI.

**Both setups need Ollama:**

1. Download it from [ollama.com/download](https://ollama.com/download), move it to Applications, and open it. If it offers to install its command line tool, accept.
2. Download the embedding model (about 270 MB):

   ```bash
   ollama pull nomic-embed-text
   ```

Ollama needs to be running whenever Journaly embeds new entries or searches by meaning. If it's off, Journaly tries again later.

**In Journaly, open AI settings in the sidebar:**

1. Under **Semantic search (embeddings)**, set **Provider** to **Ollama (local)**, click **Find models**, and pick `nomic-embed-text:latest`.
2. Under **Chat**, set it up for your choice:

   **Setup A (DeepSeek):** create an API key at [platform.deepseek.com](https://platform.deepseek.com), then enter:

   | Field | Value |
   |---|---|
   | Provider | Custom (OpenAI-compatible) |
   | Server URL | `https://api.deepseek.com` |
   | API key | Your DeepSeek key |
   | Model | Click **Find models** and pick one. I use `deepseek-flash`. |

   **Setup B (Ollama):** first download a chat model (about 2 GB):

   ```bash
   ollama pull llama3.2
   ```

   Then set **Provider** to **Ollama (local)**, click **Find models**, and pick `llama3.2:latest`.

3. Click **Save & test**. You should see a ✓ next to both Chat and Embeddings.

API keys are stored in the macOS Keychain, never in files. macOS may ask for your Mac password so Journaly can read the key; click **Always Allow**.

## Using it

- **Write:** click **New entry**. Markdown formats as you type, like Obsidian's live preview, and saves automatically.
- **Search:** type in the search bar. Switch from keyword to **AI** to search by meaning.
- **Chat:** ask a question in the panel on the right. Answers link to the entries they came from, and past conversations are in **History**.

## Where your data lives

| What | Where |
|---|---|
| Journal entries | `~/Documents/Journaly/Journal` (plain Markdown) |
| Saved chats | `~/Documents/Journaly/Chats` (plain Markdown) |
| Search index and settings | `~/Library/Application Support/com.journaly.app` |
| API keys | macOS Keychain |

What leaves your Mac depends on your provider. With a hosted chat provider, your question, recent messages and the journal passages found for it are sent to that provider. With Ollama, nothing leaves.

## Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: brew` | Run the two commands at the end of step 2 again. |
| `command not found: cargo` or `rustc` | Run `source "$HOME/.cargo/env"`, then try again. |
| `xcode-select: note: Command line tools are already installed` | That's fine. Continue to the next step. |
| Embeddings show ✗ with a connection error | Ollama isn't running. Open it and click **Save & test** again. |
| Nothing listed under **Find models** | Check the Server URL. For Ollama, run `ollama list` to confirm the model downloaded. |
| AI features seem stuck | Check for a Keychain password window hidden behind other windows. |

## Updating

Quit Journaly, then run these from the `Journaly` folder:

```bash
git pull
```

```bash
npm --prefix frontend install
```

```bash
scripts/build_app.sh
```

Replace the app in Applications with the new one, as in step 5. Your journal, chats and settings are stored outside the app, so they aren't affected.

## Uninstalling

Delete Journaly from Applications and delete the `Journaly` project folder. Your entries stay in `~/Documents/Journaly` until you delete them yourself.

## Learn more

- [How it works and why it's built this way](docs/system-design.md)
- [Project status: what works and known gaps](docs/status.md)
- [Building and sharing the app](docs/packaging.md)
- [AI providers](docs/providers.md)
- [Developing Journaly](docs/development.md)
