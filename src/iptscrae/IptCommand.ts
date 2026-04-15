import { IptToken } from './IptToken.js';
import { IptError } from './IptError.js';

export class IptCommand extends IptToken {
	constructor(characterOffset = -1) {
		super(characterOffset);
	}

	execute(_context: import('./IptExecutionContext.js').IptExecutionContext): void {
		// base no-op
	}

	override clone(): IptToken {
		throw new IptError('You cannot clone a command token.');
	}

	get running(): boolean {
		return false;
	}

	step(): void {
		// base no-op
	}

	end(): void {
		// base no-op
	}
}
