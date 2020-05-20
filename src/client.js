const net = require("net");
const fs = require("fs");
const emitter = require("events");
const zlib = require('zlib');

module.exports = class Client extends emitter {
	constructor(options = {}) {
		super();
		this.options = options;
		this.connection = null;
		this._requests = {};
		if(!this.options.url && !this.options.path) { this.options.path = "net-ipc"; }
		if(this.options.url && typeof this.options.url !== "string") { throw "Invalid url"; }
		if(this.options.path && typeof this.options.path !== "string") { throw "Invalid path"; }
		if(this.options.path && process.platform === "win32") { this.options.path = `\\\\.\\pipe\\${this.options.path.replace(/^\//, "").replace(/\//g, "-")}`; }
		if(!Number.isInteger(this.options.timeout)) { this.options.timeout = 30000; }
	}
	connect() {
		if(this.connection) {
			this.connection.end();
			setTimeout(this.connect.bind(this),1000);
			return;
		}
		this.connection = new net.Socket();
		this.connection.setKeepAlive(true);
		this.connection.on('ready', this._onready.bind(this));
		this.connection.on('error', this._onerror.bind(this));
		this.connection.on('close', this._onclose.bind(this));
		this.connection.on('data', this._ondata.bind(this));
		if(this.options.path) {
			this.connection.connect({path:this.options.path});
		} else if(this.options.url) {
			let url = this.options.url.split(":")
			this.connection.connect({host:url[0],port:url[1]});
		}
		return new Promise((ok,nope) => {
			this.once("ready",ok());
			setTimeout(() => nope("no response"), 5000);
		});
	}
	disconnect() {
		this.connection.end();
	}
	send(data) {
		let d;
		try {
			d = JSON.stringify(data,this._replacer());
			if(this.connection._compress) {
				d = zlib.deflateSync(d);
			}
		} catch(e) {
			this.connection.emit("error", e);
			return;
		}
		this.connection.write(d);
	}
	request(data) {
		return new Promise((ok,nope) => {
			let nonce = Math.floor(Math.random()*999999999999).toString(36) + Date.now().toString(36);
			this._requests[nonce] = [ok,nope];
			this.send({_nonce:nonce,_request:data});
			setTimeout(() => {
				if(this._requests[nonce]) {
					this._requests[nonce][1]("request timeout");
					delete this._requests[nonce];
				}
			}, this.options.timeout)
		});
	}
	_onready() {
		
	}
	_onerror(e) {
		if(this._events.error) {
			this.emit("error",e)
		} else {
			throw e;
		}
	}
	_onclose() {
		this.connection.removeAllListeners();
		this.connection = null;
		this.emit("close");
	}
	_ondata(data) {
		let d = data;
		try {
			if(this.connection._compress) {
				d = zlib.inflateSync(d);
			}
			d = JSON.parse(d);
		} catch(e) {
			this.connection.emit("error", e);
			return;
		}
		let keys = Object.keys(d);
		if(d._nonce) {
			if(keys.includes("_response") && this._requests[d._nonce]) {
				this._requests[d._nonce][0](d._response);
				delete this._requests[d._nonce];
			} else if(keys.includes("_request")) {
				if(d._request._hello && d._request._hello === "hello") {
					this._reply(d._nonce, {_hello:"hello",_compress:this.options.compress});
					if(this.options.compress) { this.connection._compress = true; }
					this.emit("ready",this.connection.remoteAddress);
				} else if(this._events.request) {
					this.emit("request", d._request, this.id, this._reply.bind(this, d._nonce));
				} else {
					this._reply(d._nonce, null);
				}
			}
		} else {
			this.emit("message", d, this.id);
		}
	}
	_reply(nonce,data) {
		if(data === undefined) { data = null; }
		this.send({_nonce:nonce,_response:data});
	}
	_replacer() {
		let seen = new WeakSet();
		return (key, value) => {
			if(typeof value === "object" && value !== null) {
				if (seen.has(value)) {
					return;
				}
				seen.add(value);
			}
			return value;
		}
	}
}