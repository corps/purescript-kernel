declare module "jmp" {
  export class Socket {
    constructor(name: string, hashingSchema?: string, key?: string);
    addListener(event: string, listener: Function): this;
    on(event: string, listener: Function): this;
    once(event: string, listener: Function): this;
    removeListener(event: string, listener: Function): this;
    removeAllListeners(event?: string): this;
    send(message: Message, flags: number): this;

    bindSync(address: string): this;
    close(): void;
  }

  export interface MessageHeader {
    msg_id: string
    username: string
    session: string
    msg_type: string
    version: string
  }

  export class Message<ContentType = object> {
    header: MessageHeader;
    parent_header: MessageHeader;
    metadata: object;
    content: ContentType;
    buffers: object[];
    idents: object[];

    respond(socket: Socket, messageType: string, content: object, metadata?: object, protocolVersion?: string): void;
  }

  export interface ExecuteContent {
    code: string
  }

  export interface CompleteContent {
    code: string
    cursor_pos: number
  }

  export interface ShutdownContent {
    restart: boolean
  }
}
