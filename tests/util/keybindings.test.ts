import { describe, it, expect, beforeEach } from 'vitest';
import { attachKeybindings, getKeybindingMode, hasKeybindings, getKeybindingHelp, formatKeybindingInfo } from '../../src/util/keybindings';
import readline from 'node:readline';

describe('Keybindings module', () => {
  let rl: readline.Interface;

  beforeEach(() => {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
  });

  it('should attach vi keybindings', () => {
    const state = attachKeybindings(rl, 'vi');
    expect(state.mode).toBe('vi');
    expect(state.viMode).toBe('insert');
    expect(hasKeybindings(rl)).toBe(true);
    expect(getKeybindingMode(rl)).toBe('vi');
  });

  it('should attach emacs keybindings', () => {
    const state = attachKeybindings(rl, 'emacs');
    expect(state.mode).toBe('emacs');
    expect(hasKeybindings(rl)).toBe(true);
    expect(getKeybindingMode(rl)).toBe('emacs');
  });

  it('should handle default mode', () => {
    const state = attachKeybindings(rl, 'default');
    expect(state.mode).toBe('default');
    expect(getKeybindingMode(rl)).toBe('default');
  });

  it('should provide vi help text', () => {
    const help = getKeybindingHelp('vi');
    expect(help).toContain('Vi keybindings');
    expect(help).toContain('ESC');
    expect(help).toContain('dd');
    expect(help).toContain('navigation');
  });

  it('should provide emacs help text', () => {
    const help = getKeybindingHelp('emacs');
    expect(help).toContain('Emacs keybindings');
    expect(help).toContain('C-a');
    expect(help).toContain('C-e');
    expect(help).toContain('C-k');
  });

  it('should provide default help text', () => {
    const help = getKeybindingHelp('default');
    expect(help).toContain('Default keybindings');
  });

  it('should format keybinding info for vi mode', () => {
    const info = formatKeybindingInfo('vi');
    expect(info).toContain('Vi');
  });

  it('should format keybinding info for emacs mode', () => {
    const info = formatKeybindingInfo('emacs');
    expect(info).toContain('Emacs');
  });

  it('should format keybinding info for default mode', () => {
    const info = formatKeybindingInfo('default');
    expect(info).toContain('Default');
  });

  it('should detect no keybindings on fresh interface', () => {
    expect(hasKeybindings(rl)).toBe(false);
  });

  it('should return default mode when no keybindings attached', () => {
    expect(getKeybindingMode(rl)).toBe('default');
  });
});
