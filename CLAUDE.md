# CLAUDE.md

**Quick-start guide for Claude Code - Complete details in linked docs**

---

## Project Overview

**Vellum** — Tauri 2 desktop productivity app. Frameless, glassmorphism UI with draggable/resizable widgets (ToDo, Notes, Calendar, Log, Settings), Ghost Mode (click-through), system tray, and SQLite persistence.

**Tech Stack**: Tauri 2 · Rust | React 19 · TypeScript 5 · Vite 7 | Tailwind CSS 4 | Zustand 5 | SQLite (tauri-plugin-sql)

---

## Session Start Protocol ⚡

**MANDATORY** at start of each session:

```bash
# Load essential docs (~800 tokens - 2 min read)
✓ .claude/COMMON_MISTAKES.md      # ⚠️ CRITICAL - Read FIRST
✓ .claude/QUICK_START.md          # Essential commands
✓ .claude/ARCHITECTURE_MAP.md     # File locations
```

**At task completion:**
- Create completion doc in `.claude/completions/YYYY-MM-DD-task-name.md`
- Move session file to `.claude/sessions/archive/` (if created)

**⚠️ NEVER auto-load:**
- Files in `.claude/completions/` (0 token cost)
- Files in `.claude/sessions/` (0 token cost)
- Files in `docs/archive/` (0 token cost)

---

## Quick Start Commands

```bash
npm run tauri dev      # Hot-reload dev (frontend + Rust)
npm run tauri build    # Production installer (.exe + NSIS)
npm run build          # Frontend-only build (tsc + vite)
```

---

**Last Updated**: 2026-06-24
**Optimized with**: [Claude Token Optimizer](https://github.com/nadimtuhin/claude-token-optimizer)
