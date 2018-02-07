declare module "zeromq" {
  export function createSocket(name: string): ZeroMqSocket
  export interface ZeroMqSocket {
    bindSync: (address: string) => void;
    on: (event: string, handler: Function) => void;
    send: (msg: any) => void;
    removeAllListeners: () => void
    close(): void
  }
}