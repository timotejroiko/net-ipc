# Client

The `net-ipc` Client class, extends Node's [EventEmitter](https://nodejs.org/api/events.html#class-eventemitter).

|parameter|type|required|default|description|
|-|-|-|-|-|
|options|[Client Options](#client-options)|no|{}|Client options|

```js
const { Client } = require("net-ipc");

const client = new Client({
    host: 364.24.253.23,
    port: 9999
});

client.on("message", message => {
    console.log(`received message from server:`, message);
})

client.connect().then(console.log).catch(console.error);
```

&nbsp;

## Client Options

|parameter|type|required|default|description|
|-|-|-|-|-|
|path|string|no|"net‑ipc"|Unix domain socket path. If host and port are not provided, the client will connect using socket mode|
|host|string|no|-|Pomain name or IP address to connect using TCP mode|
|port|number|no|4466|Port number to use when connecting using TCP mode|
|tls|boolean|no|false|If enabled, the client will connect in secure mode. The server must also be running in secure mode or be behind an SSL proxy|
|handshake|boolean|no|false|If enabled, the client simulate a websocket handshake for compatibility with http/https proxies|
|options|object|no|{}|[tls.TLSSocket](https://nodejs.org/api/tls.html#class-tlstlssocket) options if tls is enabled or [net.Socket](https://nodejs.org/api/net.html#class-netsocket) options otherwise|
|compress|boolean|no|false|If enabled, all messages will be compressed using a shared zlib context (requires installing `fast-zlib`)|
|messagepack|boolean|no|false|if enabled, all messages will be serialized using messagepack instead of json (requires installing `msgpackr`)|
|reconnect|boolean|no|true|Whether the client should attempt to auto-reconnect on failure|
|retries|number|no|3|Maximum number of retries before giving up (affects both connections and individual messages)|
|maxRetryTime|number|no|10000|Maximum waiting time between each retry (the waiting time starts at 500ms, increasing by 500ms for each subsequent failure, but never exceeding this maximum, until the retry limit is reached)|

&nbsp;

## Client Events

### ready

Emitted when the client connects to the server. Includes a server assigned id and information about the connection.

|params|type|description|
|-|-|-|
|response|object|Information about the connection|

```js
client.on("ready", connection => {
    console.log(`connected to server`, connection);
});
```

### error

Emitted when an error occures. If there is no listener, the error will be swallowed but the connection might still be closed depending on the error, in which case the error will be included in the `close` event as the reason for closing.

|params|type|description|
|-|-|-|
|error|error|An error instance describing the problem|

```js
client.on("error", error => {
    console.error(error);
});
```

### close

Emitted when the connection is closed permanently, either when instructed by the server or after exhausting all reconnection attempts. Includes the reason for closing if any.

|params|type|description|
|-|-|-|
|reason|any|The reason for closing if any|

```js
client.on("close", reason => {
    console.log("connection was closed. reason:", reason);
});
```

### status

Emitted when the connection suffers a status change, including disconnections and reconnections. Statuses include:

IDLE:           0
CONNECTING:     1
CONNECTED:      2
READY:          3
DISCONNECTED:   4
RECONNECTING:   5

|params|type|description|
|-|-|-|
|status|number|the new status|

```js
client.on("status", status => {
    console.log(`status changed: ${status}`);
});
```

### message

Emitted when the client receives a message from a server.

|params|type|description|
|-|-|-|
|message|any|The message content|

```js
client.on("message", message => {
    console.log("received message", message);
});
```

### request

Emitted when the client receives a request from a server.

|params|type|description|
|-|-|-|
|request|any|The message content|
|response|asyncFunction|A function to respond to this request|

```js
client.on("request", async (request, response) => {
    console.log("received request from the server:", request);
    await response("acknowledged");
});
```

&nbsp;

### Client Properties

### .id

The ID assigned to the client by the server after connecting.

* **type: string**

```js
console.log(client.id);
```

### .status

The client's current status. Statuses include:

IDLE:           0
CONNECTING:     1
CONNECTED:      2
READY:          3
DISCONNECTED:   4
RECONNECTING:   5

* **type: number**

```js
console.log(client.status);
```

### .options

The client's current options.

* **type: object**

```js
console.log(client.options);
```

### .connection

The client's internal instance of [tls.TLSSocket](https://nodejs.org/api/tls.html#class-tlstlssocket) if tls is enabled or [net.Socket](https://nodejs.org/api/net.html#class-netsocket) otherwise.

* **type: [net.Socket](https://nodejs.org/api/net.html#class-netsocket) | [tls.TLSSocket](https://nodejs.org/api/tls.html#class-tlstlssocket)**

```js
console.log(client.connection);
```

&nbsp;

### Client Methods

### .connect(payload)

Connects to the server and optionally sends an initial payload.

|parameter|type|required|default|description|
|-|-|-|-|-|
|payload|any|no|-|Initial data to send when connecting|

* **returns: Promise<[Client](#client)>**

```js
client.connect("hello").then(() => {
    console.log("sent initial payload");
}).catch(console.error);
```

### .send(data)

Sends a message to the server.

|parameter|type|required|default|description|
|-|-|-|-|-|
|data|any|yes|-|Data to send|

* **returns: Promise\<void\>**

```js
client.send("hello").then(() => {
    console.log("sent hello");
}).catch(console.error);
```

### .request(data, timeout)

Sends a request to the server.

|parameter|type|required|default|description|
|-|-|-|-|-|
|data|any|yes|-|Data to send|
|timeout|number|no|10000|How long to wait for a response before rejecting, 0 to wait forever|

* **returns: Promise\<any\>**

```js
client.request("what time is it?").then(response => {
    console.log(`server responded with: ${response}`);
}).catch(console.error);
```

### .ping(data, timeout)

Sends a ping request to the server and waits for a response.

|parameter|type|required|default|description|
|-|-|-|-|-|
|data|any|no|-|Optional data to measure the latency for|
|timeout|any|no|10000|How long to wait before rejecting, 0 to wait forever|

* **returns: Promise\<number\>**

```js
client.ping("", 5000).then(ping => {
    console.log(`current ping: ${ping}ms`);
}).catch(console.error);
```

### .close(reason)

Gracefully disconnects the client. Any pending operations will be fulfilled before the connection is closed.

|parameter|type|required|default|description|
|-|-|-|-|-|
|reason|any|no|-|The reason for disconnecting|

* **returns: Promise\<boolean\>**

```js
client.close("shutting down").then(done => {
    if(done) {
        console.log(`successfully disconnected`);
    } else {
        /* no-op... already disconnected? */
    }
}).catch(console.error);
```

### .destroy(reason)

Immediately disconnects the client. Any pending operations will be rejected.

|parameter|type|required|default|description|
|-|-|-|-|-|
|reason|any|no|-|The reason for disconnecting|

* **returns: boolean**

```js
client.destroy("shutting down");
console.log("disconnected");
```
