import { confirm, input, select } from '@inquirer/prompts';
import { theme } from '../ui/theme.js';
import { getNotificationManager, initializeNotificationManager } from '../notifications/manager.js';
import type { NotificationConfig } from '../extensions/team.js';

const colors = theme.colors || {};
const ok = colors.green || ((s: string) => s);
const info = colors.blue || ((s: string) => s);
const warn = colors.yellow || ((s: string) => s);
const error = colors.red || ((s: string) => s);

interface NotificationConfigFile {
  notifications?: NotificationConfig;
}

function loadNotificationConfig(): NotificationConfig | null {
  const slackToken = process.env.ICOPILOT_SLACK_TOKEN;
  const teamsToken = process.env.ICOPILOT_TEAMS_TOKEN;
  const channel = process.env.ICOPILOT_NOTIFY_CHANNEL;

  if (slackToken && channel) {
    return { provider: 'slack', token: slackToken, channel };
  }

  if (teamsToken && channel) {
    return { provider: 'teams', token: teamsToken, channel };
  }

  return null;
}

function saveNotificationConfig(config: NotificationConfig): void {
  if (config.provider === 'slack') {
    process.env.ICOPILOT_SLACK_TOKEN = config.token;
  } else {
    process.env.ICOPILOT_TEAMS_TOKEN = config.token;
  }
  process.env.ICOPILOT_NOTIFY_CHANNEL = config.channel;
}

async function configureSlack(): Promise<NotificationConfig> {
  console.log('\n' + info('='.repeat(50)));
  console.log(info('Slack Notification Setup'));
  console.log(info('='.repeat(50)));

  console.log(
    '\nSteps to create a Slack bot:\n' +
      '1. Go to https://api.slack.com/apps\n' +
      '2. Click "Create New App" → "From scratch"\n' +
      '3. Name it "iCopilot" and select your workspace\n' +
      '4. Go to "OAuth & Permissions" (left sidebar)\n' +
      '5. Add these scopes:\n' +
      '   - chat:write\n' +
      '   - chat:write.public\n' +
      '   - channels:read\n' +
      '6. Under "Bot Token Scopes", copy your token (starts with xoxb-)\n' +
      '7. Go to your Slack workspace and find/create a channel for notifications\n' +
      '8. Invite the bot to that channel\n',
  );

  const token = await input({
    message: 'Enter your Slack Bot Token (xoxb-...)',
    validate: (val) => {
      const trimmed = val.trim();
      return trimmed.startsWith('xoxb-') ? true : 'Token must start with xoxb-';
    },
  });

  const channel = await input({
    message: 'Enter the Slack channel name or ID (e.g., #notifications or C0123456789)',
    validate: (val) => val.trim().length > 0 ? true : 'Channel is required',
  });

  const config: NotificationConfig = {
    provider: 'slack',
    token: token.trim(),
    channel: channel.trim(),
  };

  saveNotificationConfig(config);
  return config;
}

async function configureTeams(): Promise<NotificationConfig> {
  console.log('\n' + info('='.repeat(50)));
  console.log(info('Microsoft Teams Notification Setup'));
  console.log(info('='.repeat(50)));

  console.log(
    '\nSteps to create a Teams bot:\n' +
      '1. Go to https://dev.teams.microsoft.com\n' +
      '2. Click "Create app" → "Build from scratch"\n' +
      '3. Name it "iCopilot"\n' +
      '4. Go to "Build" → "Messaging" (left sidebar)\n' +
      '5. Click "Set up a bot" or find the existing bot configuration\n' +
      '6. Under "Application ID", copy your App ID\n' +
      '7. Click "Add a password key" and copy the secret\n' +
      '8. In Teams, go to the channel where you want notifications\n' +
      '9. Copy the channel ID from the URL\n',
  );

  const token = await input({
    message: 'Enter your Teams App ID',
    validate: (val) => val.trim().length > 0 ? true : 'App ID is required',
  });

  const channel = await input({
    message: 'Enter the Teams channel ID',
    validate: (val) => val.trim().length > 0 ? true : 'Channel ID is required',
  });

  const config: NotificationConfig = {
    provider: 'teams',
    token: token.trim(),
    channel: channel.trim(),
  };

  saveNotificationConfig(config);
  return config;
}

async function testNotification(): Promise<void> {
  const config = loadNotificationConfig();
  if (!config) {
    console.log(error('✗ Notifications not configured. Run `/notify configure slack` or `/notify configure teams` first.'));
    return;
  }

  const manager = getNotificationManager();
  initializeNotificationManager(config);

  console.log(info('Testing notification...'));

  try {
    await manager.sendNotification('🧪 Test message from iCopilot - Notifications working!');
    console.log(ok('✓ Test notification sent successfully'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(error(`✗ Failed to send test notification: ${msg}`));
  }
}

async function sendMessage(message: string): Promise<void> {
  const config = loadNotificationConfig();
  if (!config) {
    console.log(error('✗ Notifications not configured. Run `/notify configure slack` or `/notify configure teams` first.'));
    return;
  }

  const manager = getNotificationManager();
  initializeNotificationManager(config);

  try {
    await manager.sendNotification(message);
    console.log(ok('✓ Message sent'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(error(`✗ Failed to send message: ${msg}`));
  }
}

async function showStatus(): Promise<void> {
  const config = loadNotificationConfig();

  if (!config) {
    console.log(info('No notification provider configured'));
    return;
  }

  console.log('\n' + info('Notification Configuration:'));
  console.log(`  Provider: ${config.provider.toUpperCase()}`);
  console.log(`  Channel:  ${config.channel}`);
  console.log(`  Token:    ${config.token.substring(0, 10)}...`);

  const manager = getNotificationManager();
  initializeNotificationManager(config);

  try {
    const status = await manager.getStatus();
    if (status.connected) {
      console.log(ok('  Status:   ✓ Connected'));
    } else {
      console.log(warn(`  Status:   ✗ ${status.error || 'Disconnected'}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(warn(`  Status:   ✗ Error checking connection: ${msg}`));
  }
}

export async function notifyCommand(args: string[]): Promise<string> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === 'help') {
    return (
      'Usage: /notify <command>\n\n' +
      'Commands:\n' +
      '  /notify configure slack  - Set up Slack notifications\n' +
      '  /notify configure teams  - Set up Teams notifications\n' +
      '  /notify test             - Send a test notification\n' +
      '  /notify send <message>   - Send a custom message\n' +
      '  /notify status           - Show current configuration\n' +
      '  /notify help             - Show this help\n\n' +
      'Examples:\n' +
      '  /notify configure slack\n' +
      '  /notify test\n' +
      '  /notify send Build completed successfully!\n'
    );
  }

  if (subcommand === 'configure') {
    const provider = rest[0];
    if (provider === 'slack') {
      const config = await configureSlack();
      initializeNotificationManager(config);
      console.log(ok('\n✓ Slack configuration saved'));
      return 'Slack notifications configured';
    }
    if (provider === 'teams') {
      const config = await configureTeams();
      initializeNotificationManager(config);
      console.log(ok('\n✓ Teams configuration saved'));
      return 'Teams notifications configured';
    }
    return error('Usage: /notify configure [slack|teams]');
  }

  if (subcommand === 'test') {
    await testNotification();
    return '';
  }

  if (subcommand === 'send') {
    const message = rest.join(' ');
    if (!message) {
      return error('Usage: /notify send <message>');
    }
    await sendMessage(message);
    return '';
  }

  if (subcommand === 'status') {
    await showStatus();
    return '';
  }

  return error(`Unknown command: ${subcommand}. Use '/notify help' for usage.`);
}
