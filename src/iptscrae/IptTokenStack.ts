import { IptToken } from './IptToken.js';
import { IptError } from './IptError.js';
import { STACK_DEPTH } from './IptConstants.js';
import { IptVariable } from './IptVariable.js';
import { IntegerToken } from './tokens/IntegerToken.js';
import { StringToken } from './tokens/StringToken.js';

export class IptTokenStack {
	stack: IptToken[] = [];

	get depth(): number {
		return this.stack.length;
	}

	popType<T extends IptToken>(requestedType: new (...args: any[]) => T): T {
		let token: IptToken = this.pop();
		if (token instanceof IptVariable && requestedType !== (IptVariable as any)) {
			token = token.dereference();
		}
		if (token instanceof requestedType) {
			return token;
		}
		// Variant coercion: IntegerToken ↔ StringToken
		if (requestedType === (IntegerToken as any) && token instanceof StringToken) {
			const num = parseInt(token.data, 10);
			return new IntegerToken(isNaN(num) ? 0 : num) as unknown as T;
		}
		if (requestedType === (StringToken as any) && token instanceof IntegerToken) {
			return new StringToken(String(token.data)) as unknown as T;
		}
		throw new IptError(
			`Expected ${requestedType.name} element. Got ${token.constructor.name} element instead.`
		);
	}

	pop(): IptToken {
		if (this.stack.length === 0) {
			throw new IptError('Cannot pop from an empty stack.');
		}
		return this.stack.pop()!;
	}

	push(token: IptToken): void {
		if (this.stack.length === STACK_DEPTH) {
			throw new IptError(`Stack depth of ${STACK_DEPTH} exceeded.`);
		}
		this.stack.push(token);
	}

	pick(position: number): IptToken {
		if (position > this.stack.length - 1) {
			throw new IptError(
				`You requested element #${position} from the top of the stack, but there are only ${this.depth} element(s) available.`
			);
		}
		return this.stack[this.stack.length - 1 - position];
	}

	duplicate(): void {
		this.push(this.pick(0));
	}
}
