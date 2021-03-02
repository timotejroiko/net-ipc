"use strict";

const { Events, ConnectionEvents, MessageTypes, ErrorMessages } = require("./constants.js");
const interfaces = require("./interfaces.js");

class Connection {
	constructor(socket, server) {
		this.server = server;
		this.connection = socket;
		this.id = this._nonce();
		this.connection.on(ConnectionEvents.ERROR, this._onerror.bind(this));
		this.connection.on(ConnectionEvents.CLOSE, this._onclose.bind(this));
		this.connection.on(ConnectionEvents.READABLE, this._read.bind(this, this.connection));
		this.connection.on(ConnectionEvents.DRAIN, this._drain.bind(this));
	}
	_onerror(e) {
		if(this.server._events[Events.ERROR]) {
			this.server.emit(Events.ERROR, e, this);
		}
		if(this.server.connections.findIndex(c => c.id === this.id) === -1) {
			this.close(ErrorMessages.ORPHAN_CONNECTION);
		}
	}
	_onclose(e) {
		this.connection.destroy();
		this.connection.removeAllListeners();
		this.connection = null;
		const index = this.server.connections.findIndex(c => c.id === this.id);
		if(index > -1) {
			this.server.emit(Events.DISCONNECT, this, e || this._end);
			this.server.connections.splice(index, 1);
		}
	}
	_parse(_data) {
		let data;
		try {
			data = JSON.parse(_data);
		} catch(e) {
			this.connection.emit(ConnectionEvents.ERROR, e);
			return;
		}
		if(data.t !== MessageTypes.CONNECTION && !this.connectedAt) {
			this.connection.emit(ConnectionEvents.ERROR, new Error(ErrorMessages.PREMATURE_PACKET));
			return;
		}
		switch(data.t) {
			case MessageTypes.CONNECTION: {
				const reply = {
					id: this.id,
					compress: data.d.compress && Boolean(this._zlib)
				};
				this._write(MessageTypes.CONNECTION, reply, data.n).catch(e => {
					this.connection.emit(ConnectionEvents.ERROR, e);
					this.close(e);
				});
				if(reply.compress) {
					this.connection.zlib = {
						deflate: new this._zlib.DeflateRaw(),
						inflate: new this._zlib.InflateRaw()
					};
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
					this.server.emit(Events.REQUEST, data.d, response => this._write(MessageTypes.RESPONSE, response, data.n), this);
				} else {
					this._write(MessageTypes.RESPONSE, void 0, data.n).catch(e => this.connection.emit(ConnectionEvents.ERROR, e));
				}
				break;
			}
			case MessageTypes.RESPONSE: {
				if(this._requests[data.n]) {
					this._requests[data.n][0](data.d);
					delete this._requests[data.n];
				}
				break;
			}
			case MessageTypes.PING: {
				this._write(MessageTypes.PONG, data.d, data.n).catch(e => this.connection.emit(ConnectionEvents.ERROR, e));
				break;
			}
			case MessageTypes.PONG: {
				if(this._requests[data.n]) {
					this._requests[data.n][0](Date.now() - this._requests[data.n][2]);
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
}

for(const [method, value] of Object.entries(interfaces)) {
	Connection.prototype[method] = value;
}

module.exports = Connection;
