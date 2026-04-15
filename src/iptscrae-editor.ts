import { IptEngine } from './client.js';
import { logmsg as _logmsg, logerror as _logerror } from './interface.js';
import { showConfirmDialog } from './utility.js';

import { CyborgEngine } from './iptscrae/cyborgEngine.js';
import { palace } from './state.js';
import {
EVENT_NAMES, CONTROL_FLOW, VAR_EVENTS, EVENT_TO_VARS,
TokType, tokenizeForHighlight, scopeTokens,
escapeHtml, TOKEN_CLASS, highlightCode, highlightTokens, setCommandLookup,
type HlToken,
} from './iptscrae-highlight.js';

// logmsg may not be available during module initialization due to circular imports
function logmsg(msg: string): void {
try { _logmsg(msg); } catch { /* startup - interface not ready yet */ }
}


const DEFAULT_CYBORG_SCRIPT = `ON USERENTER {

afktime GLOBAL
{ afkmsg GLOBAL
datetime afktime - sec =
sec 60/ min =
min 60/ hour = 
min hour 60* - min =
sec min 60* - sec =
";I've been gone for "
{ hour itoa & {" hour "}{" hours "} hour 1 == IFELSE & } hour 0 == not if
{ min itoa & {" minute "}{" minutes "} min 1 == IFELSE & } min 0 == not if
{ sec itoa & {" second"}{" seconds"} sec 1 == IFELSE & } hour 0 > sec 0 == or not if
WHOENTER PRIVATEMSG
"^" afkmsg & WHOENTER PRIVATEMSG
} WHOENTER WHOME <> afktime 0 > AND  IF
{ afkoff GLOBAL afkoff EXEC } WHOENTER WHOME == IF

}

ON IDLE {

afktime GLOBAL
{"Away mode activated." STATUSMSG
afkoff GLOBAL afkmsg GLOBAL
DATETIME 600 - afktime =
"idle" afkmsg =
{afktime GLOBAL { afkmsg GLOBAL 0 afktime = 0 afkmsg = "Away mode deactivated." STATUSMSG} afktime 0 > IF} afkoff DEF
"^!" afkmsg & SAY} afktime NOT IF

}

ON USERMOVE {

afktime GLOBAL
{afkoff GLOBAL afkoff EXEC} WHOME WHOMOVE == afktime 0 != AND IF

}

ON OUTCHAT {

afktime GLOBAL afkmsg GLOBAL
{  "$1" GREPSUB afkmsg = DATETIME afktime = "Away mode activated." STATUSMSG
afkoff GLOBAL {afktime GLOBAL { afkmsg GLOBAL 0 afktime = 0 afkmsg = "Away mode deactivated." STATUSMSG} afktime 0 > IF} afkoff DEF }
{ afkoff GLOBAL afkoff EXEC } CHATSTR "^\\\\^(.*)$" GREPSTR IFELSE

}`;

// Wire up the command lookup once the engine is available
setCommandLookup((name: string) => IptEngine.parser.getCommand(name));

// ─── Reusable script editor widget ───

/** Attach a custom resize handle to a panel (replaces CSS resize:both which breaks over webviews). */
function attachResizeHandle(panel: HTMLElement): void {
const handle = document.createElement('div');
handle.className = 'ipe-resize-handle';
panel.appendChild(handle);
let startX = 0, startY = 0, startW = 0, startH = 0;
let overlay: HTMLDivElement | null = null;
handle.addEventListener('mousedown', (e: MouseEvent) => {
e.preventDefault();
e.stopPropagation();
const rect = panel.getBoundingClientRect();
startX = e.clientX; startY = e.clientY;
startW = rect.width; startH = rect.height;
overlay = document.createElement('div');
overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:nwse-resize;';
document.body.appendChild(overlay);
const onMove = (ev: MouseEvent) => {
panel.style.width = `${startW + ev.clientX - startX}px`;
panel.style.height = `${startH + ev.clientY - startY}px`;
};
const onUp = () => {
overlay?.remove(); overlay = null;
window.removeEventListener('mousemove', onMove);
window.removeEventListener('mouseup', onUp);
};
window.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);
});
}

export class ScriptEditorWidget {
readonly element: HTMLDivElement;
readonly textarea: HTMLTextAreaElement;
private highlightLayer: HTMLPreElement;
private lineNumbers: HTMLDivElement;
private searchBar: HTMLDivElement;
private searchInput: HTMLInputElement;
private searchCountEl: HTMLSpanElement;
private searchMatches: { start: number; end: number }[] = [];
private searchIndex = -1;
private eventDropdown: HTMLDivElement | null = null;
private excludeEvents: Set<string>;
  private varTray: HTMLDivElement;
  private varTrayEvent: string | null = null;
  private eventBtn: HTMLButtonElement;
  private helpBtn: HTMLButtonElement;
  private acPopup: HTMLDivElement | null = null;
  private acItems: string[] = [];
  private acIndex = -1;
  private acPrefix = '';
  private acWordStart = 0;
  private allKeywords: string[] | null = null;
  private lastLineCount = -1;
  private highlightRafId = 0;
  private saveBtn: HTMLButtonElement | null = null;
  private savedValue = '';
onSave: ((script: string) => void) | null = null;
onClose: (() => void) | null = null;

constructor(opts: { title: string; titleAccent?: string; placeholder?: string; showSave?: boolean; excludeEvents?: Set<string> }) {
const root = document.createElement('div');
root.style.display = 'contents';

// Toolbar
const toolbar = document.createElement('div');
toolbar.className = 'ipe-toolbar';
const title = document.createElement('span');
title.className = 'ipe-title';
if (opts.titleAccent) {
title.textContent = opts.title;
const accent = document.createElement('span');
accent.className = 'ipe-accent';
accent.textContent = opts.titleAccent;
title.appendChild(accent);
} else {
title.textContent = opts.title;
}
toolbar.appendChild(title);

// Variable tray (shows available special vars for the focused event) — lives in the toolbar
this.varTray = document.createElement('div');
this.varTray.className = 'ipe-var-tray';
toolbar.appendChild(this.varTray);

this.eventBtn = document.createElement('button');
this.eventBtn.className = 'ipe-event-btn';
this.eventBtn.title = 'Insert/Go to Event Handler';
this.eventBtn.innerHTML = 'ON &#9662;';
this.eventBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleEventDropdown(this.eventBtn); });
toolbar.appendChild(this.eventBtn);

const findBtn = document.createElement('button');
findBtn.title = 'Find (Ctrl+F)';
findBtn.innerHTML = '&#128269;';
findBtn.addEventListener('click', () => this.toggleSearch());
toolbar.appendChild(findBtn);

this.helpBtn = document.createElement('button');
this.helpBtn.className = 'ipe-help-btn';
this.helpBtn.title = 'Iptscrae Reference';
this.helpBtn.textContent = '?';
this.helpBtn.addEventListener('click', () => this.openReference());
toolbar.appendChild(this.helpBtn);

if (opts.showSave !== false) {
this.saveBtn = document.createElement('button');
this.saveBtn.className = 'ipe-save';
this.saveBtn.title = 'Save (Ctrl+S)';
this.saveBtn.innerHTML = '&#9889; SAVE';
this.saveBtn.disabled = true;
this.saveBtn.addEventListener('click', () => this.save());
toolbar.appendChild(this.saveBtn);
}

root.appendChild(toolbar);

// Search bar
this.searchBar = document.createElement('div');
this.searchBar.className = 'ipe-search';
this.searchInput = document.createElement('input');
this.searchInput.type = 'text';
this.searchInput.placeholder = 'Find...';
this.searchInput.spellcheck = false;
this.searchInput.autocomplete = 'off';
this.searchInput.addEventListener('input', () => this.doSearch());
this.searchInput.addEventListener('keydown', (e) => {
e.stopPropagation();
if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? this.searchPrev() : this.searchNext(); }
if (e.key === 'Escape') { e.preventDefault(); this.closeSearch(); }
});
this.searchBar.appendChild(this.searchInput);

this.searchCountEl = document.createElement('span');
this.searchCountEl.className = 'ipe-search-count';
this.searchBar.appendChild(this.searchCountEl);

const prevBtn = document.createElement('button');
prevBtn.title = 'Previous (Shift+Enter)';
prevBtn.innerHTML = '&#9650;';
prevBtn.addEventListener('click', () => this.searchPrev());
this.searchBar.appendChild(prevBtn);

const nextBtn = document.createElement('button');
nextBtn.title = 'Next (Enter)';
nextBtn.innerHTML = '&#9660;';
nextBtn.addEventListener('click', () => this.searchNext());
this.searchBar.appendChild(nextBtn);

const closeBtn = document.createElement('button');
closeBtn.className = 'ipe-search-close';
closeBtn.title = 'Close (Escape)';
closeBtn.innerHTML = '&times;';
closeBtn.addEventListener('click', () => this.closeSearch());
this.searchBar.appendChild(closeBtn);

root.appendChild(this.searchBar);



// Body
const body = document.createElement('div');
body.className = 'ipe-body';

this.lineNumbers = document.createElement('div');
this.lineNumbers.className = 'ipe-lines';
body.appendChild(this.lineNumbers);

const code = document.createElement('div');
code.className = 'ipe-code';

this.highlightLayer = document.createElement('pre');
this.highlightLayer.className = 'ipe-highlight';
this.highlightLayer.setAttribute('aria-hidden', 'true');
code.appendChild(this.highlightLayer);

this.textarea = document.createElement('textarea');
this.textarea.className = 'ipe-textarea';
this.textarea.spellcheck = false;
this.textarea.autocomplete = 'off';
this.textarea.setAttribute('autocorrect', 'off');
this.textarea.setAttribute('autocapitalize', 'off');
if (opts.placeholder) this.textarea.placeholder = opts.placeholder;
this.textarea.addEventListener('input', () => { this.scheduleHighlight(); this.triggerAutocomplete(); this.updateSaveState(); });
this.textarea.addEventListener('scroll', () => { this.syncScroll(); this.dismissAutocomplete(); });
this.textarea.addEventListener('keydown', (e) => this.handleKey(e));
this.textarea.addEventListener('click', () => { this.scheduleHighlight(); this.dismissAutocomplete(); });
this.textarea.addEventListener('keyup', (e) => { if (!this.acPopup && (e.key === 'Backspace' || e.key === 'Delete')) this.triggerAutocomplete(); });
this.textarea.addEventListener('dblclick', () => this.handleDoubleClick());
this.textarea.addEventListener('blur', () => { setTimeout(() => this.dismissAutocomplete(), 150); });
this.textarea.addEventListener('contextmenu', (e) => this.showContextMenu(e));
document.addEventListener('selectionchange', () => { if (document.activeElement === this.textarea) this.scheduleHighlight(); });
code.appendChild(this.textarea);

body.appendChild(code);
root.appendChild(body);

this.element = root as unknown as HTMLDivElement;
this.excludeEvents = opts.excludeEvents || new Set();
}

get value(): string { return this.textarea.value; }
set value(v: string) { this.textarea.value = v; this.savedValue = v; this.updateHighlight(); this.textarea.scrollTop = 0; this.syncScroll(); }

focus(): void { this.textarea.focus(); }

private scheduleHighlight(): void {
if (this.highlightRafId) return;
this.highlightRafId = requestAnimationFrame(() => { this.highlightRafId = 0; this.updateHighlight(); });
}

updateHighlight(): void {
const code = this.textarea.value;
const tokens = tokenizeForHighlight(code);
scopeTokens(tokens);
const bracketMatches = this.computeBracketMatches(tokens);
const wordOccurrences = this.getWordOccurrences(code);
let html: string;
if (this.searchMatches.length > 0) {
html = this.injectSearchHighlights(code, tokens, bracketMatches);
} else if (wordOccurrences.length > 0) {
html = this.injectWordHighlights(code, tokens, bracketMatches, wordOccurrences);
} else {
html = highlightTokens(tokens, bracketMatches);
}
this.highlightLayer.innerHTML = html + '\n';
this.updateLineNumbers(code);
this.syncScroll();
this.updateVarTray(tokens);
this.updateHelpGlow();
}

private save(): void {
if (this.onSave) this.onSave(this.textarea.value);
this.savedValue = this.textarea.value;
this.updateSaveState();
}

private updateSaveState(): void {
if (this.saveBtn) this.saveBtn.disabled = this.textarea.value === this.savedValue;
}

/** Toggle glow on the ? button when the selection is a referenceable keyword. */
private updateHelpGlow(): void {
const word = this.getWordAtCursor();
this.helpBtn.classList.toggle('ipe-help-glow', word.length > 0 && this.isReferenceable(word));
}

/** Open the Iptscrae reference window, scrolling to the selected keyword if valid. */
private openReference(): void {
const word = this.getWordAtCursor();
let hash = '';
if (word && this.isReferenceable(word)) {
const isEvent = EVENT_NAMES.has(word);
if (isEvent && (word === 'SELECT' || word === 'WEBTITLE')) hash = 'ON_' + word;
else hash = word;
}
window.apiBridge.openIptReference(hash);
}

private computeBracketMatches(tokens: HlToken[]): Set<number> | undefined {
const cursorPos = this.textarea.selectionStart;
const selEnd = this.textarea.selectionEnd;
if (selEnd - cursorPos > 1) return undefined;
const brackets: { pos: number; char: string }[] = [];
let offset = 0;
for (const tok of tokens) {
if (tok.type === TokType.Bracket) brackets.push({ pos: offset, char: tok.text });
offset += tok.text.length;
}
let bracketIdx = -1;
for (let i = 0; i < brackets.length; i++) {
if (brackets[i].pos === cursorPos) { bracketIdx = i; break; }
if (brackets[i].pos === cursorPos - 1) { bracketIdx = i; }
}
if (bracketIdx === -1) return undefined;
const bracket = brackets[bracketIdx];
const openChars: Record<string, string> = { '{': '}', '[': ']' };
const closeChars: Record<string, string> = { '}': '{', ']': '[' };
let depth = 0;
if (bracket.char in openChars) {
const matchChar = openChars[bracket.char];
for (let i = bracketIdx; i < brackets.length; i++) {
if (brackets[i].char === bracket.char) depth++; else if (brackets[i].char === matchChar) depth--;
if (depth === 0) return new Set([bracket.pos, brackets[i].pos]);
}
} else if (bracket.char in closeChars) {
const matchChar = closeChars[bracket.char];
for (let i = bracketIdx; i >= 0; i--) {
if (brackets[i].char === bracket.char) depth++; else if (brackets[i].char === matchChar) depth--;
if (depth === 0) return new Set([bracket.pos, brackets[i].pos]);
}
}
return undefined;
}

private injectSearchHighlights(code: string, tokens: HlToken[], bracketMatchPositions?: Set<number>): string {
const parts: { offset: number; text: string; cls: string }[] = [];
let off = 0;
for (const tok of tokens) { parts.push({ offset: off, text: tok.text, cls: TOKEN_CLASS[tok.type] }); off += tok.text.length; }
const boundaries = new Set<number>();
for (const m of this.searchMatches) { boundaries.add(m.start); boundaries.add(m.end); }
const splitParts: { offset: number; text: string; cls: string }[] = [];
for (const p of parts) {
let cursor = p.offset;
const end = p.offset + p.text.length;
for (const b of Array.from(boundaries).sort((a, c) => a - c)) {
if (b > cursor && b < end) { splitParts.push({ offset: cursor, text: code.substring(cursor, b), cls: p.cls }); cursor = b; }
}
splitParts.push({ offset: cursor, text: code.substring(cursor, end), cls: p.cls });
}
const matchSet = new Map<number, boolean>();
for (let mi = 0; mi < this.searchMatches.length; mi++) {
const m = this.searchMatches[mi]; const isCurrent = mi === this.searchIndex;
for (let c = m.start; c < m.end; c++) matchSet.set(c, isCurrent);
}
let html = '';
for (const sp of splitParts) {
const escaped = escapeHtml(sp.text);
const inMatch = matchSet.has(sp.offset);
const isBracketMatch = bracketMatchPositions?.has(sp.offset) && sp.cls === 'ipt-bracket';
const effectiveCls = isBracketMatch ? sp.cls + ' ipt-bracket-match' : sp.cls;
if (inMatch) {
const isCurrent = matchSet.get(sp.offset);
const mCls = isCurrent ? 'ipt-search-current' : 'ipt-search-match';
html += `<span class="${mCls}">${effectiveCls ? `<span class="${effectiveCls}">${escaped}</span>` : escaped}</span>`;
} else if (effectiveCls) {
html += `<span class="${effectiveCls}">${escaped}</span>`;
} else {
html += escaped;
}
}
return html;
}

private handleDoubleClick(): void {
const sel = this.textarea.value.substring(this.textarea.selectionStart, this.textarea.selectionEnd);
// Trim trailing whitespace from double-click selection
const trimmed = sel.replace(/\s+$/, '');
if (trimmed.length === 0) {
this.textarea.selectionEnd = this.textarea.selectionStart;
} else if (trimmed.length < sel.length) {
this.textarea.selectionEnd = this.textarea.selectionStart + trimmed.length;
}
this.updateHighlight();
}

/** Get positions of all other occurrences of the currently selected word. */
private getWordOccurrences(code: string): { start: number; end: number }[] {
const start = this.textarea.selectionStart;
const end = this.textarea.selectionEnd;
if (start === end) return [];
const selected = code.substring(start, end);
// Only match whole words (letters/digits/underscore)
if (!/^[A-Za-z0-9_]+$/.test(selected)) return [];
const results: { start: number; end: number }[] = [];
const upper = selected.toUpperCase();
const wordRe = /[A-Za-z0-9_]+/g;
let m: RegExpExecArray | null;
while ((m = wordRe.exec(code)) !== null) {
if (m[0].toUpperCase() === upper && m.index !== start) {
results.push({ start: m.index, end: m.index + m[0].length });
}
}
return results;
}

private injectWordHighlights(code: string, tokens: HlToken[], bracketMatchPositions: Set<number> | undefined, wordOccurrences: { start: number; end: number }[]): string {
const parts: { offset: number; text: string; cls: string }[] = [];
let off = 0;
for (const tok of tokens) { parts.push({ offset: off, text: tok.text, cls: TOKEN_CLASS[tok.type] }); off += tok.text.length; }
// Collect split boundaries from word occurrences
const boundaries = new Set<number>();
for (const m of wordOccurrences) { boundaries.add(m.start); boundaries.add(m.end); }
const splitParts: { offset: number; text: string; cls: string }[] = [];
for (const p of parts) {
let cursor = p.offset;
const end = p.offset + p.text.length;
for (const b of Array.from(boundaries).sort((a, c) => a - c)) {
if (b > cursor && b < end) { splitParts.push({ offset: cursor, text: code.substring(cursor, b), cls: p.cls }); cursor = b; }
}
splitParts.push({ offset: cursor, text: code.substring(cursor, end), cls: p.cls });
}
const matchSet = new Set<number>();
for (const m of wordOccurrences) {
for (let c = m.start; c < m.end; c++) matchSet.add(c);
}
let html = '';
for (const sp of splitParts) {
const escaped = escapeHtml(sp.text);
const inMatch = matchSet.has(sp.offset);
const isBracketMatch = bracketMatchPositions?.has(sp.offset) && sp.cls === 'ipt-bracket';
const effectiveCls = isBracketMatch ? sp.cls + ' ipt-bracket-match' : sp.cls;
if (inMatch) {
html += `<span class="ipt-word-match">${effectiveCls ? `<span class="${effectiveCls}">${escaped}</span>` : escaped}</span>`;
} else if (effectiveCls) {
html += `<span class="${effectiveCls}">${escaped}</span>`;
} else {
html += escaped;
}
}
return html;
}

private updateLineNumbers(code: string): void {
let count = 1;
for (let i = 0; i < code.length; i++) { if (code.charCodeAt(i) === 10) count++; }
if (count === this.lastLineCount) return;
this.lastLineCount = count;
let html = '';
for (let i = 1; i <= count; i++) html += `<span>${i}</span>`;
this.lineNumbers.innerHTML = html;
}

private syncScroll(): void {
this.highlightLayer.scrollTop = this.textarea.scrollTop;
this.highlightLayer.scrollLeft = this.textarea.scrollLeft;
this.lineNumbers.scrollTop = this.textarea.scrollTop;
}

/** Determine which ON EVENT { } block the cursor is inside, if any. */
private detectCursorEvent(tokens?: HlToken[]): string | null {
const code = this.textarea.value;
const cursor = this.textarea.selectionStart;
// Walk through tokens, tracking brace-delimited ON EVENT blocks
if (!tokens) tokens = tokenizeForHighlight(code);
let offset = 0;
let sawOn = false;
let pendingEvent: string | null = null;
const eventStack: { event: string; depth: number }[] = [];
let depth = 0;

for (const tok of tokens) {
const tokEnd = offset + tok.text.length;
if ((tok.type === TokType.ControlFlow || tok.type === TokType.EventName) && tok.text.toUpperCase() === 'ON') {
sawOn = true; pendingEvent = null;
} else if (sawOn && tok.type === TokType.EventName) {
pendingEvent = tok.text.toUpperCase(); sawOn = false;
} else if (sawOn && tok.type !== TokType.Whitespace) {
sawOn = false; pendingEvent = null;
}
if (tok.type === TokType.Bracket) {
if (tok.text === '{') {
depth++;
if (pendingEvent) {
eventStack.push({ event: pendingEvent, depth });
pendingEvent = null;
}
} else if (tok.text === '}') {
if (eventStack.length > 0 && eventStack[eventStack.length - 1].depth === depth) {
eventStack.pop();
}
depth--;
}
}
// If we've passed the cursor, the top of the event stack is our answer
if (tokEnd > cursor) {
return eventStack.length > 0 ? eventStack[eventStack.length - 1].event : null;
}
offset = tokEnd;
}
return eventStack.length > 0 ? eventStack[eventStack.length - 1].event : null;
}

private updateVarTray(tokens: HlToken[]): void {
const event = this.detectCursorEvent(tokens);

// Skip if the event hasn't changed
if (event === this.varTrayEvent) return;
this.varTrayEvent = event;

// Update the ON button text as a breadcrumb
this.eventBtn.innerHTML = event ? `ON <span class="ipe-event-crumb">${event}</span> &#9662;` : 'ON &#9662;';

const vars = event ? EVENT_TO_VARS.get(event) : null;
if (!vars || vars.length === 0) {
this.varTray.classList.remove('ipe-var-tray-visible');
this.varTray.innerHTML = '';
return;
}

// Build chips
this.varTray.innerHTML = '';
const label = document.createElement('span');
label.className = 'ipe-var-label';
label.textContent = '\u25B8'; // ▸
this.varTray.appendChild(label);
for (const v of vars) {
const chip = document.createElement('button');
chip.className = 'ipe-var-chip';
chip.textContent = v;
chip.title = `Insert ${v} at cursor`;
chip.addEventListener('mousedown', (e) => {
e.preventDefault(); // keep textarea focus
const pos = this.textarea.selectionStart;
const end = this.textarea.selectionEnd;
const val = this.textarea.value;
// Add a space before if not at start of line and previous char isn't whitespace
const before = pos > 0 && !/\s/.test(val[pos - 1]) ? ' ' : '';
const after = pos < val.length && !/\s/.test(val[pos]) ? ' ' : '';
const insertion = before + v + after;
this.textarea.value = val.substring(0, pos) + insertion + val.substring(end);
const newPos = pos + insertion.length;
this.textarea.setSelectionRange(newPos, newPos);
this.updateHighlight();
});
this.varTray.appendChild(chip);
}
this.varTray.classList.add('ipe-var-tray-visible');
}

// ─── Autocomplete ───

private getKeywords(): string[] {
if (!this.allKeywords) {
const set = new Set<string>();
for (const e of EVENT_NAMES) set.add(e);
for (const c of CONTROL_FLOW) set.add(c);
for (const v of VAR_EVENTS.keys()) set.add(v);
// Pull command names dynamically from the parser
try {
const names = IptEngine.parser.getCommandNames();
for (const n of names) {
// skip operator symbols and unsupported legacy commands
if (/^[A-Z_]/.test(n) && IptEngine.parser.getCommand(n)?.name !== 'UnsupportedCommand') set.add(n);
}
} catch { /* parser not ready */ }
this.allKeywords = Array.from(set).sort();
}
return this.allKeywords;
}

private triggerAutocomplete(): void {
const pos = this.textarea.selectionStart;
const val = this.textarea.value;

// Find the word being typed (letters/digits/underscore backwards from cursor)
let wordStart = pos;
while (wordStart > 0 && /[A-Za-z0-9_]/.test(val[wordStart - 1])) wordStart--;
const prefix = val.substring(wordStart, pos).toUpperCase();

// Need at least 2 characters to trigger
if (prefix.length < 2) { this.dismissAutocomplete(); return; }

// Check if the previous non-whitespace word is ON (to allow event names)
let scan = wordStart;
while (scan > 0 && /\s/.test(val[scan - 1])) scan--;
let prevWordEnd = scan;
while (scan > 0 && /[A-Za-z0-9_]/.test(val[scan - 1])) scan--;
const prevWord = val.substring(scan, prevWordEnd).toUpperCase();
const afterOn = prevWord === 'ON';

// Filter matching keywords; only include event names when preceded by ON, exclude non-events after ON
const matches = this.getKeywords().filter(k => {
if (!k.startsWith(prefix) || k === prefix) return false;
if (EVENT_NAMES.has(k)) return afterOn;
if (afterOn) return false;
return true;
});
if (matches.length === 0) { this.dismissAutocomplete(); return; }

this.acPrefix = prefix;
this.acWordStart = wordStart;
this.acItems = matches.slice(0, 12); // limit items
this.acIndex = 0;
this.showAutocompletePopup();
}

private showAutocompletePopup(): void {
// Remove old popup DOM without clearing acItems/acIndex
if (this.acPopup) { this.acPopup.remove(); this.acPopup = null; }

const popup = document.createElement('div');
popup.className = 'ipe-ac-popup';

for (let i = 0; i < this.acItems.length; i++) {
const item = document.createElement('div');
item.className = 'ipe-ac-item' + (i === this.acIndex ? ' ipe-ac-active' : '');
const keyword = this.acItems[i];

// Color-code the item type
let typeClass = 'ipt-command';
const upper = keyword.toUpperCase();
if (CONTROL_FLOW.has(upper)) typeClass = 'ipt-control';
else if (EVENT_NAMES.has(upper)) typeClass = 'ipt-event';
else if (VAR_EVENTS.has(upper)) typeClass = 'ipt-extvar';

// Bold the matching prefix part
const prefixLen = this.acPrefix.length;
item.innerHTML = `<span class="${typeClass}"><b>${escapeHtml(keyword.substring(0, prefixLen))}</b>${escapeHtml(keyword.substring(prefixLen))}</span>`;

item.addEventListener('mousedown', (e) => {
e.preventDefault(); // keep textarea focus
this.acceptAutocomplete(i);
});
popup.appendChild(item);
}

// Position the popup relative to the code container
const codeEl = this.textarea.parentElement!;
const coords = this.getCaretCoordinates();
popup.style.left = `${coords.x}px`;
popup.style.top = `${coords.y}px`;

codeEl.appendChild(popup);
this.acPopup = popup;

// Adjust if popup goes below the code area
requestAnimationFrame(() => {
if (!this.acPopup) return;
const codeRect = codeEl.getBoundingClientRect();
const popRect = this.acPopup.getBoundingClientRect();
if (popRect.bottom > codeRect.bottom) {
// Show above the cursor instead
const lineHeight = parseFloat(getComputedStyle(this.textarea).lineHeight) || 19;
this.acPopup.style.top = `${coords.y - popRect.height - lineHeight}px`;
}
if (popRect.right > codeRect.right) {
this.acPopup.style.left = `${codeRect.right - popRect.width - codeRect.left}px`;
}
});
}

private getCaretCoordinates(): { x: number; y: number } {
const lineHeight = parseFloat(getComputedStyle(this.textarea).lineHeight) || 19;
const style = getComputedStyle(this.textarea);
const paddingLeft = parseFloat(style.paddingLeft) || 8;
const paddingTop = parseFloat(style.paddingTop) || 8;

const val = this.textarea.value;
const pos = this.textarea.selectionStart;
const textBefore = val.substring(0, pos);
const lines = textBefore.split('\n');
const lineIndex = lines.length - 1;
const colText = lines[lineIndex];

// Measure text width using a temporary canvas
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;
ctx.font = `${style.fontSize} ${style.fontFamily}`;
const textWidth = ctx.measureText(colText).width;

const x = paddingLeft + textWidth - this.textarea.scrollLeft;
const y = paddingTop + (lineIndex + 1) * lineHeight - this.textarea.scrollTop;

return { x, y };
}

private updateAutocompleteSelection(): void {
if (!this.acPopup) return;
const items = this.acPopup.querySelectorAll('.ipe-ac-item');
items.forEach((el, i) => {
el.classList.toggle('ipe-ac-active', i === this.acIndex);
});
// Scroll active item into view
const active = items[this.acIndex] as HTMLElement;
if (active) active.scrollIntoView({ block: 'nearest' });
}

private acceptAutocomplete(index?: number): void {
const idx = index ?? this.acIndex;
if (idx < 0 || idx >= this.acItems.length) { this.dismissAutocomplete(); return; }

const keyword = this.acItems[idx];
const val = this.textarea.value;
const pos = this.textarea.selectionStart;
const before = val.substring(0, this.acWordStart);
const after = val.substring(pos);
this.textarea.value = before + keyword + after;
const newPos = this.acWordStart + keyword.length;
this.dismissAutocomplete();
this.textarea.focus();
this.textarea.setSelectionRange(newPos, newPos);
this.updateHighlight();
}

private dismissAutocomplete(): void {
if (this.acPopup) {
this.acPopup.remove();
this.acPopup = null;
}
this.acItems = [];
this.acIndex = -1;
}

// ─── Context Menu ───

private getWordAtCursor(): string {
const val = this.textarea.value;
const pos = this.textarea.selectionStart;
let start = pos, end = pos;
while (start > 0 && /[A-Za-z0-9_]/.test(val[start - 1])) start--;
while (end < val.length && /[A-Za-z0-9_]/.test(val[end])) end++;
return val.substring(start, end).toUpperCase();
}

private isReferenceable(word: string): boolean {
if (!word) return false;
if (EVENT_NAMES.has(word)) return true;
if (CONTROL_FLOW.has(word)) return true;
if (VAR_EVENTS.has(word)) return true;
try { if (IptEngine.parser.getCommand(word)) return true; } catch { /* */ }
return false;
}

/** Resolve a word to the reference keyword — event vars map to their parent event. */
private resolveReferenceKeyword(word: string): string {
if (VAR_EVENTS.has(word)) {
const events = VAR_EVENTS.get(word)!;
// If cursor is inside an event handler that uses this var, prefer that event
const cursorEvent = this.detectCursorEvent();
if (cursorEvent && events.has(cursorEvent)) return cursorEvent;
// Otherwise use the first associated event
return events.values().next().value!;
}
return word;
}

private async showContextMenu(e: MouseEvent): Promise<void> {
e.preventDefault();
const word = this.getWordAtCursor();
const hasSelection = this.textarea.selectionStart !== this.textarea.selectionEnd;
const canRef = this.isReferenceable(word);

const items: any[] = [
{ id: 0, label: 'Cut', type: 'normal', enabled: hasSelection, accelerator: 'CmdOrCtrl+X' },
{ id: 1, label: 'Copy', type: 'normal', enabled: hasSelection, accelerator: 'CmdOrCtrl+C' },
{ id: 2, label: 'Paste', type: 'normal', enabled: true, accelerator: 'CmdOrCtrl+V' },
{ id: 3, label: 'Select All', type: 'normal', enabled: true, accelerator: 'CmdOrCtrl+A' },
];

if (canRef) {
const refWord = this.resolveReferenceKeyword(word);
items.push({ type: 'separator' });
items.push({ id: 10, label: `Reference: ${refWord}`, type: 'normal', enabled: true });
}

const menuIndex = await (window.apiBridge.openContextMenu as any)({
x: Math.round(e.clientX),
y: Math.round(e.clientY),
items,
});

switch (menuIndex) {
case 0: document.execCommand('cut'); break;
case 1: document.execCommand('copy'); break;
case 2: {
const text = await navigator.clipboard.readText();
document.execCommand('insertText', false, text);
break;
}
case 3: this.textarea.select(); break;
case 10: if (canRef) this.showReferencePopup(this.resolveReferenceKeyword(word), e.clientX, e.clientY); break;
}
}

// ─── Reference Popup ───

private showReferencePopup(keyword: string, x: number, y: number): void {
// Remove any existing popup
document.querySelector('.ipe-ref-popup')?.remove();

// Determine anchor id — events that conflict with commands are prefixed ON_
const isEvent = EVENT_NAMES.has(keyword);
let anchorId = keyword;
if (isEvent && (keyword === 'SELECT' || keyword === 'WEBTITLE')) anchorId = 'ON_' + keyword;

// Fetch the reference HTML doc and extract the card
fetch('docs/iptscrae-reference.html')
.then(r => r.text())
.then(html => {
const parser = new DOMParser();
const doc = parser.parseFromString(html, 'text/html');

// Try event id first for event names, then command id
let card = isEvent ? doc.getElementById(anchorId) : null;
if (!card) card = doc.getElementById(keyword);
if (!card) return;

const popup = document.createElement('div');
popup.className = 'ipe-ref-popup';

// Header bar with title + close
const header = document.createElement('div');
header.className = 'ipe-ref-header';

const title = document.createElement('span');
title.className = 'ipe-ref-title';
const h4 = card.querySelector('h4');
if (h4) {
const h4Clone = h4.cloneNode(true) as HTMLElement;
// Remove badge spans (classic/extended/event)
for (const badge of Array.from(h4Clone.querySelectorAll('.badge'))) badge.remove();
title.textContent = h4Clone.textContent!.trim();
} else {
title.textContent = keyword;
}
header.appendChild(title);

const closeBtn = document.createElement('button');
closeBtn.className = 'ipe-ref-close';
closeBtn.innerHTML = '&times;';
closeBtn.onclick = () => popup.remove();
header.appendChild(closeBtn);

popup.appendChild(header);

// Content — clone children except h4
const content = document.createElement('div');
content.className = 'ipe-ref-content';
for (const child of Array.from(card.children)) {
if (child.tagName === 'H4') continue;
content.appendChild(child.cloneNode(true));
}
// Re-highlight <pre> blocks using the editor's syntax highlighter
for (const pre of Array.from(content.querySelectorAll('pre'))) {
const raw = pre.textContent || '';
pre.innerHTML = highlightCode(raw);
}
popup.appendChild(content);

// Position near the click, but keep on screen
document.body.appendChild(popup);
const rect = popup.getBoundingClientRect();
let left = x + 8;
let top = y + 8;
if (left + rect.width > window.innerWidth - 16) left = window.innerWidth - rect.width - 16;
if (top + rect.height > window.innerHeight - 16) top = window.innerHeight - rect.height - 16;
if (left < 8) left = 8;
if (top < 8) top = 8;
popup.style.left = `${left}px`;
popup.style.top = `${top}px`;

// Make draggable via header
let dragX = 0, dragY = 0, dragging = false;
let dragOverlay: HTMLDivElement | null = null;
header.addEventListener('mousedown', (ev: MouseEvent) => {
if ((ev.target as HTMLElement).tagName === 'BUTTON') return;
dragging = true;
dragX = ev.clientX - popup.getBoundingClientRect().left;
dragY = ev.clientY - popup.getBoundingClientRect().top;
ev.preventDefault();
dragOverlay = document.createElement('div');
dragOverlay.style.cssText = 'position:fixed;inset:0;z-index:11999;cursor:move;';
document.body.appendChild(dragOverlay);
});
const onMove = (ev: MouseEvent) => { if (dragging) { popup.style.left = `${ev.clientX - dragX}px`; popup.style.top = `${ev.clientY - dragY}px`; } };
const onUp = () => { dragging = false; if (dragOverlay && dragOverlay.parentNode) { dragOverlay.remove(); } dragOverlay = null; };
window.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);
window.addEventListener('blur', onUp);

// Clean up listeners when popup is removed
const cleanup = () => {
onUp();
window.removeEventListener('mousemove', onMove);
window.removeEventListener('mouseup', onUp);
window.removeEventListener('blur', onUp);
};
const observer = new MutationObserver(() => {
if (!document.body.contains(popup)) {
cleanup();
observer.disconnect();
}
});
observer.observe(document.body, { childList: true });

// Close on Escape
const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { popup.remove(); document.removeEventListener('keydown', onKey); } };
document.addEventListener('keydown', onKey);
});
}

private handleKey(e: KeyboardEvent): void {
// Autocomplete key handling
if (this.acPopup) {
if (e.key === 'ArrowDown') {
e.preventDefault();
e.stopPropagation();
this.acIndex = (this.acIndex + 1) % this.acItems.length;
this.updateAutocompleteSelection();
return;
}
if (e.key === 'ArrowUp') {
e.preventDefault();
e.stopPropagation();
this.acIndex = (this.acIndex - 1 + this.acItems.length) % this.acItems.length;
this.updateAutocompleteSelection();
return;
}
if (e.key === 'Enter' || e.key === 'Tab') {
e.preventDefault();
e.stopPropagation();
this.acceptAutocomplete();
return;
}
if (e.key === 'Escape') {
e.preventDefault();
e.stopPropagation();
this.dismissAutocomplete();
return;
}
}

if (e.key === 'Tab') {
e.preventDefault();
e.stopPropagation();
const start = this.textarea.selectionStart;
const end = this.textarea.selectionEnd;
const val = this.textarea.value;
this.textarea.value = val.substring(0, start) + '    ' + val.substring(end);
this.textarea.selectionStart = this.textarea.selectionEnd = start + 4;
this.updateHighlight();
}
if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.save(); }
if (e.key === 'f' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); this.toggleSearch(); }
if (e.key === 'Escape') {
if (this.searchBar.style.display === 'flex') this.closeSearch();
else if (this.onClose) this.onClose();
}
}

private toggleSearch(): void {
if (this.searchBar.style.display === 'flex') this.closeSearch(); else this.openSearch();
}

private openSearch(): void {
this.searchBar.style.display = 'flex';
const sel = this.textarea.value.substring(this.textarea.selectionStart, this.textarea.selectionEnd);
if (sel.length > 0 && sel.indexOf('\n') === -1) this.searchInput.value = sel;
this.searchInput.focus();
this.searchInput.select();
this.doSearch();
}

private closeSearch(): void {
this.searchBar.style.display = 'none';
this.searchMatches = [];
this.searchIndex = -1;
this.searchCountEl.textContent = '';
this.updateHighlight();
this.textarea.focus();
}

private doSearch(): void {
const query = this.searchInput.value;
this.searchMatches = [];
this.searchIndex = -1;
if (query.length === 0) { this.searchCountEl.textContent = ''; this.updateHighlight(); return; }
const lq = query.toLowerCase();
const lt = this.textarea.value.toLowerCase();
let pos = 0;
while ((pos = lt.indexOf(lq, pos)) !== -1) { this.searchMatches.push({ start: pos, end: pos + query.length }); pos += 1; }
if (this.searchMatches.length > 0) {
const cursor = this.textarea.selectionStart;
this.searchIndex = 0;
for (let i = 0; i < this.searchMatches.length; i++) { if (this.searchMatches[i].start >= cursor) { this.searchIndex = i; break; } }
this.selectMatch();
} else {
this.searchCountEl.textContent = 'No results';
this.updateHighlight();
}
}

private searchNext(): void {
if (this.searchMatches.length === 0) return;
this.searchIndex = (this.searchIndex + 1) % this.searchMatches.length;
this.selectMatch();
}

private searchPrev(): void {
if (this.searchMatches.length === 0) return;
this.searchIndex = (this.searchIndex - 1 + this.searchMatches.length) % this.searchMatches.length;
this.selectMatch();
}

private selectMatch(): void {
const m = this.searchMatches[this.searchIndex];
this.textarea.setSelectionRange(m.start, m.end);
const linesBefore = this.textarea.value.substring(0, m.start).split('\n').length - 1;
const lineHeight = parseFloat(getComputedStyle(this.textarea).lineHeight) || 19;
const targetScroll = linesBefore * lineHeight - this.textarea.clientHeight / 2;
this.textarea.scrollTop = Math.max(0, targetScroll);
this.syncScroll();
this.searchCountEl.textContent = `${this.searchIndex + 1}/${this.searchMatches.length}`;
this.updateHighlight();
}

// ─── Event handler dropdown ───

private findExistingEvents(): Map<string, number> {
const code = this.textarea.value;
const found = new Map<string, number>();
const re = /\bON\s+(\w+)\s*\{/gi;
let match;
while ((match = re.exec(code)) !== null) {
const name = match[1].toUpperCase();
if (EVENT_NAMES.has(name) && !found.has(name)) {
found.set(name, match.index);
}
}
return found;
}

private toggleEventDropdown(anchor: HTMLElement): void {
if (this.eventDropdown) {
this.closeEventDropdown();
return;
}

const existing = this.findExistingEvents();

const dropdown = document.createElement('div');
dropdown.className = 'ipe-event-dropdown';

const SORTED_EVENTS = Array.from(EVENT_NAMES).filter(e => !this.excludeEvents.has(e)).sort();

for (const eventName of SORTED_EVENTS) {
const exists = existing.has(eventName);
const item = document.createElement('div');
item.className = 'ipe-event-item' + (exists ? ' ipe-event-exists' : '');
item.textContent = eventName;
if (exists) {
const check = document.createElement('span');
check.className = 'ipe-event-check';
check.textContent = '\u2713';
item.prepend(check);
}
item.addEventListener('click', () => {
if (exists) {
this.navigateToEvent(eventName, existing.get(eventName)!);
} else {
this.insertEventHandler(eventName);
}
this.closeEventDropdown();
});
dropdown.appendChild(item);
}

// Position fixed relative to viewport so it works in both panels and dialogs
const rect = anchor.getBoundingClientRect();
dropdown.style.position = 'fixed';
dropdown.style.left = `${rect.left}px`;
dropdown.style.top = `${rect.bottom + 2}px`;

document.body.appendChild(dropdown);
this.eventDropdown = dropdown;

// Adjust if dropdown extends below viewport
requestAnimationFrame(() => {
const dr = dropdown.getBoundingClientRect();
if (dr.bottom > window.innerHeight) {
dropdown.style.top = `${rect.top - dr.height - 2}px`;
}
});

const closeOnClick = (e: MouseEvent) => {
if (!dropdown.contains(e.target as Node) && e.target !== anchor) {
this.closeEventDropdown();
}
};
// Store ref so closeEventDropdown can remove it
(this as any)._eventDropdownClose = closeOnClick;
requestAnimationFrame(() => document.addEventListener('mousedown', closeOnClick, true));
}

private closeEventDropdown(): void {
if (this.eventDropdown) {
this.eventDropdown.remove();
this.eventDropdown = null;
}
if ((this as any)._eventDropdownClose) {
document.removeEventListener('mousedown', (this as any)._eventDropdownClose, true);
(this as any)._eventDropdownClose = null;
}
}

private navigateToEvent(eventName: string, offset: number): void {
const code = this.textarea.value;
// Find the full "ON EVENT" text to highlight
const re = new RegExp('\\bON\\s+' + eventName + '\\b', 'i');
const match = code.substring(offset).match(re);
const end = match ? offset + match[0].length : offset + eventName.length;
this.textarea.focus();
this.textarea.setSelectionRange(offset, end);
const linesBefore = code.substring(0, offset).split('\n').length - 1;
const lineHeight = parseFloat(getComputedStyle(this.textarea).lineHeight) || 19;
const targetScroll = linesBefore * lineHeight - this.textarea.clientHeight / 3;
this.textarea.scrollTop = Math.max(0, targetScroll);
this.syncScroll();
this.updateHighlight();
}

private insertEventHandler(eventName: string): void {
const template = `\nON ${eventName} {\n\n}\n`;
const code = this.textarea.value;
const insertPos = code.length;
this.textarea.focus();
this.textarea.value = code + template;
// Place cursor inside the braces (on the empty line)
const cursorPos = insertPos + `\nON ${eventName} {\n`.length;
this.textarea.setSelectionRange(cursorPos, cursorPos);
const linesBefore = this.textarea.value.substring(0, cursorPos).split('\n').length - 1;
const lineHeight = parseFloat(getComputedStyle(this.textarea).lineHeight) || 19;
const targetScroll = linesBefore * lineHeight - this.textarea.clientHeight / 2;
this.textarea.scrollTop = Math.max(0, targetScroll);
this.syncScroll();
this.updateHighlight();
}
}

// ─── Cyborg Editor (wraps ScriptEditorWidget) ───

export class IptscraEditor {
private panel: HTMLElement;
private widget: ScriptEditorWidget;
private visible = false;
private savedScript = '';

constructor() {
this.panel = document.getElementById('ipteditor')!;
this.widget = new ScriptEditorWidget({
title: 'IPT',
titleAccent: 'SCRAE',
placeholder: '; Type Iptscrae here...\n; Ctrl+S to save\nON INCHAT {\n    CHATSTR LOGMSG\n}',
excludeEvents: new Set([
'SELECT', 'ROLLOVER', 'ROLLOUT', 'STATECHANGE', 'FRAMECHANGE',
'MOUSEDOWN', 'MOUSEDRAG', 'MOUSEMOVE', 'MOUSEUP',
'WEBDOCBEGIN', 'WEBDOCDONE', 'WEBSTATUS', 'WEBTITLE',
'ROOMLOAD', 'ROOMREADY',
]),
});

// Append widget DOM into the panel
this.panel.appendChild(this.widget.element);
attachResizeHandle(this.panel);

this.widget.onSave = (script: string) => {
this.savedScript = this.widget.value;
localStorage.setItem('iptEditorScript', this.widget.value);
loadCyborg(script.trim());
};

this.widget.onClose = () => this.toggle();

// Drag support on the toolbar
const toolbar = this.panel.querySelector('.ipe-toolbar') as HTMLElement;
let dragX = 0, dragY = 0, dragging = false;
let dragOverlay: HTMLDivElement | null = null;
toolbar.addEventListener('mousedown', (e: MouseEvent) => {
if ((e.target as HTMLElement).tagName === 'BUTTON') return;
e.preventDefault();
dragging = true;
const rect = this.panel.getBoundingClientRect();
dragX = e.clientX - rect.left;
dragY = e.clientY - rect.top;
dragOverlay = document.createElement('div');
dragOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:move;';
document.body.appendChild(dragOverlay);
});
window.addEventListener('mousemove', (e: MouseEvent) => {
if (!dragging) return;
this.panel.style.left = `${e.clientX - dragX}px`;
this.panel.style.top = `${e.clientY - dragY}px`;
this.panel.style.marginLeft = '0';
});
window.addEventListener('mouseup', () => { dragging = false; dragOverlay?.remove(); dragOverlay = null; });

// Load saved script
const saved = localStorage.getItem('iptEditorScript');
if (saved !== null) {
this.widget.value = saved;
this.savedScript = saved;
if (saved) loadCyborg(saved);
} else {
this.widget.value = DEFAULT_CYBORG_SCRIPT;
this.savedScript = DEFAULT_CYBORG_SCRIPT;
localStorage.setItem('iptEditorScript', DEFAULT_CYBORG_SCRIPT);
loadCyborg(DEFAULT_CYBORG_SCRIPT);
}
}

toggle(): void {
if (this.visible) {
if (this.widget.value !== this.savedScript) {
showConfirmDialog('Save cyborg script before closing?').then((save) => {
if (save) {
this.savedScript = this.widget.value;
localStorage.setItem('iptEditorScript', this.widget.value);
loadCyborg(this.widget.value.trim());
} else {
this.widget.value = this.savedScript;
}
this.closePanel();
});
return;
}
this.closePanel();
} else {
this.visible = true;
this.panel.dataset.state = '1';
this.panel.style.display = 'flex';
this.widget.focus();
this.widget.updateHighlight();
const savedScroll = parseInt(localStorage.getItem('iptEditorScroll') || '0', 10);
this.widget.textarea.scrollTop = savedScroll;
}
}

private closePanel(): void {
localStorage.setItem('iptEditorScroll', String(this.widget.textarea.scrollTop));
this.visible = false;
this.panel.dataset.state = '0';
this.panel.addEventListener('transitionend', () => {
if (!this.visible) this.panel.style.display = 'none';
}, { once: true });
}
}

// ─── Spot Script Editor (dialog) ───

interface RuntimeSpot {
id: number;
name: string;
script: string;
handlers: Record<string, any>;
}

export function openSpotScriptEditor(spot: RuntimeSpot): void {
const dialog = document.createElement('div');
dialog.className = 'ipe-dialog';

const widget = new ScriptEditorWidget({
title: `Spot ${spot.id}: ${spot.name || '(unnamed)'}`,
placeholder: '; Spot script\nON SELECT {\n    "Hello" SAY\n}',
showSave: false,
});

dialog.appendChild(widget.element);
attachResizeHandle(dialog);

// Drag support on toolbar
const toolbar = dialog.querySelector('.ipe-toolbar') as HTMLElement;
let dragX = 0, dragY = 0, dragging = false;
let dragOverlay: HTMLDivElement | null = null;
toolbar.addEventListener('mousedown', (e: MouseEvent) => {
if ((e.target as HTMLElement).tagName === 'BUTTON') return;
e.preventDefault();
dragging = true;
const rect = dialog.getBoundingClientRect();
dragX = e.clientX - rect.left;
dragY = e.clientY - rect.top;
dragOverlay = document.createElement('div');
dragOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:move;';
document.body.appendChild(dragOverlay);
});
const onMouseMove = (e: MouseEvent) => {
if (!dragging) return;
dialog.style.left = `${e.clientX - dragX}px`;
dialog.style.top = `${e.clientY - dragY}px`;
dialog.style.marginLeft = '0';
};
const onMouseUp = () => { dragging = false; dragOverlay?.remove(); dragOverlay = null; };
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);

const cleanup = () => {
window.removeEventListener('mousemove', onMouseMove);
window.removeEventListener('mouseup', onMouseUp);
dialog.remove();
};

// Bottom button row
const btnRow = document.createElement('div');
btnRow.className = 'dlg-buttons';
btnRow.style.padding = '8px';
btnRow.style.borderTop = '1px solid #0ff3';
btnRow.style.background = '#121212';

const cancelBtn = document.createElement('button');
cancelBtn.className = 'dlg-btn-cancel';
cancelBtn.textContent = 'Cancel';
cancelBtn.onclick = () => cleanup();

const okBtn = document.createElement('button');
okBtn.className = 'dlg-btn-ok';
okBtn.textContent = 'OK';
okBtn.onclick = () => {
spot.script = widget.value;
spot.handlers = IptEngine.parseEventHandlers(spot.script);
palace.sendRoomSetDesc();
cleanup();
};

btnRow.appendChild(cancelBtn);
btnRow.appendChild(okBtn);
dialog.appendChild(btnRow);
document.body.appendChild(dialog);

widget.value = spot.script || '';
widget.focus();

widget.onSave = (script: string) => {
spot.script = script;
spot.handlers = IptEngine.parseEventHandlers(script);
logmsg(`Spot ${spot.id} script saved.`);
};

widget.onClose = () => cleanup();
}

// ─── Cyborg handlers ───

import { cyborgHandlers, setCyborgHandlers } from './cyborgState.js';
export { cyborgHandlers };

export function loadCyborg(script?: string): void {
if (script === undefined) {
script = (localStorage.getItem('iptEditorScript') ?? '').trim();
}
if (script.length === 0) {
setCyborgHandlers(null);
logmsg(`[Cyborg] Script cleared \u2014 cyborg removed.`);
return;
}
const handlers = CyborgEngine.parseEventHandlers(script);
const eventNames = Object.keys(handlers);
if (eventNames.length === 0) {
setCyborgHandlers(null);
logmsg(`[Cyborg] No event handlers found. Use: ON EVENT { ... }`);
return;
}
setCyborgHandlers(handlers);
logmsg(`[Cyborg] Loaded ${eventNames.length} event handler${eventNames.length > 1 ? 's' : ''}: ${eventNames.join(', ')}`);
}