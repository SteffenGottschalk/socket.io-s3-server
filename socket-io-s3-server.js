"use strict";
const EventEmitter = require('events').EventEmitter;
const util = require('util');
const fs = require('fs');
const path = require('path');
const mime = require('mime');

function mkdirSyncRecursively(dir, mode) {
	try {
		var result = fs.mkdirSync(dir, mode);
	}
	catch (e) {
		if (e.code === 'ENOENT') {
			mkdirSyncRecursively(path.dirname(dir), mode);  // if does not exists, create all parents recursively
			mkdirSyncRecursively(dir, mode);   // retry
		}
	}
}

function createDirectoryIfNotExists(dir) {
	try {
		fs.accessSync(dir, fs.F_OK);
	}
	catch (e) {
		// create directory if not exists
		mkdirSyncRecursively(dir, '0755');
	}
}

function guid() {
	function s4() {
		return Math.floor((1 + Math.random()) * 0x10000)
			.toString(16)
			.substring(1);
	}
	return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
		s4() + '-' + s4() + s4() + s4();
};

function SocketIOS3Server(socket, options) {
	if (!socket) {
		throw new Error('SocketIOS3Server requires Socket.');
	}

	this.options = options || {};
	this.maxFileSize = +options.maxFileSize || undefined;
	this.accepts = options.accepts || [];
	this.chunkSize = +options.chunkSize || 10240;
	this.transmissionDelay = options.transmissionDelay || 0;
	this.overwrite = !!options.overwrite || false;
	this.rename = options.rename || null;

	if (!options.uploadDir) {
		throw new Error('No upload directory specified.');
	}

	// check directory is exists
	if (typeof options.uploadDir === 'string') {
		createDirectoryIfNotExists(options.uploadDir);
	}
	else if (typeof options.uploadDir === 'object') {
		for (var key in options.uploadDir) {
			createDirectoryIfNotExists(options.uploadDir[key]);
		}
	}
	else {
		throw new Error('options.uploadDir must be string or object array.');
	}

	this.socket = socket;

	socket.once('socket.io-s3::reqSync', () => {
		socket.emit('socket.io-s3::recvSync', {
			maxFileSize: this.maxFileSize,
			accepts: this.accepts,
			chunkSize: this.chunkSize,
			transmissionDelay: this.transmissionDelay
		});

		this.emit('ready');
	});

	var self = this;
	var uploadingFiles = {};

	socket.on('socket.io-s3::createFile', (fileInfo) => {
		var id = fileInfo.id;
		var uploadDir = null;
		var uploadTo = fileInfo.uploadTo || '';

		function sendError(err) {
			socket.emit(`socket.io-s3::error::${id}`, {
				message: err.message
			});
			self.emit('error', err);
		}


		var filenameDisplayName = fileInfo.name;
		var filenameGuid = guid();
		var filename = filenameGuid;
		var filepath = filenameGuid;
		var fileExtension = fileInfo.name.split('.').pop();

		if (this.rename) {
			if (typeof this.rename === 'function') {
				filename = this.rename(filename);
			}
			else {
				filename = this.rename;
			}
		}

		if (typeof options.uploadDir === 'string') {
			uploadDir = path.join(options.uploadDir, filename);
		}
		else if (typeof options.uploadDir === 'object') {
			if (!uploadTo) {
				return sendError(new Error('Upload directory must be specified in multiple directories.'));
			}
			else if (options.uploadDir[uploadTo]) {
				uploadDir = path.join(options.uploadDir[uploadTo], filename);
			}
			else {
				return sendError(new Error('Upload directory ' + uploadTo + ' is not exists.'));
			}
		}
		else if (fileInfo.size > this.maxFileSize) {
			this.emit('error', err);
			return sendError(new new Error('Max Uploading File size must be under ' + this.maxFileSize + ' byte(s).'));
		}

		var startTime = new Date();

		this.emit('start', {
			name: filename,
			size: fileInfo.size,
			uploadDir: uploadDir,
			guid: filenameGuid,
			displayName: filenameDisplayName,
			path: filepath,
			extension: fileExtension
		});

		const uploadComplete = () => {
			const ws = uploadingFiles[id].writeStream;

			if (ws) {
				ws.end();
			}

			const endTime = new Date();

			const mimeType = mime.lookup(uploadDir);
			const emitObj = {
				name: filename,
				size: uploadingFiles[id].size,
				wrote: uploadingFiles[id].wrote,
				uploadDir: uploadingFiles[id].uploadDir,
				mime: mimeType,
				estimated: endTime - startTime,
				guid: filenameGuid,
				displayName: filenameDisplayName,
				extension: fileExtension
			};

			if (this.accepts && this.accepts.length > 0) {
				let found = false;

				for (var i = 0; i < this.accepts.length; i++) {
					let accept = this.accepts[i];

					if (mimeType === accept) {
						found = true;
						break;
					}
				}

				// if mime is invalid, remove files and emit error
				if (!found) {
					fs.unlink(uploadDir);	// no after works.

					let err = new Error('Not Acceptable file type ' + mimeType + ' of ' + filename + '. Type must be one of these: ' + this.accepts.join(', '));
					this.emit('error', err);
					return sendError(err);
				}
				else {
					self.emit('complete', emitObj);

					delete emitObj.uploadDir;
					self.socket.emit(`socket.io-s3::complete::${id}`, emitObj);
				}
			}
			else {
				self.emit('complete', emitObj);

				delete emitObj.uploadDir;
				self.socket.emit(`socket.io-s3::complete::${id}`, emitObj);
			}

			// Release event handlers
			socket.removeAllListeners(`socket.io-s3::stream::${id}`);
			socket.removeAllListeners(`socket.io-s3::done::${id}`);
			socket.removeAllListeners(`socket.io-s3::complete::${id}`);
			socket.removeAllListeners(`socket.io-s3::abort::${id}`);
			socket.removeAllListeners(`socket.io-s3::error::${id}`);

			delete uploadingFiles[id];
		};

		uploadingFiles[id] = {
			writeStream: null,
			name: fileInfo.name,
			size: fileInfo.size,
			wrote: 0,
			uploadDir: uploadDir
		};

		if (!options.overwrite) {
			let isFileExists = false;

			try {
				fs.accessSync(uploadDir, fs.F_OK);
				isFileExists = true;
			}
			catch (e) {
				// console.log('File is not exists, so create new one.');
			}

			if (isFileExists) return uploadComplete();
		}

		var writeStream = fs.createWriteStream(uploadDir);

		uploadingFiles[id].writeStream = writeStream;

		socket.emit(`socket.io-s3::request::${id}`);

		socket.on(`socket.io-s3::stream::${id}`, (chunk) => {
			if (uploadingFiles[id].abort) {
				socket.removeAllListeners(`socket.io-s3::stream::${id}`);
				socket.removeAllListeners(`socket.io-s3::done::${id}`);
				socket.removeAllListeners(`socket.io-s3::complete::${id}`);
				socket.removeAllListeners(`socket.io-s3::abort::${id}`);
				socket.removeAllListeners(`socket.io-s3::error::${id}`);

				uploadingFiles[id].writeStream.end();
				delete uploadingFiles[id];
				return;
			}

			var writeStream = uploadingFiles[id].writeStream;

			function write() {
				let result = (uploadingFiles[id].wrote + chunk.length) > (self.maxFileSize);

				if ((uploadingFiles[id].wrote + chunk.length) > (self.maxFileSize)) {
					return sendError(new Error(`Uploading file size exceeded max file size ${self.maxFileSize} byte(s).`));
				}

				var writeDone = writeStream.write(chunk);
				uploadingFiles[id].wrote += chunk.length;

				self.emit('stream', {
					name: uploadingFiles[id].name,
					size: uploadingFiles[id].size,
					wrote: uploadingFiles[id].wrote,
					uploadDir: uploadingFiles[id].uploadDir
				});

				if (!writeDone) {
					writeStream.once('drain', () => socket.emit(`socket.io-s3::request::${id}`));
				}
				else {
					if (self.transmissionDelay) {
						setTimeout(() => {
							socket.emit(`socket.io-s3::request::${id}`);
						}, self.transmissionDelay);
					}
					else {
						socket.emit(`socket.io-s3::request::${id}`);
					}
				}
			}

			write();
		});
		socket.on(`socket.io-s3::done::${id}`, () => {
			uploadComplete();
		});
		socket.on(`socket.io-s3::abort::${id}`, () => {
			uploadingFiles[id].abort = true;

			self.emit('abort', {
				name: uploadingFiles[id].name,
				size: uploadingFiles[id].size,
				wrote: uploadingFiles[id].wrote,
				uploadDir: uploadingFiles[id].uploadDir
			});
			socket.emit(`socket.io-s3::abort::${id}`, {
				name: uploadingFiles[id].name,
				size: uploadingFiles[id].size,
				wrote: uploadingFiles[id].wrote,
				uploadDir: uploadingFiles[id].uploadDir
			});
		});
	});
}
util.inherits(SocketIOS3Server, EventEmitter);

module.exports = SocketIOS3Server;
