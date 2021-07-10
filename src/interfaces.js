"use strict";

const {
	ConnectionEvents,
	MessageTypes,
	ErrorMessages,
	Options
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
	request(data, timeout = Options.DEFAULT_TIMEOUT) {
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
	ping(data, timeout = Options.DEFAULT_TIMEOUT) {
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
	async close(data, allowReconnect = false) {
		if(this._closed || !this.connection) { return false; }
		this._closed = true;
		await Promise.allSettled(this._drainQueue);
		const packet = this._pack({
			t: MessageTypes.END,
			d: {
				m: data,
				a: allowReconnect
			}
		});
		await new Promise(ok => {
			this.connection.end(packet, void 0, ok);
		});
		return true;
	},
	destroy(data) {
		if(this._closed || !this.connection) { return false; }
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
			}
			if(typeof value === "bigint") {
				return value.toString();
			}
			return value;
		};
	},
	_read(d) {
		const data = this.connection.zlib ? this.connection.zlib.inflate.process(d) : d;
		this.connection._buffer = Buffer.concat([this.connection._buffer, data]);
		let tag;
		while((tag = this._untag(this.connection._buffer))[2] && this.connection._buffer.length >= tag[1]) {
			const slice = this.connection._buffer.slice(tag[0], tag[1]);
			this.connection._buffer = this.connection._buffer.slice(tag[1]);
			try {
				const json = this.connection.msgpack ? this.connection.msgpack.unpack(slice) : JSON.parse(slice);
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
		const msg = this.connection.msgpack ? this.connection.msgpack.pack(data) : Buffer.from(JSON.stringify(data, this._replacer()));
		const tag = this._tag(msg.length);
		const packet = Buffer.allocUnsafe(msg.length + tag.length);
		for(let i = 0; i < tag.length; i++) {
			packet[i] = tag[i];
		}
		packet.set(msg, tag.length);
		return this.connection.zlib ? this.connection.zlib.deflate.process(packet) : packet;
	},
	_tag(_size) {
		let size = _size;
		const tag = [(size & 127) + 128];
		while((size >>= 7)) {
			tag.push(size & 127);
		}
		return tag.reverse();
	},
	_untag(data) {
		let size = 0;
		let datasize = 0;
		let done = 0;
		while(size < data.length) {
			datasize <<= 7;
			datasize += data[size] & 127;
			if(data[size++] > 127) {
				done = 1;
				break;
			}
		}
		return [size, size + datasize, done];
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
