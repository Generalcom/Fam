import { useColorScheme } from 'react-native';

import { palette, type Theme } from '@/constants/theme';

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}
