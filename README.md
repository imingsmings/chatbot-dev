# chatbot-dev

A local-first AI chat application built with Vue 3, Vite, Express, and TypeScript.

## Architecture

```text
client/
  Vue 3 UI, chat state composables, API client, Markdown rendering

server/
  Express routes, controllers, services, LLM adapters, tool registry,
  local JSON conversation storage

tests/cdp/
  CDP-based regression tests with mock LLM and browser automation
```

The frontend calls `/api/*`. During development, Vite proxies those requests to
the backend on `http://127.0.0.1:7001` and strips the `/api` prefix.

The streaming response path is:

```text
DeepSeek-compatible SSE
  -> server LLM adapter parses data: lines
  -> server emits app-level NDJSON
  -> client reads with fetch + ReadableStream.getReader()
  -> assistant message is updated by delta events
```

## Features

- Multi-conversation chat: create, select, rename, delete, and clear conversations.
- Local JSON persistence: one conversation file per session, with legacy migration support.
- Streaming answers over NDJSON.
- Request cancellation: frontend abort, explicit cancel API, and backend upstream abort.
- Native Function Calling via `tools` and `tool_choice`.
- Weather tool example through the server-side tool registry.
- Markdown rendering with `markdown-it`, `DOMPurify`, and selective `highlight.js` languages.
- Dark and light theme switching.
- CDP regression coverage for core chat, tool calling, cancellation, UI, Markdown, and highlighting.

## Requirements

- Node.js `>=22.18.0` for the server.
- pnpm.

Install dependencies separately:

```bash
pnpm --dir server install
pnpm --dir client install
```

## Environment

Create a local backend environment file:

```bash
cp server/.env.example server/.env
```

Then fill in the model and tool credentials in `server/.env`.

Key variables:

| Name                    | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `PORT`                  | Backend port. Defaults to `7001`.                                  |
| `LLM_PROVIDER`          | LLM adapter name. Currently `deepseek`.                            |
| `LLM_ENDPOINT`          | Chat completions endpoint.                                         |
| `LLM_MODEL`             | Model name sent to the provider.                                   |
| `LLM_TIMEOUT_MS`        | Upstream model request timeout.                                    |
| `DEEPSEEK_API_KEY`      | API key used by the DeepSeek adapter.                              |
| `HEFENG_API_HOST`       | Weather API host for the weather tool.                             |
| `HEFENG_API_KEY`        | Weather API key.                                                   |
| `CONVERSATION_DATA_DIR` | Optional override for conversation data storage. Useful for tests. |

## Development

Start the backend:

```bash
pnpm run dev:server
```

Start the frontend:

```bash
pnpm run dev:client
```

Open:

```text
http://localhost:5173
```

For another machine on the same LAN, open the frontend with this machine's LAN
IP address:

```text
http://<your-lan-ip>:5173
```

The frontend dev server listens on `0.0.0.0`, and API requests are proxied back
to the local backend at `127.0.0.1:7001`.

## Root Scripts

The root `package.json` provides shortcuts that delegate to the existing client,
server, and CDP test entry points.

```bash
pnpm run dev:server
pnpm run dev:client
pnpm run typecheck:server
pnpm run typecheck:client
pnpm run build:client
pnpm run lint:client
pnpm run check
```

CDP regression suites:

```bash
pnpm run test:cdp:p0
pnpm run test:cdp:p1
pnpm run test:cdp:ui
pnpm run test:cdp:markdown
pnpm run test:cdp:highlight
pnpm run test:cdp:all-mock
```

Real-provider regression tests are intentionally separate:

```bash
pnpm run test:cdp:real
```

Run real-provider tests only when the local environment is configured with real
LLM and tool credentials. The real-provider runner starts the local backend and
frontend when they are not already running.

## Backend Boundaries

- `server/routes/*`: route registration only.
- `server/controllers/*`: HTTP request/response handling.
- `server/services/chatService.ts`: chat orchestration, including Function Calling.
- `server/services/toolService.ts`: tool registry, schema definitions, validation, and execution.
- `server/utils/llm/*`: provider adapter boundary and stream parsing.
- `server/utils/conversationStore.ts`: local file persistence.
- `server/utils/requestRegistry.ts`: active request tracking and cancellation.

## Frontend Boundaries

- `client/src/App.vue`: application composition and high-level event wiring.
- `client/src/api/conversations.ts`: HTTP API wrapper.
- `client/src/composables/useConversations.ts`: conversation state and CRUD flow.
- `client/src/composables/useChatStream.ts`: streaming request lifecycle and message status.
- `client/src/components/*`: sidebar, composer, message list, empty state, Markdown message.
- `client/src/utils/markdownRenderer.ts`: shared Markdown parser, sanitizer, and highlighter setup.

## Testing Notes

Regression test definitions live in `docs/regression-test-cases.md`.
Recent full-run evidence is recorded in `docs/cdp-regression-results-2026-05-23.md`.
Current follow-up architecture notes are recorded in
`docs/architecture-review-2026-05-23.md`.

Default guidance:

- Run P0 after backend, streaming, cancellation, tool, or persistence changes.
- Run the UI suite after sidebar, composer, message rendering, scroll, theme, or responsive changes.
- Add Markdown/highlight suites after rendering changes.
- Add UI scenarios after interaction, layout, copy, retry, or scroll changes.
- Use real-provider tests only when explicitly validating real model/tool behavior.
