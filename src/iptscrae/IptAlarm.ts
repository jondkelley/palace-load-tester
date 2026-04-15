import { IptTokenList } from './IptTokenList.js';
import type { IptManager } from './IptManager.js';
import type { IptExecutionContext } from './IptExecutionContext.js';

export class IptAlarm {
	private timerId: ReturnType<typeof setTimeout> | null = null;
	tokenList: IptTokenList;
	context: IptExecutionContext;
	private _delay: number;
	completed = false;
	isCyborg = false;
	private onAlarmCallback: (() => void) | null = null;

	constructor(
		script: IptTokenList,
		manager: IptManager,
		delayTicks: number,
		context?: IptExecutionContext
	) {
		if (!context) {
			context = new manager.executionContextClass(manager);
		}
		this.context = context;
		this.tokenList = script;
		this._delay = this.ticksToMS(Math.max(0, delayTicks - 2));
		if (this._delay < 10) this._delay = 10;
	}

	private ticksToMS(ticks: number): number {
		return Math.max(0, ticks) / 60 * 1000;
	}

	onAlarm(callback: () => void): void {
		this.onAlarmCallback = callback;
	}

	start(): void {
		this.stop();
		this.timerId = setTimeout(() => {
			this.completed = true;
			this.onAlarmCallback?.();
		}, this._delay);
	}

	stop(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	}
}
