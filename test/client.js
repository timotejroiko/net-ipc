const { Client } = require("../index.js");

let c1 = new Client();
let c2 = new Client({compress:true});
let c3 = new Client({url:"localhost:8333"});
let c4 = new Client({url:"localhost:8333", compress:true});

console.log("clients started");

(async () => {
	let c01 = await c1.connect();
	await messageTest(c01,"socket");
	await requestTest(c01,"socket request");

	let c02 = await c3.connect();
	await messageTest(c02,"tcp");
	await requestTest(c02,"tcp request");

	let c03 = await c2.connect();
	if(c03.options.compress) {
		await messageTest(c03,"compressed socket");
		await requestTest(c03,"compressed socket request");
	}

	let c04 = await c4.connect();
	if(c04.options.compress) {
		await messageTest(c04,"compressed tcp");
		await requestTest(c04,"compressed tcp request");
	}

	await c01.send("finish");

	process.exit();
})();

async function messageTest(client,test) {
	console.log(`[CLIENT] starting ${test} test`);
	console.log(`[CLIENT] generating random data`);
	let data = new Array(99999).fill().map(() => Math.random().toString(36));
	console.log(`[CLIENT] sending data`);
	client.send({test:`${data.length} random strings`});
	let timer = Date.now();
	for(let d of data) {
		await client.send({data:d});
	}
	console.log(`[CLIENT] sent ${data.length} messages in ${Date.now() - timer}ms`);
	client.send({done:true});
	return new Promise(r => {
		let received = [];
		timer = Date.now();
		client.on("message", m => {
			received.push(m);
			if(received.length === data.length) {
				console.log(`[CLIENT] received ${received.length} messages in ${Date.now() - timer}ms`);
				console.log(`[CLIENT] verifying data integrity`);
				for(let i = 0; i < data.length; i++) {
					if(data[i] !== received[i]) { throw new Error("invalid data received"); }
				}
				console.log(`[CLIENT] no errors found\n`);
				r();
			}
		});
	});
}

async function requestTest(client,test) {
	console.log(`[CLIENT] starting ${test} test`);
	console.log(`[CLIENT] generating random data`);
	let data = new Array(10000).fill().map(() => Math.random().toString(36) + Math.random().toString(36) + Math.random().toString(36));
	console.log(`[CLIENT] sending ${data.length} requests`);
	let times = [];
	let total = Date.now();
	let results = [];
	for(let d of data) {
		let time = Date.now();
		let result = await client.request(d);
		times.push(Date.now() - time);
		results.push(result);
	}
	console.log(`[CLIENT] finished in ${Date.now() - total}ms, average response time of ${times.reduce((a,b) => a + b, 0) / times.length}ms`);
	console.log(`[CLIENT] verifying data integrity`);
	for(let i = 0; i < data.length; i++) {
		if(data[i] !== results[i]) { throw new Error("invalid data received"); }
	}
	console.log(`[CLIENT] no errors found\n`);
}
