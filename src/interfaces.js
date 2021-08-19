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
	_read() {
		const socket = this.connection;
		while(socket.readableLength > 1) {
			const length = this._untag();
			if(!length) { return; }
			let data = socket.read(length[0] + length[1]);
			if(!data) { return; }
			data = data.slice(length[0]);
			try {
				if(socket.zlib) { data = socket.zlib.inflate.process(data); }
				const json = socket.msgpack ? socket.msgpack.unpack(data) : JSON.parse(data);
				this._parse(json);
			} catch(e) {
				socket.emit(ConnectionEvents.ERROR, e);
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
		const socket = this.connection;
		let msg = socket.msgpack ? socket.msgpack.pack(data) : Buffer.from(JSON.stringify(data, this._replacer()));
		if(socket.zlib) { msg = socket.zlib.deflate.process(msg); }
		const tag = this._tag(msg.length);
		const packet = Buffer.allocUnsafe(msg.length + tag.length);
		for(let i = 0; i < tag.length; i++) {
			packet[i] = tag[i];
		}
		packet.set(msg, tag.length);
		return packet;
	},
	_tag(_size) {
		let size = _size;
		const tag = [(size & 127) + 128];
		while((size >>= 7)) {
			tag.push(size & 127);
		}
		return tag.reverse();
	},
	_untag() {
		let head = this.connection._readableState.buffer.head;
		let num = 0;
		let size = 0;
		do {
			for(let i = 0; i < head.data.length; i++) {
				const byte = head.data[i];
				num *= 128;
				size++;
				if(byte > 127) {
					return [size, num + (byte & 127)];
				}
				num += byte;
			}
		} while((head = head.next));
		return false;
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
