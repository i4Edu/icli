# Cloud-Scheduled Routines

Remote cron-like task execution for iCopilot.

## Overview

Cloud routines let you schedule iCopilot prompts to run automatically at specified times. Each routine is defined by:

- **Name** — unique identifier
- **Prompt** — the exact text sent to the model (e.g., "generate daily standup summary")
- **Schedule** — when to run (once at a time, daily, weekly, monthly)
- **Enabled** — toggle on/off without deleting

Routines are executed in isolated session contexts, with full git and repo awareness. Execution logs are persisted for audit trails.

## Command: `/cloud-routine`

### Create a routine

```bash
/cloud-routine create "daily-standup" "daily 09:00" "Generate a brief standup summary from recent git commits"
/cloud-routine create "weekly-review" "weekly 1 14:00" "Review all pull requests merged this week"
/cloud-routine create "monthly-audit" "monthly 15 10:00" "Run security audit on dependencies"
```

**Schedule formats:**

- `once DATE TIME` — run once at a specific date/time (e.g., `once 2025-01-15 14:30`)
- `daily TIME` — run daily at specified time (e.g., `daily 09:00` or `daily 9am`)
- `weekly DAY TIME` — run on specific day of week (e.g., `weekly 1 14:00` for Monday at 2pm; 0=Sunday)
- `monthly DOM TIME` — run on specific day of month (e.g., `monthly 15 10:00` for the 15th at 10am)

Time can be in `HH:MM`, `HH:MM:SS`, or natural format like `9am`, `9:30am`, `9:00:00`.

### List routines

```bash
/cloud-routine list
/cloud-routine list --detail
```

Shows:

```
Name                Status      Next Run             Last Run
daily-standup       enabled     Today 09:00 (11m)    2025-01-10 09:00 ✓
weekly-review       enabled     Mon 14:00 (4d)       —
monthly-audit       disabled    —                    —
```

### Show routine details

```bash
/cloud-routine show daily-standup
```

### Update a routine

```bash
/cloud-routine update daily-standup --schedule "daily 10:00"
/cloud-routine update daily-standup --prompt "Generate standups including open issues"
/cloud-routine update daily-standup --enabled false
```

### Run a routine immediately

```bash
/cloud-routine run daily-standup
```

Useful for testing without waiting for the scheduled time.

### Delete a routine

```bash
/cloud-routine delete daily-standup
```

### View execution logs

```bash
/cloud-routine logs daily-standup
/cloud-routine logs daily-standup --last 10
```

Shows recent executions with status, timestamp, output, and any errors.

## How it works

### Local persistence

Routines are stored in `~/.icopilot/cloud-routines.json` by default:

```json
[
  {
    "id": "daily-standup",
    "name": "daily-standup",
    "prompt": "Generate a brief standup...",
    "schedule": {
      "type": "daily",
      "time": "09:00"
    },
    "enabled": true,
    "createdAt": "2025-01-10T10:00:00.000Z",
    "nextRun": "2025-01-11T09:00:00.000Z",
    "lastRun": "2025-01-10T09:00:00.000Z"
  }
]
```

### Polling scheduler

When you enter interactive mode with routines enabled, iCopilot starts a background scheduler that:

1. Wakes up every 60 seconds (configurable)
2. Checks which routines are due (nextRun <= now)
3. Executes due routines in isolated session contexts
4. Logs results and recalculates next run time
5. Persists state to disk

The scheduler stops cleanly when you exit the session.

### Execution context

Each routine runs in a fresh **temporary session** with:

- Full git context (repo state, branch, recent commits)
- Model set to your configured default
- No history (clean slate for each execution)
- Execution logged with timestamp, status, output, duration

### Execution logs

Logs are stored in `~/.icopilot/cloud-routines-logs.json`:

```json
[
  {
    "routineId": "daily-standup",
    "timestamp": "2025-01-10T09:00:15.000Z",
    "status": "success",
    "duration": 3200,
    "output": "## Standup Summary\n..."
  }
]
```

## Configuration

Enable cloud routines in `~/.icopilotrc.json`:

```json
{
  "cloudRoutines": {
    "enabled": true,
    "pollingInterval": 60000
  }
}
```

Or set environment variables:

```bash
export ICOPILOT_CLOUD_ROUTINES_ENABLED=true
export ICOPILOT_CLOUD_ROUTINES_POLLING_INTERVAL=60000  # milliseconds
```

To use custom storage paths:

```bash
export ICOPILOT_CLOUD_ROUTINES_FILE=/path/to/routines.json
export ICOPILOT_CLOUD_ROUTINES_LOGS_FILE=/path/to/logs.json
```

## Timezone handling

Routines use your **system's local timezone** for all calculations. Times in schedule specifications are interpreted relative to your local time (not UTC).

To verify your timezone, check the `nextRun` values returned by `/cloud-routine list`.

## Examples

### Daily standup generation

```bash
/cloud-routine create "standup" "daily 09:00" \
  "Generate a standup summary from git log of past 24 hours, recent PRs, and open issues"
```

Each morning at 9am, get a summary of work in progress.

### Weekly code review audit

```bash
/cloud-routine create "weekly-pr-review" "weekly 1 09:00" \
  "Review all PRs merged since last week, summarize code patterns and quality trends"
```

Every Monday morning, get a high-level code review summary.

### Monthly dependency check

```bash
/cloud-routine create "deps-audit" "monthly 1 10:00" \
  "Run npm audit, identify outdated packages, suggest upgrades"
```

First of each month, get a dependency health check.

### One-time reminder

```bash
/cloud-routine create "migration-reminder" "once 2025-02-01 14:00" \
  "Remind team to start database migration project"
```

Run once at a specific date/time.

## Limitations

- Routines run in the session that created them; if you close the session, the scheduler stops
- No cross-session execution (cloud routines do not persist across iCopilot restarts)
- Maximum routine name length: 255 characters
- Maximum routine prompt length: 10,000 characters
- Execution timeout: inherit from your model's default (usually 30–60 seconds per completion)

## Future enhancements

- [ ] Webhook triggers (external systems trigger routines)
- [ ] Email notifications on failure
- [ ] Routine chaining (one routine triggers another)
- [ ] Dynamic schedule adjustment based on output
- [ ] Cloud-backed persistence (sync routines across devices)

## Troubleshooting

### Routine not running

1. Check if cloud routines are enabled: `/settings cloudRoutines.enabled`
2. Verify the routine is enabled: `/cloud-routine list`
3. Check `nextRun` time — is it in the past?
4. View logs: `/cloud-routine logs <routine-id>`

### Schedule not parsing

Verify the schedule format matches one of:

- `daily HH:MM`
- `weekly DOW HH:MM` (0–6, where 0=Sunday)
- `monthly DOM HH:MM` (1–31)
- `once DATE TIME` (YYYY-MM-DD HH:MM)

Examples: `daily 09:00`, `weekly 1 14:00`, `monthly 15 10:00`.

### Execution failed

Check the logs: `/cloud-routine logs <routine-id>`. Common issues:

- **Network error** — transient failure; routine will retry at next scheduled time
- **Model error** — invalid prompt or model unavailable
- **Git error** — routine executed outside a git repository

Fix the issue and manually run: `/cloud-routine run <routine-id>`.
