# Palace

A modern visual chat client for the [Palace Chat](https://en.wikipedia.org/wiki/The_Palace_(computer_program)) protocol, built with Electron and TypeScript.

Palace is an avatar-based graphical chat platform from the mid-90s where users inhabit themed rooms, wear props, draw on backgrounds, and interact through scripted hotspots. This client is a ground-up reimplementation for the modern desktop.

![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-lightgrey)

---

## Features

### Chat & Communication
- Public chat, whispers, encrypted chat (XTALK/XWHISPER)
- Sticky speech, thought, and shout bubbles with animated pop-in
- Embedded YouTube, Vimeo, and Facebook video links
- Scrollable chat log panel with clickable hyperlinks
- Smiley face picker with 13 faces and 16 color variations

### Props & Avatar
- Persistent prop bag backed by IndexedDB with categories and multi-select
- Full built-in prop editor — pen, eraser, fill, eyedropper, selection, zoom
- APNG animation support with timeline editing, onion skinning, and frame delay control
- GIF and video-to-APNG conversion
- Drag-and-drop loose prop placement in rooms

### Drawing
- Freehand pen, eraser, shapes, text overlay, and ovals
- Adjustable brush size, RGBA color with fill, front/back layer toggle
- Networked drawing synchronized across all users in a room

### Rooms & Navigation
- Searchable room list, user list, and server directory with population counts
- Hotspot system — passages, lockable doors, scripted areas
- Room background images and video playback
- Web embed support in spots

### Iptscrae Scripting Engine
A complete implementation of the Palace stack-based scripting language:
- 150+ built-in commands — control flow, string ops, math, drawing, HTTP, file I/O
- 18+ event types — user enter/leave, chat intercept, prop events, timers, HTTP callbacks
- Global/local variables, arrays, hashes, and persistent storage
- Alarm timer system for scheduled execution
- Built-in syntax-highlighted script editor with debugging tools
- Cyborg script support for independent automation

### Admin & Server
- Operator and Owner privilege levels with per-server password storage and auto-login
- Admin context menu for moderation (pin, mute, kill, ban)
- Room editing capabilities for authorized users

### Desktop App
- Persistent window state across sessions
- Sandboxed renderer with context isolation — no direct Node access
- IPC bridge for safe main/renderer communication
- Power save blocker during active connections

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)

### Install

```sh
git clone https://github.com/pawnipt/Palace.git
cd PalaceV
npm install
```

### Run

```sh
npm start
```

### Build

```sh
npm run build
```

The packaged app is output to `release-builds/`.

---

## Releases

Pre-built binaries are available on the [Releases](https://github.com/pawnipt/PalaceV/releases) page.

---

## Project Structure

```
src/            Renderer process (TypeScript)
  iptscrae/     Iptscrae scripting engine
  types/        Type definitions
src-main/       Electron main process
css/            Stylesheets
js/lib/         Third-party libraries (pako, UPNG, encoding, coloris)
js/workers/     Web Workers (APNG, GIF extraction, image resize)
img/            Icons and cursors
audio/          System sounds
```

---

## License

See [LICENSE](LICENSE) for details.
# palace-load-tester
