const constants = require("./constants.js");
let _zlib;

try {
	_zlib = require("fast-zlib");
} catch(e) {}

module.exports = {
	send(data) {
		return this._write(constants.MessageTypes.MESSAGE, data);
	},
	request(data, timeout = 10000) {
		if(!Number.isInteger(timeout)) { return Promise.reject(constants.ErrorMessages.BAD_TIMEOUT); }
		return new Promise((ok, nope) => {
			let nonce = this._nonce();
			this._requests[nonce] = [ok, nope];
			this._write(constants.MessageTypes.REQUEST, data, nonce).catch(e => {
				delete this._requests[nonce];
				nope(e)
			});
			setTimeout(() => {
				if(this._requests[nonce]) {
					this._requests[nonce][1](constants.ErrorMessages.TIMEOUT);
					delete this._requests[nonce];
				}
			}, timeout);
		});
	},
	ping(data, timeout = 10000) {
		return new Promise((ok, nope) => {
			let nonce = this._nonce();
			this._requests[nonce] = [ok, nope, Date.now()];
			this._write(constants.MessageTypes.PING, data, nonce).catch(e => {
				delete this._requests[nonce];
				nope(e)
			});
			setTimeout(() => {
				if(this._requests[nonce]) {
					this._requests[nonce][1](constants.ErrorMessages.TIMEOUT);
					delete this._requests[nonce];
				}
			}, timeout);
		});
	},
	close(data) {
		this.connection.closing = true;
		return Promise.allSettled(this._drainQueue).then(() => {
			this.connection.end({ t:constants.MessageTypes.END, d:data });
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
		return Math.floor(Math.random()*999999999999).toString(36) + Date.now().toString(36);
	},
	_replacer() {
		let seen = new WeakSet();
		return (_, value) => {
			if(typeof value === "object" && value !== null) {
				if(seen.has(value)) {
					return;
				}
				seen.add(value);
			}
			return value;
		}
	},
	_read(stream) {
		let data;
		while(stream.readable && (data = stream.read())) {
			if(this.connection.zlib) {
				data = this.connection.zlib.unpack(data);
			}
			this._buffer += data.toString();
			let index;
			while((index = this._buffer.indexOf(constants.MessageDelimiter)) > -1) {
				this._parse(this._buffer.slice(0, index));
				this._buffer = this._buffer.slice(index+1);
			}
		}
	},
	_write(op, data, nonce) {
		if(!this.connection.writable || this.connection.closing) {
			return Promise.reject(false);
		}
		try {
			let d = { t:op, d:data };
			if(nonce) { d.n = nonce; }
			let packet = JSON.stringify(d, this._replacer()) + constants.MessageDelimiter;
			if(this.connection.zlib) {
				packet = this.connection.zlib.pack(packet);
			}
			let sent = this.connection.write(packet);
			if(!sent) {
				return new Promise((resolve, reject) => this._drainQueue.push({resolve, reject}));
			}
			return Promise.resolve(true);
		} catch(e) {
			this.connection.emit(constants.ConnectionEvents.ERROR, e);
			return Promise.reject(false);
		}
	},
	_drain() {
		this._drainQueue.shift().resolve(true);
	},
	_drainQueue: [],
	_requests: {},
	_buffer: "",
	_zlib
}
