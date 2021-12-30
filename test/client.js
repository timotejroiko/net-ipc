"use strict";

const { Client } = require("../index.js");

const c1 = new Client();
const c2 = new Client({ compress: true });
const c22 = new Client({ messagepack: true });
const c222 = new Client({
	compress: true,
	messagepack: true
});

const c3 = new Client({
	host: "localhost",
	port: 8333
});
const c4 = new Client({
	host: "localhost",
	port: 8333,
	compress: true
});
const c44 = new Client({
	host: "localhost",
	port: 8333,
	compress: false,
	messagepack: true
});
const c444 = new Client({
	host: "localhost",
	port: 8333,
	compress: true,
	messagepack: true
});

const c5 = new Client({
	host: "localhost",
	port: 8334,
	tls: true,
	options: { pskCallback: () => ({ psk: Buffer.from("test"), identity: "test" }), ciphers: "PSK", checkServerIdentity: () => void 0 }
});

console.log("clients started");

(async () => {

	const c01 = await c1.connect("test1");
	await messageTest(c01, "socket");
	await requestTest(c01, "socket request");

	const c02 = await c2.connect("test2");
	await messageTest(c02, "compressed socket");
	await requestTest(c02, "compressed socket request");

	const c022 = await c22.connect("test3");
	await messageTest(c022, "messagepack socket");
	await requestTest(c022, "messagepack socket request");

	const c0222 = await c222.connect("test4");
	await messageTest(c0222, "compressed messagepack socket");
	await requestTest(c0222, "compressed messagepack socket request");

	const c03 = await c3.connect("test5");
	await messageTest(c03, "tcp");
	await requestTest(c03, "tcp request");

	const c04 = await c4.connect("test6");
	await messageTest(c04, "compressed tcp");
	await requestTest(c04, "compressed tcp request");

	const c044 = await c44.connect("test7");
	await messageTest(c044, "messagepack tcp");
	await requestTest(c044, "messagepack tcp request");

	const c0444 = await c444.connect("test8");
	await messageTest(c0444, "compressed messagepack tcp");
	await requestTest(c0444, "compressed messagepack tcp request");

	const c05 = await c5.connect("test5");
	await messageTest(c05, "tcp with tls");
	await requestTest(c05, "tcp with tls request");

	await c01.send("finish");

	process.exit();
})().catch(console.log);

async function messageTest(client, test) {
	console.log(`[CLIENT] starting ${test} test`);
	console.log("[CLIENT] generating random data");
	const data = new Array(9999).fill().map(() => randomObject(10));
	console.log("[CLIENT] sending data");
	client.send({ test: `${data.length} random objects` });
	let timer = Date.now();
	for(const d of data) {
		/*
		if(Math.random() < 0.00001) {
			console.log("[TEST SIMULATED DISCONNECTION]");
			client.connection.end();
		}
		*/
		await client.send({ data: d });
	}
	console.log(`[CLIENT] sent ${data.length} messages in ${Date.now() - timer}ms`);
	client.send({ done: true });
	return new Promise((r, j) => {
		const received = [];
		timer = Date.now();
		client.on("message", m => {
			received.push(m);
			if(received.length === data.length) {
				console.log(`[CLIENT] received ${received.length} messages in ${Date.now() - timer}ms`);
				console.log("[CLIENT] verifying data integrity");
				for(let i = 0; i < data.length; i++) {
					if(JSON.stringify(data[i]) !== JSON.stringify(received[i])) { return j(new Error("invalid data received", data[i], received[i])); }
				}
				console.log("[CLIENT] no errors found\n");
				r();
			}
		});
	});
}

async function requestTest(client, test) {
	console.log(`[CLIENT] starting ${test} test`);
	console.log("[CLIENT] generating random data");
	const data = new Array(1000).fill().map(() => randomObject(10));
	console.log(`[CLIENT] sending ${data.length} requests`);
	const times = [];
	const total = Date.now();
	const results = [];
	for(const d of data) {
		const time = Date.now();
		const result = await client.request(d);
		times.push(Date.now() - time);
		results.push(result);
	}
	console.log(`[CLIENT] finished in ${Date.now() - total}ms, average response time of ${times.reduce((a, b) => a + b, 0) / times.length}ms`);
	console.log("[CLIENT] verifying data integrity");
	for(let i = 0; i < data.length; i++) {
		if(JSON.stringify(data[i]) !== JSON.stringify(results[i])) { throw new Error("invalid data received", data[i], results[i]); }
	}
	console.log("[CLIENT] no errors found\n");
}

function randomObject(keys) {
	const obj = {};
	for(let i = 0; i < keys; i++) {
		const multibyte = String.fromCharCode(Math.ceil(Math.random() * (2 ** 15)));
		obj[Math.random().toString(36)] = Array(keys).fill().map(() => String.fromCharCode(Math.ceil(Math.random() * (2 ** 7)))).join("") + multibyte;
	}
	return obj;
}
