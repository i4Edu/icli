# Multi-model routing

iCopilot can route tasks to different models based on a profile. Use this to
keep cost low while routing the hardest tasks (edits, reviews) to a stronger
model.

## Profiles

| Profile | plan | chat | edit | review | commit | summarize |
|---------|------|------|------|--------|--------|-----------|
| `cheap`    | mini | mini | mini | mini | mini | mini |
| `balanced` | mini | mini | 4o   | 4o   | mini | mini |
| `strong`   | mini | 4o   | 4o   | 4o   | 4o   | mini |
| `fixed`    | session | session | session | session | session | session |

`fixed` (the default) never overrides the session model. Switch to a real
profile only when you opt in.

## Slash command

```text
> /route get
routing profile: fixed

> /route list
routing profiles: cheap, balanced, strong, fixed

> /route set balanced
✔ routing profile → balanced
```

## Env

```bash
ICOPILOT_ROUTING=balanced icopilot
```

## How it works

`src/modes/turn.ts` asks `pickModel(session.state.model, task)` per turn. The
task is `'plan'` in Plan Mode and `'chat'` otherwise. Future work: thread
distinct task kinds (edit, review, commit) through the call sites that
currently use the chat model.
