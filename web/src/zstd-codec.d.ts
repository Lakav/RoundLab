declare module 'zstd-codec' {
  export class ZstdCodec {
    decompress(data: Buffer | Uint8Array): Promise<Buffer>;
    compress(data: Buffer | Uint8Array): Promise<Buffer>;
  }
}
