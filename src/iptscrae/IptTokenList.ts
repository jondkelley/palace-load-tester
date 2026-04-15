import { IptToken } from './IptToken.js';
import { IptError } from './IptError.js';
import { IptCommand } from './IptCommand.js';
import { RECURSION_LIMIT } from './IptConstants.js';
import type { IptExecutionContext } from './IptExecutionContext.js';

export interface Runnable {
	execute(context: IptExecutionContext): void;
	step(): void;
	end(): void;
	running: boolean;
	toString(): string;
}

export class IptTokenList extends IptToken implements Runnable {
	sourceScript = '';
	characterOffsetCompensation = 0;
	protected _running = false;
	context!: IptExecutionContext;
	tokenList: IptToken[];
	position = 0;

	constructor(tokenList?: IptToken[]) {
		super();
		this.tokenList = tokenList ?? [];
	}

	set running(value: boolean) {
		this._running = value;
	}

	get running(): boolean {
		return this._running;
	}

	reset(): void {
		this.position = 0;
		this._running = true;
	}

	getCurrentToken(): IptToken | null {
		if (this.position < this.tokenList.length) {
			return this.tokenList[this.position];
		}
		return null;
	}

	getNextToken(): IptToken {
		if (this.position >= this.tokenList.length) {
			throw new IptError('Read past end of tokenlist.');
		}
		if (this.tokenList.length === 0) {
			throw new IptError('No tokens to read.');
		}
		return this.tokenList[this.position++];
	}

	get tokensAvailable(): boolean {
		return this.position < this.tokenList.length;
	}

	get length(): number {
		return this.tokenList.length;
	}

	addToken(token: IptToken, characterOffset = -1): void {
		token.scriptCharacterOffset = characterOffset;
		this.tokenList.push(token);
	}

	popToken(): IptToken {
		const token = this.tokenList.pop();
		if (!token) {
			throw new IptError('Unable to pop token: empty list.');
		}
		return token;
	}

	override clone(): IptToken {
		const newTokenList = new IptTokenList([...this.tokenList]);
		newTokenList.sourceScript = this.sourceScript;
		newTokenList.scriptCharacterOffset = this.scriptCharacterOffset;
		return newTokenList;
	}

	execute(context: IptExecutionContext): void {
		this.context = context;
		if (context.manager.callStack.length > RECURSION_LIMIT) {
			throw new IptError(`Max call stack depth of ${RECURSION_LIMIT} exceeded.`);
		}
		this.reset();
		context.manager.callStack.push(this);
	}

	end(): void {
		this._running = false;
	}

	step(): void {
		if (this.tokensAvailable) {
			if (this.context.returnRequested) {
				this.context.returnRequested = false;
				this.end();
				return;
			}
			if (this.context.exitRequested || this.context.breakRequested) {
				this.end();
				return;
			}

			const token = this.getNextToken();
			if (token instanceof IptCommand) {
				const debug = this.context.manager.debugMode;
				const stackBefore = debug ? this.context.stack.stack.slice(-6).map(t => t.toString()) : [];
				try {
					token.execute(this.context);
				} catch (e) {
					const iptErr = e instanceof IptError ? e : new IptError(String(e));
					const offsetToReport =
						iptErr.characterOffset === -1
							? token.scriptCharacterOffset
							: iptErr.characterOffset;
					this.end();
					const err = new IptError(
						`  ${token.constructor.name}:\n${iptErr.message}`,
						offsetToReport
					);
					err.stackSnapshot = iptErr.stackSnapshot.length > 0 ? iptErr.stackSnapshot : stackBefore;
					throw err;
				}
			} else if (token instanceof IptTokenList) {
				this.context.stack.push(token.clone() as IptTokenList);
			} else {
				this.context.stack.push(token);
			}
		} else {
			this.end();
		}
	}

	override toString(): string {
		let snippet = this.sourceScript.replace(/[\r\n]/g, ' ');
		if (snippet.length > 20) {
			snippet = snippet.substring(0, 20) + '...';
		}
		return `[IptTokenList {${snippet}}]`;
	}
}
