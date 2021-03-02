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
		if(!Number.isInteger(timeout)) { return Promise.reject(ErrorMessages.BAD_TIMEOUT); }
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
			const packet = this._pack({
				t: MessageTypes.END,
				d: data
			});
			this.connection.end(packet);
			return true;
		});
	},
	destroy(data) {
		this.connection.closing = true;
		const n = this._drainQueue.length;
		for(let i = 0; i < n; i++) {
			this._drainQueue.shift().reject(new Error(ErrorMessages.CONNECTION_DESTROYED));
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
			if(typeof value === "object" && value) {
				if(seen.has(value)) {
					return `[Circular ${value.constructor.name}]`;
				}
				seen.add(value);
			} else if(typeof value === "bigint") {
				return value.toString();
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
		if(!this.connection || this.connection.closing || !this.connection.writable) {
			return Promise.reject(new Error(ErrorMessages.CONNECTION_CLOSED));
		}
		try {
			const d = {
				t: op,
				d: data
			};
			if(nonce) { d.n = nonce; }
			const packet = this._pack(d);
			const sent = this.connection.write(packet);
			if(sent) {
				return Promise.resolve();
			}
			return new Promise((resolve, reject) => {
				this._drainQueue.push({
					resolve,
					reject
				});
			});
		} catch(e) {
			this.connection.emit(ConnectionEvents.ERROR, e);
			return Promise.reject(e);
		}
	},
	_pack(data) {
		let packet = JSON.stringify(data, this._replacer()) + MessageDelimiter;
		if(this.connection.zlib) {
			packet = this.connection.zlib.deflate.process(packet);
		}
		return packet;
	},
	_drain() {
		this._drainQueue.shift().resolve();
	},
	_drainQueue: [],
	_requests: {},
	_buffer: "",
	_zlib
};
