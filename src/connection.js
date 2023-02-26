"use strict";

const { Events, ConnectionEvents, MessageTypes, ErrorMessages, Options } = require("./constants.js");
const interfaces = require("./interfaces.js");

class Connection {
	constructor(socket, server) {
		this.server = server;
		this.connection = socket;
		this.connection.on(ConnectionEvents.ERROR, this._onerror.bind(this));
		this.connection.on(ConnectionEvents.CLOSE, this._onclose.bind(this));
		this.connection.on(ConnectionEvents.DATA, this._init.bind(this));
		this.connection.on(ConnectionEvents.DRAIN, this._drain.bind(this));
		this._error = null;
		this._end = null;
		this._retries = this.server.options.retries;
		this._closed = false;
	}
	pause() {
		this.connection.pause();
	}
	resume() {
		this.connection.resume();
	}
	_init() {
		const socket = this.connection;
		const test = socket.read(3);
		if(!test) { return; }
		const string = test.toString();
		if(string === "GET") {
			const CRLF = Buffer.from("\r\n\r\n");
			let head = socket._readableState.buffer.head;
			let buff = Buffer.allocUnsafe(0);
			do {
				buff = Buffer.concat([buff, head.data]);
				const index = buff.indexOf(CRLF);
				if(index > -1) {
					const headers = socket.read(index + 4);
					if(!headers) { continue; }
					const str = headers.toString();
					if(str.includes("Connection: Upgrade") && str.includes("Upgrade: net-ipc")) {
						socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: net-ipc\r\n\r\n");
						socket._events[ConnectionEvents.DATA] = this._read.bind(this);
						this._read();
						return;
					} else {
						socket.end("HTTP/1.1 418 I'm a Teapot");
					}
				}
			} while((head = head.next));
		} else if(string === "IPC") {
			socket._events[ConnectionEvents.DATA] = this._read.bind(this);
			this._read();
		} else {
			socket.end("HTTP/1.1 418 I'm a Teapot");
		}
	}
	_onerror(e) {
		this._error = e;
		if(this.server._events[Events.ERROR]) {
			this.server.emit(Events.ERROR, e, this);
		}
		if(!this.server.connections.find(c => c.id === this.id)) {
			this.close(ErrorMessages.ORPHAN_CONNECTION);
		}
	}
	_onclose() {
		this.connection.removeAllListeners();
		this.connection.destroy();
		this.connection = null;
		const array = this.server.connections;
		const index = array.findIndex(c => c.id === this.id);
		if(index > -1) {
			this.server.emit(Events.DISCONNECT, this, this._end || this._error);
			array[index] = array[array.length - 1];
			array.pop();
		}
	}
	_parse(data) {
		if(!this.connectedAt && data.t !== MessageTypes.CONNECTION) {
			this.connection.emit(ConnectionEvents.ERROR, new Error(ErrorMessages.PREMATURE_PACKET));
			return;
		}
		switch(data.t) {
			case MessageTypes.CONNECTION: {
				if(data.d.id) { this.id = data.d.id; }
				const reply = {
					id: this.id,
					compress: data.d.compress && Boolean(this._zlib),
					messagepack: data.d.messagepack && Boolean(this._msgpack)
				};
				this._write(MessageTypes.CONNECTION, reply, data.n).catch(e => {
					this.connection.emit(ConnectionEvents.ERROR, e);
					this.connection.destroy(e);
				});
				if(reply.compress) {
					this.connection.zlib = {
						deflate: new this._zlib.DeflateRaw(),
						inflate: new this._zlib.InflateRaw()
					};
				}
				if(reply.messagepack) {
					this.connection.msgpack = this._msgpack;
				}
				this.connection.emit(ConnectionEvents.READY, data.d.extras);
				break;
			}
			case MessageTypes.MESSAGE: {
				this.server.emit(Events.MESSAGE, data.d, this);
				break;
			}
			case MessageTypes.REQUEST: {
				if(this.server._events[Events.REQUEST]) {
					this.server.emit(Events.REQUEST, data.d, response => this._tryWrite(MessageTypes.RESPONSE, response, data.n), this);
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
				}
				break;
			}
		}
	}
	async _tryWrite(op, data, nonce, r = 0) {
		if(this._closed) { throw new Error(ErrorMessages.CONNECTION_CLOSED); }
		try {
			const sent = await this._write(op, data, nonce);
			return sent;
		} catch(e) {
			if(this._retries && this._retries > r) {
				for(let i = r; i < this._retries; i++) {
					await new Promise(resolve => { setTimeout(resolve, Options.RETRY_INCREMENT * (i + 1)); });
					const connection = this.server.connections.find(c => c.id === this.id);
					if(connection) { return connection._tryWrite(op, data, nonce, i); }
				}
			}
			return new Error(e);
		}
	}
}

for(const [method, value] of Object.entries(interfaces)) {
	Connection.prototype[method] = value;
}

module.exports = Connection;
