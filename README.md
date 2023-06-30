# net-ipc

A simple message based IPC client/server providing bi-directional communication over sockets and TCP.

## Features

* Promises
* Unix/Windows sockets for local communication
* TCP for remote communication
* Supports multiple clients
* Supports request-response, survey and broadcast operations
* Supports secure connections (tls/ssl)
* Supports http/https proxies
* Built-in zlib support (requires installing `fast-zlib`)
* Built-in messagepack support (requires installing `msgpackr`)
* Sexy
* Fast

## Documentation

* [Client](https://github.com/timotejroiko/net-ipc/blob/master/docs/client.md) - The `net-ipc` client
* [Server](https://github.com/timotejroiko/net-ipc/blob/master/docs/server.md) - The `net-ipc` server

## Examples

### Server Examples

Local IPC server for communication between processes in the same machine.

```js
const { Server } = require("net-ipc");
const server = new Server({
    path: "/myapp"
});

server.start().catch(console.error);
```

TCP server for remote communication over the internet.

```js
const { Server } = require("net-ipc");
const server = new Server({
    port: 4466
});

server.start().catch(console.error);
```

Secure TCP server with a domain name and an SSL certificate directly exposed to the web.

```js
const { readFileSync } = require("fs");
const { Server } = require("net-ipc");
const server = new Server({
    port: 443,
    tls: true,
    options: {
        cert: readFileSync("/path/to/certificate.pem"),
        key: readFileSync("/path/to/key.pem")
    }
});

server.start().catch(console.error);
```

Secure TCP server using PSK (pre shared key) instead of an SSL certificate and a domain name. This setup enables secure connections between direct IP addresses.

```js
const USER = "some username";
const KEY = Buffer.from("some password");

const { Server } = require("net-ipc");
const server = new Server({
    port: 4466,
    tls: true,
    options: {
        pskCallback: (socket, identity) => {
            if(identity === USER) { // confirm username
                return KEY; // return password for verification
            }
        },
        ciphers: "PSK", // enable PSK ciphers, they are disabled by default
    }
});

server.start().catch(console.error);
```

### Client Examples

Connecting to a local IPC server.

```js
const { Client } = require("net-ipc");
const client = new Client({
    path: "/myapp"
});

client.connect().catch(console.error);
```

Connecting to a remote TCP server.

```js
const { Client } = require("net-ipc");
const client = new Client({
    host: "192.168.1.25",
    port: 4466
});

client.connect().catch(console.error);
```

Connecting to a remote TCP server secured with an SSL certificate and a domain name.

```js
const { Client } = require("net-ipc");
const client = new Client({
    host: "somedomain.com",
    port: 443,
    tls: true
});

client.connect().catch(console.error);
```

Connecting to a remote TCP server secured with a PSK.

```js
const USER = "username here";
const KEY = "password here";

const { Client } = require("net-ipc");
const client = new Client({
    host: "192.168.1.35",
    port: 4466,
    tls: true,
    options: {
        pskCallback: () => {
            // return the user and the key for verification
            return {
                identity: USER,
                psk: Buffer.from(KEY)
            }
        },
        ciphers: "PSK", // enable PSK ciphers, they are disabled by default
        checkServerIdentity: () => void 0; // bypass SSL certificate verification since we are not using certificates
    }
});

client.connect().catch(console.error);
```

Connecting to a TCP server behind an SSL proxy (nginx/replit/etc). The server itself does not need to be secure as the proxy does it instead.

```js
const { Client } = require("net-ipc");
const client = new Client({
    host: "somedomain.com",
    port: 443,
    tls: true,
    handshake: true // simulates websocket http handshake
});

client.connect().catch(console.error);
```

### Usage Examples

Request and response example:

```js
// server side
server.on("request", async (req, res, client) => {
    if(req.type === "fetch") {
        const fetched = await someDatabase.fetch(req.data);
        await res(fetched);
    }
});

// client side
const fetched = await client.request({ type: "fetch", data: "someID" });
```
