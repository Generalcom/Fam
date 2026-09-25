export const palette = {
  light: {
    background: '#F6F7F9',
    surface: '#FFFFFF',
    text: '#111827',
    textSecondary: '#5B6472',
    border: '#E2E5EA',
    primary: '#0B7A6E',
    primaryText: '#FFFFFF',
    danger: '#B91C1C',
    warningBg: '#FEF3C7',
    warningText: '#78350F',
  },
  dark: {
    background: '#0B0F14',
    surface: '#151B23',
    text: '#F3F4F6',
    textSecondary: '#A1A9B5',
    border: '#243041',
    primary: '#2DD4BF',
    primaryText: '#062925',
    danger: '#F87171',
    warningBg: '#3A2F0B',
    warningText: '#FDE68A',
  },
} as const;

export type Theme = { [K in keyof typeof palette.light]: string };

/** The sign-in and onboarding screens: plain black on white (white on black in dark mode), no accent colour. */
export const authPalette = {
  light: {
    background: '#FFFFFF',
    text: '#0D0D0D',
    muted: '#6B6B6B',
    border: '#BDBDBD',
    solidBg: '#0D0D0D',
    solidText: '#FFFFFF',
  },
  dark: {
    background: '#0D0D0D',
    text: '#F5F5F5',
    muted: '#A6A6A6',
    border: '#4A4A4A',
    solidBg: '#FFFFFF',
    solidText: '#0D0D0D',
  },
} as const;

export type AuthTheme = { [K in keyof typeof authPalette.light]: string };

// All dark enough for white text at WCAG AA.
export const MEMBER_COLORS = [
  '#B91C1C',
  '#B45309',
  '#047857',
  '#1D4ED8',
  '#7C3AED',
  '#BE185D',
  '#0F766E',
  '#C2410C',
] as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
