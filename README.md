# socket.io-s3-server

## Example

### Server side

```javascript
"use strict";
const express = require('express');
const app = express();
const http = require('http');
const httpServer = http.Server(app);
const io = require('socket.io')(httpServer);
const SocketIOS3Server = require('socket.io-s3-server');

app.get('/', (req, res, next) => {
	return res.sendFile(__dirname + '/client/index.html');
});

app.get('/app.js', (req, res, next) => {
	return res.sendFile(__dirname + '/client/app.js');
});

app.get('/socket.io.js', (req, res, next) => {
	return res.sendFile(__dirname + '/node_modules/socket.io-client/dist/socket.io.js');
});

app.get('/socket-io-s3-client.js', (req, res, next) => {
	return res.sendFile(__dirname + '/node_modules/socket.io-s3-client/socket-io-s3-client.js');
});

io.on('connection', (socket) => {
	console.log('Socket connected.');

	var uploader = new SocketIOS3Server(socket, {
		// uploadDir: {			// multiple directories
		// 	music: 'data/music',
		// 	document: 'data/document'
		// },
		uploadDir: 'data',							// simple directory
		accepts: ['audio/mpeg', 'audio/mp3'],		// chrome and some of browsers checking mp3 as 'audio/mp3', not 'audio/mpeg'
		maxFileSize: 4194304, 						// 4 MB. default is undefined(no limit)
		chunkSize: 10240,							// default is 10240(1KB)
		transmissionDelay: 0,						// delay of each transmission, higher value saves more cpu resources, lower upload speed. default is 0(no delay)
		overwrite: true 							// overwrite file if exists, default is true.
	});
	uploader.on('start', (fileInfo) => {
		console.log('Start uploading');
		console.log(fileInfo);
	});
	uploader.on('stream', (fileInfo) => {
		console.log(`${fileInfo.wrote} / ${fileInfo.size} byte(s)`);
	});
	uploader.on('complete', (fileInfo) => {
		console.log('Upload Complete.');
		console.log(fileInfo);
	});
	uploader.on('error', (err) => {
		console.log('Error!', err);
	});
	uploader.on('abort', (fileInfo) => {
		console.log('Aborted: ', fileInfo);
	});
});

httpServer.listen(3000, () => {
	console.log('Server listening on port 3000');
});
```

### Client side

```javascript
var socket = io('http://localhost:3000');
var uploader = new SocketIOS3ServerClient(socket);
var form = document.getElementById('form');

uploader.on('start', function(fileInfo) {
	console.log('Start uploading', fileInfo);
});
uploader.on('stream', function(fileInfo) {
	console.log('Streaming... sent ' + fileInfo.sent + ' bytes.');
});
uploader.on('complete', function(fileInfo) {
	console.log('Upload Complete', fileInfo);
});
uploader.on('error', function(err) {
	console.log('Error!', err);
});
uploader.on('abort', function(fileInfo) {
	console.log('Aborted: ', fileInfo);
});

form.onsubmit = function(ev) {
	ev.preventDefault();
	
	var fileEl = document.getElementById('file');
	var uploadIds = uploader.upload(fileEl);

};
```

```html
<html>
<head>
	<meta charset="UTF-8">
</head>
<body>

	<form id="form">
		<input type="file" id="file" multiple />
		<input type="submit" value="Upload" />
	</form>

	<script src="socket.io.js"></script>
	<script src="socket-io-s3-client.js"></script>
	<script src="app.js"></script>
</body>
</html>
```


## API
### constructor SocketIOS3Server(io socket, Object options)
Create new SocketIOS3Server object.

Available optionts:
- String uploadDir: String of directory want to upload. This value can be relative or absolute both. Or you can pass the object which has key as identifier, value as directory for multiple directories upload. Client can select the destination if server has multiple upload directories. Check the example to details.
- Array accepts: Array of string that refers mime type. Note that browsers and server can recognize different(like mp3 file, Chrome recognize as "audio/mp3" while server recognize as "audio/mpeg"). See the example to detail later. Default is empty array, which means accept every file.
- Number maxFileSize: Bytes of max file size. Default is undefined, means no limit.
- Number chunkSize: Size of chunk you sending to. Default is 10240 = 1KB. Higher value gives you faster upload, uses more server resources. Lower value saves your server resources, slower upload.
- Number transmissionDelay: Delay of each chunk transmission, default is 0. 0 means no delay, unit is ms. Use this property wisely to save your server resources with chunkSize.
- Boolean overwite: If sets true, overwrite the file if already exists. Default is false, which upload gonna complete immediately if file already exists. 
- String rename: Rename the file before upload starts.
- Function rename: Rename the file before upload starts. Return value is use for the name. This option is useful to upload file without overwriting concerns. Check the details from later example.

### Events
SocketIOS3Server provides these events.

#### ready
Fired on ready, means after synchronize meta data from client.

#### start
Fired on starting file upload. This means server grant your uploading request and create empty file to begin writes. Argument has:
- String name: Name of the file
- Number size: Size of the file(bytes)
- String uploadDir: Directory for writing.

#### stream
Fired on getting chunks from client. Argument has:
- String name
- String uploadDir
- Number size
- Number wrote: Bytes of wrote

#### complete
Fired on upload complete. Argument has:
- String name
- String uploadDir
- String mime: MIME type that server recognized.
- Number size
- Number wrote
- Number estimated: Estimated uploading time as ms.

#### abort
Fired on abort uploading.
- String name
- String uploadDir
- Number size
- Number wrote

#### error
Fired on got an error. Passes Error object.


## Browser Supports
This module uses FileReader API with ArrayBuffer, so make sure your browser support it.