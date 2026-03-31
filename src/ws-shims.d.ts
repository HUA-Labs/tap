declare module "ws" {
  import type { EventEmitter } from "node:events";
  import type { Duplex } from "node:stream";
  import type { IncomingMessage } from "node:http";

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    readonly readyState: number;

    constructor(url: string, options?: { perMessageDeflate?: boolean });

    send(data: RawData, options?: { binary?: boolean }): void;
    close(code?: number, reason?: string): void;

    on(
      event: "message",
      listener: (data: RawData, isBinary: boolean) => void,
    ): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
  }

  export interface WebSocketServerOptions {
    host?: string;
    port?: number;
    path?: string;
    perMessageDeflate?: boolean;
    noServer?: boolean;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: WebSocketServerOptions);

    on(
      event: "connection",
      listener: (socket: WebSocket, request: IncomingMessage) => void,
    ): this;
    on(event: "listening", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;

    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (socket: WebSocket, request: IncomingMessage) => void,
    ): void;

    close(callback?: () => void): void;
  }
}
