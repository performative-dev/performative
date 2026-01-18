# Performative Developer 🎭

A playful yet practical VS Code extension that **emulates real coding** — the pauses, the context switches, the terminal runs — while still generating real, runnable projects.

---

## Motivation

In today's fast-paced tech world, "looking busy" is half the battle. Whether you're in an open-plan office, on a Zoom call where you zoned out ten minutes ago, or just trying to look like a 10x developer while mentally planning your lunch: _appearance is everything_.

We asked ourselves: Why should you have to type code to look like you're coding? The Hollywood hacker aesthetic shouldn't require actual effort.
---

## What We Built (Quick Summary)

**Performative Developer** is a VS Code extension that **auto-types code like a human**, generates **multi-file Python projects with AI**, simulates **real developer workflows & distractions**, and can **run the result** in a terminal. 

However it doesn't just paste code; it types it. It makes typos. It switches files. It opens the terminal. It even creates split panes and asks GitHub Copilot questions to simulate "deep research." It is the ultimate tool for performative productivity. It’s a coding performance engine designed for demos, teaching, and entertainment — without sacrificing real output.

---

## Why This Solves a Real Problem

Actual coding involves a lot of staring blankly at documentation and thinking, which is bad for optics at work, sc. Performative solves the "Optics of Stagnation."

By automating the visual chaos of high-velocity development, we provide a solution for:

- Imposter Capability: looking like a genius without writing a line of code.
- The "Manager Walk-By": ensuring that whenever someone glances at your screen, code is flowing and terminals are toggling.

or more righteous scenarios like:
- Visual Filler: generating high-quality background visuals for tech influencers or movie sets.
- Live coding and technical demos of projects and/or developer tools

---

## Features

### 🎬 Performance Mode
- Auto-types code character-by-character for a human feel
- Supports both **single-file** and **multi-file** projects

### ⌨️ Auto-Type Controls
- Start/stop continuous typing
- Speed up or slow down the typing pace

### 🧠 AI Project Generation
- Generates **multi-file Python projects** using:
  - Groq
  - Google Gemini
  - OpenAI 
- Produces runnable, standard-library projects

### 🧪 Scene Execution
- Runs the generated project in a terminal
- Auto-generates a README for the project

### 🪄 Diff-Based Extension Flow
- After a run, it can ask Copilot for an improvement
- Applies changes file-by-file, typing out diffs in real time

### 🎭 Performative Distractions
- Simulated interruptions (micro-manager popups)
- Fake dependency installs in terminal
- Intrusive thoughts that appear and get deleted
- UI layout and file-switching chaos for realism

---

## Example Use Cases

- **The Coffee Break**: Toggle Performative on, leave your laptop open, and go get coffee. Your screen will be a hive of activity while you're away.

- **The "Deep Work" Session**: Block out your calendar for "focus time," turn on the extension, and take a nap.

- **The Live Demo**: Need to show a "live coding" demo but afraid of typos? Let Performative handle the typing while you handle the talking.

---

## Commands & Keybindings

| Command | Description | Default Keybinding |
| --- | --- | --- |
| `Performative: Toggle Performance Mode` | Start/stop the performance | — |
| `Performative: Start/Stop Auto-Type Mode` | Toggle continuous typing | `Ctrl+Shift+P` / `Cmd+Shift+A` |
| `Performative: Speed Up Auto-Type` | Increase typing speed | `Ctrl+Shift+↑` / `Cmd+Shift+↑` |
| `Performative: Slow Down Auto-Type` | Decrease typing speed | `Ctrl+Shift+↓` / `Cmd+Shift+↓` |
| `Performative: Generate New Project` | Ask AI for a new project | `Ctrl+Shift+G` / `Cmd+Shift+G` |

---

## Configuration

Set one of these in VS Code settings to enable AI generation:

- `performative.groqApiKey`
- `performative.geminiApiKey`
- `performative.openaiApiKey`

---

## Getting Started

1. Install the extension.
2. Open the Command Palette (Cmd+Shift+P / Ctrl+Shift+P).
3. Run Performative: Toggle Performance Mode
4. (Optional) Configure your API keys in Settings to generate fresh projects.
5. Press Ctrl+Shift+P (or your mapped key) to start Auto-Typing.

---

## Final Note

We built **Performative Developer** with the intention of making an **entertaining hack** — while still solving a real, practical problem for demos and live coding experiences.

---

## License

MIT
