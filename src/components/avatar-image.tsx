import { SvgXml } from 'react-native-svg';

import { avatarSvg, type AvatarConfig } from '@/lib/avatar';

/** A person's chosen icon, drawn from its options. */
export function AvatarImage({ config, size }: { config: AvatarConfig; size: number }) {
  return <SvgXml xml={avatarSvg(config)} width={size} height={size} />;
}
