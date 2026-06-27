import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config, getDefaultConfig } from '../../src/config.js';
import { resetSetting, setSetting, showSettings } from '../../src/commands/settings-cmd.js';

describe('settings command', () => {
  let tmpRoot: string;
  let rcPath: string;
  let originalRcPath: string | undefined;
  let originalConfig: typeof config;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(process.cwd(), '.vitest-settings-'));
    rcPath = path.join(tmpRoot, 'icopilotrc.json');
    originalRcPath = process.env.ICOPILOT_RC_PATH;
    process.env.ICOPILOT_RC_PATH = rcPath;
    originalConfig = { ...config };
  });

  afterEach(() => {
    Object.assign(config, originalConfig);
    if (originalRcPath === undefined) delete process.env.ICOPILOT_RC_PATH;
    else process.env.ICOPILOT_RC_PATH = originalRcPath;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('shows settings and persists runtime changes', () => {
    expect(setSetting('model', 'gpt-5-mini')).toContain('setting model');
    setSetting('theme', 'dark');
    setSetting('editFormat', 'whole');
    setSetting('autoLint', 'true');
    setSetting('autoTest', 'yes');
    setSetting('reasoningEffort', 'high');

    const saved = JSON.parse(fs.readFileSync(rcPath, 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({
      model: 'gpt-5-mini',
      theme: 'dark',
      editFormat: 'whole',
      autoLint: true,
      autoTest: true,
      reasoningEffort: 'high',
    });
    expect(config.defaultModel).toBe('gpt-5-mini');
    expect(config.theme).toBe('dark');
    expect(config.editFormat).toBe('whole');
    expect(config.autoLint).toBe(true);
    expect(config.autoTest).toBe(true);
    expect(config.reasoningEffort).toBe('high');

    const output = showSettings();
    expect(output).toContain('Settings');
    expect(output).toContain('model');
    expect(output).toContain('gpt-5-mini');
    expect(output).toContain('autoLint');
    expect(output).toContain('autoTest');
    expect(output).toContain('reasoningEffort');
    expect(output).toContain(rcPath);
  });

  it('resets a setting to its default and removes persisted override', () => {
    const defaults = getDefaultConfig();
    setSetting('sandbox', 'true');
    setSetting('theme', 'light');

    expect(resetSetting('sandbox')).toContain('reset sandbox');
    const saved = JSON.parse(fs.readFileSync(rcPath, 'utf8')) as Record<string, unknown>;
    expect(saved.sandbox).toBeUndefined();
    expect(saved.theme).toBe('light');
    expect(config.sandbox).toBe(defaults.sandbox);
  });
});
