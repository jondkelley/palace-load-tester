import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const tcpNet = require('net');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MSG = {
	LOGON:       0x72656769,
	LOGOFF:      0x62796520,
	TIYID:       0x74697972,
	PING:        0x70696e67,
	PONG:        0x706f6e67,
	TALK:        0x74616c6b,
	XTALK:       0x78746c6b,
	ROOMGOTO:    0x6e617652,
	ROOMDESC:    0x726f6f6d,
	ROOMDESCEND: 0x656e6472,
	ROOMSETDESC: 0x73526f6d,
	SERVERINFO:  0x73696e66,
	USERSTATUS:  0x75537461,
	VERSION:     0x76657273,
	BLOWTHRU:    0x626c6f77,
	SERVERDOWN:  0x646f776e,
	HTTPSERVER:  0x48545450,
	USERNEW:     0x6e707273,
	USERLIST:    0x72707273,
	USEREXIT:    0x65707273,
	USERLOG:     0x6c6f6720,
	NAVERROR:    0x73457272,
	GO_SERVER_VER: 0x67766572,
	AUTHENTICATE:  0x61757468,
	USERNAME:    0x7573724e,
	USERMOVE:    0x754c6f63,
	WHISPER:     0x77686973,
	XWHISPER:    0x78776973,
};

let win;

function createWindow() {
	win = new BrowserWindow({
		width: 640,
		height: 720,
		backgroundColor: '#1e1e2e',
		resizable: true,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			preload: path.join(__dirname, 'preload.js')
		}
	});
	win.setMenuBarVisibility(false);
	win.loadFile('index.html');
	win.on('closed', () => {
		disconnectAll();
		win = null;
		app.quit();
	});
}

app.whenReady().then(() => {
	nativeTheme.themeSource = 'dark';
	createWindow();
});

app.on('window-all-closed', () => app.quit());

// ─── Palace Protocol Bot ─────────────────────────────────────────────────────

class PalaceBot {
	constructor(id, ip, port, name, roomId, hide, dance, slide, onStatus) {
		this.id = id;
		this.ip = ip;
		this.port = port;
		this.name = name;
		this.roomId = roomId;
		this.hide = hide;
		this.dance = dance;
		this.slide = slide;
		this.onStatus = onStatus;

		this.buffer = Buffer.alloc(0);
		this.soc = null;
		this.pingTimer = null;
		this.moveTimer = null;
		this.state = 'idle';
		this.roomDescCount = 0;
	}

	connect() {
		this.status('connecting', `Connecting to ${this.ip}:${this.port}...`);
		this.soc = new tcpNet.Socket();

		this.soc.connect(this.port, this.ip, () => {
			this.status('connected', 'TCP connected, waiting for handshake...');
		});

		this.soc.on('data', (data) => this.onData(data));
		this.soc.on('error', (err) => this.status('error', `Error: ${err.message}`));
		this.soc.on('close', () => {
			this.cleanup();
			this.status('disconnected', 'Disconnected');
		});
	}

	status(state, msg) {
		this.state = state;
		this.onStatus(this.id, state, msg);
	}

	cleanup() {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
		this.stopMovement();
	}

	onData(nodeBuffer) {
		this.buffer = Buffer.concat([this.buffer, nodeBuffer]);
		while (this.buffer.length >= 8) {
			const payloadLen = this.buffer.readInt32LE(4);
			const packetLen = payloadLen + 12;
			if (this.buffer.length < packetLen) break;

			const packet = Buffer.from(this.buffer.subarray(0, packetLen));
			this.buffer = Buffer.from(this.buffer.subarray(packetLen));
			this.handlePacket(packet);
		}
	}

	handlePacket(buf) {
		const type = buf.readInt32LE(0);
		const ref = buf.readInt32LE(8);

		switch (type) {
			case MSG.TIYID:
				this.sessionUserID = ref;
				this.status('handshake', `Session ID: ${ref}, registering as "${this.name}"...`);
				this.sendRegistration();
				break;

			case MSG.USERSTATUS:
				this.status('registered', 'Registered, waiting for room...');
				break;

			case MSG.ROOMDESC:
			case MSG.ROOMSETDESC:
				break;

			case MSG.ROOMDESCEND:
				this.roomDescCount++;
				if (this.roomDescCount === 1) {
					if (this.roomId > 0) {
						this.status('navigating', `In entry room, navigating to room ${this.roomId}...`);
						this.sendRoomNav(this.roomId);
					} else {
						this.onRoomReady();
					}
				} else if (this.roomDescCount >= 2) {
					this.onRoomReady();
				}
				break;

			case MSG.NAVERROR:
				this.status('naverror', `Room ${this.roomId} not found, staying in entry room`);
				this.onRoomReady();
				break;

			case MSG.PING:
				this.sendPong();
				break;

			case MSG.SERVERDOWN:
				this.cleanup();
				this.status('serverdown', 'Server shutting down');
				break;

			case MSG.AUTHENTICATE:
				this.status('auth', 'Server requires authentication (not supported in load tester)');
				break;

			case MSG.GO_SERVER_VER:
			case MSG.SERVERINFO:
			case MSG.VERSION:
			case MSG.HTTPSERVER:
			case MSG.USERNEW:
			case MSG.USERLIST:
			case MSG.USEREXIT:
			case MSG.USERLOG:
			case MSG.USERMOVE:
			case MSG.USERNAME:
			case MSG.TALK:
			case MSG.XTALK:
			case MSG.WHISPER:
			case MSG.XWHISPER:
			case MSG.BLOWTHRU:
				break;
		}
	}

	onRoomReady() {
		const roomLabel = this.roomId > 0 ? `room ${this.roomId}` : 'entry room';
		if (this.hide) {
			this.status('hiding', `In ${roomLabel}, sending hide...`);
			setTimeout(() => {
				this.sendHide();
				this.status('ready', `Hidden in ${roomLabel}`);
				this.startMovement(roomLabel);
			}, 300);
		} else {
			this.status('ready', `Idle in ${roomLabel}`);
			this.startMovement(roomLabel);
		}
	}

	startMovement(roomLabel) {
		if (!this.dance && !this.slide) return;

		const scheduleNext = () => {
			if (!this.soc || this.soc.destroyed) return;

			const doDance = this.dance && this.slide
				? Math.random() < 0.5
				: this.dance;

			const x = Math.floor(Math.random() * 512);
			const y = Math.floor(Math.random() * 384);
			this.sendMove(x, y);

			const delay = doDance
				? 150 + Math.floor(Math.random() * 350)   // dance: 150–500ms
				: 1000 + Math.floor(Math.random() * 2000); // slide: 1000–3000ms

			this.moveTimer = setTimeout(scheduleNext, delay);
		};

		const startDelay = Math.floor(Math.random() * 1000);
		this.moveTimer = setTimeout(scheduleNext, startDelay);

		const modes = [this.dance && 'dancing', this.slide && 'sliding'].filter(Boolean).join(' & ');
		this.status('ready', `${modes} in ${roomLabel}`);
	}

	stopMovement() {
		if (this.moveTimer) {
			clearTimeout(this.moveTimer);
			this.moveTimer = null;
		}
	}

	sendRegistration() {
		// 12-byte header + 128-byte payload = 140 bytes total.
		// Payload layout matches AuxRegistrationRec (new-style, > 72 bytes).
		const buf = Buffer.alloc(140);
		buf.writeInt32LE(MSG.LOGON, 0);          // type
		buf.writeInt32LE(128, 4);                 // payload length
		// refnum at [8] = 0

		// CRC and Counter: non-zero so the server treats us as a member, not a guest.
		const crc = (Math.floor(Math.random() * 2147483546) + 100) >>> 0;
		const counter = (Math.floor(Math.random() * 2147483546) + 100) >>> 0;
		buf.writeUInt32LE(crc, 12);               // payload[0]: CRC
		buf.writeUInt32LE(counter, 16);            // payload[4]: Counter

		// UserName — pascal string (length byte + up to 31 ASCII chars)
		const nameBytes = Buffer.from(this.name, 'ascii');
		const nameLen = Math.min(nameBytes.length, 31);
		buf.writeUInt8(nameLen, 20);               // payload[8]: name length
		nameBytes.copy(buf, 21, 0, nameLen);       // payload[9..]: name data

		// WizPassword: payload[40..72] — leave zeroed (no wiz password)

		// AuxFlags / platform hint
		buf.writeUInt32LE(0x80000002, 84);         // payload[72]: Mac platform

		// PUID
		const puidCtr = (Math.floor(Math.random() * 2147483546) + 100) >>> 0;
		buf.writeUInt32LE(puidCtr, 88);            // payload[76]: PUIDCtr
		buf.writeUInt32LE(crc, 92);                // payload[80]: PUIDCRC

		// Demo/version fields
		buf.writeUInt32LE(0x00011940, 96);         // payload[84]: DemoElapsed
		buf.writeUInt32LE(0x00011940, 100);        // payload[88]: TotalElapsed
		buf.writeUInt32LE(0x00011940, 104);        // payload[92]: DemoLimit

		// DesiredRoom: payload[96..98] at buffer offset 108
		if (this.roomId > 0) {
			buf.writeInt16LE(this.roomId, 108);
		}

		// Client version tag at payload[98] (buffer offset 110) — server reads "PC5..." here
		const versionTag = Buffer.from('PC5001', 'ascii');
		versionTag.copy(buf, 110);

		this.soc.write(buf);

		this.pingTimer = setInterval(() => this.sendPong(), 120000);
	}

	sendRoomNav(roomId) {
		const buf = Buffer.alloc(14);
		buf.writeInt32LE(MSG.ROOMGOTO, 0);
		buf.writeInt32LE(2, 4);
		buf.writeInt16LE(roomId, 12);
		this.soc.write(buf);
	}

	sendHide() {
		const msg = '`hide\0';
		const msgBuf = Buffer.from(msg, 'ascii');
		const buf = Buffer.alloc(12 + msgBuf.length);
		buf.writeInt32LE(MSG.TALK, 0);
		buf.writeInt32LE(msgBuf.length, 4);
		msgBuf.copy(buf, 12);
		this.soc.write(buf);
	}

	sendMove(x, y) {
		if (!this.soc || this.soc.destroyed) return;
		const buf = Buffer.alloc(16);
		buf.writeInt32LE(MSG.USERMOVE, 0);
		buf.writeInt32LE(4, 4);
		buf.writeInt16LE(y, 12);
		buf.writeInt16LE(x, 14);
		this.soc.write(buf);
	}

	sendPong() {
		if (!this.soc || this.soc.destroyed) return;
		const buf = Buffer.alloc(12);
		buf.writeInt32LE(MSG.PONG, 0);
		this.soc.write(buf);
	}

	disconnect() {
		this.cleanup();
		if (this.soc && !this.soc.destroyed) {
			try {
				const buf = Buffer.alloc(12);
				buf.writeInt32LE(MSG.LOGOFF, 0);
				this.soc.write(buf);
			} catch { /* ignore */ }
			this.soc.destroy();
		}
		this.soc = null;
	}
}

// ─── Bot Manager ─────────────────────────────────────────────────────────────

let bots = [];

function disconnectAll() {
	for (const bot of bots) bot.disconnect();
	bots = [];
}

function emitStatus(id, state, msg) {
	if (win && !win.isDestroyed()) {
		win.webContents.send('bot-status', { id, state, msg });
	}
}

ipcMain.handle('start-loadtest', async (_event, config) => {
	disconnectAll();

	const { server, numClients, namePrefix, roomId, hide, dance, slide } = config;
	const parts = server.split(':');
	const ip = parts[0];
	const port = parseInt(parts[1]) || 9998;

	const staggerMs = Math.min(200, Math.max(50, Math.floor(2000 / numClients)));

	for (let i = 0; i < numClients; i++) {
		const name = `${namePrefix}${i + 1}`;
		const bot = new PalaceBot(i, ip, port, name, roomId, hide, dance, slide, emitStatus);
		bots.push(bot);
		setTimeout(() => bot.connect(), i * staggerMs);
	}

	return { started: numClients, staggerMs };
});

ipcMain.handle('stop-loadtest', async () => {
	const count = bots.length;
	disconnectAll();
	return { stopped: count };
});

ipcMain.handle('get-stats', async () => {
	const counts = { total: bots.length, ready: 0, error: 0, connecting: 0 };
	for (const bot of bots) {
		if (bot.state === 'ready') counts.ready++;
		else if (bot.state === 'error' || bot.state === 'disconnected' || bot.state === 'serverdown') counts.error++;
		else counts.connecting++;
	}
	return counts;
});
