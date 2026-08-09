# OpenAI Responses Regression Results - 2026-08-02

## Scope

- Backend provider registry, model catalog and request-level capability validation.
- OpenAI Responses SSE text, reasoning summary, function arguments and completion snapshots.
- Stateless Function Calling continuation with response output items and `function_call_output`.
- React runtime model selection, capability-aware settings and NDJSON v2 rendering.
- Real OpenAI-compatible Responses flow through the browser and Express backend.

No endpoint, API key, request payload secret or full model answer is recorded here.

## Automated Results

| Check | Result |
| --- | --- |
| Server TypeScript typecheck | Passed |
| OpenAI adapter and end-to-end mock flow | 8/8 passed |
| Root Node unit suites | 63/63 passed |
| React typecheck and normal/type-aware lint | Passed |
| React Vitest | 13 files / 43 tests passed |
| React production build | Passed |
| React all-mock CDP | 10 scripts passed |
| Real OpenAI Responses CDP | 16/16 assertions passed |

## Real Provider Assertions

- A partial assistant answer was visible while the request was still generating.
- React sent `provider=openai`, `model=gpt-5.6-luna` and the selected reasoning effort.
- Unsupported `temperature` was omitted.
- A non-empty reasoning summary was rendered separately from the final answer.
- The model called the local `calculate` tool; tool start/result events and the correct result reached the NDJSON stream.
- The second Responses request correlated `function_call_output` by `call_id` and completed normally.
- Stop generation aborted the browser request, showed the stopped state, and a later request completed successfully.

The real run used three temporary conversations with a `CDPOPENAIREAL-` prefix. The script deleted them and removed its temporary Chrome profile in `finally`.

## Commands

```bash
pnpm run typecheck:server
pnpm run test:unit
pnpm --dir client-react run typecheck
pnpm --dir client-react run lint
pnpm --dir client-react run lint:type-aware
pnpm --dir client-react run test
pnpm --dir client-react run build
pnpm run test:cdp:react:all-mock
pnpm run test:cdp:react:real-openai
```

The real-provider command is intentionally separate because it consumes an external API and may incur cost.
