"use strict";

const net = require("net");
const tls = require("tls");
const Emitter = require("events");
const interfaces = require("./interfaces.js");
const {
	Options,
	Events,
	ConnectionEvents,
	MessageTypes,
	ErrorMessages,
	ClientStatus
} = require("./constants.js");

class Client extends Emitter {
	constructor(options = {}) {
		super();
		this.connection = null;
		this.id = null;
		this.status = ClientStatus.IDLE;
		this.options = {
			path: options.path,
			host: options.host,
			port: options.port,
			options: options.options || {},
			tls: Boolean(options.tls),
			handshake: Boolean(options.handshake),
			compress: Boolean(options.compress),
			messagepack: Boolean(options.messagepack),
			reconnect: typeof options.reconnect !== "undefined" ? Boolean(options.reconnect) : true,
			retries: Number(options.retries) > 0 ? Number(options.retries) : Options.DEFAULT_RETRIES,
			maxRetryTime: Number(options.maxRetryTime) >= Options.RETRY_INCREMENT ? Number(options.maxRetryTime) : Options.DEFAULT_MAXRETRYTIME
		};
		this._error = null;
		this._end = null;
		this._promise = null;
		this._retries = 0;
		this._payload = null;
		if(typeof this.options.options !== "object") { throw new Error(ErrorMessages.BAD_OPTIONS); }
		if(!this.options.path && !this.options.host) { this.options.path = Options.DEFAULT_PATH; }
		if(this.options.host && !this.options.port) { this.options.port = Options.DEFAULT_PORT; }
		if(this.options.host && typeof this.options.host !== "string") { throw new Error(ErrorMessages.BAD_URL); }
		if(this.options.path && typeof this.options.path !== "string") { throw new Error(ErrorMessages.BAD_PATH); }
		if(this.options.path && process.platform === "win32") { this.options.path = `\\\\.\\pipe\\${this.options.path.replace(/^\//, "").replace(/\//g, "-")}`; }
	}
	connect(data) {
		return new Promise((ok, nope) => {
			if(this.status !== ClientStatus.IDLE) {
				nope(ErrorMessages.NOT_IDLE);
				return;
			}
			if(this._closed) {
				this._closed = false;
			}
			this._promise = {
				resolve: ok,
				reject: nope
			};
			this._payload = data;
			this._setStatus(ClientStatus.CONNECTING);
			const options = Object.assign({}, this.options.options);
			if(this.options.host) {
				options.host = options.servername = this.options.host;
				options.port = this.options.port;
			} else {
				options.path = this.options.path;
			}
			if(this.options.tls) {
				this.connection = tls.connect(options);
			} else {
				this.connection = net.connect(options);
			}
			this.connection.setKeepAlive(true);
			this.connection.on(ConnectionEvents.ERROR, this._onerror.bind(this));
			this.connection.on(ConnectionEvents.CLOSE, this._onclose.bind(this));
			this.connection.once(ConnectionEvents.READY, this._ready.bind(this));
		});
	}
	_onerror(e) {
		this._error = e;
		if(this._events[Events.ERROR]) {
			this.emit(Events.ERROR, e);
		}
	}
	_onclose() {
		this._setStatus(ClientStatus.DISCONNECTED);
		this.connection.removeAllListeners();
		this.connection.destroy();
		this.connection = null;
		const error = this._error;
		const end = this._end;
		const promise = this._promise;
		this._error = null;
		this._end = null;
		this._promise = null;
		if(this.options.reconnect && !this._closed) {
			this._setStatus(ClientStatus.RECONNECTING);
			setTimeout(() => {
				this._setStatus(ClientStatus.IDLE);
				const exceeded = this._retries > this.options.retries;
				if(exceeded) {
					if(promise) {
						this._retries = 0;
						promise.reject(error || ErrorMessages.UNKNOWN_ERROR);
					} else {
						this.emit(Events.CLOSE, end || error);
					}
				} else if(promise) {
					promise.resolve(this.connect(this._payload));
				} else {
					this.connect(this._payload).catch(e => {
						this.emit(Events.CLOSE, e);
					});
				}
			}, Math.min(Options.RETRY_INCREMENT * ++this._retries, this.options.maxRetryTime));
		} else {
			this._setStatus(ClientStatus.IDLE);
			this._retries = 0;
			this.emit(Events.CLOSE, end || error);
		}
	}
	_ready() {
		this._setStatus(ClientStatus.CONNECTED);
		if(this.options.handshake) {
			const socket = this.connection;
			const host = this.options.host || "net-ipc";
			const data = Buffer.from(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: net-ipc\r\n\r\n`);
			socket.on(ConnectionEvents.DATA, () => {
				const test = socket.read(32);
				if(!test) { return; }
				if(test.toString() === "HTTP/1.1 101 Switching Protocols") {
					const CRLF = Buffer.from("\r\n\r\n");
					let buff = Buffer.allocUnsafe(0);

					// Compatibility between node < 20.11 and node >= 20.11
					const readable = socket._readableState
					let currentBufferIndex = readable.bufferIndex
					let currentBuffer = readable.buffer.head || readable.buffer[currentBufferIndex];

					do {
						const data = currentBuffer.data || currentBuffer

						buff = Buffer.concat([buff, data]);
						const index = buff.indexOf(CRLF);
						if(index > -1) {
							const headers = socket.read(index + 4);
							if(!headers) { continue; }
							this.connection.removeAllListeners(ConnectionEvents.DATA);
							this._init();
							return;
						}
					} while(currentBuffer = (currentBuffer.next || readable.buffer[++currentBufferIndex]));
				} else {
					const str = test.toString();
					this._error = str.slice(0, str.indexOf("\r\n"));
					this.connection.destroy();
				}
			});
			socket.write(data);
		} else {
			this.connection.write(Buffer.from("IPC"));
			this._init();
		}
	}
	_init() {
		this.connection.on(ConnectionEvents.DATA, this._read.bind(this));
		this.connection.on(ConnectionEvents.DRAIN, this._drain.bind(this));
		this.connection.once(ConnectionEvents.DONE, extras => {
			this.id = extras.id;
			if(this.options.compress && !extras.compress) {
				this.options.compress = false;
				console.warn(ErrorMessages.ZLIB_MISSING);
			}
			if(this.options.messagepack && !extras.messagepack) {
				this.options.messagepack = false;
				console.warn(ErrorMessages.MSGPACK_MISSING);
			}
			this._setStatus(ClientStatus.READY);
			this._promise.resolve(this);
			this._promise = null;
			this._retries = 0;
			this.emit(Events.READY, extras);
		});
		const payload = {
			compress: this.options.compress && Boolean(this._zlib),
			messagepack: this.options.messagepack && Boolean(this._msgpack),
			extras: this._payload,
			id: this.id
		};
		this._write(MessageTypes.CONNECTION, payload).catch(e => {
			this._error = e;
			this.connection.destroy();
		});
	}
	_setStatus(status) {
		this.status = status;
		this.emit(Events.STATUS, status);
	}
	_parse(data) {
		switch(data.t) {
			case MessageTypes.CONNECTION: {
				if(data.d.compress) {
					this.connection.zlib = {
						deflate: new this._zlib.DeflateRaw(),
						inflate: new this._zlib.InflateRaw()
					};
				}
				if(data.d.messagepack) {
					this.connection.msgpack = this._msgpack;
				}
				this.connection.emit(ConnectionEvents.DONE, data.d);
				break;
			}
			case MessageTypes.MESSAGE: {
				this.emit(Events.MESSAGE, data.d);
				break;
			}
			case MessageTypes.REQUEST: {
				if(this._events[Events.REQUEST]) {
					this.emit(Events.REQUEST, data.d, response => this._tryWrite(MessageTypes.RESPONSE, response, data.n));
				} else {
					this._tryWrite(MessageTypes.RESPONSE, void 0, data.n).catch(e => this.connection.emit(ConnectionEvents.ERROR, e));
				}
				break;
			}
			case MessageTypes.RESPONSE: {
				const stored = this._requests[data.n];
				if(stored) {
					if(stored.timer) { clearTimeout(stored.timer); }
					stored.resolve(data.d);
					delete this._requests[data.n];
				}
				break;
			}
			case MessageTypes.PING: {
				this._tryWrite(MessageTypes.PONG, data.d, data.n).catch(e => this.connection.emit(ConnectionEvents.ERROR, e));
				break;
			}
			case MessageTypes.PONG: {
				const stored = this._requests[data.n];
				if(stored) {
					if(stored.timer) { clearTimeout(stored.timer); }
					stored.resolve(Date.now() - stored.date);
					delete this._requests[data.n];
				}
				break;
			}
			case MessageTypes.END: {
				if(data.d) {
					this._end = data.d.m;
					this._closed = !data.d.a;
				}
				break;
			}
		}
	}
	async _tryWrite(op, data, nonce, r = 0) {
		if(this._closed) { throw new Error(ErrorMessages.CONNECTION_CLOSED); }
		try {
			if(this.status !== ClientStatus.READY) { throw new Error(ErrorMessages.NOT_READY); }
			const sent = await this._write(op, data, nonce);
			return sent;
		} catch(e) {
			if(this.options.reconnect && this.options.retries > r) {
				const retries = r + 1;
				await new Promise(resolve => { setTimeout(resolve, Math.min(Options.RETRY_INCREMENT * retries, this.options.maxRetryTime)); });
				return this._tryWrite(op, data, nonce, retries);
			}
			return new Error(e);
		}
	}
}

for(const [method, value] of Object.entries(interfaces)) {
	Client.prototype[method] = value;
}

module.exports = Client;
