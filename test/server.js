"use strict";

const { Server } = require("../index.js");

console.log("[SOCKET SERVER] starting");
const socket = new Server();
socket.start();

console.log("[TCP SERVER] starting");
const tcp = new Server({ port: 8333 });
tcp.start();

console.log("[TLS SERVER] starting");
const tls = new Server({ port: 8334, tls: true, options: { pskCallback: () => Buffer.from("test") } });
tls.start();

socket.on("message", message1).on("request", request1);
tcp.on("message", message2).on("request", request2);
tls.on("message", message2).on("request", request2);

const received = {};

socket.on("connect", (client, payload) => {
	console.log(`\n[SOCKET SERVER] new connection received, assigned client id ${client.id} and payload ${payload}`);
	const id = `socket${client.connection.msgpack ? " messagepack" : ""} ${client.connection.zlib ? " zlib" : ""}`;
	if(!received[id]) { received[id] = 0; }
	client.connection.on("data", d => { received[id] += d.toString().length; });
});
tcp.on("connect", (client, payload) => {
	console.log(`\n[TCP SERVER] new connection received, assigned client id ${client.id} and payload ${payload}`);
	const id = `tcp${client.connection.msgpack ? " messagepack" : ""} ${client.connection.zlib ? " zlib" : ""}`;
	if(!received[id]) { received[id] = 0; }
	client.connection.on("data", d => { received[id] += d.toString().length; });
});
tls.on("connect", (client, payload) => {
	console.log(`\n[TCP SERVER] new connection received, assigned client id ${client.id} and payload ${payload}`);
	const id = `tls${client.connection.msgpack ? " messagepack" : ""} ${client.connection.zlib ? " zlib" : ""}`;
	if(!received[id]) { received[id] = 0; }
	client.connection.on("data", d => { received[id] += d.toString().length; });
});

socket.on("disconnect", c => console.log("disconnected", c.id));
tcp.on("disconnect", c => console.log("disconnected", c.id));
tls.on("disconnect", c => console.log("disconnected", c.id));

socket.on("error", e => console.log("error", e.message));
tcp.on("error", e => console.log("error", e.message));
tls.on("error", e => console.log("error", e.message));

let timer;
let data = [];

async function message1(m, client) {
	if(m === "finish") {
		console.log("[SERVER] total bytes received per connection", received);
		process.exit();
	}
	if(m.test) {
		console.log(`[SOCKET SERVER] acknowledged test start ${m.test}`);
		timer = Date.now();
	} else if(m.data) {
		data.push(m.data);
	} else if(m.done) {
		console.log(`[SOCKET SERVER] received ${data.length} messages in ${Date.now() - timer}ms`);
		console.log("[SOCKET SERVER] preparing to send them back");
		timer = Date.now();
		for(const d of data) {
			await client.send(d);
		}
		console.log(`[SOCKET SERVER] sent ${data.length} messages in ${Date.now() - timer}ms`);
		data = [];
	}
}

async function message2(m, client) {
	if(m === "finish") {
		console.log("[SERVER] total bytes received per connection", received);
		process.exit();
	}
	if(m.test) {
		console.log(`[TCP SERVER] acknowledged test start ${m.test}`);
		timer = Date.now();
	} else if(m.data) {
		data.push(m.data);
	} else if(m.done) {
		console.log(`[TCP SERVER] received ${data.length} messages in ${Date.now() - timer}ms`);
		console.log("[TCP SERVER] preparing to send them back");
		timer = Date.now();
		for(const d of data) {
			await client.send(d);
		}
		console.log(`[TCP SERVER] sent ${data.length} messages in ${Date.now() - timer}ms`);
		data = [];
	}
}

async function request1(m, reply) {
	await reply(m);
}

async function request2(m, reply) {
	await reply(m);
}
