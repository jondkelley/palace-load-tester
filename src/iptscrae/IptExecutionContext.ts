import type { IptManager } from './IptManager.js';
import { IptToken } from './IptToken.js';
import { IptTokenStack } from './IptTokenStack.js';
import { IptVariableStore } from './IptVariableStore.js';

export class IptExecutionContext {
	manager: IptManager;
	data: Record<string, unknown> = {};
	stack: IptTokenStack;
	variableStore: IptVariableStore;

	breakRequested = false;
	returnRequested = false;
	exitRequested = false;

	constructor(
		manager: IptManager,
		stack?: IptTokenStack,
		variableStore?: IptVariableStore
	) {
		this.manager = manager;
		this.stack = stack ?? new IptTokenStack();
		this.variableStore = variableStore ?? new IptVariableStore(this);
	}

	resetExecutionControls(): void {
		this.breakRequested = this.returnRequested = this.exitRequested = false;
	}

	isExternalVariable(_name: string): boolean {
		return false;
	}

	setExternalVariable(_name: string, _value: IptToken): void {
		// override in subclass
	}

	getExternalVariable(_name: string): IptToken {
		return new IptToken();
	}

	clone(): IptExecutionContext {
		return new IptExecutionContext(this.manager, this.stack, this.variableStore);
	}

	/** Clone with shared variable store but a fresh stack. */
	cloneSharedScope(): IptExecutionContext {
		const ctx = new IptExecutionContext(this.manager, undefined, this.variableStore);
		return ctx;
	}
}
