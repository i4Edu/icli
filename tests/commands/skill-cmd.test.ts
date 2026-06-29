import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activateSkill,
  addSkill,
  deactivateSkill,
  getActiveSkillContext,
  listSkills,
  loadSkills,
  removeSkill,
  saveSkills,
  skillCommand,
  type Skill,
} from '../../src/commands/skill-cmd.js';

let testDir: string;
let originalSkillsPath: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(process.cwd(), '.test-skill-cmd-'));
  originalSkillsPath = process.env.ICOPILOT_SKILLS_PATH;
  process.env.ICOPILOT_SKILLS_PATH = path.join(testDir, 'skills.json');
});

afterEach(() => {
  if (originalSkillsPath === undefined) {
    delete process.env.ICOPILOT_SKILLS_PATH;
  } else {
    process.env.ICOPILOT_SKILLS_PATH = originalSkillsPath;
  }
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('skill-cmd', () => {
  it('saves and loads skills', () => {
    const skills: Skill[] = [
      {
        name: 'build-guide',
        description: 'Build guide',
        source: 'file',
        path: 'C:\\skills\\build.md',
        active: true,
      },
      {
        name: 'release-guide',
        description: 'Release guide',
        source: 'url',
        path: 'file:///release.md',
        active: false,
      },
    ];

    saveSkills(skills);

    expect(loadSkills()).toEqual([skills[0], skills[1]]);
  });

  it('adds file, directory, and file-url skills', () => {
    const filePath = path.join(testDir, 'build.md');
    fs.writeFileSync(filePath, '# Build guide\nUse npm run build.\n', 'utf8');

    const dirPath = path.join(testDir, 'deploy-skill');
    fs.mkdirSync(dirPath);
    fs.writeFileSync(
      path.join(dirPath, 'README.md'),
      '# Deploy guide\nUse safe rollout.\n',
      'utf8',
    );
    fs.writeFileSync(path.join(dirPath, 'checks.txt'), 'Verify health checks.\n', 'utf8');

    const urlPath = path.join(testDir, 'review.md');
    fs.writeFileSync(urlPath, '# Review guide\nCheck the diff first.\n', 'utf8');

    const fileSkill = addSkill(filePath);
    const dirSkill = addSkill(dirPath);
    const urlSkill = addSkill(pathToFileURL(urlPath).toString());

    expect('error' in fileSkill ? fileSkill.error : fileSkill.name).toBe('build');
    expect('error' in dirSkill ? dirSkill.error : dirSkill.source).toBe('directory');
    expect('error' in urlSkill ? urlSkill.error : urlSkill.source).toBe('url');
    expect(listSkills()).toContain('build');
    expect(listSkills()).toContain('deploy-skill');
    expect(listSkills()).toContain('review');
  });

  it('activates, deactivates, removes skills, and builds active context', () => {
    const buildPath = path.join(testDir, 'build.md');
    fs.writeFileSync(buildPath, '# Build guide\nUse npm run build.\n', 'utf8');

    const dirPath = path.join(testDir, 'ops');
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, 'README.md'), '# Ops guide\nMonitor latency.\n', 'utf8');

    addSkill(buildPath);
    addSkill(dirPath);

    expect(getActiveSkillContext()).toContain('Skill: build');
    expect(getActiveSkillContext()).toContain('Use npm run build.');
    expect(getActiveSkillContext()).toContain('Skill: ops');

    expect(deactivateSkill('build')).toBe(true);
    expect(listSkills()).toContain('inactive');
    expect(getActiveSkillContext()).not.toContain('Skill: build');
    expect(getActiveSkillContext()).toContain('Skill: ops');

    expect(activateSkill('build')).toBe(true);
    expect(getActiveSkillContext()).toContain('Skill: build');
    expect(removeSkill('ops')).toBe(true);
    expect(removeSkill('ops')).toBe(false);
  });

  it('dispatches skillCommand subcommands and usage', () => {
    const skillPath = path.join(testDir, 'security.md');
    fs.writeFileSync(skillPath, '# Security guide\nNever commit secrets.\n', 'utf8');

    expect(skillCommand([])).toContain('Skill command');
    expect(skillCommand(['list'])).toContain('No skills saved');
    expect(skillCommand(['add', skillPath])).toContain('added skill security');
    expect(skillCommand(['deactivate', 'security'])).toContain('deactivated skill security');
    expect(skillCommand(['activate', 'security'])).toContain('activated skill security');
    expect(skillCommand(['remove', 'security'])).toContain('removed skill security');
    expect(skillCommand(['wat'])).toContain('usage: /skill');
  });

  it('returns errors for missing sources and unknown names', () => {
    expect(addSkill(path.join(testDir, 'missing.md'))).toEqual({
      error: expect.stringContaining('skill source not found'),
    });
    expect(skillCommand(['add'])).toContain('usage: /skill add');
    expect(skillCommand(['remove', 'missing'])).toContain('skill not found: missing');
    expect(skillCommand(['activate', 'missing'])).toContain('skill not found: missing');
    expect(skillCommand(['deactivate', 'missing'])).toContain('skill not found: missing');
  });
});
