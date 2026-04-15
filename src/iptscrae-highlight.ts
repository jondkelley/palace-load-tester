/**
 * Iptscrae syntax highlighting — shared between the script editor and the reference page.
 *
 * This module is intentionally free of app-specific imports (client, state, etc.)
 * so it can be loaded in the standalone reference BrowserWindow.
 */
import { COMMAND_NAMES } from './iptscrae/commandNames.js';

// ─── Language constants ───

export const EVENT_NAMES = new Set([
'ALARM', 'COLORCHANGE', 'ENTER', 'FACECHANGE', 'FRAMECHANGE',
'HTTPERROR', 'HTTPRECEIVED', 'HTTPRECEIVEPROGRESS', 'HTTPSENDPROGRESS',
'IDLE', 'INCHAT', 'KEYDOWN', 'KEYUP',
'LEAVE', 'LOOSEPROPADDED', 'LOOSEPROPDELETED', 'LOOSEPROPMOVED',
'MOUSEDOWN', 'MOUSEDRAG', 'MOUSEMOVE', 'MOUSEUP',
'NAMECHANGE', 'OUTCHAT',
'ROOMLOAD', 'ROOMREADY', 'ROLLOUT', 'ROLLOVER', 'SELECT',
'SERVERMSG', 'SIGNON', 'SIGNOFF', 'STATECHANGE',
'USERENTER', 'USERLEAVE', 'USERMOVE',
'WEBDOCBEGIN', 'WEBDOCDONE', 'WEBSTATUS', 'WEBTITLE'
]);

export const CONTROL_FLOW = new Set([
'IF', 'IFELSE', 'WHILE', 'FOREACH', 'EXEC', 'BREAK', 'RETURN', 'EXIT',
'ON', 'AND', 'OR', 'NOT', 'GLOBAL', 'DEF'
]);

export const VAR_EVENTS = new Map<string, Set<string>>([
['CHATSTR', new Set(['OUTCHAT', 'INCHAT', 'SERVERMSG'])],
['WHOCHANGE', new Set(['COLORCHANGE', 'NAMECHANGE', 'FACECHANGE'])],
['LASTNAME', new Set(['NAMECHANGE'])],
['WHOMOVE', new Set(['USERMOVE'])],
['WHOENTER', new Set(['USERENTER'])],
['WHOLEAVE', new Set(['USERLEAVE'])],
['WHATPROP', new Set(['LOOSEPROPADDED', 'LOOSEPROPMOVED', 'LOOSEPROPDELETED'])],
['WHATINDEX', new Set(['LOOSEPROPMOVED', 'LOOSEPROPDELETED'])],
['LASTSTATE', new Set(['STATECHANGE'])],
['CONTENTS', new Set(['HTTPRECEIVED'])],
['HEADERS', new Set(['HTTPRECEIVED'])],
['TYPE', new Set(['HTTPRECEIVED'])],
['FILENAME', new Set(['HTTPRECEIVED'])],
['ERRORMSG', new Set(['HTTPERROR'])],
['DOCURL', new Set(['WEBDOCBEGIN', 'WEBDOCDONE'])],
['NEWSTATUS', new Set(['WEBSTATUS'])],
['NEWTITLE', new Set(['WEBTITLE'])],
]);

// Inverse map: event name → special variable names available in that event
export const EVENT_TO_VARS = new Map<string, string[]>();
for (const [varName, events] of VAR_EVENTS) {
	for (const ev of events) {
		let arr = EVENT_TO_VARS.get(ev);
		if (!arr) { arr = []; EVENT_TO_VARS.set(ev, arr); }
		arr.push(varName);
	}
}

// ─── Tokenizer ───

export const enum TokType { Whitespace, Comment, String, Number, Command, ControlFlow, EventName, Variable, ExternalVar, Operator, Bracket, Unknown }

export interface HlToken { type: TokType; text: string; }

/**
 * Optional command lookup — set this to the parser's getCommand when the full
 * engine is available. When null, unknown identifiers are left as Variable.
 */
let commandLookup: ((name: string) => unknown) | null = null;

export function setCommandLookup(fn: (name: string) => unknown): void {
	commandLookup = fn;
}

export function tokenizeForHighlight(script: string): HlToken[] {
	const tokens: HlToken[] = [];
	let i = 0;
	const len = script.length;
	while (i < len) {
		const cc = script.charCodeAt(i);
		if (cc === 32 || cc === 9 || cc === 13 || cc === 10) {
			const start = i;
			while (i < len) { const c = script.charCodeAt(i); if (c !== 32 && c !== 9 && c !== 13 && c !== 10) break; i++; }
			tokens.push({ type: TokType.Whitespace, text: script.substring(start, i) });
		} else if (cc === 35 || cc === 59) {
			const start = i; i++;
			while (i < len) { const c = script.charCodeAt(i); if (c === 13 || c === 10) break; i++; }
			tokens.push({ type: TokType.Comment, text: script.substring(start, i) });
		} else if (cc === 34) {
			const start = i; i++;
			while (i < len) { const c = script.charCodeAt(i); if (c === 92) { i += 2; continue; } if (c === 34) { i++; break; } i++; }
			tokens.push({ type: TokType.String, text: script.substring(start, i) });
		} else if (cc === 123 || cc === 125 || cc === 91 || cc === 93) {
			tokens.push({ type: TokType.Bracket, text: script.charAt(i) }); i++;
		} else if ((cc >= 48 && cc <= 57) || (cc === 45 && i + 1 < len && script.charCodeAt(i + 1) >= 48 && script.charCodeAt(i + 1) <= 57)) {
			const start = i; if (cc === 45) i++;
			while (i < len && script.charCodeAt(i) >= 48 && script.charCodeAt(i) <= 57) i++;
			tokens.push({ type: TokType.Number, text: script.substring(start, i) });
		} else if ((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || cc === 95) {
			const start = i;
			while (i < len) { const c = script.charCodeAt(i); if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) break; i++; }
			const word = script.substring(start, i);
			const upper = word.toUpperCase();
			if (CONTROL_FLOW.has(upper)) {
				if (upper === 'ON' && word !== 'ON') tokens.push({ type: TokType.Variable, text: word });
				else tokens.push({ type: TokType.ControlFlow, text: word });
			}
			else if (EVENT_NAMES.has(upper)) {
				if (word === upper) tokens.push({ type: TokType.EventName, text: word });
				else tokens.push({ type: TokType.Variable, text: word });
			}
			else if (VAR_EVENTS.has(upper)) tokens.push({ type: TokType.ExternalVar, text: word });
			else if (commandLookup ? commandLookup(upper) : COMMAND_NAMES.has(upper)) tokens.push({ type: TokType.Command, text: word });
			else tokens.push({ type: TokType.Variable, text: word });
		} else {
			const start = i; i++;
			while (i < len) {
				const c = script.charCodeAt(i);
				if (c === 32 || c === 9 || c === 13 || c === 10 || c === 34 || c === 123 || c === 125 || c === 91 || c === 93 || c === 35 || c === 59 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) break;
				i++;
			}
			tokens.push({ type: TokType.Operator, text: script.substring(start, i) });
		}
	}
	return tokens;
}

// ─── Rendering ───

export function escapeHtml(text: string): string {
	if (text.indexOf('&') === -1 && text.indexOf('<') === -1 && text.indexOf('>') === -1) return text;
	let result = '';
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		if (ch === 38) result += '&amp;';
		else if (ch === 60) result += '&lt;';
		else if (ch === 62) result += '&gt;';
		else result += text.charAt(i);
	}
	return result;
}

export const TOKEN_CLASS: Record<TokType, string> = {
	[TokType.Whitespace]: '', [TokType.Comment]: 'ipt-comment', [TokType.String]: 'ipt-string',
	[TokType.Number]: 'ipt-number', [TokType.Command]: 'ipt-command', [TokType.ControlFlow]: 'ipt-control',
	[TokType.EventName]: 'ipt-event', [TokType.Variable]: 'ipt-variable', [TokType.ExternalVar]: 'ipt-extvar',
	[TokType.Operator]: 'ipt-operator', [TokType.Bracket]: 'ipt-bracket', [TokType.Unknown]: '',
};

/** Recolor ON keywords and scope external vars to their event handler blocks. */
export function scopeTokens(tokens: HlToken[]): void {
	for (let t = 0; t < tokens.length; t++) {
		if (tokens[t].type === TokType.ControlFlow && tokens[t].text.toUpperCase() === 'ON') {
			let next = t + 1;
			while (next < tokens.length && tokens[next].type === TokType.Whitespace) next++;
			if (next < tokens.length && tokens[next].type === TokType.EventName) tokens[t].type = TokType.EventName;
		}
	}
	const eventStack: { event: string; depth: number }[] = [];
	let braceDepth = 0;
	let sawOn = false;
	let sawEvent = false;
	let pendingEvent = '';
	for (let t = 0; t < tokens.length; t++) {
		const tok = tokens[t];
		if (tok.type === TokType.Whitespace) continue;
		if (tok.type === TokType.Bracket) {
			if (tok.text === '{') {
				if (sawEvent) eventStack.push({ event: pendingEvent, depth: braceDepth });
				braceDepth++;
			} else if (tok.text === '}') {
				braceDepth--;
				if (eventStack.length > 0 && eventStack[eventStack.length - 1].depth === braceDepth) eventStack.pop();
			}
			sawOn = false; sawEvent = false;
		} else if (tok.type === TokType.EventName && tok.text.toUpperCase() === 'ON') {
			sawOn = true; sawEvent = false;
		} else if (sawOn && tok.type === TokType.EventName) {
			pendingEvent = tok.text.toUpperCase();
			sawOn = false; sawEvent = true;
		} else {
			sawOn = false; sawEvent = false;
		}
		if (tok.type === TokType.ExternalVar) {
			const varEvents = VAR_EVENTS.get(tok.text.toUpperCase());
			const curEvent = eventStack.length > 0 ? eventStack[eventStack.length - 1].event : null;
			if (varEvents && (!curEvent || !varEvents.has(curEvent))) tok.type = TokType.Variable;
		}
	}
}

export function highlightCode(script: string, bracketMatchPositions?: Set<number>): string {
	const tokens = tokenizeForHighlight(script);
	scopeTokens(tokens);
	return highlightTokens(tokens, bracketMatchPositions);
}

export function highlightTokens(tokens: HlToken[], bracketMatchPositions?: Set<number>): string {
	let html = '';
	let offset = 0;
	for (const tok of tokens) {
		const cls = TOKEN_CLASS[tok.type];
		const escaped = escapeHtml(tok.text);
		if (tok.type === TokType.Bracket && bracketMatchPositions?.has(offset)) {
			html += `<span class="${cls} ipt-bracket-match">${escaped}</span>`;
		} else if (cls) {
			html += `<span class="${cls}">${escaped}</span>`;
		} else {
			html += escaped;
		}
		offset += tok.text.length;
	}
	return html;
}
