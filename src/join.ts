// SHIM until the next Fizlet vendor sync: fizlet/presence `join(url, signal, protocols)` (fizlet#113).
// The vendored join() (Fizlet 0.19.0) takes no protocols, so this one hands them to the WebSocket it
// makes: join() builds its socket synchronously, so WebSocket is swapped only for that one call.
// At the sync, delete this file and export join from ../vendor/fizlet/presence again (src/net.ts).
import { join as vendorJoin } from "../vendor/fizlet/presence";

export function join(url: string, signal?: AbortSignal, protocols?: string | string[]) {
  if (!protocols) return vendorJoin(url, signal);
  const W = globalThis.WebSocket;
  globalThis.WebSocket = class extends W {
    constructor(u: string | URL) {
      super(u, protocols);
    }
  };
  try {
    return vendorJoin(url, signal);
  } finally {
    globalThis.WebSocket = W;
  }
}
