"use strict";

const { fork } = require("child_process");

fork(`${__dirname}/server.js`);

setTimeout(() => {
	fork(`${__dirname}/client.js`);
}, 1000);
