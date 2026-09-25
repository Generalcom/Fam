import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { bytesToBase64 } from '@/lib/id-number';

/**
 * Minivision's Silent-Face-Anti-Spoofing models (Apache-2.0), converted to ONNX. See assets/models/NOTICE.md.
 * `scale` is how much the face box is enlarged before the crop that model looks at.
 */
const MODELS = [
  { name: 'v2', scale: 2.7, source: require('../../assets/models/mini-fasnet-v2-2.7.onnx') as number },
  { name: 'v1se', scale: 4.0, source: require('../../assets/models/mini-fasnet-v1se-4.0.onnx') as number },
];

export type ModelChunk = { name: string; scale: number; index: number; total: number; data: string };

/** A piece is well under what a WebView will take in one call, and any split is fine: the page joins them. */
const PIECE = 240_000;

/** Reads both model files and cuts their base64 into pieces to hand to the selfie page. Resolves to [] if a file cannot be read. */
export async function loadModelChunks(): Promise<ModelChunk[]> {
  try {
    const chunks: ModelChunk[] = [];
    for (const model of MODELS) {
      const asset = Asset.fromModule(model.source);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const base64 = bytesToBase64(new Uint8Array(await new File(uri).arrayBuffer()));
      const total = Math.ceil(base64.length / PIECE);
      for (let index = 0; index < total; index++) {
        chunks.push({ name: model.name, scale: model.scale, index, total, data: base64.slice(index * PIECE, (index + 1) * PIECE) });
      }
    }
    return chunks;
  } catch {
    return [];
  }
}
