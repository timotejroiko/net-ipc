"use strict";

const {
	ConnectionEvents,
	MessageTypes,
	ErrorMessages
} = require("./constants.js");

let _zlib;
try {
	_zlib = require("fast-zlib");
} catch(e) { /* no-op */ }

let _msgpack;
try {
	_msgpack = require("msgpackr");
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
	/*
	_read(d) {
		const data = this.connection.zlib ? this.connection.zlib.inflate.process(d) : d;
		this._buffer += data.toString();
		let index = 0;
		let next = 0;
		while((next = this._buffer.indexOf(MessageDelimiter, index)) > -1) {
			const json = JSON.parse(this._buffer.slice(index, next));
			// const json = unpack(Buffer.from(this._buffer.slice(index, next), "base64"));
			this._parse(json);
			index = next + MessageDelimiter.length;
		}
		this._buffer = this._buffer.slice(index);
	},
	*/
	_read(d) {
		const data = this.connection.zlib ? this.connection.zlib.inflate.process(d) : d;
		this._buffer += data.toString();
		while(this._buffer.length) {
			const buffer = this._buffer;
			const bufferLength = buffer.length;
			const dataHeader = buffer.charCodeAt(0) >> 6;
			let dataLength = 0;
			switch(dataHeader) {
				case 0: {
					dataLength = buffer.charCodeAt(0) & 63;
					break;
				}
				case 1: {
					if(bufferLength < 2) { return; }
					dataLength = ((buffer.charCodeAt(0) & 63) << 8) + buffer.charCodeAt(1);
					break;
				}
				case 2: {
					if(bufferLength < 3) { return; }
					dataLength = ((((buffer.charCodeAt(0) & 63) << 8) + buffer.charCodeAt(1)) << 8) + buffer.charCodeAt(2);
					break;
				}
				case 3: {
					if(bufferLength < 4) { return; }
					dataLength = ((((((buffer.charCodeAt(0) & 63) << 8) + buffer.charCodeAt(1)) << 8) + buffer.charCodeAt(2)) << 8) + buffer.charCodeAt(3);
					break;
				}
			}
			const start = dataHeader + 1;
			const end = start + dataLength;
			if(bufferLength < end) { return; }
			const slice = buffer.slice(start, end);
			this._buffer = buffer.slice(end);
			try {
				const json = this.connection.msgpack ? this.connection.msgpack.unpack(Buffer.from(slice, "latin1")) : JSON.parse(slice);
				this._parse(json);
			} catch(e) {
				this.connection.emit(ConnectionEvents.ERROR, e);
			}
		}
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
		let packet;
		let length;
		if(this.connection.msgpack) {
			packet = this.connection.msgpack.pack(data).toString("latin1");
		} else {
			packet = JSON.stringify(data, this._replacer());
		}
		const L = packet.length;
		if(L < (1 << 6)) {
			length = String.fromCharCode(L);
		} else if(L < (1 << 14)) {
			length = String.fromCharCode((1 << 6) + (L >> 8), L & 255);
		} else if(L < (1 << 22)) {
			length = String.fromCharCode((2 << 6) + (L >> 16), (L >> 8) & 255, L & 255);
		} else {
			length = String.fromCharCode((3 << 6) + (L >> 24), (L >> 16) & 255, (L >> 8) & 255, L & 255);
		}
		packet = length + packet;
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
	_zlib,
	_msgpack
};
