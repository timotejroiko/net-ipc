"use strict";

const { Client } = require("../index.js");

const c1 = new Client();
const c2 = new Client({ compress: true });
const c22 = new Client({ messagepack: true });
const c222 = new Client({
	compress: true,
	messagepack: true
});

const c3 = new Client({ url: "localhost:8333" });
const c4 = new Client({
	url: "localhost:8333",
	compress: true
});
const c44 = new Client({
	url: "localhost:8333",
	compress: false,
	messagepack: true
});
const c444 = new Client({
	url: "localhost:8333",
	compress: true,
	messagepack: true
});

console.log("clients started");

(async () => {
	const c01 = await c1.connect();
	await messageTest(c01, "socket");
	await requestTest(c01, "socket request");

	const c02 = await c2.connect();
	await messageTest(c02, "compressed socket");
	await requestTest(c02, "compressed socket request");

	const c022 = await c22.connect();
	await messageTest(c022, "messagepack socket");
	await requestTest(c022, "messagepack socket request");

	const c0222 = await c222.connect();
	await messageTest(c0222, "compressed messagepack socket");
	await requestTest(c0222, "compressed messagepack socket request");

	const c03 = await c3.connect();
	await messageTest(c03, "tcp");
	await requestTest(c03, "tcp request");

	const c04 = await c4.connect();
	await messageTest(c04, "compressed tcp");
	await requestTest(c04, "compressed tcp request");

	const c044 = await c44.connect();
	await messageTest(c044, "messagepack tcp");
	await requestTest(c044, "messagepack tcp request");

	const c0444 = await c444.connect();
	await messageTest(c0444, "compressed messagepack tcp");
	await requestTest(c0444, "compressed messagepack tcp request");

	await c01.send("finish");

	process.exit();
})();

async function messageTest(client, test) {
	console.log(`[CLIENT] starting ${test} test`);
	console.log("[CLIENT] generating random data");
	const data = new Array(99999).fill().map(() => Math.random().toString(36));
	console.log("[CLIENT] sending data");
	client.send({ test: `${data.length} random strings` });
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
	return new Promise(r => {
		const received = [];
		timer = Date.now();
		client.on("message", m => {
			received.push(m);
			if(received.length === data.length) {
				console.log(`[CLIENT] received ${received.length} messages in ${Date.now() - timer}ms`);
				console.log("[CLIENT] verifying data integrity");
				for(let i = 0; i < data.length; i++) {
					if(data[i] !== received[i]) { throw new Error("invalid data received"); }
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
	const data = new Array(10000).fill().map(() => Math.random().toString(36) + Math.random().toString(36) + Math.random().toString(36));
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
		if(data[i] !== results[i]) { throw new Error("invalid data received"); }
	}
	console.log("[CLIENT] no errors found\n");
}
