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

// ─── Palace Registration (CRC computation matching PalaceV/client.ts) ────────

const CRC_MAGIC = 0xa95ade76;
const MAGIC_LONG = 0x9602c9bf;
const CRC_MASK = [
	0xebe19b94, 0x7604de74, 0xe3f9d651, 0x604fd612, 0xe8897c2c, 0xadc40920, 0x37ecdfb7, 0x334989ed,
	0x2834c33b, 0x8bd2fe15, 0xcbf001a7, 0xbd96b9d6, 0x315e2ce0, 0x4f167884, 0xa489b1b6, 0xa51c7a62,
	0x54622636, 0x0bc016fc, 0x68de2d22, 0x3c9d304c, 0x44fd06fb, 0xbbb3f772, 0xd637e099, 0x849aa9f9,
	0x5f240988, 0xf8373bb7, 0x30379087, 0xc7722864, 0xb0a2a643, 0xe3316071, 0x956fed7c, 0x966f937d,
	0x9945ae16, 0xf0b237ce, 0x223479a0, 0xd8359782, 0x05ae1b89, 0xe3653292, 0xc34eea0d, 0x2691dfc2,
	0xe9145f51, 0xd9aa7f35, 0xc7c4344e, 0x4370eba1, 0x1e43833e, 0x634bcf18, 0x0c50e26b, 0x06492118,
	0xf78b8bfe, 0x5f2bb95c, 0xa3eb54a6, 0x1e15a2f0, 0x6cc01887, 0xde4e7405, 0x1c1d7374, 0x85757feb,
	0xe372517e, 0x9b9979c7, 0xf37807e8, 0x18f97235, 0x645a149b, 0x9556c6cf, 0xf389119e, 0x1d6cbf85,
	0xa9760ce5, 0xa985c5ff, 0x5f4db574, 0x13176cac, 0x2f14aa85, 0xf520832c, 0xd21ee917, 0x6f307a5b,
	0xc1fb01c6, 0x19415378, 0x797fa2c3, 0x24f42481, 0x4f652c30, 0x39bc02ed, 0x11eda1d7, 0x8c79a136,
	0x6bd37a86, 0x80b354ee, 0xc424e066, 0xaae16427, 0x6bd3be12, 0x868d8e37, 0xd1d43c54, 0x4d62081f,
	0x433056d7, 0xf2e4cb02, 0x043fc5a2, 0x9da58ca4, 0x1ed63321, 0x20679f26, 0xb38a4758, 0x846419f7,
	0x6bdc6352, 0xabf2c24d, 0x40ac386c, 0x27588588, 0x5e1ab2e5, 0x76bdead4, 0x71444d32, 0x02fc6084,
	0x92db41fb, 0xef86baeb, 0xf7d8572a, 0xb75aeabf, 0x84dc5c93, 0xcbc13881, 0x641d6e73, 0x0cb27a99,
	0xded369a6, 0x617e5dfa, 0x248bd13e, 0xb8596d66, 0x9b36a9fa, 0x52edaf1c, 0x3c659784, 0x146df599,
	0x109fcae8, 0xc9ed4841, 0xbf593f49, 0xc94a6e73, 0x5afa0d2f, 0xb2035002, 0xcab31104, 0x7c4f5a82,
	0xeac93638, 0x63fc5385, 0xdf0cae06, 0x26e55be3, 0x2921b9b8, 0xb80b3408, 0x917e137d, 0x127a48bc,
	0xe031858a, 0x722213d7, 0x2dbc96fa, 0x5359f112, 0xab256019, 0x6e2a756e, 0x4dc62f76, 0x268832de,
	0x5980e578, 0xd338b668, 0xeee2e4d7, 0x1fff8fc6, 0x9b17ed10, 0xf3e6be0f, 0xc1ba9d78, 0xbb8693c5,
	0x24d57ec0, 0x5d640aed, 0xee87979b, 0x96323e11, 0xccbc1601, 0x0e83f43b, 0x2c2f7495, 0x5f150b2a,
	0x710a77e2, 0x281b51dc, 0x2385d03c, 0x67239bff, 0xa719e8f9, 0x21c3b9de, 0x26489c22, 0x0de68989,
	0xca758f0d, 0x417e8cd2, 0x67ed61f8, 0xd15fc001, 0x3ba2f272, 0x57e2f7a9, 0xe723b883, 0x914e43e1,
	0x71aa5b97, 0xfceb1be1, 0x7ffa4fd9, 0x67a0b494, 0x5e1c741e, 0xc8c2a5e6, 0xe13ba068, 0x24525548,
	0x397a9cf6, 0x3dddd4d6, 0xb626234c, 0x39e7b04d, 0x36ca279f, 0x89aea387, 0xcfe93789, 0x04e1761b,
	0x9d620edc, 0x6e9df1e7, 0x4a15dfa6, 0xd44641ac, 0x39796769, 0x6d062637, 0xf967af35, 0xddb4a233,
	0x48407280, 0xa9f22e7e, 0xd9878f67, 0xa05b3bc1, 0xe8c9237a, 0x81cec53e, 0x4be53e70, 0x60308e5e,
	0xf03de922, 0xa712af7b, 0xbb6168b4, 0xcc6c15b5, 0x2f202775, 0x304527e3, 0xd32bc1e6, 0xba958058,
	0xa01f7214, 0xc6e8d190, 0xab96f14b, 0x18669984, 0x4f93a385, 0x403b5b40, 0x580755f1, 0x59de50e8,
	0xf746729f, 0xff6f7d47, 0x8022ea34, 0xb24b0bcd, 0xf687a7cc, 0x7e95bab3, 0x8dc1583d, 0x0b443fe9,
	0xe6e45618, 0x224d746f, 0xf30624bb, 0xb7427258, 0xc78e19bf, 0xd1ee98a6, 0x66be7d3a, 0x791e342f,
	0x68cbaab0, 0xbbb5355d, 0x8dda9081, 0xdc2736dc, 0x573355ad, 0xc3ffec65, 0xe97f0270, 0xc6a265e8,
	0xd9d49152, 0x4bb35bdb, 0xa1c7bbe6, 0x15a3699a, 0xe69e1eb5, 0x7cdda410, 0x488609df, 0xd19678d3,
];

function computeLicenseCRC(v) {
	let crc = CRC_MAGIC;
	for (let i = 4; --i >= 0;) {
		crc = ((crc << 1) | ((crc & 0x80000000) ? 1 : 0)) ^ CRC_MASK[(v >>> (i * 8)) & 0xFF];
	}
	return crc;
}

function makeRegistration(seed) {
	const crc = computeLicenseCRC(seed);
	const counter = ((seed ^ MAGIC_LONG) ^ crc) >>> 0;
	return { crc: crc >>> 0, counter };
}

function makePUID(seed) {
	const crc = computeLicenseCRC(seed);
	const counter = (seed ^ crc) >>> 0;
	return { crc: crc >>> 0, counter };
}

const SERVER_DOWN_REASONS = {
	1: 'Logged off',
	2: 'Communication error',
	3: 'Killed for flooding',
	4: 'Killed by an Operator',
	5: 'Server shut down',
	6: 'Server unresponsive',
	7: 'Killed by System Operator',
	8: 'Server is full',
	9: 'Invalid serial number',
	10: 'Duplicate serial number',
	11: 'Death penalty active',
	12: 'Banished',
	13: 'Banished and Killed',
	14: 'No guests allowed',
	15: 'Demo expired',
};

// ─── Palace Protocol Bot ─────────────────────────────────────────────────────

class PalaceBot {
	constructor(id, ip, port, name, roomId, hide, dance, slide, versionTag, onStatus) {
		this.id = id;
		this.ip = ip;
		this.port = port;
		this.name = name;
		this.roomId = roomId;
		this.hide = hide;
		this.dance = dance;
		this.slide = slide;
		this.versionTag = versionTag;
		this.onStatus = onStatus;

		this.buffer = Buffer.alloc(0);
		this.soc = null;
		this.pingTimer = null;
		this.moveTimer = null;
		this.state = 'idle';
		this.roomDescCount = 0;
		this.retryRegistration = false;

		const regiSeed = Math.floor(Math.random() * 2147483546) + 100;
		const puidSeed = Math.floor(Math.random() * 2147483546) + 100;
		this.regi = makeRegistration(regiSeed);
		this.puid = makePUID(puidSeed);
	}

	connect() {
		this.status('connecting', `Connecting to ${this.ip}:${this.port}...`);
		this.soc = new tcpNet.Socket();

		this.soc.connect(this.port, this.ip, () => {
			this.status('connected', 'TCP connected, waiting for handshake...');
		});

		this.soc.on('data', (data) => this.onData(data));
		this.soc.on('error', (err) => {
			if (err.code === 'ECONNRESET' && !this.retryRegistration) {
				this.retryRegistration = true;
				this.buffer = Buffer.alloc(0);
				this.status('connecting', 'Connection reset, retrying...');
				this.soc.destroy();
				this.soc = new tcpNet.Socket();
				this.soc.on('data', (data) => this.onData(data));
				this.soc.on('error', (err2) => this.status('error', `Error: ${err2.message}`));
				this.soc.on('close', () => {
					this.cleanup();
					this.status('disconnected', 'Disconnected');
				});
				this.soc.connect(this.port, this.ip);
				return;
			}
			this.status('error', `Error: ${err.message}`);
		});
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

			case MSG.SERVERDOWN: {
				this.cleanup();
				const reason = SERVER_DOWN_REASONS[ref] || `Unknown (ref=${ref})`;
				this.status('serverdown', `Disconnected: ${reason}`);
				break;
			}

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
		const buf = Buffer.alloc(140);
		buf.writeInt32LE(MSG.LOGON, 0);
		buf.writeInt32LE(128, 4);

		buf.writeUInt32LE(this.regi.crc, 12);
		buf.writeUInt32LE(this.regi.counter, 16);

		const nameBytes = Buffer.from(this.name, 'ascii');
		const nameLen = Math.min(nameBytes.length, 31);
		buf.writeUInt8(nameLen, 20);
		nameBytes.copy(buf, 21, 0, nameLen);

		buf.writeUInt32LE(0x80000002, 84);          // auxFlags (Mac platform)
		buf.writeUInt32LE(this.puid.counter, 88);    // PUIDCtr
		buf.writeUInt32LE(this.puid.crc, 92);        // PUIDCRC
		buf.writeUInt32LE(0x00011940, 96);           // demoElapsed
		buf.writeUInt32LE(0x00011940, 100);          // totalElapsed
		buf.writeUInt32LE(0x00011940, 104);          // demoLimit

		if (this.roomId > 0) {
			buf.writeInt16LE(this.roomId, 108);      // desiredRoom
		}

		Buffer.from(this.versionTag, 'ascii').copy(buf, 110, 0, Math.min(this.versionTag.length, 6));

		buf.writeUInt32LE(0x00000041, 120);          // ulUploadCaps
		if (this.retryRegistration) {
			buf.writeUInt32LE(0x00000111, 124);      // ulDownloadCaps (retry)
		} else {
			buf.writeUInt32LE(0x00000151, 124);      // ulDownloadCaps (first attempt)
		}
		buf.writeUInt32LE(0x00000001, 128);          // ul2DEngineCaps
		buf.writeUInt32LE(0x00000001, 132);          // ul2DGraphicsCaps

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

	const { server, numClients, namePrefix, roomId, hide, dance, slide, versionTag } = config;
	const parts = server.split(':');
	const ip = parts[0];
	const port = parseInt(parts[1]) || 9998;
	const tag = versionTag || 'PC5001';

	const staggerMs = Math.min(200, Math.max(50, Math.floor(2000 / numClients)));

	for (let i = 0; i < numClients; i++) {
		const name = `${namePrefix}${i + 1}`;
		const bot = new PalaceBot(i, ip, port, name, roomId, hide, dance, slide, tag, emitStatus);
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
