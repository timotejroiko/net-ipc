declare module "net-ipc" {
	import type { EventEmitter } from "events";
	import type { Socket as NetClient, Server as NetServer, ServerOpts, NetConnectOpts, ListenOptions } from "net";
	import type { Server as TLSServer, TLSSocket, TlsOptions, ConnectionOptions } from "tls";
	export type PromiseSettled = {
		status: "fulfilled" | "rejected";
		value?: any;
		reason?: any;
	}
	export type ClientOptions = {
		path?: string;
		host?: string;
		port?: number;
		tls?: boolean;
		options?: NetConnectOpts | ConnectionOptions;
		handshake?: boolean;
		compress?: boolean;
		messagepack?: boolean;
		reconnect?: boolean;
		retries?: number;
		maxRetryTime?: number;
	}
	export type ClientReadyEvent = {
		id: string,
		compress: boolean,
		messagepack: boolean
	}
	export const enum ClientStatus {
		IDLE,
		CONNECTING,
		CONNECTED,
		READY,
		DISCONNECTED,
		RECONNECTING
	}
	export type ServerOptions = {
		path?: string;
		port?: number;
		tls?: boolean;
		options?: ServerOpts | TlsOptions;
		listenOptions?: Omit<ListenOptions, "port" | "path">;
		max?: number;
		retries?: number;
	}
	export class Client extends EventEmitter {
		constructor(options?: ClientOptions);
		on(event: 'ready', listener: (data: ClientReadyEvent) => void): this;
		on(event: 'error', listener: (error: ErrorEvent) => void): this;
		on(event: 'close', listener: (reason: any) => void): this;
		on(event: 'status', listener: (status: number) => void): this;
		on(event: 'message', listener: (data: any) => void): this;
		on(event: 'request', listener: (request: any, response: (data: any) => Promise<void>) => void): this;
		connect(payload?: any): Promise<this>;
		send(data: any): Promise<void>;
		request(data: any, timeout?: number): Promise<any>;
		ping(data?: any, timeout?: number): Promise<number>;
		close(reason?: any): Promise<boolean>;
		destroy(reason?: any): boolean;
		id?: string;
		status: ClientStatus;
		options: ClientOptions;
		connection: NetClient | TLSSocket;
	}
	export class Server extends EventEmitter {
		constructor(options?: ServerOptions);
		on(event: 'ready', listener: (address: string) => void): this;
		on(event: 'error', listener: (error: ErrorEvent, connection: Connection) => void): this;
		on(event: 'connect', listener: (connection: Connection, payload?: any) => void): this;
		on(event: 'disconnect', listener: (connection: Connection, reason?: any) => void): this;
		on(event: 'close', listener: () => void): this;
		on(event: 'message', listener: (message: any, connection: Connection) => void): this;
		on(event: 'request', listener: (request: any, response: (data: any) => Promise<void>, connection: Connection) => void): this;
		start(): Promise<this>;
		close(allowReconnect?: boolean): Promise<this>;
		broadcast(data: any): Promise<void>;
		survey(data: any, timeout?: number): Promise<Array<PromiseSettled>>;
		ping(data?: any, timeout?: number): Promise<Array<PromiseSettled>>;
		pause(): void;
		resume(): void;
		connections: Connection[];
		options: ServerOptions;
		server: NetServer | TLSServer;
	}
	export class Connection {
		send(data: any): Promise<void>;
		request(data: any, timeout?: number): Promise<any>;
		ping(data?: any, timeout?: number): Promise<number>;
		close(reason?: any, allowReconnect?: boolean): Promise<boolean>;
		destroy(reason?: any): boolean;
		pause(): void;
		resume(): void;
		id: string;
		server: Server;
		connection: NetClient | TLSSocket;
	}
}
