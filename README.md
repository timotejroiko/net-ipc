# net-ipc

A simple message based IPC client/server providing bi-directional communication over sockets and TCP.

## Features

* Promises
* Unix/Windows sockets for local communication
* TCP for remote communication
* Supports multiple clients
* Supports request-response, survey and broadcast
* Supports Synchronous zlib-stream (requires installing "fast-zlib")
* Sexy
* Fast

## Usage

```js
// server side

const { Server } = require("net-ipc");

const server = new Server({
    port: 8333, // for TCP
    // path: "mypath", // for sockets
    // max: 100 // max number of clients (default unlimited)
    // retries: 5 // number of retries in case of unnatural disconnections (default 3)
});

server.on("ready", url => {
    console.log(`server started on ${url}`);
});

server.on("error", console.error);

server.on("connect", (client, data) => {
    console.log(`received new connection and assigned it the id ${client.id}`);
    console.log(`the connection sent an initial payload containing ${data}`);
});

server.on("disconnect", (client, reason) => {
    console.log(`client id ${client.id} disconnected with reason ${reason}`);
});

server.on("message", async (message, client) => {
    // received when any client uses .send()
    console.log(`received message ${message} from client id ${client.id}`);
});

server.on("request", (req, res, client) => {
    // received when any client uses .request()
    console.log(`received request from client id ${client.id} containing ${req}`);
    // reply to this request. client will receive "something" in the promise returned by .request()
    // res is an async function, will reject if the reply fails
    res("something").catch(console.error);
});

// send a message to all clients. each client will receive it in a message event
server.broadcast("hello everyone!");

// send a request to all clients. each client will receive it in a request event
server.survey("survey").then(results => {
    // returns an array of promise outcomes according to https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled
});

// all connected clients are accessible in the server.connections array and can be independently interacted with
server.connections.find(connection => connection.id === "someid")?.send("hi");

server.start().catch(console.error);
```

```js
// client side

const { Client } = require("net-ipc");

const client = new Client({
    url: "localhost:8333", // for TCP
    // path: "mypath", // for sockets
    // compress: true // enable zlib-stream compression (requires installing "fast-zlib")
    // reconnect: true // autoreconenct on unnatural disconnections (default true)
    // retries: 5 // number of retries in case of unnatural disconnections (default 3)
});

client.on("ready", async data => {
    console.log(`established new connection, received id ${data.id} from server`);

    // send a message to the server
    await client.send("execute broadcast").catch(console.error);

    // send a request to the server
    // will reject after a timeout if the server does not respond
    // will reject immediately if the server does not listen to the request event
    let response = await client.request("did you receive this?").catch(e => `oops: ${e}`);
    console.log(response);
});

client.on("message", message => {
    // messages sent by the server via server.broadcast() or connection.send()
    console.log(message);
});

client.on("request", (req, res) => {
    // requests sent by the server via server.survey() or connection.request()
    console.log(`received request from server containing ${req}`);
    // res is an async function, will reject if the reply fails
    res("response").catch(console.error);
});

client.connect("hi").catch(console.error);
```

## Docs

* **`Class Server extends EventEmitter`** - Server class.
* **`Class Client extends EventEmitter`** - Client class.
* **`Class Connection`** - Server-side Client class.

### Server Events

* **`ready -> (address:string)`** - Emitted when the server starts listening.
* **`error -> (Error, Connection)`** - Emitted when an error occures. If there is no listener, the error will be swallowed to avoid crashing the server.
* **`connect -> (Connection, payload?:any)`** - Emitted when a new client connects. Includes the initial payload if one exists.
* **`disconnect -> (Connection, reason?:any)`** - Emitted when a client disconnects. Includes the reason for disconnect if one exists.
* **`close -> ()`** - Emitted when the server is shut down.
* **`message -> (message:any, Connection)`** - Emitted when the server receives a message from a client.
* **`request -> (request:any, response:asyncFunction, Connection)`** - Emitted when the server receives a request from a client.

### Server Methods

* **`.start() -> promise<Server>`** - Starts the server.
* **`.close() -> promise<Server>`** - Gracefully disconnects all clients and closes the server.
* **`.broadcast(data:any) -> promise<void>`** - Sends a message to all clients. Errors will be forwarded to the error event and wont reject the promise.
* **`.survey(data:any, timeout?:integer) -> promise<object[]>`** - Sends a request to all clients and waits for them to respond. Returns an array of objects containing promise statuses and results. Timeout is 10 seconds by default. Set to 0 to wait forever.
* **`.ping(data:any) -> promise<object[]>`** - Sends a ping request to all clients and waits for them to respond. Returns an array of objects containing the promise statuses and results.
* **`.pause() -> void`** - Pause receiving messages on all connections. Messages will be queued by their clients.
* **`.resume() -> void`** - Resume receiving messages on all connections. Queued messages will be immediately emitted.

### Server Properties

* **`.connections -> Connection[]`** - Array of currently connected clients. Connection instances are also Clients and can use the same methods for bidirectional communication.
* **`.options -> object`** - Current server options.
* **`.server -> net.Server`** - Internal instance of net.Server.

### Connection Methods

* **`.send(data:any) -> promise<void>`** - Sends a message to the corresponding client.
* **`.request(data:any, timeout?:integer) -> promise<any>`** - Sends a request to the corresponding client and waits for a response. Timeout is 10 seconds by default. Set to 0 to wait forever.
* **`.ping(data:any) -> promise<integer>`** - Sends a ping request to the corresponding client.
* **`.pause() -> void`** - Pause receiving messages on this connection. Messages will be queued on the client side.
* **`.resume() -> void`** - Resume receiving messages on this connection. Queued messages will be immediately emitted.
* **`.close(reason:any) -> promise<bool>`** - Finishes all pending jobs then closes the connection.
* **`.destroy(reason:any) -> bool`** - Rejects all pending jobs and closes the connection.

### Connection Properties

* **`.id -> string?`** - The ID assigned to the client by the server after connecting.
* **`.server -> Server`** - Reference to the parent Server instance.
* **`.connection -> net.Client`** - Internal instance of net.Client.

### Client Events

* **`ready -> (response:object)`** - Emitted when the client connects to the server. Includes a server assigned id and compression status.
* **`error -> (error)`** - Emitted when an error occures. If there is no listener, the error will be swallowed but the connection might still be closed depending on the error.
* **`close -> (reason:any)`** - Emitted when the connection is closed. Includes the reason for closing if any.
* **`status -> (status:integer)`** - Emitted when the connection suffers a status change, including disconnections and reconnections.
* **`message -> (message:any)`** - Emitted when the client receives a message from a server.
* **`request -> (request:any, response:asyncFunction)`** - Emitted when the client receives a request from a server.

### Client Methods

* **`.connect(payload:any) -> promise<Client>`** - connects to the server and optionally sends an initial payload.
* **`.send(data:any) -> promise<void>`** - Sends a message to the server.
* **`.request(data:any, timeout?:integer) -> promise<any>`** - Sends a request to the server and waits for a response. Timeout is 10 seconds by default. Set to 0 to wait forever.
* **`.ping(data:any) -> promise<integer>`** - Sends a ping request to the server.
* **`.close(reason:any) -> promise<bool>`** - Finishes all pending jobs then closes the connection.
* **`.destroy(reason:any) -> bool`** - Rejects all pending jobs and closes the connection.

### Client Properties

* **`.id -> string?`** - The ID assigned to the client by the server after connecting.
* **`.status -> integer`** - Current client status.
* **`.options -> object`** - Current client options.
* **`.connection -> net.Client`** - Internal instance of net.Client.

### Client Statuses

```js
IDLE:           0
CONNECTING:     1
CONNECTED:      2
READY:          3
DISCONNECTED:   4
RECONNECTING:   5
```
