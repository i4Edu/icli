import { beforeEach, describe, expect, it } from 'vitest';
import { pickModel, setProfile, getProfile } from '../../src/routing/router.js';

beforeEach(() => {
  setProfile('fixed');
});

describe('router', () => {
  it('fixed profile returns the session default', () => {
    expect(pickModel('gpt-4o-mini', 'chat')).toBe('gpt-4o-mini');
    expect(pickModel('custom-x', 'edit')).toBe('custom-x');
  });

  it('balanced profile routes edit/review to gpt-4o', () => {
    setProfile('balanced');
    expect(pickModel('any', 'edit')).toBe('gpt-4o');
    expect(pickModel('any', 'review')).toBe('gpt-4o');
    expect(pickModel('any', 'chat')).toBe('gpt-4o-mini');
  });

  it('setProfile/getProfile roundtrip + rejects unknown', () => {
    setProfile('strong');
    expect(getProfile()).toBe('strong');
    expect(() => setProfile('nope')).toThrow(/Unknown routing profile/);
  });
});
