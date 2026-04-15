import { IptToken } from '../IptToken.js';
import { ENABLE_DEBUGGING } from '../IptConstants.js';
import type { IptExecutionContext } from '../IptExecutionContext.js';
import { IptCommand } from '../IptCommand.js';
import { ArrayToken } from './ArrayToken.js';
import { ArrayMarkToken } from './ArrayMarkToken.js';

export class ArrayParseToken extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const array = new ArrayToken();
		if (ENABLE_DEBUGGING) {
			context.manager.traceMessage('Building array:');
		}
		while (context.stack.depth > 0) {
			const token: IptToken = context.stack.pop();
			if (ENABLE_DEBUGGING) {
				context.manager.traceMessage(`  - Found element: ${token.toString()}`);
			}
			if (token instanceof ArrayMarkToken) {
				array.scriptCharacterOffset = token.scriptCharacterOffset;
				break;
			} else {
				array.data.unshift(token);
			}
		}
		context.stack.push(array);
		if (ENABLE_DEBUGGING) {
			context.manager.traceMessage('Array built.');
		}
	}

	override toString(): string {
		return '[ArrayParseToken]';
	}
}
