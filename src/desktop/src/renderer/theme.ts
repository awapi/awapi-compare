import type { DiffStatus } from '@awapi/shared';
import type { ThemeName } from './state/themeStore.js';

/**
 * Beyond-Compare-inspired palette. The dark variant is the default;
 * a light variant is exposed for theme switching.
 */
export interface DiffPalette {
  background: string;
  panel: string;
  panelAlt: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  status: Record<DiffStatus, string>;
}

export const darkPalette: DiffPalette = {
  background: '#1e1e1e',
  panel: '#252526',
  panelAlt: '#2d2d30',
  text: '#e6e6e6',
  textMuted: '#9da0a4',
  border: '#3c3c3c',
  accent: '#4e9af1',
  status: {
    identical: '#d4d4d4',
    different: '#e74c3c',
    'left-only': '#c792ea',
    'right-only': '#7fdbca',
    'newer-left': '#f1c40f',
    'newer-right': '#f39c12',
    excluded: '#6a6a6a',
    error: '#ff6b6b',
  },
};

export const lightPalette: DiffPalette = {
  background: '#ffffff',
  panel: '#f5f5f5',
  panelAlt: '#ebebeb',
  text: '#1e1e1e',
  textMuted: '#555555',
  border: '#d0d0d0',
  accent: '#0066cc',
  status: {
    identical: '#2c2c2c',
    different: '#c0392b',
    'left-only': '#8e44ad',
    'right-only': '#16a085',
    'newer-left': '#b7950b',
    'newer-right': '#ca8a04',
    excluded: '#888888',
    error: '#c0392b',
  },
};

export function statusLabel(status: DiffStatus): string {
  switch (status) {
    case 'left-only':
      return 'Left only';
    case 'right-only':
      return 'Right only';
    case 'identical':
      return 'Identical';
    case 'different':
      return 'Different';
    case 'newer-left':
      return 'Newer on left';
    case 'newer-right':
      return 'Newer on right';
    case 'excluded':
      return 'Excluded';
    case 'error':
      return 'Error';
  }
}

export function getPalette(theme: ThemeName): DiffPalette {
  return theme === 'light' ? lightPalette : darkPalette;
}
