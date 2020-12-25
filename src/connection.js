"use strict";

const constants = require("./constants.js");
const interfaces = require("./interfaces.js");

class Connection {
	constructor(socket, server) {
		this.server = server;
		this.connection = socket;
		this.id = this._nonce();
		this.connection.on(constants.ConnectionEvents.ERROR, this._onerror.bind(this));
		this.connection.on(constants.ConnectionEvents.CLOSE, this._onclose.bind(this));
		this.connection.on(constants.ConnectionEvents.READABLE, this._read.bind(this, this.connection));
		this.connection.on(constants.ConnectionEvents.DRAIN, this._drain.bind(this));
	}
	_onerror(e) {
		if(this.server._events[constants.Events.ERROR]) {
			this.server.emit(constants.Events.ERROR, e, this);
		}
		if(this.server.connections.findIndex(c => c.id === this.id) === -1) {
			this.close(constants.ErrorMessages.ORPHAN_CONNECTION);
		}
	}
	_onclose(e) {
		this.connection.destroy();
		this.connection.removeAllListeners();
		this.connection = null;
		const index = this.server.connections.findIndex(c => c.id === this.id);
		if(index > -1) {
			this.server.emit(constants.Events.DISCONNECT, this, e || this._end);
			this.server.connections.splice(index, 1);
		}
	}
	_parse(_data) {
		let data;
		try {
			data = JSON.parse(_data);
		} catch(e) {
			this.connection.emit(constants.ConnectionEvents.ERROR, e);
			return;
		}
		if(data.t !== constants.MessageTypes.CONNECTION && !this.connectedAt) {
			this.connection.emit(constants.ConnectionEvents.ERROR, new Error(constants.ErrorMessages.PREMATURE_PACKET));
			return;
		}
		switch(data.t) {
			case constants.MessageTypes.CONNECTION: {
				const reply = {
					id: this.id,
					compress: data.d.compress && Boolean(this._zlib)
				};
				this._write(constants.MessageTypes.CONNECTION, reply, data.n).catch(e => this.connection.emit(constants.ConnectionEvents.ERROR, e));
				if(reply.compress) {
					this.connection.zlib = {
						deflate: new this._zlib.DeflateRaw(),
						inflate: new this._zlib.InflateRaw()
					};
				}
				this.connection.emit(constants.ConnectionEvents.READY, data.d.extras);
				break;
			}
			case constants.MessageTypes.MESSAGE: {
				this.server.emit(constants.Events.MESSAGE, data.d, this);
				break;
			}
			case constants.MessageTypes.REQUEST: {
				if(this.server._events[constants.Events.REQUEST]) {
					this.server.emit(constants.Events.REQUEST, data.d, response => this._write(constants.MessageTypes.RESPONSE, response, data.n), this);
				} else {
					this._write(constants.MessageTypes.RESPONSE, void 0, data.n).catch(e => this.connection.emit(constants.ConnectionEvents.ERROR, e));
				}
				break;
			}
			case constants.MessageTypes.RESPONSE: {
				if(this._requests[data.n]) {
					this._requests[data.n][0](data.d);
					delete this._requests[data.n];
				}
				break;
			}
			case constants.MessageTypes.PING: {
				this._write(constants.MessageTypes.PONG, data.d, data.n).catch(e => this.connection.emit(constants.ConnectionEvents.ERROR, e));
				break;
			}
			case constants.MessageTypes.PONG: {
				if(this._requests[data.n]) {
					this._requests[data.n][0](Date.now() - this._requests[data.n][2]);
					delete this._requests[data.n];
				}
				break;
			}
			case constants.MessageTypes.END: {
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
