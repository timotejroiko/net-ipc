"use strict";

const { Server: NetServer } = require("net");
const { unlinkSync, statSync } = require("fs");
const Emitter = require("events");
const Connection = require("./connection.js");
const {
	Options,
	Events,
	ConnectionEvents,
	ServerEvents,
	ErrorMessages
} = require("./constants.js");

module.exports = class Server extends Emitter {
	constructor(options = {}) {
		super();
		this.options = { ...options };
		this.connections = [];
		this.server = null;
		if(!this.options.port && !this.options.path) { this.options.path = Options.DEFAULT_PATH; }
		if(this.options.max && !Number.isInteger(this.options.max)) { throw new Error(ErrorMessages.BAD_CONNECTIONS); }
		if(this.options.port && !Number.isInteger(this.options.port)) { throw new Error(ErrorMessages.BAD_PORT); }
		if(this.options.path && typeof this.options.path !== "string") { throw new Error(ErrorMessages.BAD_PATH); }
		if(this.options.path && process.platform === "win32") { this.options.path = `\\\\.\\pipe\\${this.options.path.replace(/^\//, "").replace(/\//g, "-")}`; }
		if(!Number.isInteger(this.options.retries) || this.options.retries < 0) { this.options.retries = 3; }
	}
	start() {
		return new Promise((ok, nope) => {
			if(this.server) {
				nope(new Error(ErrorMessages.SERVER_EXISTS));
				return;
			}
			this.server = new NetServer();
			this.server.on(ServerEvents.ERROR, this._onerror.bind(this));
			this.server.on(ServerEvents.CLOSE, this._onclose.bind(this));
			this.server.on(ServerEvents.CONNECTION, this._onconnection.bind(this));
			this.server.on(ServerEvents.LISTENING, this._onlistening.bind(this));
			this.server.once(ServerEvents.LISTENING, () => ok(this));
			if(this.options.max) { this.server.maxConnections = this.options.max; }
			if(this.options.path) {
				try { unlinkSync(this.options.path); } catch(e) { /* no-op */ }
				try {
					statSync(this.options.path);
					this.close();
					nope(new Error(`${ErrorMessages.EADDRINUSE} - ${this.options.path}`));
					return;
				} catch(e) { /* no-op */ }
				this.server.listen({ path: this.options.path });
			} else if(this.options.port) {
				this.server.listen({
					port: this.options.port,
					exclusive: true
				});
			}
		});
	}
	async close() {
		if(this.server) {
			this.server.close();
			for(const client of this.connections) {
				await client.close(ErrorMessages.SERVER_CLOSED);
			}
		}
		return this;
	}
	async broadcast(data) {
		for(const c of this.connections) {
			await c.send(data).catch(e => this.emit(Events.ERROR, e));
		}
	}
	survey(data, timeout = 10000) {
		if(!Number.isInteger(timeout)) { return Promise.reject(ErrorMessages.BAD_TIMEOUT); }
		return Promise.allSettled(this.connections.map(c => c.request(data, timeout)));
	}
	ping(data) {
		return Promise.allSettled(this.connections.map(c => c.ping(data)));
	}
	pause() {
		for(const c of this.connections) {
			c.pause();
		}
	}
	resume() {
		for(const c of this.connections) {
			c.resume();
		}
	}
	_onlistening() {
		let address = this.server.address();
		if(typeof address === "object") { address = `${address.address}:${address.port}`; }
		this.emit(Events.READY, address);
	}
	_onerror(e) {
		if(this._events[Events.ERROR]) {
			this.emit(Events.ERROR, e);
		}
	}
	_onclose() {
		this.server.removeAllListeners();
		this.server = null;
		this.emit(Events.CLOSE);
	}
	_onconnection(socket) {
		const client = new Connection(socket, this);
		const timer = setTimeout(() => {
			client.close();
		}, 10000);
		client.connection.once(ConnectionEvents.READY, extras => {
			clearTimeout(timer);
			client.connectedAt = Date.now();
			this.connections.push(client);
			this.emit(Events.CONNECT, client, extras);
		});
	}
};
