"use strict";

const { Socket } = require("net");
const Emitter = require("events");
const interfaces = require("./interfaces.js");
const { Options, Events, ConnectionEvents, MessageTypes, ErrorMessages } = require("./constants.js");

class Client extends Emitter {
	constructor(options = {}) {
		super();
		this.connection = null;
		this.options = options;
		if(!this.options.url && !this.options.path) { this.options.path = Options.DEFAULT_PATH; }
		if(this.options.url && typeof this.options.url !== "string") { throw ErrorMessages.BAD_URL; }
		if(this.options.path && typeof this.options.path !== "string") { throw ErrorMessages.BAD_PATH; }
		if(this.options.path && process.platform === "win32") { this.options.path = `\\\\.\\pipe\\${this.options.path.replace(/^\//, "").replace(/\//g, "-")}`; }
		if(this.options.compress) { this.options.compress = Boolean(this.options.compress); }
	}
	connect(data) {
		return new Promise((ok, nope) => {
			if(this.connection) {
				this.connection.end();
				setTimeout(() => ok(this.connect(data)), 500);
				return;
			}
			this.connection = new Socket();
			this.connection.setKeepAlive(true);
			this.connection.on(ConnectionEvents.READABLE, this._read.bind(this, this.connection));
			this.connection.on(ConnectionEvents.DRAIN, this._drain.bind(this));
			this.connection.on(ConnectionEvents.CLOSE, e => {
				nope(e || ErrorMessages.NO_RESPONSE);
			});
			this.connection.on(ConnectionEvents.ERROR, e => {
				this.connection.end();
				nope(e || ErrorMessages.UNKNOWN_ERROR);
			});
			this.connection.once(ConnectionEvents.READY, () => {
				this._write(MessageTypes.CONNECTION, {
					compress: this.options.compress && Boolean(this._zlib),
					extras: data
				}).catch(e => {
					this.connection.emit(ConnectionEvents.ERROR, e);
					this.close(e);
				});
				this.connection.cork();
			});
			this.connection.once(ConnectionEvents.DONE, extras => {
				this.connection._events[ConnectionEvents.CLOSE] = this._onclose.bind(this);
				this.connection._events[ConnectionEvents.ERROR] = this._onerror.bind(this);
				this.connection.uncork();
				this.id = extras.id;
				if(this.options.compress && !extras.compress) {
					this.options.compress = false;
					console.warn(ErrorMessages.ZLIB_MISSING);
				}
				this.emit(Events.READY, extras);
				ok(this);
			});
			if(this.options.path) {
				this.connection.connect({ path: this.options.path });
			} else if(this.options.url) {
				const url = this.options.url.split(":");
				const port = url.pop();
				this.connection.connect({
					host: url.join(":"),
					port: port
				});
			}
		});
	}
	_onerror(e) {
		if(this._events[Events.ERROR]) {
			this.emit(Events.ERROR, e);
		}
	}
	_onclose(e) {
		this.connection.destroy();
		this.connection.removeAllListeners();
		this.connection = null;
		this.emit(Events.CLOSE, e || this._end);
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
			case MessageTypes.CONNECTION:
				if(data.d.compress) {
					this.connection.zlib = {
						deflate: new this._zlib.DeflateRaw(),
						inflate: new this._zlib.InflateRaw()
					};
				}
				this.connection.emit(ConnectionEvents.DONE, data.d);
				break;
			case MessageTypes.MESSAGE:
				this.emit(Events.MESSAGE, data.d);
				break;
			case MessageTypes.REQUEST:
				if(this._events[Events.REQUEST]) {
					this.emit(Events.REQUEST, data.d, response => this._write(MessageTypes.RESPONSE, response, data.n));
				} else {
					this._write(MessageTypes.RESPONSE, void 0, data.n).catch(e => this.connection.emit(ConnectionEvents.ERROR, e));
				}
				break;
			case MessageTypes.RESPONSE:
				if(this._requests[data.n]) {
					this._requests[data.n][0](data.d);
					delete this._requests[data.n];
				}
				break;
			case MessageTypes.PING:
				this._write(MessageTypes.PONG, data.d, data.n).catch(e => this.connection.emit(ConnectionEvents.ERROR, e));
				break;
			case MessageTypes.PONG:
				if(this._requests[data.n]) {
					this._requests[data.n][0](Date.now() - this._requests[data.n][2]);
					delete this._requests[data.n];
				}
				break;
			case MessageTypes.END:
				if(data.d) {
					this._end = data.d;
				}
				break;
		}
	}
}

for(const [method, value] of Object.entries(interfaces)) {
	Client.prototype[method] = value;
}

module.exports = Client;
