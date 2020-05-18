# fast-ipc
Fast & simple IPC (Inter-Process Communication) server/client build on native net module

## Installation

```sh
npm i fast-ipc
```

## Usage

### Server
```js
import { server } from 'fast-ipc';

const ipcServer =
    new server('example')
        .on('msg', (req) => {
            console.log(req);
            //[1, 2, 3, 4, 5]
        })
        .on('ping', (req, res) => {
            res('pong!');
        })
        .on('event', (req, res) => {
            res({
                data: req,
                timestamp: Date.now()
            });
        });

```

### Client
```js
import { client } from 'fast-ipc';

const ipcClinet = new client('example');

ipcClinet.send('msg', [1, 2, 3, 4, 5]);

ipcClinet.send('ping', [], (msg) => {
    console.log(msg);
    //pong!
});

ipcClinet.send('event', [1, 2, 3, 'testing'], (msg) => {
    console.log(msg);
    //{ data: [ '1', '2', '3', 'testing' ], timestamp: 1577025604487 }
});
```