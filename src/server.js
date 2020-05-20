const net = require("net");
const fs = require("fs");
const emitter = require("events");
const zlib = require('zlib');

module.exports = class Server extends emitter {
	constructor(options = {}) {
		super();
		this.clients = [];
		this.options = options;
		this.server = null;
		if(!this.options.port && !this.options.path) { this.options.path = "net-ipc"; }
		if(this.options.port && !Number.isInteger(this.options.port)) { throw "Invalid port"; }
		if(this.options.path && typeof this.options.path !== "string") { throw "Invalid path"; }
		if(this.options.path && process.platform === "win32") { this.options.path = `\\\\.\\pipe\\${this.options.path.replace(/^\//, "").replace(/\//g, "-")}`; }
		if(!Number.isInteger(this.options.timeout)) { this.options.timeout = 30000; }
	}
	start(force) {
		if(this.server) {
			if(force) {
				this.close();
				setTimeout(this.start.bind(this,true),1000);
			}
			this.server.emit("error", new Error(`Server Already exists`));
			return;
		}
		this.server = new net.Server();
		this.server.on('listening', this._onlistening.bind(this));
		this.server.on('error', this._onerror.bind(this));
		this.server.on('close', this._onclose.bind(this));
		this.server.on('connection', this._onconnection.bind(this));
		if(this.options.max) { this.server.maxConnections = max; }
		if(this.options.path) {
			try { fs.unlinkSync(this.options.path); } catch(e) {}
			let exists;
			try { fs.statSync(this.options.path); exists = true; } catch(e) { exists = false; }
			if(exists) {
				this.server.emit("error", new Error(`EADDRINUSE: address already in use ${this.options.path}`));
				return;
			}
			this.server.listen({path:this.options.path});
		} else if(this.options.port) {
			this.server.listen({port:this.options.port,exclusive:true});
		}
	};
	close() {
		if(this.server) {
			this.server.close();
			for(let client of this.clients) {
				client.connection.close();
			}
		}
	}
	send(id,data) {
		let client = this.clients.find(c => c.id === id);
		if(client) { client.send(data); }
	}
	request(id,data) {
		let client = this.clients.find(c => c.id === id);
		if(client) { return client.request(data); }
	}
	broadcast(data) {
		for(let c of this.clients) {
			c.send(data);
		}
	}
	async survey(data) {
		return Promise.all(this.clients.map(c => c.request(data)));
	}
	_onlistening() {
		this.emit("ready", this.server.address());
	}
	_onerror(e) {
		if(this._events.error) {
			this.emit("error",e)
		} else {
			throw e;
		}
	}
	_onclose() {
		this.server.removeAllListeners();
		this.server = null;
		this.emit("close");
	}
	_onconnection(socket) {
		let connection = new Connection(socket,this);
		connection.request({_hello:"hello"}).then(r => {
			if(r._hello === "hello") {
				if(r._compress) { connection._compress = true; }
				this.clients.push(connection);
				this.emit("connect",connection);
			}
		});
	}
}

class Connection {
	constructor(socket,server) {
		this.server = server;
		this.connection = socket;
		this.id = Math.floor(Math.random()*999999999999).toString(36) + Date.now().toString(36);
		this.connection.on('error', this._onerror.bind(this));
		this.connection.on('close', this._onclose.bind(this));
		this.connection.on('data', this._ondata.bind(this));
		this._requests = {};
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
			}, this.server.options.timeout)
		});
	}
	_onerror(e) {
		this.server.emit("error", e, this.id);
	}
	_onclose(e) {
		this.connection.removeAllListeners();
		this.connection.destroy();
		this.connection = null;
		let index = this.server.clients.findIndex(c => c.id === this.id);
		if(index > -1) {
			this.server.emit("disconnect", this.id, e);
			this.server.clients.splice(index, 1);
		}
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
				if(this.server._events.request) {
					this.server.emit("request", d._request, this.id, this._reply.bind(this, d._nonce));
				} else {
					this._reply(d._nonce, null);
				}
			}
		} else {
			this.server.emit("message", d, this.id);
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