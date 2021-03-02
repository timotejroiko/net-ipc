"use strict";

const { ConnectionEvents, MessageTypes, MessageDelimiter, ErrorMessages } = require("./constants.js");
let _zlib;

try {
	_zlib = require("fast-zlib");
} catch(e) { /* no-op */ }

module.exports = {
	send(data) {
		return this._write(MessageTypes.MESSAGE, data);
	},
	request(data, timeout = 10000) {
		if(!Number.isInteger(timeout)) { return Promise.reject(ErrorMessages.BAD_TIMEOUT); }
		return new Promise((ok, nope) => {
			const nonce = this._nonce();
			this._requests[nonce] = [ok, nope];
			this._write(MessageTypes.REQUEST, data, nonce).catch(e => {
				delete this._requests[nonce];
				nope(e);
			});
			setTimeout(() => {
				if(this._requests[nonce]) {
					this._requests[nonce][1](ErrorMessages.TIMEOUT);
					delete this._requests[nonce];
				}
			}, timeout);
		});
	},
	ping(data, timeout = 10000) {
		return new Promise((ok, nope) => {
			const nonce = this._nonce();
			this._requests[nonce] = [ok, nope, Date.now()];
			this._write(MessageTypes.PING, data, nonce).catch(e => {
				delete this._requests[nonce];
				nope(e);
			});
			setTimeout(() => {
				if(this._requests[nonce]) {
					this._requests[nonce][1](ErrorMessages.TIMEOUT);
					delete this._requests[nonce];
				}
			}, timeout);
		});
	},
	close(data) {
		this.connection.closing = true;
		return Promise.allSettled(this._drainQueue).then(() => {
			let packet = JSON.stringify({
				t: MessageTypes.END,
				d: data
			}, this._replacer()) + MessageDelimiter;
			if(this.connection.zlib) {
				packet = this.connection.zlib.deflate.process(packet);
			}
			this.connection.end(packet);
			return true;
		});
	},
	destroy(data) {
		this.connection.closing = true;
		for(let i = 0; i < this._drainQueue.length; i++) {
			this._drainQueue.shift().reject(false);
		}
		this.connection.destroy(data);
		return true;
	},
	_nonce() {
		return Math.floor(Math.random() * 999999999999).toString(36) + Date.now().toString(36);
	},
	_replacer() {
		const seen = new WeakSet();
		return (_, value) => {
			if(typeof value === "object" && value !== null) {
				if(seen.has(value)) {
					return;
				}
				seen.add(value);
			}
			return value;
		};
	},
	_read(stream) {
		let data;
		while(stream.readable && (data = stream.read())) {
			if(this.connection.zlib) {
				data = this.connection.zlib.inflate.process(data);
			}
			this._buffer += data.toString();
			let index = 0;
			let next = 0;
			while((next = this._buffer.indexOf(MessageDelimiter, index)) > -1) {
				this._parse(this._buffer.slice(index, next));
				index = next + MessageDelimiter.length;
			}
			this._buffer = this._buffer.slice(index);
		}
	},
	_write(op, data, nonce) {
		if(!this.connection.writable || this.connection.closing) {
			return Promise.resolve(false);
		}
		try {
			const d = {
				t: op,
				d: data
			};
			if(nonce) { d.n = nonce; }
			let packet = JSON.stringify(d, this._replacer()) + MessageDelimiter;
			if(this.connection.zlib) {
				packet = this.connection.zlib.deflate.process(packet);
			}
			const sent = this.connection.write(packet);
			if(!sent) {
				return new Promise((resolve, reject) => {
					this._drainQueue.push({
						resolve,
						reject
					});
				});
			}
			return Promise.resolve(true);
		} catch(e) {
			this.connection.emit(ConnectionEvents.ERROR, e);
			return Promise.resolve(false);
		}
	},
	_drain() {
		this._drainQueue.shift().resolve(true);
	},
	_drainQueue: [],
	_requests: {},
	_buffer: "",
	_zlib
};
