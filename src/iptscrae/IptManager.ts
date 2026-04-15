import { IptError } from './IptError.js';
import { IptTokenList, type Runnable } from './IptTokenList.js';
import { IptExecutionContext } from './IptExecutionContext.js';
import { PalaceExecutionContext } from './PalaceExecutionContext.js';
import { IptVariableStore } from './IptVariableStore.js';
import { IptParser } from './IptParser.js';
import { IptAlarm } from './IptAlarm.js';
import { clearTooltip } from './commands/palaceCommands.js';

export type TraceCallback = (message: string) => void;
export type EngineEventCallback = () => void;

export class IptManager {
	callStack: Runnable[] = [];
	private eventQueue: { tokenList: IptTokenList; context: IptExecutionContext }[] = [];
	alarms: IptAlarm[] = [];
	cachedScripts: Map<string, IptTokenList[]> = new Map();
	parser: IptParser;
	globalVariableStore: IptVariableStore;
	grepMatchData: RegExpMatchArray | null = null;
	currentScript = '';
	paused = false;
	debugMode = false;
	stepsPerTimeSlice = 800;
	delayBetweenTimeSlices = 1;
	stepThroughScript = false;
	private _running = false;

	executionContextClass: new (manager: IptManager) => IptExecutionContext = IptExecutionContext;

	// Event callbacks
	onTrace: TraceCallback | null = null;
	onTraceHtml: TraceCallback | null = null;
	onPause: EngineEventCallback | null = null;
	onResume: EngineEventCallback | null = null;
	onAbort: EngineEventCallback | null = null;
	onStart: EngineEventCallback | null = null;
	onFinish: EngineEventCallback | null = null;

	constructor() {
		this.globalVariableStore = new IptVariableStore(
			new IptExecutionContext(this)
		);
		this.parser = new IptParser(this);
	}

	get running(): boolean {
		return this._running || this.eventQueue.length > 0 || this.alarms.length > 0;
	}

	traceMessage(message: string): void {
		this.onTrace?.(message);
	}

	addAlarm(alarm: IptAlarm): void {
		this.alarms.push(alarm);
		alarm.onAlarm(() => this.handleAlarm(alarm));
		alarm.start();
	}

	removeAlarm(alarm: IptAlarm): void {
		alarm.stop();
		const index = this.alarms.indexOf(alarm);
		if (index !== -1) {
			this.alarms.splice(index, 1);
		}
	}

	clearAlarms(): void {
		for (const alarm of this.alarms) {
			alarm.stop();
		}
		this.alarms = [];
	}

	clearCachedScripts(): void {
		this.cachedScripts.clear();
	}

	clearAlarmsByScope(isCyborg: boolean): void {
		const toRemove = this.alarms.filter((a) => a.isCyborg === isCyborg);
		for (const alarm of toRemove) {
			this.removeAlarm(alarm);
		}
	}

	private handleAlarm(alarm: IptAlarm): void {
		if (this.alarms.indexOf(alarm) === -1) return;
		this.executeTokenListWithContext(alarm.tokenList, alarm.context);
		this.removeAlarm(alarm);
		this.start();
	}

	clearCallStack(): void {
		this.callStack = [];
	}

	get currentRunnableItem(): Runnable | null {
		if (this.callStack.length > 0) {
			return this.callStack[this.callStack.length - 1];
		}
		return null;
	}

	get moreToExecute(): boolean {
		return this.callStack.length > 0;
	}

	cleanupCurrentItem(): void {
		const runnableItem = this.currentRunnableItem;
		if (runnableItem && !runnableItem.running) {
			this.callStack.pop();
		}
	}

	step(): void {
		const runnableItem = this.currentRunnableItem;
		if (runnableItem) {
			if (runnableItem.running) {
				try {
					runnableItem.step();
				} catch (e) {
					if (e instanceof IptError && runnableItem instanceof IptTokenList) {
						this.outputError(this.currentScript, e, 0);
						this.clearCallStack();
					}
				}
				this.cleanupCurrentItem();
			} else {
				this.callStack.pop();
			}
		}
	}

	pause(): void {
		if (this.debugMode) {
			this.paused = true;
			this.onPause?.();
		}
	}

	resume(): void {
		this.stepThroughScript = false;
		if (this.paused) {
			this.paused = false;
			this.onResume?.();
			this.run();
		}
	}

	private finish(): void {
		this._running = false;
		if (this.eventQueue.length === 0 && this.alarms.length === 0) {
			this.onFinish?.();
		}
	}

	abort(): void {
		this.clearAlarms();
		this.clearCallStack();
		this.eventQueue = [];
		this._running = false;
		clearTooltip();
		this.onAbort?.();
		this.onFinish?.();
	}

	start(): void {
		if (!this._running) {
			this._running = true;
			setTimeout(() => this.run(), 1);
		}
		if (this.debugMode && this.stepThroughScript) {
			this.pause();
		}
	}

	private run(): void {
		for (let i = 0; i < this.stepsPerTimeSlice; i++) {
			if (!this.moreToExecute && this.eventQueue.length > 0) {
				const next = this.eventQueue.shift()!;
				this.executeTokenListWithContext(next.tokenList, next.context);
			}
			if (this.moreToExecute && !this.paused) {
				this.step();
			} else {
				if (!this.moreToExecute) {
					this.finish();
				}
				return;
			}
		}
		setTimeout(() => this.run(), this.delayBetweenTimeSlices);
	}

	execute(script: string): void {
		const context = new this.executionContextClass(this);
		this.executeWithContext(script, context);
	}

	queueTokenListWithContext(
		tokenList: IptTokenList,
		context: IptExecutionContext
	): void {
		this.eventQueue.push({ tokenList, context });
	}

	executeTokenListSync(
		tokenList: IptTokenList,
		context: IptExecutionContext
	): void {
		const stackDepth = this.callStack.length;
		try {
			this.currentScript = tokenList.sourceScript;
			tokenList.execute(context);
			while (this.callStack.length > stackDepth) {
				this.step();
			}
		} catch (e) {
			if (e instanceof IptError) {
				this.outputError(tokenList.sourceScript, e, 0, context);
				while (this.callStack.length > stackDepth) {
					this.callStack.pop();
				}
			}
		}
	}

	executeTokenListWithContext(
		tokenList: IptTokenList,
		context: IptExecutionContext
	): void {
		try {
			this.currentScript = tokenList.sourceScript;
			tokenList.execute(context);
			this.onStart?.();
		} catch (e) {
			if (e instanceof IptError) {
				this.outputError(tokenList.sourceScript, e, 0, context);
				this.abort();
			}
		}
	}

	executeWithContext(script: string, context: IptExecutionContext): void {
		this.currentScript = script;
		let tokenList: IptTokenList;
		try {
			tokenList = this.parser.tokenize(script);
		} catch (e) {
			if (e instanceof IptError) {
				const error = new IptError(
					'Parse Error: ' + e.message,
					e.characterOffset
				);
				this.outputError(this.currentScript, error, 0);
				this.abort();
			}
			return;
		}
		try {
			tokenList.execute(context);
			this.start();
		} catch (e) {
			if (e instanceof IptError) {
				let charOffset = 0;
				if (tokenList) {
					charOffset = tokenList.characterOffsetCompensation;
				}
				this.outputError(this.currentScript, e, charOffset);
				this.abort();
			}
		}
	}

	parseEventHandlers(script: string): Record<string, IptTokenList> {
		let handlers: Record<string, IptTokenList> = {};
		try {
			handlers = this.parser.parseEventHandlers(script);
		} catch (e) {
			if (e instanceof IptError) {
				this.outputError(script, e);
			}
		}
		return handlers;
	}

	private outputError(
		_script: string,
		e: IptError,
		characterOffsetCompensation = 0,
		context?: IptExecutionContext
	): void {
		let sourceContext = '';
		let sourceContextHtml = '';
		let output = e.message;
		if (e.characterOffset !== -1) {
			const offset = e.characterOffset - characterOffsetCompensation;
			if (this.currentRunnableItem) {
				if (this.currentRunnableItem instanceof IptTokenList) {
					const tokenList = this.currentRunnableItem as IptTokenList;
					const adjOffset = offset - tokenList.characterOffsetCompensation;
					sourceContext = this.highlightSource(
						tokenList.sourceScript,
						adjOffset,
						80
					);
					sourceContextHtml = this.highlightSourceHtml(
						tokenList.sourceScript,
						adjOffset,
						80
					);
				}
			}
			output = `At character ${offset}:\n${output}\n${sourceContext}`;
		}
		const ctx = this.getErrorContext() ?? (context instanceof PalaceExecutionContext ? context : null);
		let prefix = '';
		if (ctx) {
			prefix = `[Spot ${ctx.hotspotId}, ${ctx.eventName || 'unknown event'}`;
			if (ctx.httpUrl) prefix += `, URL: ${ctx.httpUrl}`;
			prefix += ']';
			output = `${prefix} ${output}`;
		}
		if (this.onTraceHtml && sourceContextHtml) {
			const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			const escapedMsg = esc(e.message);
			const escapedPrefix = esc(prefix);

			let stackHtml = '';
			if (e.stackSnapshot.length > 0) {
				const items = e.stackSnapshot.map(s => `<span style="color:#a0a0a0">${esc(s)}</span>`).join(', ');
				stackHtml = `<div style="margin:3px 0 2px;padding:3px 8px;background:rgba(255,255,255,0.04);border-left:2px solid #3a3a3a;border-radius:0 3px 3px 0;font-size:11px;color:#888888">Stack: ${items}</div>`;
			}

			this.onTraceHtml(
				`<div style="margin:4px 0;padding:6px 10px;background:rgba(200,40,40,0.1);border:1px solid rgba(200,40,40,0.25);border-radius:6px;font-size:12px;line-height:1.5">` +
				`<div style="color:#f06060;font-weight:600">${escapedPrefix ? '<span style="color:#888888;font-weight:400">' + escapedPrefix + '</span> ' : ''}${escapedMsg}</div>` +
				stackHtml +
				`<div style="margin-top:4px;font-family:monospace;font-size:11px;white-space:pre-wrap;color:#a0a0a0">${sourceContextHtml}</div>` +
				`</div>`
			);
		} else {
			if (e.stackSnapshot.length > 0) {
				output += '\nStack: ' + e.stackSnapshot.join(', ');
			}
			this.traceMessage(output);
		}
	}

	private getErrorContext(): PalaceExecutionContext | null {
		for (let i = this.callStack.length - 1; i >= 0; i--) {
			const item = this.callStack[i];
			if (item instanceof IptTokenList && item.context instanceof PalaceExecutionContext) {
				return item.context;
			}
		}
		return null;
	}

	get scriptContextDisplay(): string {
		if (this.currentRunnableItem) {
			if (this.currentRunnableItem instanceof IptTokenList) {
				const tokenList = this.currentRunnableItem as IptTokenList;
				let charOffset = tokenList.scriptCharacterOffset;
				const currentToken = tokenList.getCurrentToken();
				if (currentToken) {
					charOffset = currentToken.scriptCharacterOffset;
				}
				return this.highlightSource(
					tokenList.sourceScript,
					charOffset - tokenList.characterOffsetCompensation,
					30
				);
			}
		}
		return '';
	}

	highlightSource(
		script: string,
		characterOffset: number,
		contextCharacters = 80
	): string {
		if (characterOffset !== -1) {
			script = script.replace(/[\r\n]/g, ' ');
			const charsAfter = script.length - characterOffset;
			const charsBefore = script.length - charsAfter;

			let output = script.slice(
				characterOffset - Math.min(charsBefore, contextCharacters),
				characterOffset + Math.min(charsAfter, contextCharacters)
			);
			output += '\n';

			const pointerPadding = Math.min(charsBefore, contextCharacters);
			let pointer = '';
			for (let i = 0; i < pointerPadding; i++) {
				pointer += ' ';
			}
			pointer += '^';
			output += pointer;
			return output;
		}
		return '';
	}

	private highlightSourceHtml(
		script: string,
		characterOffset: number,
		contextCharacters = 80
	): string {
		if (characterOffset !== -1) {
			script = script.replace(/[\r\n]/g, ' ');
			const charsAfter = script.length - characterOffset;
			const charsBefore = script.length - charsAfter;

			const start = characterOffset - Math.min(charsBefore, contextCharacters);
			const end = characterOffset + Math.min(charsAfter, contextCharacters);

			// Find the error token end (next space or end of string)
			let tokenEnd = characterOffset;
			while (tokenEnd < script.length && script[tokenEnd] !== ' ') tokenEnd++;

			const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

			const before = esc(script.slice(start, characterOffset));
			const errorToken = esc(script.slice(characterOffset, Math.min(tokenEnd, end)));
			const after = esc(script.slice(Math.min(tokenEnd, end), end));

			return (
				(start > 0 ? '&hellip;' : '') +
				before +
				`<span style="background:#d32f2f;color:#fff;padding:1px 3px;border-radius:3px;font-weight:600">${errorToken}</span>` +
				after +
				(end < script.length ? '&hellip;' : '')
			);
		}
		return '';
	}
}
