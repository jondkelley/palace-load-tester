import { IptExecutionContext } from './IptExecutionContext.js';
import { IptToken } from './IptToken.js';
import { IptError } from './IptError.js';
import { IntegerToken } from './tokens/IntegerToken.js';
import { StringToken } from './tokens/StringToken.js';
import { HashToken } from './tokens/HashToken.js';
import type { IptManager } from './IptManager.js';

interface EventVar {
	events: Set<string>;
	get: (ctx: PalaceExecutionContext) => IptToken;
}

const EVENT_VARS = new Map<string, EventVar>([
	['CHATSTR', { events: new Set(['OUTCHAT', 'INCHAT', 'SERVERMSG']), get: ctx => new StringToken(ctx.chatStr) }],
	['WHOCHANGE', { events: new Set(['COLORCHANGE', 'NAMECHANGE', 'FACECHANGE']), get: ctx => new IntegerToken(ctx.whoChangeId) }],
	['LASTNAME', { events: new Set(['NAMECHANGE']), get: ctx => new StringToken(ctx.lastName) }],
	['WHOMOVE', { events: new Set(['USERMOVE']), get: ctx => new IntegerToken(ctx.whoMoveId) }],
	['WHOENTER', { events: new Set(['USERENTER']), get: ctx => new IntegerToken(ctx.whoEnterId) }],
	['WHOLEAVE', { events: new Set(['USERLEAVE']), get: ctx => new IntegerToken(ctx.whoLeaveId) }],
	['WHATPROP', { events: new Set(['LOOSEPROPADDED', 'LOOSEPROPMOVED', 'LOOSEPROPDELETED']), get: ctx => new IntegerToken(ctx.whatPropId) }],
	['WHATINDEX', { events: new Set(['LOOSEPROPMOVED', 'LOOSEPROPDELETED']), get: ctx => new IntegerToken(ctx.whatIndex) }],
	['LASTSTATE', { events: new Set(['STATECHANGE']), get: ctx => new IntegerToken(ctx.lastState) }],
	['CONTENTS', { events: new Set(['HTTPRECEIVED']), get: ctx => new StringToken(ctx.httpContents) }],
	['HEADERS', { events: new Set(['HTTPRECEIVED']), get: ctx => ctx.httpHeaders }],
	['TYPE', { events: new Set(['HTTPRECEIVED']), get: ctx => new StringToken(ctx.httpContentType) }],
	['FILENAME', { events: new Set(['HTTPRECEIVED']), get: ctx => new StringToken(ctx.httpFilename) }],
	['ERRORMSG', { events: new Set(['HTTPERROR']), get: ctx => new StringToken(ctx.httpErrorMsg) }],
	['BYTESSENT', { events: new Set(['HTTPSENDPROGRESS']), get: ctx => new IntegerToken(ctx.httpBytesSent) }],
	['BYTESLEFT', { events: new Set(['HTTPSENDPROGRESS']), get: ctx => new IntegerToken(ctx.httpBytesLeft) }],
	['BYTESRECEIVED', { events: new Set(['HTTPRECEIVEPROGRESS']), get: ctx => new IntegerToken(ctx.httpBytesReceived) }],
	['TOTALBYTES', { events: new Set(['HTTPRECEIVEPROGRESS']), get: ctx => new IntegerToken(ctx.httpTotalBytes) }],
	['DOCURL', { events: new Set(['WEBDOCBEGIN', 'WEBDOCDONE']), get: ctx => new StringToken(ctx.docUrl) }],
	['NEWSTATUS', { events: new Set(['WEBSTATUS']), get: ctx => new StringToken(ctx.newStatus) }],
	['NEWTITLE', { events: new Set(['WEBTITLE']), get: ctx => new StringToken(ctx.newTitle) }],
]);

export class PalaceExecutionContext extends IptExecutionContext {
	hotspotId = 0;
	eventName = '';
	whoChatId = 0;
	whoTargetId = 0;
	chatStr = '';
	whoChangeId = 0;
	lastName = '';
	whoMoveId = 0;
	whoEnterId = 0;
	whoLeaveId = 0;
	whatPropId = 0;
	whatIndex = 0;
	wherePropX = 0;
	wherePropY = 0;
	lastState = 0;
	mouseX = 0;
	mouseY = 0;
	isRightClick = false;

	// HTTP event variables
	httpContents = '';
	httpHeaders: HashToken = new HashToken();
	httpContentType = '';
	httpFilename = '';
	httpErrorMsg = '';
	httpUrl = '';
	httpBytesSent = 0;
	httpBytesLeft = 0;
	httpBytesReceived = 0;
	httpTotalBytes = 0;

	// Web embed event variables
	docUrl = '';
	newStatus = '';
	newTitle = '';

	constructor(manager: IptManager) {
		super(manager);
	}

	override isExternalVariable(name: string): boolean {
		const entry = EVENT_VARS.get(name);
		return entry !== undefined && entry.events.has(this.eventName);
	}

	override getExternalVariable(name: string): IptToken {
		return EVENT_VARS.get(name)!.get(this);
	}

	override setExternalVariable(name: string, value: IptToken): void {
		if (name === 'CHATSTR') {
			if (value instanceof StringToken) {
				this.chatStr = value.data;
			} else {
				throw new IptError("Invalid data type for 'CHATSTR': expected StringToken");
			}
		} else if (name === 'CONTENTS') {
			if (value instanceof StringToken) {
				this.httpContents = value.data;
			} else {
				throw new IptError("Invalid data type for 'CONTENTS': expected StringToken");
			}
		} else if (name === 'FILENAME') {
			if (value instanceof StringToken) {
				this.httpFilename = value.data;
			} else {
				throw new IptError("Invalid data type for 'FILENAME': expected StringToken");
			}
		}
	}

	override clone(): PalaceExecutionContext {
		const ctx = new PalaceExecutionContext(this.manager);
		this.copyFieldsTo(ctx);
		return ctx;
	}

	override cloneSharedScope(): PalaceExecutionContext {
		const ctx = new PalaceExecutionContext(this.manager);
		ctx.variableStore = this.variableStore;
		this.copyFieldsTo(ctx);
		return ctx;
	}

	private copyFieldsTo(ctx: PalaceExecutionContext): void {
		ctx.hotspotId = this.hotspotId;
		ctx.eventName = this.eventName;
		ctx.whoChatId = this.whoChatId;
		ctx.whoTargetId = this.whoTargetId;
		ctx.chatStr = this.chatStr;
		ctx.whoChangeId = this.whoChangeId;
		ctx.lastName = this.lastName;
		ctx.whoMoveId = this.whoMoveId;
		ctx.whoEnterId = this.whoEnterId;
		ctx.whoLeaveId = this.whoLeaveId;
		ctx.whatPropId = this.whatPropId;
		ctx.whatIndex = this.whatIndex;
		ctx.wherePropX = this.wherePropX;
		ctx.wherePropY = this.wherePropY;
		ctx.lastState = this.lastState;
		ctx.mouseX = this.mouseX;
		ctx.mouseY = this.mouseY;
		ctx.isRightClick = this.isRightClick;
		ctx.httpContents = this.httpContents;
		ctx.httpHeaders = this.httpHeaders;
		ctx.httpContentType = this.httpContentType;
		ctx.httpFilename = this.httpFilename;
		ctx.httpErrorMsg = this.httpErrorMsg;
		ctx.httpUrl = this.httpUrl;
		ctx.httpBytesSent = this.httpBytesSent;
		ctx.httpBytesLeft = this.httpBytesLeft;
		ctx.httpBytesReceived = this.httpBytesReceived;
		ctx.httpTotalBytes = this.httpTotalBytes;
		ctx.docUrl = this.docUrl;
		ctx.newStatus = this.newStatus;
		ctx.newTitle = this.newTitle;
	}
}
