# Voice Canvas

A voice assistant with a synchronized visual workspace. You talk to the agent in real time while it creates, edits, and organizes notes, markdown tables, and code snippets on screen.

## How it works

The frontend runs an ElevenLabs conversational voice agent over a signed WebSocket connection. During a call, the agent uses client tools to read and modify the visual canvas in real time without HTTP webhooks.

```
User (Voice / Text) <---> VoiceChat (React) <---> ElevenLabs Agent
                               |
                               v
                     Client Tools (WebSocket)
                     - list_canvas_entries
                     - read_canvas
                     - append_to_canvas
                     - update_canvas_entry
                     - delete_canvas_entry
                     - write_to_canvas
                               |
                               v
                     Canvas Panel + SQLite (voice_sessions.db)
```

1. **Client tools over WebSocket.** The browser registers tools (`list_canvas_entries`, `read_canvas`, `append_to_canvas`, `update_canvas_entry`, `delete_canvas_entry`, `write_to_canvas`). When the agent calls a tool, the browser runs the handler locally and returns the result in the active session frame.
2. **Interactive canvas.** The right panel parses markdown, GitHub Flavored Markdown tables, code blocks with copy buttons, and HTML callouts. Users can double-click or click the edit icon on any card to edit markdown directly in place.
3. **Session resumption.** When you resume a past call, the app loads the prior transcript and canvas entries from SQLite and sends the transcript to the agent as background context on connect.
4. **Document injection.** You can paste text or documents up to several thousand words into the chat box to send them as a user message or inject them silently into the agent memory.
5. **Local storage.** Session history, duration, transcripts, and canvas states save to a local SQLite database (`voice_sessions.db`).

## Setup

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+) or Node.js (v18+)
- An ElevenLabs account with an API key

### Installation

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/ngenome/voice-canvas.git
cd voice-canvas
bun install
```

2. Create `.env` from the example file:

```bash
cp .env.example .env
```

3. Add your ElevenLabs credentials to `.env`:

```env
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_AGENT_ID=your_agent_id_here
PORT=3002
```

4. Configure your ElevenLabs agent with the required tool definitions:

```bash
bun run update-agent
```

To create a new agent from scratch instead, run:

```bash
bun run create-agent
```

5. Start the development server:

```bash
bun run dev
```

Open `http://localhost:5173` in your browser.

## Project structure

- `server/db.ts` SQLite database service for sessions, transcripts, and canvas data.
- `server/index.ts` Hono backend server for signed URLs, canvas persistence, and settings.
- `server/updateAgent.ts` Syncs tool definitions and prompt rules to your ElevenLabs agent.
- `server/createAgent.ts` Creates a new agent on ElevenLabs with canvas tools configured.
- `src/components/VoiceChat.tsx` Main workstation layout, microphone stream, and client tool handlers.
- `src/components/CanvasPanel.tsx` Canvas renderer with markdown tables, code syntax blocks, and in-place editing.
- `src/components/AvatarSpeaker.tsx` Reactive audio visualizer orb.
- `src/components/Waveform.tsx` Audio frequency bars.
- `src/components/SessionHistory.tsx` Session history drawer with resume and search.
- `src/components/SettingsModal.tsx` In-app API key and agent ID settings.

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Starts Vite frontend and Hono backend concurrently |
| `bun run server` | Starts only the Hono backend server |
| `bun run build` | Builds the frontend for production into `dist/` |
| `bun run update-agent` | Updates tool definitions on ElevenLabs |
| `bun run create-agent` | Creates a new agent on ElevenLabs |

## License

MIT
