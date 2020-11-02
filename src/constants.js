module.exports = {
	MessageDelimiter:"\x04",
	ZlibInflator:"InflateRaw",
	ZlibDeflator:"DeflateRaw",
	MessageTypes: {
		CONNECTION:0,
		MESSAGE:1,
		REQUEST:2,
		RESPONSE:3,
		PING:4,
		PONG:5,
		END:6
	},
	ErrorMessages:{
		BAD_TIMEOUT:"invalid timeout",
		TIMEOUT:"request timed out",
		PREMATURE_PACKET:"ignored data packet received before connection finished establishing",
		BAD_CONNECTIONS:"invalid max number of connections",
		BAD_PORT:"invalid TCP port",
		BAD_PATH:"invalid socket path",
		BAD_URL:"invalid URL",
		SERVER_EXISTS:"server already exists",
		EADDRINUSE:"EADDRINUSE: address already in use",
		ORPHAN_CONNECTION:"closing orphaned connection",
		NO_RESPONSE:"no response",
		UNKNOWN_ERROR:"unknown error",
		ZLIB_MISSING:"WARNING: compression requires the 'fast-zlib' package to be installed (npm install fast-zlib)"
	},
	Events:{
		READY:"ready",
		ERROR:"error",
		CONNECT:"connect",
		DISCONNECT:"disconnect",
		MESSAGE:"message",
		REQUEST:"request",
		CLOSE:"close"
	},
	ConnectionEvents:{
		ERROR:"error",
		CLOSE:"close",
		READABLE:"readable",
		READY:"ready",
		DONE:"done",
		DRAIN:"drain"
	},
	ServerEvents:{
		ERROR:"error",
		CONNECTION:"connection",
		LISTENING:"listening",
		CLOSE:"close"
	},
	Options:{
		DEFAULT_PATH:"net-ipc"
	}
}
