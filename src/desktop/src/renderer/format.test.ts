import { describe, expect, it } from 'vitest';
import { formatMtime, formatSize, statusGlyph } from './format.js';

describe('format', () => {
  describe('formatSize', () => {
    it('returns empty string for undefined', () => {
      expect(formatSize(undefined)).toBe('');
    });

    it('formats bytes under 1 KiB', () => {
      expect(formatSize(0)).toBe('0 B');
      expect(formatSize(512)).toBe('512 B');
      expect(formatSize(1023)).toBe('1023 B');
    });

    it('formats KiB with one decimal when < 10', () => {
      expect(formatSize(1024)).toBe('1.0 KiB');
      expect(formatSize(1536)).toBe('1.5 KiB');
    });

    it('formats larger units with no decimal when >= 10', () => {
      expect(formatSize(50 * 1024)).toBe('50 KiB');
      expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MiB');
      expect(formatSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GiB');
    });

    it('caps at TiB', () => {
      expect(formatSize(5 * 1024 ** 4)).toBe('5.0 TiB');
    });
  });

  describe('formatMtime', () => {
    it('returns empty string for undefined', () => {
      expect(formatMtime(undefined)).toBe('');
    });

    it('formats epoch ms as local YYYY-MM-DD HH:MM', () => {
      // Build a known local date to avoid TZ flakiness.
      const d = new Date(2024, 0, 5, 9, 7);
      expect(formatMtime(d.getTime())).toBe('2024-01-05 09:07');
    });
  });

  describe('statusGlyph', () => {
    it('returns a distinct glyph for every status', () => {
      const statuses = [
        'identical',
        'different',
        'left-only',
        'right-only',
        'newer-left',
        'newer-right',
        'excluded',
        'error',
      ] as const;
      const glyphs = statuses.map(statusGlyph);
      expect(new Set(glyphs).size).toBe(statuses.length);
    });
  });
});
