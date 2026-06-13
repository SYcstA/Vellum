<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="./docs/logo-charcoal.svg">
  <img src="./docs/logo-charcoal.svg" alt="Vellum" width="120">
</picture>

# Vellum

### A Beautiful, Frameless, Glassmorphism Productivity Workspace.

[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.0-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Zustand](https://img.shields.io/badge/Zustand-5-433E38?style=for-the-badge&logo=react&logoColor=white)](https://github.com/pmndrs/zustand)

</div>

---

## Overview

Vellum is a modern, lightweight desktop productivity application that blends seamlessly into the user's workflow. It features a frameless, translucent glassmorphism UI that defaults to a centered **95% screen ratio**, allowing the desktop wallpaper to shine through — no clunky window chrome, no jarring transitions, just your work, layered over your desktop.

Built on **Tauri 2** (a native Rust shell + a React/TypeScript frontend), Vellum stays under 5 MB on disk and idles at single-digit RAM. The whole thing feels less like an Electron app and more like a native OS component.

<!-- Drop a hero shot here — recommended size: 1600×1000, .png -->
<div align="center">

![Vellum Dashboard](./docs/screenshot-dashboard.png)

*The Vellum dashboard — frameless, centered, glass.*

</div>

---

## Key Features

### Smart Widgets
Independently draggable, resizable widgets for **To-Do**, **Notes**, **Calendar**, and an **Activity Log**. Every widget enforces strict screen-boundary clamping on mount, drag, and resize — so they never get lost off-screen, even after resolution changes or monitor unplugs.

<!-- Widgets close-up: 1400×900, .png -->
<div align="center">

![Widgets](./docs/screenshot-widgets.png)

</div>

### Ghost Mode (Escape Hatch)
Need to click *through* Vellum to interact with the desktop underneath? Toggle **Ghost Mode** from the title bar. The window becomes fully click-through — perfect for keeping a checklist visible while you work in another app. Press **`Alt + G`** at any time to instantly restore interactivity, so you can never lock yourself out.

### Persistent State
Powered by `tauri-plugin-window-state`, Vellum remembers your **custom window size**, **widget positions**, **theme** (Dark Glass · Frosted Light · Pure Black), **opacity**, and **wallpaper** across every session. Quit, reopen — it's exactly where you left it.

<!-- Theme switcher comparison: side-by-side 1600×600, .png -->
<div align="center">

![Themes](./docs/screenshot-themes.png)

*Dark Glass · Frosted Light · Pure Black*

</div>

### Autostart Ready
Flip a single toggle in Settings to launch Vellum silently in the background on system boot. Hides to the tray on close; one click to bring it back.

---

## Installation

1. Head to the [**Releases page**](https://github.com/SYcstA/Vellum/releases) and grab the latest `Vellum-x.y.z-setup.exe`.
2. Run the installer (NSIS, signed under publisher **YcstA**).
3. Launch Vellum from the Start menu or pin it to the taskbar.

That's it. No external runtime, no dependencies, no telemetry.

---

## Local Development

**Prerequisites:** Node.js 20+, Rust toolchain, and the platform-specific Tauri prereqs ([see Tauri docs](https://tauri.app/start/prerequisites/)).

```bash
# Install dependencies
npm install

# Run in dev mode (hot-reload on the frontend, Rust rebuilds on change)
npm run tauri dev

# Build a production installer (.exe + NSIS bundle under /src-tauri/target/release/bundle/)
npm run tauri build
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Native shell | Tauri 2 · Rust |
| Frontend | React 19 · TypeScript 5 · Vite 7 |
| Styling | Tailwind CSS 4 + custom glassmorphism design tokens |
| State | Zustand 5 (persisted via `localStorage`) |
| Persistence | SQLite (via `tauri-plugin-sql`) |
| Icons | lucide-react |
| Virtualization | `@tanstack/react-virtual` |

---

## Screenshots Folder

All README images live in [`./docs/`](./docs/). To swap in your own screenshots, just drop PNGs/GIFs in there with these filenames:

| Filename | What it shows | Suggested size |
|---|---|---|
| `screenshot-dashboard.png` | Hero shot of the full dashboard | 1600×1000 |
| `screenshot-widgets.png` | Widgets close-up | 1400×900 |
| `screenshot-themes.png` | Theme switcher side-by-side | 1600×600 |

---

<div align="center">

Developed with ❤️ by **YcstA**.

</div>
