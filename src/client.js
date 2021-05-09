"use strict";

const { Socket } = require("net");
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
		this._error = null;
		this._end = null;
		this._promise = null;
		this._compress = Boolean(options.compress);
		this._reconnect = typeof options.reconnect !== "undefined" ? Boolean(options.reconnect) : true;
		this._retries = Number.isInteger(options.retries) && options.retries > 0 ? options.retries : 3;
		this._url = options.url || null;
		this._path = options.path || (options.url ? null : Options.DEFAULT_PATH);
		if(this._url && typeof this._url !== "string") { throw new Error(ErrorMessages.BAD_URL); }
		if(this._path && typeof this._path !== "string") { throw new Error(ErrorMessages.BAD_PATH); }
		if(this._path && process.platform === "win32") { this._path = `\\\\.\\pipe\\${this._path.replace(/^\//, "").replace(/\//g, "-")}`; }
	}
	connect(data) {
		return new Promise((ok, nope) => {
			if(this.status !== ClientStatus.IDLE) {
				nope(ErrorMessages.NOT_IDLE);
				return;
			}
			this._promise = {
				resolve: ok,
				reject: nope,
				payload: data,
				retries: 0
			};
			this.connection = new Socket();
			this.connection.setKeepAlive(true);
			this.connection.on(ConnectionEvents.ERROR, this._onerror.bind(this));
			this.connection.on(ConnectionEvents.CLOSE, this._onclose.bind(this));
			this.connection.once(ConnectionEvents.READY, this._ready.bind(this));
			this._connect();
		});
	}
	_connect() {
		this._setStatus(ClientStatus.CONNECTING);
		if(this._path) {
			this.connection.connect({ path: this._path });
		} else if(this._url) {
			const url = this._url.split(":");
			const port = url.pop();
			this.connection.connect({
				host: url.join(":"),
				port: port
			});
		}
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
		if(this._reconnect) {
			this._setStatus(ClientStatus.RECONNECTING);
			if(promise) {
				setTimeout(() => {
					this._setStatus(ClientStatus.IDLE);
					if(promise.retries > this._retries) {
						promise.reject(error || ErrorMessages.UNKNOWN_ERROR);
					} else {
						promise.resolve(this.connect(promise.payload));
					}
				}, 500 * ++promise.retries);
			} else {
				setTimeout(() => {
					this.connect(this._payload).catch(() => { /* no-op */});
				}, 500);
			}
		} else {
			this._setStatus(ClientStatus.IDLE);
			this.emit(Events.CLOSE, end || error);
		}
	}
	_ready() {
		this._setStatus(ClientStatus.CONNECTED);
		this.connection.on(ConnectionEvents.READABLE, this._read.bind(this, this.connection));
		this.connection.on(ConnectionEvents.DRAIN, this._drain.bind(this));
		this.connection.once(ConnectionEvents.DONE, extras => {
			this.id = extras.id;
			if(this._compress && !extras.compress) {
				this._compress = false;
				console.warn(ErrorMessages.ZLIB_MISSING);
			}
			this._setStatus(ClientStatus.READY);
			this.emit(Events.READY, extras);
			this._promise.resolve(this);
		});
		const payload = {
			compress: this._compress && Boolean(this._zlib),
			extras: this._promise.payload,
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
	_parse(_data) {
		let data;
		try {
			data = JSON.parse(_data);
		} catch(e) {
			this.connection.emit(ConnectionEvents.ERROR, e);
			return;
		}
		switch(data.t) {
			case MessageTypes.CONNECTION: {
				if(data.d.compress) {
					this.connection.zlib = {
						deflate: new this._zlib.DeflateRaw(),
						inflate: new this._zlib.InflateRaw()
					};
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
					this._end = data.d;
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
			if(this._reconnect && this._retries > r) {
				const retries = r + 1;
				await new Promise(resolve => { setTimeout(resolve, 500 * retries); });
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
