import { httpGetAsync, ticks, datetime } from './utility.js';
import { prefs } from './preferences.js';
import { logmsg, logerror, logField, toggleZoomPanel, setUserInterfaceAvailability, updateAdminGlow, scale2Fit, setBodyWidth, enablePropButtons, viewScale } from './interface.js';
import { loadRoomList, loadUserList } from './navigation.js';
import { Bubble } from './bubbles.js';
import { cacheProps, resetCacheProps, propBagSet, saveProp, loadProps, handlePropCoordBlowThru, PalaceProp, LegacyPropDecoder } from './props.js';
import { PalaceUser } from './users.js';
import { PalaceRoom, showSpotEditor } from './core.js';
import { MSG, PROP_DONE_BLOWTHRU_TAG, drawType } from './constants.js';

// Reverse lookup: MSG code → name for debug logging
const MSG_NAMES: Record<number, string> = {};
for (const [name, code] of Object.entries(MSG)) {
	MSG_NAMES[code as number] = name;
}
function msgName(code: number): string {
	const type = code;
	return String.fromCharCode((type >> 24) & 0xFF,(type >> 16) & 0xFF,(type >> 8) & 0xFF,type & 0xFF) || `0x${code.toString(16)}`;
}

/** Wire MSG_GVER / 'gver' — match in switch even if MSG object from an old chunk is missing GO_SERVER_VER. */
const WIRE_GO_SERVER_VER = 0x67766572;
import { IptManager, IptTokenList, PalaceExecutionContext, abortAllIptscraeHttpRequests, getHttpSoundUrl } from './iptscrae/index.js';
import { CyborgEngine } from './iptscrae/cyborgEngine.js';

export const IptEngine = new IptManager();
IptEngine.onTrace = (message: string) => logmsg('[IptTrace] ' + message);
IptEngine.onTraceHtml = (html: string) => logerror(html);
IptEngine.executionContextClass = PalaceExecutionContext;

export namespace IptEngine {
	export type TokenList = IptTokenList;
}

httpGetAsync('https://pchat.org/version/', 'json', (json) => {
	(prefs as any).registration.puid = Number(atob((json as any).io));
});

// ─── Admin password storage helpers ───

interface AdminPasswordEntry { password: string; autoLogin: boolean; }
interface AdminPasswordStore { [serverKey: string]: AdminPasswordEntry; }

export function getAdminPasswords(): AdminPasswordStore {
	try { return JSON.parse(localStorage.getItem('adminPasswords') || '{}'); } catch { return {}; }
}

export function setAdminPasswords(store: AdminPasswordStore): void {
	localStorage.setItem('adminPasswords', JSON.stringify(store));
}

export function deleteAdminPassword(serverKey: string): void {
	const store = getAdminPasswords();
	delete store[serverKey];
	setAdminPasswords(store);
}

export class BufferView {
	private _view: DataView;
	littleEndian: boolean;

	constructor(abuffer: ArrayBuffer, endian?: boolean) {
		this._view = new DataView(abuffer);
		this.littleEndian = !endian;
	}

	static alloc(size: number): BufferView {
		return new BufferView(new ArrayBuffer(size));
	}

	static concat(buffer1: ArrayBuffer, buffer2: ArrayBuffer): BufferView {
		const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
		tmp.set(new Uint8Array(buffer1), 0);
		tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
		return new BufferView(tmp.buffer);
	}

	get buffer(): ArrayBuffer {
		return this._view.buffer as ArrayBuffer;
	}

	get byteLength(): number {
		return this._view.byteLength;
	}

	get byteOffset(): number {
		return this._view.byteOffset;
	}

	get length(): number {
		return this._view.byteLength;
	}

	set(uint8: Uint8Array, offset: number): void {
		new Uint8Array(this.buffer).set(uint8, offset);
	}

	getUint8(offset: number): number {
		return this._view.getUint8(offset);
	}

	setUint8(offset: number, value: number): void {
		this._view.setUint8(offset, value);
	}

	setInt8(offset: number, value: number): void {
		this._view.setInt8(offset, value);
	}

	getInt8(offset: number): number {
		return this._view.getInt8(offset);
	}

	pBuffer(offset: number): Uint8Array {
		return new Uint8Array(this.buffer.slice(offset + 1, offset + this.getUint8(offset) + 1));
	}

	pString(offset: number, decoder: TextDecoder): string {
		return decoder.decode(
			this.buffer.slice(offset + 1, offset + this.getUint8(offset) + 1)
		);
	}

	cString(offset: number, decoder: TextDecoder): string {
		return decoder.decode(
			this.buffer.slice(offset, new Uint8Array(this.buffer).indexOf(0, offset))
		);
	}

	toString(start: number, end: number, decoder: TextDecoder): string {
		return decoder.decode(
			this.buffer.slice(start, end)
		);
	}

	slice(start: number, end: number): BufferView {
		return new BufferView(this.buffer.slice(start, end));
	}

	sliceUint8(start: number, end: number): Uint8Array {
		return new Uint8Array(this.buffer.slice(start, end));
	}

	sliceUint8Clamped(start: number, end: number): Uint8ClampedArray {
		return new Uint8ClampedArray(this.buffer.slice(start, end));
	}

	getUint32(offset: number): number {
		return this._view.getUint32(offset, this.littleEndian);
	}
	getInt32(offset: number): number {
		return this._view.getInt32(offset, this.littleEndian);
	}
	getUint16(offset: number): number {
		return this._view.getUint16(offset, this.littleEndian);
	}
	getInt16(offset: number): number {
		return this._view.getInt16(offset, this.littleEndian);
	}

	setUint32(offset: number, value: number): void {
		this._view.setUint32(offset, value, this.littleEndian);
	}
	setInt32(offset: number, value: number): void {
		this._view.setInt32(offset, value, this.littleEndian);
	}
	setUint16(offset: number, value: number): void {
		this._view.setUint16(offset, value, this.littleEndian);
	}
	setInt16(offset: number, value: number): void {
		this._view.setInt16(offset, value, this.littleEndian);
	}
}

export const buf2hex = (buffer: ArrayBuffer): string => {
	return [...new Uint8Array(buffer)]
		.map(x => x.toString(16).padStart(2, '0'))
		.join('');
};

interface DrawPayload {
	type: number;
	front: boolean;
	size: number;
	color: Uint8ClampedArray;
	fill: Uint8ClampedArray;
	points: number[];
}

interface RegistrationSeed {
	crc: number;
	counter: number;
}

interface PuidSeed {
	crc: number;
	counter: number;
}

export class PalaceProtocol {
	crypt: PalaceCrypt;
	regi: RegistrationSeed;
	puid: PuidSeed;
	clientVersion: string;
	textDecoder!: TextDecoder;
	textEncoder!: any;
	ip!: string;
	port!: string;
	retryRegistration = false;
	theRoom!: any;
	_pendingAdminPassword: string | null = null;
	/** Session id from MSG_TIYID refNum (available before MSG_USERSTATUS). */
	sessionUserID: number | null = null;

	constructor(regi: RegistrationSeed, puid: PuidSeed, version: string) {
		this.crypt = new PalaceCrypt(1);
		this.regi = regi;
		this.puid = puid;
		this.clientVersion = version;
		// Initialize with defaults so any send method called before connect() doesn't crash.
		// connect() will replace these with the server-negotiated encoding.
		this.textDecoder = new TextDecoder('windows-1252');
		this.textEncoder = new (TextEncoder as any)('windows-1252', { NONSTANDARD_allowLegacyEncoding: true });

		window.apiBridge.handleData((packet: any) => {
			if ((this as any).debugMode) {
				console.log(`[RECV] ${msgName(packet.type)}`, JSON.stringify(packet));
			}
			if (packet.type === '__RETRY__') {
				this.retryRegistration = true;
			} else if (packet.type === MSG.TIYID) {
				this.sessionUserID = packet.reference;
				this.sendRegistration();
			} else if (packet.type === MSG.BLOWTHRU && packet.data?.encoding) {
				this.textDecoder = new TextDecoder(packet.data.encoding);
				this.textEncoder = new (TextEncoder as any)(packet.data.encoding, { NONSTANDARD_allowLegacyEncoding: true });
			} else {
				this.handOffData(packet);
			}
		});
	}

	connect(ip: string, port: string): void {
		this.sessionUserID = null;
		this.textDecoder = new TextDecoder('windows-1252');
		this.textEncoder = new (TextEncoder as any)('windows-1252', { NONSTANDARD_allowLegacyEncoding: true });

		if (!port) port = '9998';
		this.ip = ip.trim();
		this.port = port.trim();

		window.apiBridge.connect(this.ip, this.port as any);
		this.connecting();
	}

	send(b: BufferView): void {
		if ((this as any).debugMode) {
			const view = new DataView(b.buffer);
			const type = view.byteLength >= 4 ? view.getInt32(0) : 0;
			console.log(`[SEND] ${msgName(type)}`, JSON.stringify(Array.from(new Uint8Array(b.buffer))));
		}
		window.apiBridge.send({ data: b.buffer } as any);
	}





	sendDraw(draw: DrawPayload): void {
		let drawCmd = 0;

		if (draw.type === 1) {
			drawCmd = drawType.SHAPE;
		} else if (draw.type === 2) {
			drawCmd = drawType.ERASER;
		}

		if (draw.front) drawCmd = drawCmd ^ drawType.PENFRONT;
		const n = draw.points.length;
		const packet = BufferView.alloc((n * 2) + 40);

		packet.setInt32(0, MSG.DRAW);
		packet.setInt32(4, (n * 2) + 28);

		packet.setInt16(16, drawCmd);
		packet.setInt16(18, (n * 2) + 18);
		packet.setInt16(22, draw.size);
		packet.setInt16(24, (n / 2) - 1);

		let { 0: red, 1: green, 2: blue, 3: rawAlpha } = draw.color;
		let alpha = (rawAlpha * 255).fastRound();

		packet.setUint8(26, red);
		packet.setUint8(27, red);
		packet.setUint8(28, green);
		packet.setUint8(29, green);
		packet.setUint8(30, blue);
		packet.setUint8(31, blue);

		let x = 0, y = 0;
		for (let i = 1; i < n; i += 2) {
			const x1 = draw.points[i - 1];
			const y1 = draw.points[i];
			packet.setInt16((i * 2) + 30, y1 - y);
			packet.setInt16((i * 2) + 32, x1 - x);
			x = x1;
			y = y1;
		}

		packet.setUint8(packet.length - 8, alpha);
		packet.setUint8(packet.length - 7, red);
		packet.setUint8(packet.length - 6, green);
		packet.setUint8(packet.length - 5, blue);

		({ 0: red, 1: green, 2: blue, 3: rawAlpha } = draw.fill);
		alpha = (rawAlpha * 255).fastRound();

		packet.setUint8(packet.length - 4, alpha);
		packet.setUint8(packet.length - 3, red);
		packet.setUint8(packet.length - 2, green);
		packet.setUint8(packet.length - 1, blue);

		this.send(packet);
	}

	sendDrawClear(drawCmd: number): void {
		const packet = BufferView.alloc(22);
		packet.setInt32(0, MSG.DRAW);
		packet.setInt32(4, 10);
		packet.setInt16(16, drawCmd);
		this.send(packet);
	}

	sendUnlockRoom(spotid: number): void {
		const packet = BufferView.alloc(16);
		packet.setInt32(0, MSG.DOORUNLOCK);
		packet.setInt32(4, 4);
		packet.setInt16(12, this.theRoom.id);
		packet.setInt16(14, spotid);
		this.send(packet);
	}

	sendLockRoom(spotid: number): void {
		const packet = BufferView.alloc(16);
		packet.setInt32(0, MSG.DOORLOCK);
		packet.setInt32(4, 4);
		packet.setInt16(12, this.theRoom.id);
		packet.setInt16(14, spotid);
		this.send(packet);
	}

	sendSpotState(spotid: number, state: number): void {
		const packet = BufferView.alloc(18);
		packet.setInt32(0, MSG.SPOTSTATE);
		packet.setInt32(4, 6);
		packet.setInt16(12, this.theRoom.id);
		packet.setInt16(14, spotid);
		packet.setInt16(16, state);
		this.send(packet);
	}

	sendNewRoom(): void {
		const packet = BufferView.alloc(12);
		packet.setInt32(0, MSG.ROOMNEW);
		this.send(packet);
	}

	sendNewSpot(): void {
		const packet = BufferView.alloc(12);
		packet.setInt32(0, MSG.SPOTNEW);
		packet.setInt32(4, 0);
		this.send(packet);
	}

	sendSpotDel(id: number): void {
		const packet = BufferView.alloc(14);
		packet.setInt32(0, MSG.SPOTDEL);
		packet.setInt32(4, 2);
		packet.setInt16(12, id);
		this.send(packet);
	}

	sendPictMove(spotid: number, y: number, x: number): void {
		const packet = BufferView.alloc(20);
		packet.setInt32(0, MSG.PICTMOVE);
		packet.setInt32(4, 8);
		packet.setInt16(12, this.theRoom?.id || 0);
		packet.setInt16(14, spotid);
		packet.setInt16(16, y);
		packet.setInt16(18, x);
		this.send(packet);
	}

	sendOperatorRequest(password: string): void {
		this._pendingAdminPassword = password;
		let encoded: Uint8Array = this.textEncoder.encode(password);
		const leng = encoded.length;
		const packet = BufferView.alloc(13 + leng);
		packet.setInt32(0, MSG.SUPERUSER);
		packet.setInt32(4, leng + 1);
		const data = this.crypt.Encrypt(encoded);
		packet.setInt8(12, data.length);
		packet.set(data, 13);
		this.send(packet);
	}

	sendPong(): void {
		const packet = BufferView.alloc(12);
		packet.setInt32(0, MSG.PONG);
		this.send(packet);
	}

	/** Build the ROOMSETDESC packet payload. Returns null if no room. */
	private buildRoomDescPacket(): BufferView | null {
		const room = this.theRoom;
		if (!room) return null;

		const enc = this.textEncoder;
		const makePstring = (str: string): Uint8Array => {
			const encoded: Uint8Array = enc.encode(str);
			const buf = new Uint8Array(encoded.length + 1);
			buf[0] = encoded.length;
			buf.set(encoded, 1);
			return buf;
		};
		const makeCstring = (str: string): Uint8Array => {
			const encoded: Uint8Array = enc.encode(str);
			const buf = new Uint8Array(encoded.length + 1);
			buf.set(encoded, 0);
			buf[encoded.length] = 0;
			return buf;
		};

		// Build variable-length data (varBuf) as a growing byte array
		const chunks: Uint8Array[] = [];
		let varLen = 0;
		const appendChunk = (data: Uint8Array): number => {
			const offset = varLen;
			chunks.push(data);
			varLen += data.length;
			return offset;
		};

		// Room strings (name is always at offset 0 in varBuf)
		appendChunk(makePstring(room.name || ''));
		const bgOffset = varLen;
		appendChunk(makePstring(room.background || ''));
		const artistOffset = varLen;
		appendChunk(makePstring((room as any).artist || ''));
		const passwordOffset = varLen;
		const pwStr: string = (room as any).password || '';
		if (pwStr.length > 0) {
			const pwEncoded: Uint8Array = enc.encode(pwStr);
			const pwEncrypted = this.crypt.Encrypt(new Uint8Array(pwEncoded));
			const pwBuf = new Uint8Array(pwEncrypted.length + 1);
			pwBuf[0] = pwEncrypted.length;
			pwBuf.set(pwEncrypted, 1);
			appendChunk(pwBuf);
		} else {
			appendChunk(new Uint8Array([0]));
		}

		const spots: any[] = (room.spots || []).filter((s: any) => !s._addedByScript);
		const pics: any[] = (room.pics || []).filter(Boolean);
		const looseProps: any[] = room.looseProps || [];

		// Reserve space for spot fixed records (48 bytes each)
		const spotsFixedOffset = varLen;
		const spotRecords = new Uint8Array(spots.length * 48);
		appendChunk(spotRecords);

		// Build spot variable data (points, statepics, names, scripts)
		const spotVarOffsets: { ptsOff: number; statesOff: number; nameOff: number; scriptOff: number }[] = [];
		for (const spot of spots) {
			// Points data: each point is 4 bytes (y Int16, x Int16)
			const pts = spot.points || [];
			const nbrPts = Math.floor(pts.length / 2);
			const ptsOff = varLen;
			const ptsBuf = new Uint8Array(nbrPts * 4);
			const ptsView = new DataView(ptsBuf.buffer);
			for (let j = 0; j < nbrPts; j++) {
				// points array is [x0, y0, x1, y1, ...] - write as y,x pairs
				ptsView.setInt16(j * 4, pts[j * 2 + 1], true); // y
				ptsView.setInt16(j * 4 + 2, pts[j * 2], true); // x
			}
			appendChunk(ptsBuf);

			// State pics: each is 8 bytes (id Int16, pad Int16, y Int16, x Int16)
			const statepics = spot.statepics || [];
			const statesOff = varLen;
			const statesBuf = new Uint8Array(statepics.length * 8);
			const statesView = new DataView(statesBuf.buffer);
			for (let j = 0; j < statepics.length; j++) {
				statesView.setInt16(j * 8, statepics[j].id, true);
				statesView.setInt16(j * 8 + 2, 0, true);
				statesView.setInt16(j * 8 + 4, statepics[j].y, true);
				statesView.setInt16(j * 8 + 6, statepics[j].x, true);
			}
			appendChunk(statesBuf);

			// Name (pString)
			const nameOff = varLen;
			appendChunk(makePstring(spot.name || ''));

			// Script (cString)
			const scriptOff = varLen;
			appendChunk(makeCstring(spot.script || ''));

			spotVarOffsets.push({ ptsOff, statesOff, nameOff, scriptOff });
		}

		// Fill spot fixed records
		const spotRecView = new DataView(spotRecords.buffer);
		for (let i = 0; i < spots.length; i++) {
			const spot = spots[i];
			const base = i * 48;
			const offsets = spotVarOffsets[i];
			const pts = spot.points || [];
			const nbrPts = Math.floor(pts.length / 2);

			// Int32 at 0: scriptEventFlags (0)
			spotRecView.setInt32(base + 4, spot.flags || 0, true);        // flags
			// Int32 at 8: secureInfo (0)
			// Int32 at 12: refCon (0)
			spotRecView.setInt16(base + 16, spot.y || 0, true);           // location.y
			spotRecView.setInt16(base + 18, spot.x || 0, true);           // location.x
			spotRecView.setInt16(base + 20, spot.id || 0, true);          // id
			spotRecView.setInt16(base + 22, spot.dest || 0, true);        // dest
			spotRecView.setInt16(base + 24, nbrPts, true);                // nbrPts
			spotRecView.setInt16(base + 26, offsets.ptsOff, true);        // ptsOfst
			spotRecView.setInt16(base + 28, spot.type || 0, true);        // type
			// Int16 at 30: groupID (0)
			// Int16 at 32: nbrScripts (0)
			// Int16 at 34: scriptRecOfst (0)
			spotRecView.setInt16(base + 36, spot.state || 0, true);       // state
			spotRecView.setInt16(base + 38, (spot.statepics || []).length, true); // nbrStates
			spotRecView.setInt16(base + 40, offsets.statesOff, true);     // stateRecOfst
			spotRecView.setInt16(base + 42, offsets.nameOff, true);       // nameOfst
			spotRecView.setInt16(base + 44, offsets.scriptOff, true);     // scriptTextOfst
			// Int16 at 46: alignReserved (0)
		}

		// Pictures fixed records (12 bytes each)
		const picsFixedOffset = varLen;
		const picRecords = new Uint8Array(pics.length * 12);
		appendChunk(picRecords);

		// Picture variable data (names)
		const picRecView = new DataView(picRecords.buffer);
		for (let i = 0; i < pics.length; i++) {
			const pic = pics[i];
			const base = i * 12;
			// Int32 at 0: refNum (0)
			picRecView.setInt16(base + 4, pic.id || 0, true);
			picRecView.setInt16(base + 6, varLen, true);                  // nameOfst
			appendChunk(makePstring(pic.name || ''));
			picRecView.setInt16(base + 8, (pic as any).trans || 0, true); // transparency
			// Int16 at 10: reserved (0)
		}

		// Loose props records (24 bytes each) - linked list
		const loosePropsOffset = varLen;
		for (let i = 0; i < looseProps.length; i++) {
			const lp = looseProps[i];
			const lpBuf = new Uint8Array(24);
			const lpView = new DataView(lpBuf.buffer);
			if (i < looseProps.length - 1) {
				lpView.setInt16(0, varLen + 24, true);            // next offset
			}
			lpView.setInt32(4, lp.id || 0, true);                // assetID
			// UInt32 at 8: crc (0 - not tracked client-side)
			lpView.setInt16(20, lp.y || 0, true);                // y
			lpView.setInt16(22, lp.x || 0, true);                // x
			appendChunk(lpBuf);
		}

		// Build the 40-byte room header
		const roomHeader = new Uint8Array(40);
		const rhView = new DataView(roomHeader.buffer);
		rhView.setInt32(0, room.flags || 0, true);                // roomFlags
		rhView.setInt32(4, 0, true);                              // facesID
		rhView.setInt16(8, room.id || 0, true);                   // roomID
		rhView.setInt16(10, 0, true);                             // roomNameOfst (name at start of varBuf)
		rhView.setInt16(12, bgOffset, true);                      // backgroundOfst
		rhView.setInt16(14, artistOffset, true);                  // artistNameOfst
		rhView.setInt16(16, passwordOffset, true);                // passwordOfst
		rhView.setInt16(18, spots.length, true);                  // nbrHotspots
		rhView.setInt16(20, spotsFixedOffset, true);              // hotspotOfst
		rhView.setInt16(22, pics.length, true);                   // nbrPics
		rhView.setInt16(24, picsFixedOffset, true);               // picsOfst
		rhView.setInt16(26, 0, true);                             // nbrDrawCmds
		rhView.setInt16(28, 0, true);                             // firstDrawCmd
		rhView.setInt16(30, (room.users?.length || 0) + 1, true); // nbrUsers
		rhView.setInt16(32, looseProps.length, true);             // nbrLProps
		rhView.setInt16(34, loosePropsOffset, true);              // firstLProp
		rhView.setInt16(36, 0, true);                             // reserved
		rhView.setInt16(38, varLen, true);                        // lenVars

		// Assemble the full packet: 12-byte header + 40-byte room header + varBuf
		const totalVarBuf = new Uint8Array(varLen);
		let pos = 0;
		for (const chunk of chunks) {
			totalVarBuf.set(chunk, pos);
			pos += chunk.length;
		}

		const packetSize = 12 + 40 + varLen;
		const packet = BufferView.alloc(packetSize);
		packet.setInt32(0, MSG.ROOMSETDESC);
		packet.setInt32(4, 40 + varLen);
		packet.setInt32(8, 0);
		packet.set(roomHeader, 12);
		packet.set(totalVarBuf, 52);

		return packet;
	}

	/** Return the byte size of the ROOMSETDESC packet for the current room. */
	calcRoomDescSize(): number {
		return this.buildRoomDescPacket()?.byteLength ?? 0;
	}

	sendRoomSetDesc(): void {
		const packet = this.buildRoomDescPacket();
		if (!packet) return;

		if (packet.byteLength > 15984) {
			logmsg('Room data exceeds server size limit (15984 bytes). Remove some scripting or doors.');
			return;
		}

		this.send(packet);
	}

	sendWhisper(msg: string, whisperID: number): void {
		const encoded: Uint8Array = this.textEncoder.encode(msg);
		const packet = BufferView.alloc(19 + encoded.length);
		packet.setInt32(0, MSG.XWHISPER);
		packet.setInt32(4, encoded.length + 7);
		packet.setInt32(12, whisperID);
		packet.setInt16(16, encoded.length + 3);
		packet.set(this.crypt.Encrypt(encoded), 18);
		this.send(packet);
	}

	sendRmsg(msg: string): void {
		const encoded: Uint8Array = this.textEncoder.encode(msg);
		const packet = BufferView.alloc(13 + encoded.length);
		packet.setInt32(0, MSG.RMSG);
		packet.setInt32(4, encoded.length + 1);
		packet.set(encoded, 12);
		this.send(packet);
	}

	sendGmsg(msg: string): void {
		const encoded: Uint8Array = this.textEncoder.encode(msg);
		const packet = BufferView.alloc(13 + encoded.length);
		packet.setInt32(0, MSG.GMSG);
		packet.setInt32(4, encoded.length + 1);
		packet.set(encoded, 12);
		this.send(packet);
	}


	sendXtlk(msg: string): void {
		const encoded: Uint8Array = this.textEncoder.encode(msg);
		const leng = encoded.length;
		const packet = BufferView.alloc(15 + leng);
		packet.setInt32(0, MSG.XTALK);
		packet.setInt32(4, leng + 3);
		packet.setInt16(12, leng + 3);
		packet.set(this.crypt.Encrypt(encoded), 14);
		this.send(packet);
	}

	sendRoomNav(id: number): void {
		const packet = BufferView.alloc(14);
		packet.setInt32(0, MSG.ROOMGOTO);
		packet.setInt32(4, 2);
		packet.setInt16(12, id);
		this.send(packet);
	}

	sendRoomListRequest(): void {
		const packet = BufferView.alloc(12);
		packet.setInt32(0, MSG.LISTOFALLROOMS);
		this.send(packet);
	}

	sendUserListRequest(): void {
		const packet = BufferView.alloc(12);
		packet.setInt32(0, MSG.LISTOFALLUSERS);
		this.send(packet);
	}

	sendPropDress(props: number[]): void {
		const length = props.length;
		const packet = BufferView.alloc(16 + length * 8);
		packet.setInt32(0, MSG.USERPROP);
		packet.setInt32(4, length * 8 + 4);
		packet.setInt32(12, length);
		for (let i = 0; i < length; i++)
			packet.setInt32(16 + i * 8, props[i]);
		this.send(packet);
	}

	sendPropDrop(x: number, y: number, id: number): void {
		const packet = BufferView.alloc(24);
		packet.setInt32(0, MSG.PROPNEW);
		packet.setInt32(4, 12);
		packet.setInt32(12, id);
		packet.setInt16(20, y);
		packet.setInt16(22, x);
		this.send(packet);
	}

	sendPropMove(x: number, y: number, index: number): void {
		const packet = BufferView.alloc(20);
		packet.setInt32(0, MSG.PROPMOVE);
		packet.setInt32(4, 8);
		packet.setInt32(12, index);
		packet.setInt16(16, y);
		packet.setInt16(18, x);
		this.send(packet);
	}

	sendPropDelete(index: number): void {
		const packet = BufferView.alloc(16);
		packet.setInt32(0, MSG.PROPDEL);
		packet.setInt32(4, 4);
		packet.setInt32(12, index);
		this.send(packet);
	}

	sendUserLocation(x: number, y: number): void {
		const packet = BufferView.alloc(16);
		packet.setInt32(0, MSG.USERMOVE);
		packet.setInt32(4, 4);
		packet.setInt16(12, y);
		packet.setInt16(14, x);
		this.send(packet);
	}

	sendUserName(name: string): void {
		const encoded: Uint8Array = this.textEncoder.encode(name);
		const packet = BufferView.alloc(encoded.length + 13);
		packet.setInt32(0, MSG.USERNAME);
		packet.setInt32(4, encoded.length + 1);
		packet.setInt8(12, encoded.length);
		packet.set(encoded, 13);
		this.send(packet);
	}

	sendFace(face: number): void {
		const packet = BufferView.alloc(14);
		packet.setInt32(0, MSG.USERFACE);
		packet.setInt32(4, 2);
		packet.setInt16(12, face);
		this.send(packet);
	}

	sendFaceColor(color: number): void {
		const packet = BufferView.alloc(14);
		packet.setInt32(0, MSG.USERCOLOR);
		packet.setInt32(4, 2);
		packet.setInt16(12, color);
		this.send(packet);
	}

	sendAuthenticate(name: string, pass: string): void {
		const info: Uint8Array = this.textEncoder.encode(`${name}:${pass}`);
		const packet = BufferView.alloc(13 + info.length);
		packet.setInt32(0, MSG.AUTHRESPONSE);
		packet.setInt32(4, info.length + 1);
		packet.setInt8(12, info.length);
		packet.set(this.crypt.Encrypt(info), 13);
		this.send(packet);
	}

	sendRegistration(): void {
		const reg = BufferView.alloc(140);
		reg.setInt32(0, MSG.LOGON);
		reg.setInt32(4, 128);

		
		reg.setInt32(12, this.regi.crc);
		reg.setInt32(16, this.regi.counter);

		const userName = prefs.general.userName as string || '';
		const isAscii = /^[\x20-\x7E]*$/.test(userName);
		if (isAscii && userName.length > 0) {
			const name: Uint8Array = this.textEncoder.encode(userName);
			reg.setInt8(20, name.length);
			reg.set(name, 21);
		}

		if (/^Win/.test(navigator.platform)) {
			reg.setUint32(84, 0x80000004);
		} else {
			reg.setUint32(84, 0x80000002);
		}

		reg.setInt32(88, this.puid.counter);
		reg.setInt32(92, this.puid.crc);

		reg.setInt32(96, 0x00011940);
		reg.setInt32(100, 0x00011940);
		reg.setInt32(104, 0x00011940);
		reg.set(this.textEncoder.encode(this.clientVersion), 110);

		reg.setInt32(120, 0x00000041);
		if (this.retryRegistration === true) {
			reg.setInt32(124, 0x00000111);
		} else {
			reg.setInt32(124, 0x00000151);
		}
		reg.setInt32(128, 0x00000001);
		reg.setInt32(132, 0x00000001);

		this.send(reg);
	}

	sendAssetQuery(id: number): void {
		const packet = BufferView.alloc(24);
		packet.setInt32(0, MSG.ASSETQUERY);
		packet.setInt32(4, 12);
		packet.setInt32(12, 0x50726F70);
		packet.setInt32(16, id);
		this.send(packet);
	}

	/* eslint-disable @typescript-eslint/no-unused-vars */
	connecting(): void { /* overridden by subclass */ }
	handOffData(_p: any): void { /* overridden by subclass */ }
	/* eslint-enable @typescript-eslint/no-unused-vars */
}

export class PalaceClient extends PalaceProtocol {
	propDecoder: LegacyPropDecoder;
	background: HTMLElement;
	videobg: HTMLVideoElement;
	container: HTMLElement;
	canvas: HTMLCanvasElement;
	canvas2: HTMLCanvasElement;
	canvas3: HTMLCanvasElement;
	canvas4: HTMLCanvasElement;
	containerOffsetTop: number;
	chatBoxHeight: number;
	sounds: Record<string, HTMLAudioElement>;

	mediaMuted = false;
	copiedSpot: any = null;
	servername = '';
	serverflags = 0;
	theUserID: number | null = null;
	theUserStatus = 0;
	theUser: PalaceUser | null = null;
	/** Set when MSG_GVER is seen after logon; used with MSG_VERSION to log server kind (PC* clients). */
	private goServerVerSeen = false;
	/** True when the server advertises ;unicode=1 in MSG_GVER — enables UTF-8 chat with 150-char limit. */
	unicodeEnabled = false;
	mediaUrl = '';
	lastUserLogOnTime = 0;
	lastUserLogOnID = 0;
	serverUserCount = 0;
	roomList: any[] | null = null;
	userList: any[] | null = null;
	lastLoadedBG = '';
	currentBG = '';
	clientId = 0;
	debugMode = false;

	constructor(regi: number, puid: number, version: string) {
		const reg = new PalaceRegistration(regi, puid);
		super(
			{ crc: reg.crc, counter: reg.counter },
			{ crc: reg.puidCrc, counter: reg.puidCounter },
			`PC5${version.replace(/\./g, '').slice(-3)}`
		);

		this.propDecoder = new LegacyPropDecoder();
		this.background = document.getElementById('background')!;
		this.videobg = document.getElementById('videobg') as HTMLVideoElement;
		this.container = document.getElementById('container')!;
		this.canvas = document.getElementById('mainlayer') as HTMLCanvasElement;
		this.canvas2 = document.getElementById('toplayer') as HTMLCanvasElement;
		this.canvas3 = document.getElementById('bubblelayer') as HTMLCanvasElement;
		this.canvas4 = document.getElementById('proplayer') as HTMLCanvasElement;

		this.containerOffsetTop = this.container.offsetTop;
		this.chatBoxHeight = document.getElementById('chatbar')!.offsetHeight;

		this.sounds = {
			signon: PalaceClient.preloadAudio('SignOn'),
			signoff: PalaceClient.preloadAudio('SignOff'),
			whisper: PalaceClient.preloadAudio('Whispered'),
			doorclose: PalaceClient.preloadAudio('DoorClose'),
			dooropen: PalaceClient.preloadAudio('DoorOpen')
		};

		this.videobg.onloadeddata = () => {
			if ((this.videobg as any).webkitAudioDecodedByteCount > 0 || (this.videobg as any).mozHasAudio || (this.videobg as any).audioTracks?.length > 0) {
				this.showMuteButton();
				if (this.mediaMuted) this.videobg.muted = true;
			}
		};

		this.videobg.onloadedmetadata = () => {
			this.lastLoadedBG = this.videobg.src;
			this.videobg.width = this.videobg.videoWidth;
			this.videobg.height = this.videobg.videoHeight;
			this.setRoomBG(this.videobg.videoWidth, this.videobg.videoHeight, '');
			this.videobg.style.display = 'block';
			this.theRoom.executeEvent('ROOMREADY');
		};

		const menuStore: { userid?: number; looseprop?: any } = {};

		this.canvas.addEventListener('contextmenu', (e: MouseEvent) => {
			if (this.theRoom) {
				e.preventDefault();

				// Suppress context menu after a right-click drag slide
				if (this.theRoom.rightDragSlideEnded) {
					this.theRoom.rightDragSlideEnded = false;
					return;
				}

				const x = ((e as any).layerX / viewScale).fastRound();
				const y = ((e as any).layerY / viewScale).fastRound();

				let user = this.theRoom.mouseOverUser(x, y);

				if (user && user === this.theUser) {
					const selfUser = this.theUser!;
					(async () => {
						const locked = selfUser.avatarLocked;
						const menuIndex = await (window.apiBridge.openContextMenu as any)({
							items: [
								{ label: "Accept Avatar", type: "normal", enabled: true },
								{ label: "Save Avatar to Bag", type: "normal", enabled: selfUser.props.length > 0 },
								{ label: "Remove All Props", type: "normal", enabled: selfUser.props.length > 0 },
								{ label: "Lock Avatar", type: "checkbox", enabled: true, checked: locked },
								{ label: "", type: "separator", enabled: false },
								{ label: "Smiley Faces", type: "normal", enabled: true },
								{ label: "", type: "separator", enabled: false },
								{ label: "Change User Name", type: "normal", enabled: true }
							]
						}) as number;
						switch (menuIndex) {
							case 0:
								super.sendXtlk("'accept");
								break;
							case 1:
								saveProp(selfUser.props.slice());
								enablePropButtons();
								break;
							case 2:
								this.setprops([]);
								break;
							case 3:
								selfUser.avatarLocked = !locked;
								prefs.general.avatarLocked = selfUser.avatarLocked;
								logmsg(selfUser.avatarLocked ? 'Avatar locked.' : 'Avatar unlocked.');
								break;
							case 5:
								toggleZoomPanel('smileypicker');
								break;
							case 7: {
								const chatbox = document.getElementById('chatbox')!;
								chatbox.textContent = '~name ';
								chatbox.focus();
								// Move cursor to end
								const range = document.createRange();
								const sel = window.getSelection()!;
								range.selectNodeContents(chatbox);
								range.collapse(false);
								sel.removeAllRanges();
								sel.addRange(range);
								break;
							}
						}
					})();

				} else if (user && user !== this.theUser) {
					menuStore.userid = user.id;

					(async () => {
						const isAdmin = this.isOperator || this.isOwner;
						const menuIndex = await (window.apiBridge.openContextMenu as any)({
							items: [
								{ id: 0, label: "Whisper", type: "checkbox", enabled: true, checked: Boolean(this.theRoom.whisperUserID) },
								{ type: "separator" },
								{ id: 2, label: "Offer avatar", type: "normal", enabled: true },
								{ id: 3, label: "Accept avatar", type: "normal", enabled: true },
								{ type: "separator" },
								{ id: 5, label: "Prop mute", type: "checkbox", enabled: true, checked: Boolean(user.propMuted) },
								...(isAdmin ? [
									{ type: "separator" },
									{ id: 71, label: "`list -o -k", type: "normal", enabled: true },
									{ id: 72, label: "`list -o -p", type: "normal", enabled: true },
									{ type: "separator" },
									{ id: 6, label: "Server Commands", type: "normal", enabled: true, submenu: [
										{ id: 60, label: "`mute", type: "normal", enabled: true },
										{ id: 61, label: "`unmute", type: "normal", enabled: true },
										{ type: "separator" },
										{ id: 62, label: "`hidefrom", type: "normal", enabled: true },
										{ id: 63, label: "`unhidefrom", type: "normal", enabled: true },
										{ type: "separator" },
										{ id: 64, label: "`gag", type: "normal", enabled: true },
										{ id: 65, label: "`ungag", type: "normal", enabled: true },
										{ type: "separator" },
										{ id: 66, label: "`propgag", type: "normal", enabled: true },
										{ id: 67, label: "`unpropgag", type: "normal", enabled: true },
										{ type: "separator" },
										{ id: 68, label: "`pin", type: "normal", enabled: true },
										{ id: 69, label: "`unpin", type: "normal", enabled: true },
										{ type: "separator" },
										{ id: 70, label: "`kill", type: "normal", enabled: true }
									]}
								] : [
										{ type: "separator" },
										{ id: 6, label: "Server Commands", type: "normal", enabled: true, submenu: [
										{ id: 60, label: "`mute", type: "normal", enabled: true },
										{ id: 61, label: "`unmute", type: "normal", enabled: true },
										{ type: "separator" },
										{ id: 62, label: "`hidefrom", type: "normal", enabled: true },
										{ id: 63, label: "`unhidefrom", type: "normal", enabled: true }
									]}
									])
							]
						}) as number;
						switch (menuIndex) {
							case 0:
								user = this.theRoom.getUser(menuStore.userid);
								if (user) this.theRoom.enterWhisperMode(user.id, user.name);
								break;
							case 2:
								super.sendWhisper("'offer", menuStore.userid!);
								break;
							case 3:
								super.sendXtlk("'accept");
								break;
							case 5:
								user = this.theRoom.getUser(menuStore.userid);
								if (user) user.propMuted = !user.propMuted;
								break;
							case 60: super.sendWhisper("`mute", menuStore.userid!); break;
							case 61: super.sendWhisper("`unmute", menuStore.userid!); break;
							case 62: super.sendWhisper("`hidefrom", menuStore.userid!); break;
							case 63: super.sendWhisper("`unhidefrom", menuStore.userid!); break;
							case 64: super.sendWhisper("`gag", menuStore.userid!); break;
							case 65: super.sendWhisper("`ungag", menuStore.userid!); break;
							case 66: super.sendWhisper("`propgag", menuStore.userid!); break;
							case 67: super.sendWhisper("`unpropgag", menuStore.userid!); break;
							case 68: super.sendWhisper("`pin", menuStore.userid!); break;
							case 69: super.sendWhisper("`unpin", menuStore.userid!); break;
							case 70: super.sendWhisper("`kill", menuStore.userid!); break;
							case 71: super.sendWhisper("`list -o -k", menuStore.userid!); break;
							case 72: super.sendWhisper("`list -o -p", menuStore.userid!); break;
						}
					})();

				} else {
					// Check for spot right-click in authoring mode
					if (this.theRoom.authoring) {
						const spot = this.theRoom.mouseInSpot(x, y);
						if (spot) {
							this.theRoom.selectedSpot = spot;
							this.theRoom.reDrawTop();
							const spotRef = spot;
							const room = this.theRoom;
							(async () => {
								const menuIndex = await (window.apiBridge.openContextMenu as any)({
									items: [
										{ id: 0, label: "Door Info...", type: "normal", enabled: true },
										{ id: 1, label: "Edit Script...", type: "normal", enabled: true },
										{ type: "separator" },
										{ id: 2, label: "New Door", type: "normal", enabled: true },
										{ id: 3, label: "Clone Door", type: "normal", enabled: true },
										{ type: "separator" },
										{ id: 4, label: "Copy Door", type: "normal", enabled: true },
										{ id: 5, label: "Paste Door", type: "normal", enabled: this.copiedSpot !== null },
										{ id: 6, label: "Delete Door", type: "normal", enabled: true },
										{ type: "separator" },
										{ id: 7, label: "Door Layers", type: "normal", enabled: true, submenu: [
											{ id: 70, label: "Move to Bottom", type: "normal", enabled: true },
											{ id: 71, label: "Move Backward", type: "normal", enabled: true },
											{ id: 72, label: "Move Forward", type: "normal", enabled: true },
											{ id: 73, label: "Move to Top", type: "normal", enabled: true }
										]},
										{ id: 8, label: "Rotate Door", type: "normal", enabled: true, submenu: [
											{ id: 80, label: "0\u00B0", type: "normal", enabled: true },
											{ id: 81, label: "90\u00B0", type: "normal", enabled: true },
											{ id: 82, label: "180\u00B0", type: "normal", enabled: true },
											{ id: 83, label: "270\u00B0", type: "normal", enabled: true }
										]}
									]
								}) as number;
								switch (menuIndex) {
									case 0:
										showSpotEditor(spotRef, room);
										break;
									case 1:
										showSpotEditor(spotRef, room, 2);
										break;
									case 2:
										this.sendNewSpot();
										break;
									case 3: {
										const cloned = this.createSpotAt(spotRef.x + 10, spotRef.y + 10, spotRef);
										if (cloned) {
											room.selectedSpot = cloned;
											room.refresh(); room.refreshTop();
											this.sendRoomSetDesc();
										}
										break;
									}
									case 4:
										this.copiedSpot = spotRef;
										break;
									case 5: {
										if (this.copiedSpot) {
											const pasted = this.createSpotAt(spotRef.x + 10, spotRef.y + 10, this.copiedSpot);
											if (pasted) {
												room.selectedSpot = pasted;
												room.refresh(); room.refreshTop();
												this.sendRoomSetDesc();
											}
										}
										break;
									}
									case 6:
										this.sendSpotDel(spotRef.id);
										break;
									case 70: { // Move to Bottom
										const spots = room.spots;
										const idx = spots.indexOf(spotRef);
										if (idx > 0) { spots.splice(idx, 1); spots.unshift(spotRef); room.refresh(); room.refreshTop(); this.sendRoomSetDesc(); }
										break;
									}
									case 71: { // Move Backward
										const spots = room.spots;
										const idx = spots.indexOf(spotRef);
										if (idx > 0) { spots.splice(idx, 1); spots.splice(idx - 1, 0, spotRef); room.refresh(); room.refreshTop(); this.sendRoomSetDesc(); }
										break;
									}
									case 72: { // Move Forward
										const spots = room.spots;
										const idx = spots.indexOf(spotRef);
										if (idx >= 0 && idx < spots.length - 1) { spots.splice(idx, 1); spots.splice(idx + 1, 0, spotRef); room.refresh(); room.refreshTop(); this.sendRoomSetDesc(); }
										break;
									}
									case 73: { // Move to Top
										const spots = room.spots;
										const idx = spots.indexOf(spotRef);
										if (idx >= 0 && idx < spots.length - 1) { spots.splice(idx, 1); spots.push(spotRef); room.refresh(); room.refreshTop(); this.sendRoomSetDesc(); }
										break;
									}
								}
							})();
							return;
						}
					}

					// Empty-area context menu in authoring mode
					if (this.theRoom.authoring && !this.theRoom.mouseOverUser(x, y)) {
						const room = this.theRoom;
						const clickX = x;
						const clickY = y;
						(async () => {
							const menuIndex = await (window.apiBridge.openContextMenu as any)({
								items: [
									{ id: 0, label: "New Door", type: "normal", enabled: true },
									{ type: "separator" },
									{ id: 1, label: "Paste Door", type: "normal", enabled: this.copiedSpot !== null },
								]
							}) as number;
							switch (menuIndex) {
								case 0: {
									const spot = this.createSpotAt(clickX, clickY);
									if (spot) {
										room.selectedSpot = spot;
										room.refresh(); room.refreshTop();
										this.sendRoomSetDesc();
									}
									break;
								}
								case 1: {
									if (this.copiedSpot) {
										const pasted = this.createSpotAt(clickX, clickY, this.copiedSpot);
										if (pasted) {
											room.selectedSpot = pasted;
											room.refresh(); room.refreshTop();
											this.sendRoomSetDesc();
										}
									}
									break;
								}
							}
						})();
						return;
					}

					const lpIndex = this.theRoom.mouseOverLooseProp(x, y);

					if (lpIndex != null) {
						const lp = this.theRoom.looseProps[lpIndex];
						menuStore.looseprop = lp;

						(async () => {
							const menuIndex = await (window.apiBridge.openContextMenu as any)({
								items: [
									{ label: "Save Prop", enabled: (!propBagSet.has(lp.id)) },
									{ label: "", type: "separator", enabled: false },
									{ label: "Delete Prop", enabled: true }
								]
						}) as number;

							if (menuIndex === 0) {
								saveProp([menuStore.looseprop.id]);
							} else if (menuIndex === 2) {
								const index = this.theRoom.looseProps.indexOf(menuStore.looseprop);
								if (index > -1) super.sendPropDelete(index);
							}
						})();
					}
				}
			}
		}, false);
	}

	createSpotAt(x: number, y: number, template?: any): any {
		if (!this.theRoom) return null;
		let maxId = 0;
		for (const s of this.theRoom.spots) {
			if (s.id > maxId) maxId = s.id;
		}
		const newId = maxId + 1;
		const halfSize = 22;
		const spot: any = {
			id: newId,
			name: template ? template.name : '',
			type: template ? template.type : 0,
			flags: template ? template.flags : 0,
			x: x,
			y: y,
			state: 0,
			dest: template ? template.dest : 0,
			points: template ? template.points.slice() : [-halfSize, -halfSize, halfSize, -halfSize, halfSize, halfSize, -halfSize, halfSize],
			statepics: template ? template.statepics.map((p: any) => ({ id: p.id, x: p.x, y: p.y })) : [],
			img: PalaceRoom.createSpotPicPlaceholder(),
			toplayer: template ? template.toplayer : false,
			script: template ? template.script : '',
			handlers: {},
		};
		if (template?.spotStyle) spot.spotStyle = { ...template.spotStyle };
		this.container.appendChild(spot.img);
		this.theRoom.spots.push(spot);
		return spot;
	}

	get zoomFactorY(): number {
		return (this.containerOffsetTop * window.devicePixelRatio - this.containerOffsetTop);
	}

	maximizeRoomView(img: string): void {
		this.setRoomBG(window.innerWidth - logField.offsetWidth, window.innerHeight - this.containerOffsetTop - this.chatBoxHeight, img);
	}

	override connecting(): void {
		this.maximizeRoomView('');
		this.serverDown();
		this.toggleLoadingBG(true);
		setUserInterfaceAvailability(true);
	}

	goto(url: string): void {
		const connectInfo = url.trim().replace('palace://', '').split(':');
		this.retryRegistration = false;
		// AI DO NOT REMOVE THIS COMMENT - THIS IS LEGACY DIRECTORY BEHAVIOR
		// For hostname-based addresses, attempt to fetch palace.json from the host for
		// port and IP discovery. Falls back to a direct host:port connection if unavailable.
		httpGetAsync(
			`http://${connectInfo[0]}/palace.json`,
			'json',
			(json) => {
				const data = json as any;
				// A 200 response with a non-JSON body (e.g. an HTML error page) results in
				// json being null. Treat that the same as a failed fetch and connect directly.
				if (!data || data.port == null) {
					super.connect(connectInfo[0], connectInfo[1]);
					return;
				}
				const port = String(data.port);
				const ip = data.ip !== undefined ? data.ip : connectInfo[0];
				super.connect(ip, port);
			},
			() => {
				super.connect(connectInfo[0], connectInfo[1]);
			}
		);
	}

	static preloadAudio(name: string): HTMLAudioElement {
		const a = document.createElement("audio");
		a.src = `audio/system/${name}.wav`;
		return a;
	}

	logmsg(msg: string): void {
		logmsg(msg);
	}
	
	setBackGroundVideo(url: string): void {
		this.unloadBgVideo();
		this.videobg.src = url;
		if (this.theRoom) {
			this.theRoom.executeEvent('ROOMLOAD');
		}
	}

	setBackGround(url: string): void {
		this.unloadBgVideo();

		const bg = document.createElement('img');

		let count = 0;
		const preLoad = setInterval(() => {
			if (bg.naturalWidth > 0 || this.currentBG !== bg.src) {
				bg.onload!(null as any);
			}
			count++;
			if (count > 500) {
				clearInterval(preLoad);
			}
		}, 50);

		bg.onload = () => {
			clearInterval(preLoad);
			if (this.currentBG === bg.src && this.lastLoadedBG !== bg.src) {
				if (bg.naturalWidth > 0) {
					this.lastLoadedBG = bg.src;
					this.setRoomBG(bg.naturalWidth, bg.naturalHeight, `url(${bg.src})`);
					if (this.theRoom) this.theRoom.executeEvent('ROOMREADY');
				} else {
					bg.onerror!(null as any);
				}
			}
		};

		let retriedAlt = false;
		bg.onerror = () => {
			clearInterval(preLoad);
			if (!retriedAlt) {
				retriedAlt = true;
				const src = bg.src;
				if (src.endsWith('.png')) {
					bg.src = src.slice(0, -4) + '.jpg';
					this.currentBG = bg.src;
					return;
				} else if (src.endsWith('.jpg')) {
					bg.src = src.slice(0, -4) + '.png';
					this.currentBG = bg.src;
					return;
				}
			}
			if (this.currentBG === bg.src) {
				this.maximizeRoomView("url(img/error.svg)");
			}
			this.currentBG = '';
			this.lastLoadedBG = '';
		};

		bg.src = url;
	}

	toggleLoadingBG(on: boolean): void {
		if (on) {
			this.background.style.width = '200px';
			this.background.style.height = '200px';
			this.background.className = 'spinloading';
		} else {
			this.background.className = '';
		}
	}

	unloadBgVideo(): void {
		this.videobg.style.display = 'none';
		if (this.videobg.src !== '') {
			this.videobg.src = '';
		}
		this.hideMuteButton();
	}

	setRoomBG(w: number, h: number, bg: string): void {
		this.toggleLoadingBG(false);
		this.setRoomSize(w, h);
		this.background.style.backgroundImage = bg;
		const dimOverlay = document.getElementById('dimoverlay');
		if (dimOverlay) dimOverlay.style.opacity = '0';
		Bubble.resetDisplayedBubbles();
		if (this.theRoom) {
			this.theRoom.refreshTop();
			this.theRoom.refresh();
			this.theRoom.refreshProps();
		}
	}

	setRoomSize(w: number, h: number): void {
		this.canvas.width = w;
		this.canvas.height = h;
		this.canvas2.width = w;
		this.canvas2.height = h;
		this.canvas3.width = w;
		this.canvas3.height = h;
		this.canvas4.width = w;
		this.canvas4.height = h;

		if (this.theRoom) {
			[this.theRoom.context, this.theRoom.topcontext, this.theRoom.bubblecontext, this.theRoom.propcontext].forEach((ctx: CanvasRenderingContext2D) => {
				ctx.lineJoin = 'round';
				ctx.lineCap = 'round';
				ctx.imageSmoothingEnabled = false;
			});
		}
		scale2Fit();
		this.background.style.width = `${w}px`;
		this.background.style.height = `${h}px`;
		this.container.style.width = `${w}px`;
		this.container.style.height = `${h}px`;

		document.body.style.height = `${this.roomHeight + this.containerOffsetTop + this.chatBoxHeight}px`;
		setBodyWidth();

		if (this.theRoom?.users) {
			this.theRoom.users.forEach((user: PalaceUser) => {
				user.setNameLocation();
			});
		}
	}

	get roomWidth(): number {
		return this.canvas.width;
	}

	get roomHeight(): number {
		return this.canvas.height;
	}

	serverDownMsg(ref: number, msg?: string): string {
		switch (ref) {
			case 1: return 'You\'ve logged off.';
			case 2: return 'com error.';
			case 3: return 'You\'ve been killed for flooding!';
			case 4: return 'You\'ve been killed by a Operator!';
			case 5: return 'Server has been shut down.';
			case 6: return 'Server is unresponsive.';
			case 7: return 'You\'ve been killed by the System Operator!';
			case 8: return 'The Server is full.';
			case 9: return 'The server has rejected you because you are using a invalid serial number.';
			case 10: return 'The server has rejected you because someone with the same serial number has logged on.';
			case 11: return 'Your death penalty is still active.';
			case 12: return 'You\'ve been Banished.';
			case 13: return 'You\'ve been Banished and Killed.';
			case 14: return 'This server does not allow guests.';
			case 15: return 'demo expired.';
			case 16: return msg!;
			default:
				if (msg) return msg;
				return `You have been disconnected for a reason unknown.  REFNUMBER: ${ref}`;
		}
	}

	passUrl(s: string): string {
		const url = s.trim().replace(/ /g, '%20');
		return (url.indexOf('http') === 0) ? url : this.mediaUrl + url;
	}

	removeSpotPicElements(): void {
		const childs = this.container.children;
		for (let i = childs.length; --i >= 0;) {
			const child = childs[i] as HTMLElement;
			if (child.className.indexOf('spot') === 0) {
				if (child.constructor === window.HTMLImageElement) {
					(child as HTMLImageElement).onload = null;
				}
				this.container.removeChild(child);
			}
		}
		// Ensure all webembed webviews are removed from the DOM
		this.container.querySelectorAll('.spotwebembed').forEach(el => el.remove());
		if (this.theRoom) {
			this.theRoom.spots.forEach((spot: any) => {
				spot.webEmbed = undefined;
			});
		}
		this.hideMuteButton();
	}

	serverDown(msg?: string): void {
		IptEngine.abort();
		IptEngine.clearCachedScripts();
		CyborgEngine.abort();
		this.mediaUrl = "";
		this.lastUserLogOnTime = 0;
		this.lastUserLogOnID = 0;
		this.serverUserCount = 0;
		this.theUser = null;
		this.theUserID = null;
		this.sessionUserID = null;
		this.roomList = null;
		this.userList = null;
		this.lastLoadedBG = '';
		this.removeSpotPicElements();
		Bubble.deleteAllBubbles();
		this.unloadBgVideo();
		toggleZoomPanel('authenticate', 0);

		resetCacheProps();

		if (this.theRoom) {
			this.theRoom.exitWhisperMode();
			this.removeUserDomElements();
		}
		this.theRoom = new PalaceRoom({
			id: -1,
			flags: 0,
			name: '',
			artist: '',
			background: '',
			password: '',
			looseProps: [],
			spots: [],
			pictures: [],
			draws: []
		});
		this.theRoom.users = [];
		this.theRoom.refresh();
		this.theRoom.refreshTop();

		if (msg) {
			this.maximizeRoomView("url(img/error.svg)");
			logmsg(msg);
		}
	}

	serverInfo(info: { name: string; flags: number }): void {
		this.servername = info.name;
		this.serverflags = info.flags;
		const addressBar = document.getElementById('palaceserver')!;
		addressBar.title = info.name;
		if (addressBar !== document.activeElement) addressBar.innerText = this.servername;
		// Auto-admin: send saved password if autoLogin is enabled
		const key = this.serverKey();
		const saved = getAdminPasswords();
		if (saved[key]?.autoLogin) {
			try {
				this.sendOperatorRequest(atob(saved[key].password));
			} catch { /* corrupted entry */ }
		}
	}

	serverKey(): string {
		return `${this.ip}:${this.port}`;
	}

	get allowPainting(): boolean {
		return Boolean(this.serverflags & 0x0004);
	}

	get isOperator(): boolean {
		return Boolean(this.theUserStatus & 0x0001);
	}

	get isOwner(): boolean {
		return Boolean(this.theUserStatus & 0x0002);
	}

	userLogOn(info: { id: number; count: number }): void {
		this.lastUserLogOnID = info.id;
		this.lastUserLogOnTime = PalaceClient.ticks();
		this.serverUserCount = info.count;
		if (this.theRoom) this.theRoom.setUserCount(info.id);
		
	}

	userLogOff(info: { id: number; count: number; logoff?: boolean }): void {
		this.serverUserCount = info.count;
		if (this.theRoom) {
			info.logoff = true;
			if (this.theRoom.removeUser(info) && !prefs.general.disableSounds) this.sounds.signoff.play();
			this.theRoom.setUserCount();
		}
	}

	addSelfProp(pid: number): boolean | undefined {
		if (this.theUser && this.theUser.props.length < 9 && this.theUser.props.indexOf(pid) === -1) {
			(this.theUser as any).propsChanged = true;
			this.theUser.props.push(pid);
			this.theUser.setDomProps();
			return true;
		}
	}

	removeSelfProp(pid: number): boolean | undefined {
		if (this.theUser) {
			const i = this.theUser.props.indexOf(pid);
			if (this.theUser.props.length > 0 && i > -1) {
				(this.theUser as any).propsChanged = true;
				this.theUser.props.splice(i, 1);
				this.theUser.setDomProps();
				return true;
			}
		}
	}

	static datetime(): number {
		return datetime();
	}

	static ticks(): number {
		return ticks();
	}

	showMuteButton(): void {
		const btn = document.getElementById('muteaudio')!;
		btn.style.display = 'block';
		btn.style.backgroundImage = `url(img/audio${this.mediaMuted ? 'off' : 'on'}.svg)`;
	}

	hideMuteButton(): void {
		// Hide only if no audio sources remain
		const hasWebEmbed = this.container.querySelector('.spotwebembed') !== null;
		const hasVideoBg = this.videobg.style.display !== 'none' && this.videobg.src !== '';
		if (!hasWebEmbed && !hasVideoBg) {
			document.getElementById('muteaudio')!.style.display = 'none';
		}
	}

	muteAllMedia(muted: boolean): void {
		this.mediaMuted = muted;
		this.videobg.muted = muted;
		this.container.querySelectorAll('.spotwebembed').forEach(el => {
			try { (el as any).setAudioMuted?.(muted); } catch { /* not ready */ }
		});
		const btn = document.getElementById('muteaudio')!;
		btn.style.backgroundImage = `url(img/audio${muted ? 'off' : 'on'}.svg)`;
	}

	playSound(name: string): void {
		if (!prefs.general.disableSounds) {
			const player = document.getElementById('soundplayer') as HTMLAudioElement;
			if (name.startsWith('http://') || name.startsWith('https://')) {
				player.onerror = null;
				player.src = name;
				return;
			}
			// Check HTTP sound cache before trying local files
			const cachedUrl = getHttpSoundUrl(name);
			if (cachedUrl) {
				player.onerror = null;
				player.src = cachedUrl;
				return;
			}
			player.onerror = () => {
				const parts = player.src.split('.');
				const ext = parts.pop();
				if (ext === 'wav') {
					player.src = `${parts[0]}.mp3`;
				} else {
					player.onerror = null;
					player.src = this.mediaUrl + name;
				}
			};
			player.src = `audio/${name.split('.').length === 1 ? `${name}.wav` : name}`;
		}
	}

	override connect(ip: string, port: string): void {
		if (this.debugMode) console.log(`[PalaceClient.connect] ip=${ip} port=${port}`);
		this.goServerVerSeen = false;
		this.unicodeEnabled = false;
		super.connect(ip, port);
	}

	/** True after MSG_GVER (palaceserver-go); enables blowthru prop coordination in props.ts and UUID for Palace Electron only.*/
	supportsPalaceAppPropCoord(): boolean {
		//console.log(`[supportsPalaceAppPropCoord] goServerVerSeen=${this.goServerVerSeen}`);
		return this.goServerVerSeen;
	}

	/** Goserver After MSG_GVER: send optional `CLIENT_MACHINE_UUID` (Palace Electron only). */
	private async sendGoServerMachineUuid(): Promise<void> {
		if (this.debugMode) console.log('[sendGoServerMachineUuid] called');
		const bridge = window.apiBridge as { getMachineUuid?: () => Promise<string | null> };
		if (typeof bridge.getMachineUuid !== 'function') {
			return;
		}
		let value: string | null;
		try {
			value = await bridge.getMachineUuid();
		} catch {
			return;
		}
		if (!value || value.length < 8 || value.length > 80) {
			return;
		}
		const enc = new TextEncoder();
		const body = enc.encode(value);
		if (body.length > 80) {
			return;
		}
		const packet = BufferView.alloc(12 + body.length + 1);
		packet.setInt32(0, MSG.CLIENT_MACHINE_UUID);
		packet.setInt32(4, body.length + 1);
		packet.setInt32(8, 0);
		packet.set(body, 12);
		packet.setUint8(12 + body.length, 0);
		this.send(packet);
	}

	/** Goserver Room blowthru: `flags=0`, `nbrUsers=0`, `PRPD` tag, signed int32 prop asset id (LE). */
	sendPropCoordBlowThru(propId: number): void {
		if (this.debugMode) console.log(`[sendPropCoordBlowThru] propId=${propId}`);
		const refUid = this.theUserID ?? this.sessionUserID;
		if (!this.goServerVerSeen || refUid == null) {
			if (this.debugMode) console.log(`[sendPropCoordBlowThru] skipped: goServerVerSeen=${this.goServerVerSeen}, refUid=${refUid}`);
			return;
		}
		const payloadLen = 16;
		const packet = BufferView.alloc(12 + payloadLen);
		packet.setInt32(0, MSG.BLOWTHRU);
		packet.setInt32(4, payloadLen);
		packet.setInt32(8, refUid);
		packet.setUint32(20, PROP_DONE_BLOWTHRU_TAG);
		packet.setInt32(24, propId | 0);
		this.send(packet);
		if (this.debugMode) console.log(`Sent blowthru for prop ${propId} with refUid ${refUid}`);
	}

	localmsg(msg: string): void {
		if (this.theRoom) {
			this.theRoom.userChat({ id: 0, chatstr: String(msg) });
		}
	}

	donprop(pid: number): void {
		if (this.addSelfProp(pid)) {
			this.selfPropChange();
			loadProps([pid], true);
		}
	}

	removeprop(pid: number): void {
		if (this.removeSelfProp(pid)) {
			this.selfPropChange();
			loadProps(this.theUser!.props, true);
		}
	}

	setprops(pids: number[]): void {
		if (this.theUser && this.theUser.changeUserProps(pids, true)) {
			this.selfPropChange();
		}
	}

	gotoroom(id: number): void {
		super.sendRoomNav(id);
	}

	setpos(x: number, y: number): void {
		if (x < 22) x = 22;
		if (y < 22) y = 22;
		if (x > this.roomWidth - 22) x = this.roomWidth - 22;
		if (y > this.roomHeight - 22) y = this.roomHeight - 22;
		super.sendUserLocation(x, y);
		this.theRoom.userMove({ id: this.theUserID, x, y });
	}

	move(x: number, y: number): void {
		if (this.theUser) {
			this.setpos(this.theUser.x + x, this.theUser.y + y);
		}
	}

	selfPropChange(): void {
		if (this.theUser) {
			super.sendPropDress(this.theUser.props);
		}
		(this.theUser as any).propsChanged = false;
		enablePropButtons();
	}

	decodeLegacyProp(data: any): void {
		if (Array.isArray(data.img)) data.img = Uint8ClampedArray.from(data.img);
		this.propDecoder.decode(data.flags, data.img, (blob: Blob | null) => {
			if (!blob) return;
			const aProp = new PalaceProp(data.id, data);
			cacheProps[data.id] = aProp;
			aProp.loadBlob(blob);
			delete aProp.rcounter;
		});
	}

	removeUserDomElements(): void {
		this.theRoom.users.forEach((user: PalaceUser) => {
			user.removeFromDom();
		});
	}

	override handOffData(p: { type: number; reference?: number; data: any }): void {
		switch (p.type) {
			case MSG.TALK:
			case MSG.WHISPER:
			case MSG.XWHISPER:
			case MSG.XTALK:
				this.theRoom.userChat(p.data);
				break;
			case MSG.USERMOVE:
				this.theRoom.userMove(p.data);
				break;
			case MSG.USERFACE:
				this.theRoom.userFaceChange(p.data);
				break;
			case MSG.USERCOLOR:
				this.theRoom.userColorChange(p.data);
				break;
			case MSG.USERPROP:
				this.theRoom.userPropChange(p.data);
				break;
			case MSG.USERDESC:
				this.theRoom.userAvatarChange(p.data);
				break;
			case MSG.USERNAME:
				this.theRoom.userNameChange(p.data);
				break;
			case MSG.DRAW:
				this.theRoom.draw(p.data);
				break;
			case MSG.USERLOG:
				this.userLogOn(p.data);
				break;
			case MSG.LOGOFF:
				this.userLogOff(p.data);
				break;
			case MSG.USEREXIT:
				this.theRoom.removeUser(p.data);
				break;
			case MSG.USERNEW:
				this.theRoom.addUser(p.data);
				break;
			case MSG.HTTPSERVER:
				this.mediaUrl = p.data;
				break;
			case MSG.SPOTMOVE:
				this.theRoom.spotMove(p.data);
				break;
			case MSG.PICTMOVE:
				this.theRoom.spotMovePic(p.data);
				break;
			case MSG.SPOTSTATE:
			case MSG.DOORLOCK:
			case MSG.DOORUNLOCK:
				this.theRoom.spotStateChange(p.data);
				break;
			case MSG.ROOMSETDESC:
			case MSG.ROOMDESC: {
				let users: PalaceUser[] | undefined;
				let wasAuthoring = false;
				let selectedSpotId: number | null = null;
				p.data.authored = p.type === MSG.ROOMSETDESC;
				if (this.theRoom?.users) {
					this.theRoom.hideSpotTip();
					wasAuthoring = this.theRoom.authoring || false;
					if (this.theRoom.selectedSpot) selectedSpotId = this.theRoom.selectedSpot.id;
					if (p.data.authored) {
						users = this.theRoom.users;
					} else {
						this.removeUserDomElements();
					}
				}
				// Stop pending alarms, queued events, in-flight scripts, and HTTP requests from the old room
				IptEngine.clearAlarms();
				IptEngine.clearCallStack();
				CyborgEngine.clearAlarms();
				abortAllIptscraeHttpRequests();
				this.theRoom = new PalaceRoom(p.data);
				this.theRoom.users = users;
				if (wasAuthoring) {
					this.theRoom.authoring = true;
					if (selectedSpotId !== null) {
						this.theRoom.selectedSpot = this.theRoom.getSpot(selectedSpotId) ?? null;
					}
					this.theRoom.refreshTop();
				}
				break;
			}
			case MSG.ROOMDESCEND: {
				this.theRoom.autoUserLayer = false;
				for (const user of this.theRoom.users) {
					user.domAvatar.style.zIndex = '';
					user.domNametag.style.zIndex = '';
				}
				this.theRoom.executeEvent('ROOMLOAD');
				break;		
			}
			case MSG.NAVERROR:
				this.theRoom.navigationError(p.data);
				break;
			case MSG.LISTOFALLROOMS:
				loadRoomList(p.data);
				break;
			case MSG.LISTOFALLUSERS:
				loadUserList(p.data);
				break;
			case MSG.PROPDEL:
				this.theRoom.loosePropDelete(p.data);
				break;
			case MSG.PROPNEW:
				this.theRoom.loosePropAdd(p.data);
				break;
			case MSG.PROPMOVE:
				this.theRoom.loosePropMove(p.data);
				break;
			case MSG.USERSTATUS: {
				const wasAdmin = this.isOperator || this.isOwner;
				this.theUserID = p.data.id;
				this.theUserStatus = p.data.status;
				const isAdmin = this.isOperator || this.isOwner;
				if (!wasAdmin && isAdmin && this._pendingAdminPassword) {
					const key = this.serverKey();
					const saved = getAdminPasswords();
					if (saved[key]) {
						saved[key].password = btoa(this._pendingAdminPassword);
					} else {
						saved[key] = { password: btoa(this._pendingAdminPassword), autoLogin: false };
					}
					setAdminPasswords(saved);
					logmsg(`Admin password saved for ${key}.`);
				}
				this._pendingAdminPassword = null;
				updateAdminGlow();
				break;
			}
			case MSG.SERVERINFO:
				this.serverInfo(p.data);
				break;
			case WIRE_GO_SERVER_VER:
				if (this.debugMode) console.log('[handOffData] WIRE_GO_SERVER_VER received', p.data);
				logmsg('ThePalace.app server detected');
				this.goServerVerSeen = true;
				if (p.data?.unicode) {
					this.unicodeEnabled = true;
					this.textDecoder = new TextDecoder('utf-8');
					this.textEncoder = new TextEncoder();
					if (this.debugMode) console.log('[handOffData] Unicode mode enabled — switched to UTF-8');
					const prefName = prefs.general.userName as string;
					if (prefName) {
						this.sendUserName(prefName);
					}
				} else if (this.unicodeEnabled) {
					this.unicodeEnabled = false;
					this.textDecoder = new TextDecoder('windows-1252');
					this.textEncoder = new (TextEncoder as any)('windows-1252', { NONSTANDARD_allowLegacyEncoding: true });
					if (this.debugMode) console.log('[handOffData] Unicode mode disabled — switched to windows-1252');
				}
				void this.sendGoServerMachineUuid();
				break;
			case MSG.BLOWTHRU:
				if (this.debugMode) console.log('[handOffData] MSG.BLOWTHRU received', p.data);
				if (p.data?.propCoordDone != null) {
					handlePropCoordBlowThru(p.data.propCoordDone, p.reference ?? -1);
				}
				break;
			case MSG.VERSION:
				if (this.debugMode) console.log(`[handOffData] MSG.VERSION received, clientVersion=${this.clientVersion}, goServerVerSeen=${this.goServerVerSeen}`);
				if (this.clientVersion.startsWith('PC') && !this.goServerVerSeen) {
					logmsg('Legacy server detected');
				}
				break;
			case MSG.USERLIST:
				this.theRoom.loadUsers(p.data);
				break;
			case MSG.AUTHENTICATE:
				toggleZoomPanel('authenticate', 1);
				(document.getElementById("authusername") as HTMLInputElement).focus();
				break;
			case MSG.SERVERDOWN: {
				const sdMsg = this.serverDownMsg(p.data.refnum, p.data.msg);
				logmsg(sdMsg);
				this.retryRegistration = true;
				window.apiBridge.serverDown(sdMsg);
				break;
			}
			case MSG.ASSETSEND:
				this.decodeLegacyProp(p.data);
				break;
			default:
				if (this.debugMode) console.log(p);
				break;
		}
	}
}

export class PalaceRegistration {
	crc: number;
	counter: number;
	puidCrc: number;
	puidCounter: number;

	constructor(seed: number, p: number) {
		this.crc = this.computeLicenseCRC(seed);
		this.counter = ((seed ^ PalaceRegistration.MAGIC_LONG) ^ this.crc);
		this.puidCrc = this.computeLicenseCRC(p);
		this.puidCounter = (p ^ this.puidCrc);
	}

	static get CRC_MAGIC(): number { return 0xa95ade76; }
	static get MAGIC_LONG(): number { return 0x9602c9bf; }

	static get CRCMask(): number[] {
		return [0xebe19b94, 0x7604de74, 0xe3f9d651, 0x604fd612, 0xe8897c2c, 0xadc40920, 0x37ecdfb7, 0x334989ed,
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
		0xd9d49152, 0x4bb35bdb, 0xa1c7bbe6, 0x15a3699a, 0xe69e1eb5, 0x7cdda410, 0x488609df, 0xd19678d3];
	}

	computeLicenseCRC(v: number): number {
		const mask = PalaceRegistration.CRCMask;
		let crc = PalaceRegistration.CRC_MAGIC;
		for (let i = 4; --i >= 0;) {
			crc = ((crc << 1) | ((crc & 0x80000000) ? 1 : 0)) ^ mask[(v >> (i * 8) & 0xFF)];
		}
		return crc;
	}
}

export class PalaceCrypt {
	gSeed: number;
	gEncryptTable: Uint8Array;

	constructor(seed: number) {
		this.gSeed = seed;
		this.MySRand(666666);
		this.gEncryptTable = new Uint8Array(512);
		for (let i = 0; i < 512; i++) {
			this.gEncryptTable[i] = this.MyRandom(256) & 0xff;
		}
		this.MySRand(seed);
	}

	static get R_A(): number { return 16807; }
	static get R_M(): number { return 2147483647; }
	static get R_Q(): number { return 127773; }
	static get R_R(): number { return 2836; }

	Encrypt(b: Uint8Array): Uint8Array {
		if (b == null || b.length === 0) return b;
		let rc = 0, lastChar = 0, i = b.length;
		while (i--) {
			b[i] = b[i] ^ (this.gEncryptTable[rc] ^ lastChar);
			lastChar = b[i] ^ this.gEncryptTable[rc + 1];
			rc += 2;
		}
		return b;
	}

	Decrypt(b: Uint8Array, decoder: TextDecoder): string {
		if (b == null || b.length === 0) return '';
		let rc = 0, tmp = 0, lastChar = 0, i = b.length;
		while (i--) {
			tmp = b[i];
			b[i] = tmp ^ (this.gEncryptTable[rc] ^ lastChar);
			lastChar = tmp ^ this.gEncryptTable[rc + 1];
			rc += 2;
		}
		return decoder.decode(b);
	}

	get LongRandom(): number {
		const hi = (this.gSeed / PalaceCrypt.R_Q) & 0xffffffff;
		const lo = (this.gSeed % PalaceCrypt.R_Q) & 0xffffffff;
		const test = (PalaceCrypt.R_A * lo - PalaceCrypt.R_R * hi) & 0xffffffff;
		if (test > 0) {
			this.gSeed = test;
		} else {
			this.gSeed = test + PalaceCrypt.R_M;
		}
		return this.gSeed;
	}

	MyRandom(max: number): number {
		return (this.LongRandom / PalaceCrypt.R_M) * max;
	}

	MySRand(s: number): void {
		this.gSeed = s;
		if (this.gSeed === 0) this.gSeed = 1;
	}
}
