import {describe, expect, it} from 'bun:test';
import {relativeTime} from '../src/lib/relative-time.ts';

describe('relativeTime', function () {
  const now = Date.parse('2026-09-04T12:00:00.000Z');

  it('should say "just now" when under a minute has passed', function () {
    expect(relativeTime('2026-09-04T11:59:40.000Z', now)).toBe('just now');
  });

  it('should count minutes when under an hour has passed', function () {
    expect(relativeTime('2026-09-04T11:20:00.000Z', now)).toBe('40m');
  });

  it('should count hours when under a day has passed', function () {
    expect(relativeTime('2026-09-04T04:00:00.000Z', now)).toBe('8h');
  });

  it('should count days when under a week has passed', function () {
    expect(relativeTime('2026-09-01T12:00:00.000Z', now)).toBe('3d');
  });

  it('should fall back to a date when more than a week has passed', function () {
    expect(relativeTime('2026-07-01T12:00:00.000Z', now)).not.toMatch(/^\d+[mhd]$/);
  });

  it('should return an empty string when the timestamp cannot be read', function () {
    expect(relativeTime('not a date', now)).toBe('');
  });
});
