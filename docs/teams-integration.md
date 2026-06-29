# Slack/Teams Integration

Send notifications and approval requests from iCopilot to Slack or Microsoft Teams. Enable team collaboration and audit trails for command approvals.

## Overview

iCopilot can integrate with Slack or Microsoft Teams to:
- Send notifications and command output to a team channel
- Request approvals for potentially dangerous operations
- Maintain audit logs of who approved what
- Enable distributed team workflows without direct CLI access

## Slack Setup

### Step 1: Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. App Name: `iCopilot`
4. Workspace: Select your workspace
5. Click **Create App**

### Step 2: Enable Features

1. In the left sidebar, click **Incoming Webhooks**
2. Toggle **Activate Incoming Webhooks** to **On**
3. Click **Add New Webhook to Workspace** and select the channel where notifications should appear
4. Copy the **Webhook URL** (you'll need it later)

### Step 3: Get Bot Token

1. In the left sidebar, click **OAuth & Permissions**
2. Under **Scopes**, click **Add an OAuth Scope**
3. Add these scopes:
   - `chat:write` — send messages
   - `chat:write.public` — send to public channels
4. At the top under **OAuth Tokens for Your Workspace**, click **Install to Workspace** (or **Reinstall App** if already done)
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Step 4: Configure iCopilot

Run the configuration command:

```bash
copilot /notify configure slack
```

When prompted:
- Paste your **Bot User OAuth Token** (from Step 3)
- Enter your notification channel: `#channel-name` or `@username`

Or set environment variables directly:

```bash
export ICOPILOT_SLACK_TOKEN="xoxb-your-token-here"
export ICOPILOT_NOTIFY_CHANNEL="#notifications"
export ICOPILOT_SLACK_SIGNING_SECRET="your-signing-secret" # Optional, for webhook validation
```

### Step 5: Enable Webhooks (Optional, for Approvals)

To receive approval responses via buttons in Slack:

1. In your Slack app settings, go to **Interactivity & Shortcuts**
2. Toggle **Interactivity** to **On**
3. Set **Request URL** to: `https://your-icopilot-server/webhooks/slack`
   - Replace `your-icopilot-server` with your iCopilot API server URL
4. In **Event Subscriptions**, toggle **Enable Events** to **On**
5. Set **Request URL** to: `https://your-icopilot-server/webhooks/slack`
6. Under **Subscribe to bot events**, add: `app_mention`, `message.im`

### Step 6: Test

Send a test message:

```bash
copilot /notify test
```

You should see a message appear in your configured Slack channel.

## Teams Setup

### Step 1: Register Bot in Azure

1. Go to https://dev.teams.microsoft.com
2. Click **Apps** → **New app**
3. Enter app name: `iCopilot`
4. Click **Create**

### Step 2: Configure Bot

1. In the left sidebar, click **Configure** under **App features**
2. Scroll to **Bots** section
3. Click **Create a bot** (or **Manage**if already exists)
4. Enter bot name: `iCopilot`
5. Click **Create**
6. You'll be given:
   - **Bot ID** (copy and save)
   - **Password** (copy and save securely)

### Step 3: Add Messaging Endpoint

1. Still in bot settings, under **Messaging endpoint**, enter:
   - `https://your-icopilot-server/webhooks/teams`
   - Replace `your-icopilot-server` with your iCopilot API server URL

### Step 4: Configure iCopilot

Run the configuration command:

```bash
copilot /notify configure teams
```

When prompted:
- Paste your **Bot ID**
- Paste your **Bot Password**
- Enter your **Channel ID** (ask your Teams admin or extract from channel URL)

Or set environment variables:

```bash
export ICOPILOT_TEAMS_APP_ID="your-bot-id"
export ICOPILOT_TEAMS_APP_PASSWORD="your-bot-password"
export ICOPILOT_NOTIFY_CHANNEL="channel-id"
```

### Step 5: Test

Send a test message:

```bash
copilot /notify test
```

You should see a message appear in your configured Teams channel.

## Commands

### View Status

```bash
copilot /notify status
```

Shows:
- Configured provider (Slack, Teams, or None)
- Current channel
- Connection status
- Last successful message timestamp

### Send Manual Message

```bash
copilot /notify send "Hello team, deployment complete"
```

### Toggle Auto-Approval

For certain operations that normally require approval:

```bash
copilot /notify auto-approve on
```

When enabled, operations like database migrations will auto-approve instead of requiring team approval.

```bash
copilot /notify auto-approve off
```

## Approval Workflows

When a potentially dangerous operation is blocked, you can request team approval:

```bash
# Example: Production deployment blocked by safety net
$ copilot /deploy prod
❌ Dangerous operation blocked: Production database migration

Notify team for approval? (Y/n)
```

Press `Y` to send an approval request to Slack/Teams. Team members will see:

**Slack:**
```
[iCopilot] Approval needed: Production database migration
Details: ALTER TABLE users ADD COLUMN admin BOOLEAN;
⏱️ Expires in 5 minutes

[Approve] [Deny]
```

**Teams:**
```
[iCopilot Approval Request]
Production database migration
Details: ALTER TABLE users ADD COLUMN admin BOOLEAN;
Expires in 5 minutes

[✓ Approve] [✗ Deny]
```

The command waits up to 5 minutes for approval. Once approved or denied, execution resumes or fails accordingly.

## Webhook URL Configuration

If iCopilot is running locally (localhost), webhooks won't work because Slack/Teams can't reach your machine. For local development, use:

- **ngrok** (recommended): `https://ngrok.io` — exposes local server to internet
  ```bash
  ngrok http 3000  # If iCopilot runs on port 3000
  ```
  Use the generated URL in Slack/Teams webhook settings.

- **Localtunnel**: Similar alternative to ngrok
- **Production**: If iCopilot runs on a public server, use your actual domain

## Security Considerations

### Token Storage

Never commit tokens to version control:
- Tokens are passed via environment variables only
- Never log or print tokens (the system strips them)
- If a token is compromised, regenerate it in Slack/Teams admin panel

### Webhook Validation

All webhooks are validated:
- **Slack**: HMAC-SHA256 signature validation using your Signing Secret
- **Teams**: Bot Framework authentication validation

Unauthorized requests are rejected with 401 Unauthorized.

### Audit Trail

All approvals are logged with:
- Who approved (Slack user ID or Teams user ID)
- What operation was approved
- Timestamp
- Approval/denial decision

Access logs via:

```bash
copilot /notify status  # Shows recent approval history
```

## Troubleshooting

### No message appears in channel

1. Check token validity: `/notify test`
2. Verify channel name/ID: `/notify status`
3. Check iCopilot logs for errors: `tail -f ~/.icopilot/logs/notifications.log`

### Approval buttons don't work

1. Verify webhook URL is accessible from internet (ngrok for local dev)
2. Check webhook signature validation: enable ICOPILOT_SLACK_SIGNING_SECRET
3. Ensure webhook endpoint is configured in Slack/Teams admin panel

### "Unauthorized" errors

1. Verify token is correct: `echo $ICOPILOT_SLACK_TOKEN`
2. Regenerate token if compromised
3. Ensure bot has required permissions (see Slack/Teams setup steps above)

### Connection timeout

1. Check network connectivity
2. Verify Slack/Teams API endpoint is reachable
3. Check for rate limiting (wait a few minutes and retry)

## API Reference

### NotificationManager

```typescript
// Send message
await notificationManager.sendNotification('Hello team', {
  channel: '#notifications'
});

// Request approval
const result = await notificationManager.requestUserApproval('delete_database', {
  description: 'Delete production database',
  details: { database: 'prod_db', tables: 5000 },
  timeout: 300000  // 5 minutes
});

if (result.approved) {
  console.log('Approved by:', result.approver);
} else {
  console.log('Approval denied or timed out');
}

// Format output
const slack = notificationManager.formatOutput(
  'SELECT * FROM users',
  'code'
);
```

### Interfaces

```typescript
interface NotificationConfig {
  provider: 'slack' | 'teams';
  token: string;          // Slack bot token or Teams bot password
  channel: string;        // #channel or channel ID
  autoApprove?: string[]; // Actions to auto-approve
}

interface ApprovalRequest {
  description: string;
  details?: Record<string, unknown>;
  timeout?: number;
}

interface ApprovalResult {
  approved: boolean;
  approver?: string;
  timestamp?: number;
}
```

## Environment Variables

```bash
# Slack
ICOPILOT_SLACK_TOKEN=xoxb-...
ICOPILOT_SLACK_SIGNING_SECRET=...

# Teams
ICOPILOT_TEAMS_APP_ID=...
ICOPILOT_TEAMS_APP_PASSWORD=...

# Shared
ICOPILOT_NOTIFY_CHANNEL=#notifications
```

## Examples

### Auto-send daily summary

```bash
# In your workflow/cron job
copilot /notify send "$(copilot /status)"
```

### Conditional notifications

```bash
# Deploy with approval if production
if [[ $ENVIRONMENT == "prod" ]]; then
  copilot /deploy --notify-approval prod
else
  copilot /deploy dev
fi
```

### Approval chains

Request approval from multiple teams:

```bash
copilot /notify send "Waiting for Security team approval"
# ... security team approves ...
copilot /notify send "Waiting for DBA approval"
# ... DBA approves ...
copilot /deploy prod
```
