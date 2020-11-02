const { Socket } = require("net");
const Emitter = require("events");
const interfaces = require("./interfaces.js");
const constants = require("./constants.js");

class Client extends Emitter {
	constructor(options = {}) {
		super();
		this.connection = null;
		this.options = options;
		if(!this.options.url && !this.options.path) { this.options.path = constants.Options.DEFAULT_PATH; }
		if(this.options.url && typeof this.options.url !== "string") { throw constants.ErrorMessages.BAD_URL; }
		if(this.options.path && typeof this.options.path !== "string") { throw constants.ErrorMessages.BAD_PATH; }
		if(this.options.path && process.platform === "win32") { this.options.path = `\\\\.\\pipe\\${this.options.path.replace(/^\//, "").replace(/\//g, "-")}`; }
		if(this.options.compress) { this.options.compress = Boolean(this.options.compress); }
	}
	connect(data) {
		return new Promise((ok, nope) => {
			if(this.connection) {
				this.connection.end();
				setTimeout(() => ok(this.connect(data)), 500);
				return;
			}
			this.connection = new Socket();
			this.connection.setKeepAlive(true);
			this.connection.on(constants.ConnectionEvents.READABLE, this._read.bind(this, this.connection));
			this.connection.on(constants.ConnectionEvents.DRAIN, this._drain.bind(this));
			this.connection.on(constants.ConnectionEvents.CLOSE, e => {
				nope(e || constants.ErrorMessages.NO_RESPONSE);
			});
			this.connection.on(constants.ConnectionEvents.ERROR, e => {
				this.connection.end();
				nope(e || constants.ErrorMessages.UNKNOWN_ERROR);
			});
			this.connection.once(constants.ConnectionEvents.READY, () => {
				this._write(constants.MessageTypes.CONNECTION, { compress: this.options.compress && Boolean(this._zlib) }).catch(e => this.connection.emit(constants.ConnectionEvents.ERROR, e));
				this.connection.cork();
			});
			this.connection.once(constants.ConnectionEvents.DONE, extras => {
				this.connection._events[constants.ConnectionEvents.CLOSE] = this._onclose.bind(this);
				this.connection._events[constants.ConnectionEvents.ERROR] = this._onerror.bind(this);
				this.connection.uncork();
				this.id = extras.id;
				if(this.options.compress && !extras.compress) {
					this.options.compress = false;
					console.warn(constants.ErrorMessages.ZLIB_MISSING);
				}
				this.emit(constants.Events.READY, extras);
				ok(this);
			});
			if(this.options.path) {
				this.connection.connect({path:this.options.path});
			} else if(this.options.url) {
				let url = this.options.url.split(":");
				let port = url.pop();
				this.connection.connect({host:url.join(":"),port:port});
			}
		});
	}
	_onerror(e) {
		if(this._events[constants.Events.ERROR]) {
			this.emit(constants.Events.ERROR, e);
		}
	}
	_onclose(e) {
		this.connection.destroy();
		this.connection.removeAllListeners();
		this.connection = null;
		this.emit(constants.Events.CLOSE, e || this._end);
	}
	_parse(data) {
		try {
			data = JSON.parse(data);
		} catch(e) {
			this.connection.emit(constants.ConnectionEvents.ERROR, e);
			return;
		}
		switch(data.t) {
			case constants.MessageTypes.CONNECTION:
				if(data.d.compress) {
					this.connection.zlib = {
						pack: this._zlib(constants.ZlibDeflator),
						unpack: this._zlib(constants.ZlibInflator)
					}
				}
				this.connection.emit(constants.ConnectionEvents.DONE, data.d);
				break;
			case constants.MessageTypes.MESSAGE:
				this.emit(constants.Events.MESSAGE, data.d);
				break;
			case constants.MessageTypes.REQUEST:
				if(this._events[constants.Events.REQUEST]) {
					this.emit(constants.Events.REQUEST, data.d, response => this._write(constants.MessageTypes.RESPONSE, response, data.n));
				} else {
					this._write(constants.MessageTypes.RESPONSE, void 0, data.n).catch(e => this.connection.emit(constants.ConnectionEvents.ERROR, e));
				}
				break;
			case constants.MessageTypes.RESPONSE:
				if(this._requests[data.n]) {
					this._requests[data.n][0](data.d);
					delete this._requests[data.n];
				}
				break;
			case constants.MessageTypes.PING:
				this._write(constants.MessageTypes.PONG, data.d, data.n).catch(e => this.connection.emit(constants.ConnectionEvents.ERROR, e));
				break;
			case constants.MessageTypes.PONG:
				if(this._requests[data.n]) {
					this._requests[data.n][0](Date.now() - this._requests[data.n][2]);
					delete this._requests[data.n];
				}
				break;
			case constants.MessageTypes.END:
				if(data.d) {
					this._end = data.d;
				}
				break;
		}
	}
}

for(let [method, value] of Object.entries(interfaces)) {
	Client.prototype[method] = value;
}

module.exports = Client;