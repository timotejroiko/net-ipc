"use strict";

const {
	ConnectionEvents,
	MessageTypes,
	MessageDelimiter,
	ErrorMessages
} = require("./constants.js");

let _zlib;
try {
	_zlib = require("fast-zlib");
} catch(e) { /* no-op */ }

module.exports = {
	send(data) {
		return this._tryWrite(MessageTypes.MESSAGE, data);
	},
	request(data, timeout = 10000) {
		if(!Number.isInteger(timeout)) { return Promise.reject(ErrorMessages.BAD_TIMEOUT); }
		return new Promise((ok, nope) => {
			const nonce = this._nonce();
			this._requests[nonce] = {
				resolve: ok,
				reject: nope,
				timer: timeout > 0 ? setTimeout(() => {
					delete this._requests[nonce];
					nope(ErrorMessages.TIMEOUT);
				}, timeout) : null
			};
			this._tryWrite(MessageTypes.REQUEST, data, nonce).catch(e => {
				if(this._requests[nonce].timer) { clearTimeout(this._requests[nonce].timer); }
				delete this._requests[nonce];
				nope(e);
			});
		});
	},
	ping(data, timeout = 10000) {
		if(!Number.isInteger(timeout)) { return Promise.reject(ErrorMessages.BAD_TIMEOUT); }
		return new Promise((ok, nope) => {
			const nonce = this._nonce();
			this._requests[nonce] = {
				resolve: ok,
				reject: nope,
				date: Date.now(),
				timer: timeout > 0 ? setTimeout(() => {
					delete this._requests[nonce];
					nope(ErrorMessages.TIMEOUT);
				}, timeout) : null
			};
			this._tryWrite(MessageTypes.PING, data, nonce).catch(e => {
				if(this._requests[nonce].timer) { clearTimeout(this._requests[nonce].timer); }
				delete this._requests[nonce];
				nope(e);
			});
		});
	},
	async close(data) {
		this._closed = true;
		await Promise.allSettled(this._drainQueue);
		const packet = this._pack({
			t: MessageTypes.END,
			d: data
		});
		await new Promise(ok => {
			this.connection.end(packet, void 0, ok);
		});
		return true;
	},
	destroy(data) {
		this._closed = true;
		for(let i = 0; i < this._drainQueue.length; i++) {
			this._drainQueue.shift().reject(new Error(ErrorMessages.CONNECTION_DESTROYED));
		}
		this.connection.destroy(data);
		return true;
	},
	_nonce() {
		return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36) + Date.now().toString(36);
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
	_read(d) {
		const data = this.connection.zlib ? this.connection.zlib.inflate.process(d) : d;
		this._buffer += data.toString();
		let index = 0;
		let next = 0;
		while((next = this._buffer.indexOf(MessageDelimiter, index)) > -1) {
			this._parse(this._buffer.slice(index, next));
			index = next + MessageDelimiter.length;
		}
		this._buffer = this._buffer.slice(index);
	},
	_write(op, data, nonce) {
		if(!this.connection || !this.connection.writable) {
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
			if(sent) { return Promise.resolve(); }
			let resolve;
			let reject;
			const promise = new Promise((ok, nope) => {
				resolve = ok;
				reject = nope;
			});
			promise.resolve = resolve;
			promise.reject = reject;
			this._drainQueue.push(promise);
			return promise;
		} catch(e) {
			this.connection.emit(ConnectionEvents.ERROR, e);
			return Promise.reject(e);
		}
	},
	_pack(data) {
		const d = JSON.stringify(data.d, this._replacer());
		let packet = `{"t":${data.t}${data.n ? `,"n":"${data.n}"` : ""}${d ? `,"d":${d}` : ""}}${MessageDelimiter}`;
		if(this.connection.zlib) {
			packet = this.connection.zlib.deflate.process(packet);
		}
		return packet;
	},
	_drain() {
		for(let i = 0; i < this._drainQueue.length; i++) {
			this._drainQueue.shift().resolve();
		}
	},
	_drainQueue: [],
	_requests: {},
	_buffer: "",
	_zlib
};
