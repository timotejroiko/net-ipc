const { Server:NetServer } = require("net");
const { unlinkSync, statSync } = require("fs");
const Emitter = require("events");
const Connection = require("./connection.js");
const constants = require("./constants.js");

module.exports = class Server extends Emitter {
	constructor(options = {}) {
		super();
		this.connections = [];
		this.options = options;
		this.server = null;
		if(!this.options.port && !this.options.path) { this.options.path = constants.Options.DEFAULT_PATH; }
		if(this.options.max && !Number.isInteger(this.options.max)) { throw constants.ErrorMessages.BAD_CONNECTIONS; }
		if(this.options.port && !Number.isInteger(this.options.port)) { throw constants.ErrorMessages.BAD_PORT; }
		if(this.options.path && typeof this.options.path !== "string") { throw constants.ErrorMessages.BAD_PATH; }
		if(this.options.path && process.platform === "win32") { this.options.path = `\\\\.\\pipe\\${this.options.path.replace(/^\//, "").replace(/\//g, "-")}`; }
	}
	start() {
		return new Promise((ok, nope) => {
			if(this.server) {
				nope(new Error(constants.ErrorMessages.SERVER_EXISTS));
				return;
			}
			this.server = new NetServer();
			this.server.on(constants.ServerEvents.ERROR, this._onerror.bind(this));
			this.server.on(constants.ServerEvents.CLOSE, this._onclose.bind(this));
			this.server.on(constants.ServerEvents.CONNECTION, this._onconnection.bind(this));
			this.server.on(constants.ServerEvents.LISTENING, this._onlistening.bind(this));
			this.server.once(constants.ServerEvents.LISTENING, ok);
			if(this.options.max) { this.server.maxConnections = max; }
			if(this.options.path) {
				try { unlinkSync(this.options.path); } catch(e) {}
				try {
					statSync(this.options.path);					
					this.close();
					nope(new Error(`${constants.ErrorMessages.EADDRINUSE} - ${this.options.path}`));
					return;
				} catch(e) {}
				this.server.listen({path:this.options.path});
			} else if(this.options.port) {
				this.server.listen({port:this.options.port, exclusive:true});
			}
		});
	}
	close() {
		if(this.server) {
			this.server.close();
			for(let client of this.connections) {
				client.close();
			}
		}
		return this;
	}
	broadcast(data) {
		for(let c of this.connections) {
			c.send(data);
		}
	}
	survey(data, timeout = 10000) {
		if(!Number.isInteger(timeout)) { return Promise.reject(constants.ErrorMessages.BAD_TIMEOUT); }
		return Promise.allSettled(this.connections.map(c => c.request(data, timeout)));
	}
	ping(data) {
		return Promise.allSettled(this.connections.map(c => c.ping(data)));
	}
	_onlistening() {
		let address = this.server.address();
		if(typeof address === "object") { address = `${address.address}:${address.port}`; }
		this.emit(constants.Events.READY, address);
	}
	_onerror(e) {
		if(this._events[constants.Events.ERROR]) {
			this.emit(constants.Events.ERROR, e);
		}
	}
	_onclose() {
		this.server.removeAllListeners();
		this.server = null;
		this.emit(constants.Events.CLOSE);
	}
	_onconnection(socket) {
		let client = new Connection(socket, this);
		client.connection.once("ready", extras => {
			if(!this.connections.find(t => t.id === client.id)) {
				this.connections.push(client);
				this.emit(constants.Events.CONNECT, client, extras);
				client.connectedAt = Date.now();
			}
		});
		setTimeout(() => {
			if(!client.connectedAt) {
				client.close();
			}
		}, 10000);
	}
}
