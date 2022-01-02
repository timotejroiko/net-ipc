# Server

The `net-ipc` Server class, extends Node's [EventEmitter](https://nodejs.org/api/events.html#class-eventemitter).

|parameter|type|required|default|description|
|-|-|-|-|-|
|options|[Server Options](#Server Options)|no|{}|Server options|

```js
const { Server } = require("net-ipc");

const server = new Server({
    port: 9999
});

server.on("message", (message, connection) => {
    console.log(`${message} from ${connection.id}`)
})

server.start().then(console.log).catch(console.error);
```

&nbsp;

## Server Options

|parameter|type|required|default|description|
|-|-|-|-|-|
|path|string|no|"net-ipc"|Unix domain socket path. If port is not provided, the server will operate in socket mode|
|port|number|no|-|TCP port to bind the server to. If provided, the server will operate in TCP mode, otherwise it will fallback to socket mode|
|tls|boolean|no|false|If enabled, the server will operate in secure mode. An SSL certificate or PSK configuration will be required in the `options` field|
|options|object|no|{}|[TLSServer](https://nodejs.org/api/tls.html#tlscreateserveroptions-secureconnectionlistener) options if tls is enabled, [netServer](https://nodejs.org/api/net.html#netcreateserveroptions-connectionlistener) options otherwise|
|max|number|no|-|Maximum number of concurrent clients the server will accept, unlimited otherwise|
|retries|number|no|3|Maximum number of retries on connection failure before rejecting an operation|

&nbsp;

## Server Events

### ready

Emitted when the server starts listening.

|params|type|description|
|-|-|-|
|address|string|The path or url the server is listening to|

```js
server.on("ready", address => {
    console.log(`server started on ${address}`);
});
```

### error

Emitted when an error occures. If there is no listener, the error will be swallowed to avoid crashing the server. If no error listener is attached, all errors will be silently swallowed and the server will continue operating normally.

|params|type|description|
|-|-|-|
|error|[Error](https://developer.mozilla.org/en-US/docs/web/javascript/reference/global_objects/error)|An error instance describing the problem|
|connection|[Connection](#Connection)|The connection where the error happened|

```js
server.on("error", (error, connection) => {
    console.log(`an error happened in the connection ${connection.id}: ${error.message}`);
    console.log(error);
});
```

### connect

Emitted when a new client connects. Includes the initial payload if sent by the client. This can be used for additional authorization procedures.

|params|type|description|
|-|-|-|
|connection|[Connection](#Connection)|The connection instance for the client that connected|
|payload|any|The initial payload sent by the client, if any|

```js
server.on("connect", (connection, payload) => {
    console.log(`new connection! assigned it the following id: ${connection.id}`);
    if(payload) {
        console.log(`client sent an initial payload:`);
        console.log(payload);
        /* auth example
        if(payload !== "superSecretPassword") {
            connection.close();
        }
        */
    }
});
```

### disconnect

Emitted when a client disconnects. Includes the reason for disconnect if one exists.

|params|type|description|
|-|-|-|
|connection|[Connection](#Connection)|The connection instance for the client that disconnected|
|reason|any|The reason for disconnection if any|

```js
server.on("disconnect", (connection, reason) => {
    console.log(`connection ${connection.id} disconnected because of:`);
    console.log(reason);
});
```

### close

Emitted when the server is shut down.

```js
server.on("close", () => {
    console.log("server closed");
});
```

### message

Emitted when the server receives a message from a client.

|params|type|description|
|-|-|-|
|message|any|The message content|
|connection|[Connection](#Connection)|The connection instance for the client that sent the message|

```js
server.on("message", (message, connection) => {
    console.log(`received a message from ${connection.id}:`)
    console.log(message);
});
```

### request

Emitted when the server receives a request from a client.

|params|type|description|
|-|-|-|
|request|any|The request data sent by the client|
|response|asyncFunction|A function to respond to this request|
|connection|[Connection](#Connection)|The connection instance for the client that sent the request|

```js
server.on("request", (request, response, connection) => {
    console.log(`received request from ${connection.id}`);
    console.log("request content:", request);
    // return a response to this request
    response("hello").catch(console.error);
});
```

&nbsp;

### Server Properties

#### .options

Current server options.

```js
console.log(server.options);
```

#### .connections

Array of [Connection](#Connection) instances representing currently connected clients. Connection instances also implement Client methods for independent bidirectional communication.

```js
for(const connection of server.connections) {
    console.log(connection.id);
    connection.send("hi");
}
```

#### .server

Internal instance of [net.Server](https://nodejs.org/api/net.html#class-netserver) if tls is disabled, or [tls.Server](https://nodejs.org/api/tls.html#class-tlsserver) if tls is enabled, for advanced usage.

```js
console.log(server.server);
```

&nbsp;

### Server Methods

#### .start()

Starts the server.

* **returns => [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)<[Server](#server)>**

```js
server.start().then(server => {
    console.log("server started with options:", server.options);
}).catch(e => {
    console.log("server failed to start:", e);
});
```

#### .close(allowReconnect)

Gracefully disconnects all clients and closes the server. If `allowReconnect` is true, clients will attempt to auto-reconnect for a few seconds after they are disconnected. Use this if you plan to restart the server soon.

|parameter|type|required|default|description|
|-|-|-|-|-|
|allowReconnect|boolean|no|false|Whether the clients should try to reconnect after being disconnected|

* **returns => [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)<[Server](#server)>**

```js
server.close(true).then(server => {
    console.log("server closed, restarting...");
    process.exit();
}).catch(console.error);
```

#### .broadcast(data)

Sends a message to all clients. Transmission errors will be forwarded to the error event and will not reject the promise.

|parameter|type|required|default|description|
|-|-|-|-|-|
|data|any|yes|-|The data to send|

* **returns => [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)<void>**

```js
server.broadcast("hello everyone").then(() => {
    console.log("sent message to all clients");
}).catch(console.error);
```

#### .survey(data, timeout)

Sends a request to all clients and waits for them to respond. Returns an array of [Promise outcome](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled#using_promise.allsettled) objects.

|parameter|type|required|default|description|
|-|-|-|-|-|
|data|any|yes|-|The data to send|
|timeout|number|no|10000|How long to wait for a response from each client before giving up on them|

* **returns => [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)<Array<[outcome](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled#using_promise.allsettled)>>**

```js
server.survey("test").then(results => {
    for(let i = 0; i < server.connections.length; i++) {
        const client = server.connections[i];
        if(results[i].status === "fulfilled") {
            console.log(`client id ${client.id} responded with ${results[i].value}`);
        } else {
            console.log(`client id ${client.id} failed to respond`);
        }
    }
}).catch(console.error);
```

#### .ping(data, timeout)

Sends a ping to all clients and waits for them to respond. Returns an array of [Promise outcome](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled#using_promise.allsettled) objects containig the ping latency values.

|parameter|type|required|default|description|
|-|-|-|-|-|
|data|any|no|-|Optional data to measure the latency for|
|timeout|number|no|10000|How long to wait for a response from each client before giving up on them|

* **returns => [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)<Array<[outcome](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled#using_promise.allsettled)>>**

```js
server.ping("test").then(results => {
    for(let i = 0; i < server.connections.length; i++) {
        const client = server.connections[i];
        if(results[i].status === "fulfilled") {
            console.log(`client id ${client.id} 's ping is ${results[i].value}`);
        } else {
            console.log(`client id ${client.id} failed to respond`);
        }
    }
}).catch(console.error);
```

#### .pause()

Pause receiving messages on all connections. Clients will be instructued to queue their messages.

* **returns => void**

```js
server.pause();
```

#### .resume()

Resume receiving messages on all connections. Queued messages will be resumed in order.

* **returns => void**

```js
server.resume();
```
