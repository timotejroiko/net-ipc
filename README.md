# net-ipc

A simple message based IPC client/server providing bi-directional communication over sockets and TCP.

## Features

* Promises
* Unix/Windows sockets for local communication
* TCP for remote communication
* Supports multiple clients
* Supports request-response, survey and broadcast
* Synchronous zlib-stream (requires installing "fast-zlib")
* Sexy
* Fast

## Usage

```js
// server side

const { Server } = require("net-ipc");

const server = new Server({
    port:8333, // for TCP
    //path:"mypath", // for sockets
    //max: 100 // max number of clients (default unlimited)
});

server.on("ready", url => {
    console.log(`server started on ${url}`);
});

server.on("error", console.error);

server.on("connect", async (client, data) => {
    console.log(`received new connection and assigned it the id ${client.id}`);
    console.log(`the connection send an initial payload containing ${data}`);
});

server.on("disconnect", (client, reason) => {
    console.log(`client id ${client.id} disconnected with reason ${reason}`)
});

server.on("message", async (message, client) => {
    console.log(`received message ${message} from client id ${client.id}`); //hi
    if(message === "execute broadcast") {
        await server.broadcast("hello everyone!");
    }
});

server.on("request", async (req, res, client) => {
    console.log(`received request from client id ${client.id} containing ${req}`); // did you receive this? // haha
    if(req === "did you receive this?") {
        await res("yes abcdefg");
    } else if(req === "run survey") {
        let data = await server.survey("survey");
        res(data);
    }
});

server.start().catch(console.error);
```

```js
// client side

const { Client } = require("net-ipc");

const client = new Client({
    url:"localhost:8333", // for TCP
    //path:"mypath", // for sockets
    //compress:true // enable zlib-stream compression (requires installing "fast-zlib")
});

client.on("ready", async data => {
    console.log(`established new connection, received id ${data.id} from server`);
    await client.send("hi");

    let response = await client.request("did you receive this?");
    console.log(response) // yes abcdefg

    let response2 = await client.request("haha", 1000).catch(e => "no response");
    console.log(response2) // no response

    await client.send("execute broadcast");

    let results = await client.request("run survey");
    console.log(results) // [1]
});

client.on("message", message => {
    console.log(message) // hello everyone!
});

client.on("request", async (req, res) => {
    if(req === "survey") {
        await res(1);
    }
});

client.connect("hi").catch(console.error);
```

## Docs

* **`Class Server extends EventEmitter`** - Server class.
* **`Class Client extends EventEmitter`** - Client class.

### Server Events

* **`ready -> (address:string)`** - Emitted when the server starts listening.
* **`error -> (error)`** - Emitted when an error occures. If there is no listener, the error will be swallowed.
* **`connect -> (Client, payload:any)`** - Emitted when a new client connects. Includes the initial payload it exists.
* **`disconnect -> (Client, reason:any)`** - Emitted when a client disconnects. Includes reason for disconnect if it exists.
* **`close -> ()`** - Emitted when the server is closed.
* **`message -> (message:any, Client)`** - Emitted when the server receives a message from a client.
* **`request -> (request:any, response:asyncFunction, Client)`** - Emitted when the server receives a request from a client.

### Server Methods

* **`start() -> promise<Server>`** - Starts the server.
* **`close() -> Server`** - Disconnects all clients and closes the server.
* **`broadcast(data:any) -> promise<void>`** - Sends a message to all clients. Errors will be forwarded to the error event and wont reject the promise.
* **`survey(data:any, timeout:integer) -> promise<object[]>`** - Sends a request to all clients. Returns an array of objects containing promise statuses and results.
* **`ping(data:any) -> promise<object[]>`** - Sends a ping request to all clients. Returns an array of objects containing the promise statuses and results.

### Server Properties

* **`.connections -> Client[]`** - Array of currently connected clients.
* **`.options -> object`** - Current server options.
* **`.server -> net.Server`** - Internal instance of net.Server.

### Client Events

* **`ready -> (response:object)`** - Emitted when the client connects to the server. Includes a server assigned id and compression status.
* **`error -> (error)`** - Emitted when an error occures. If there is no listener, the error will be swallowed.
* **`close -> (reason:any)`** - Emitted when the connection is closed. Includes the reason for closing if any.
* **`message -> (message:any, Client)`** - Emitted when the server receives a message from a client.
* **`request -> (request:any, response:asyncFunction, Client)`** - Emitted when the server receives a request from a client.

### Client Methods

* **`connect(payload:any) -> promise<Client>`** - connects to the server and optionally sends an initial payload.
* **`send(data:any) -> promise<bool>`** - Sends a message to the server.
* **`request(data:any, timeout:integer) -> promise<any>`** - Sends a request to the server and waits for a response.
* **`ping(data:any) -> promise<integer>`** - Sends a ping request to the server.
* **`close(reason:any) -> promise<bool>`** - Finishes all pending jobs then closes the connection.
* **`destroy(reason:any) -> bool`** - Rejects all pending jobs and closes the connection.

### Client Properties

* **`.id -> string?`** - The ID assigned to the client by the server after connecting.
* **`.options -> object`** - Current client options.
* **`.connection -> net.Client`** - Internal instance of net.Client.