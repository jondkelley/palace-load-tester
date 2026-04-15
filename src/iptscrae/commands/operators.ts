import { IptCommand } from '../IptCommand.js';
import type { IptExecutionContext } from '../IptExecutionContext.js';
import { IptToken } from '../IptToken.js';
import { IptVariable } from '../IptVariable.js';
import { IntegerToken } from '../tokens/IntegerToken.js';
import { StringToken } from '../tokens/StringToken.js';

// ── Variant Coercion Helpers ──

function toInteger(token: IptToken): number {
	if (token instanceof IntegerToken) return token.data;
	if (token instanceof StringToken) {
		const n = parseInt(token.data, 10);
		return isNaN(n) ? 0 : n;
	}
	return 0;
}

function toStr(token: IptToken): string {
	if (token instanceof StringToken) return token.data;
	if (token instanceof IntegerToken) return String(token.data);
	return '';
}

// ── Arithmetic Operators ──

export class AdditionOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const a2 = context.stack.pop().dereference();
		const a1 = context.stack.pop().dereference();
		if (a1 instanceof StringToken || a2 instanceof StringToken) {
			context.stack.push(new StringToken(toStr(a1) + toStr(a2)));
		} else {
			context.stack.push(new IntegerToken(toInteger(a1) + toInteger(a2)));
		}
	}
}

export class SubtractionOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const a2 = toInteger(context.stack.pop().dereference());
		const a1 = toInteger(context.stack.pop().dereference());
		context.stack.push(new IntegerToken(a1 - a2));
	}
}

export class MultiplicationOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const multiplier = toInteger(context.stack.pop().dereference());
		const multiplicand = toInteger(context.stack.pop().dereference());
		context.stack.push(new IntegerToken(multiplicand * multiplier));
	}
}

export class DivisionOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const divisor = toInteger(context.stack.pop().dereference());
		const dividend = toInteger(context.stack.pop().dereference());
		context.stack.push(new IntegerToken((dividend / divisor) | 0));
	}
}

export class ModuloOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const a2 = toInteger(context.stack.pop().dereference());
		const a1 = toInteger(context.stack.pop().dereference());
		context.stack.push(new IntegerToken(a1 % a2));
	}
}

export class ConcatOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const arg2 = toStr(context.stack.pop().dereference());
		const arg1 = toStr(context.stack.pop().dereference());
		context.stack.push(new StringToken(arg1 + arg2));
	}
}

// ── Assignment Operators ──

export class AssignOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		const value = context.stack.pop().dereference();
		variable.value = value;
	}
}

export class AdditionAssignmentOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		const argument = context.stack.pop().dereference();
		const originalValue = variable.value;
		if (argument instanceof StringToken || originalValue instanceof StringToken) {
			variable.value = new StringToken(toStr(originalValue) + toStr(argument));
		} else {
			variable.value = new IntegerToken(toInteger(originalValue) + toInteger(argument));
		}
	}
}

export class SubtractionAssignmentOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		const amount = toInteger(context.stack.pop().dereference());
		variable.value = new IntegerToken(toInteger(variable.value) - amount);
	}
}

export class MultiplicationAssignmentOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		const multiplier = toInteger(context.stack.pop().dereference());
		variable.value = new IntegerToken(toInteger(variable.value) * multiplier);
	}
}

export class DivisionAssignmentOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		const divisor = toInteger(context.stack.pop().dereference());
		variable.value = new IntegerToken((toInteger(variable.value) / divisor) | 0);
	}
}

export class ModuloAssignmentOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		const arg = toInteger(context.stack.pop().dereference());
		variable.value = new IntegerToken(toInteger(variable.value) % arg);
	}
}

export class ConcatAssignmentOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		const arg = toStr(context.stack.pop().dereference());
		variable.value = new StringToken(toStr(variable.value) + arg);
	}
}

// ── Unary Operators ──

export class UnaryIncrementOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		variable.value = new IntegerToken(toInteger(variable.value) + 1);
	}
}

export class UnaryDecrementOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const variable = context.stack.popType(IptVariable);
		variable.value = new IntegerToken(toInteger(variable.value) - 1);
	}
}

// ── Comparison Operators ──

export class EqualityOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const a2 = context.stack.pop().dereference();
		const a1 = context.stack.pop().dereference();
		if (a1 instanceof IntegerToken && a2 instanceof IntegerToken) {
			context.stack.push(a1.data === a2.data ? IntegerToken.ONE : IntegerToken.ZERO);
		} else if (a1 instanceof StringToken && a2 instanceof StringToken) {
			context.stack.push(
				a1.data.toUpperCase() === a2.data.toUpperCase() ? IntegerToken.ONE : IntegerToken.ZERO
			);
		} else {
			context.stack.push(IntegerToken.ZERO);
		}
	}
}

export class InequalityOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const a2 = context.stack.pop().dereference();
		const a1 = context.stack.pop().dereference();
		if (a1 instanceof IntegerToken && a2 instanceof IntegerToken) {
			context.stack.push(a1.data !== a2.data ? IntegerToken.ONE : IntegerToken.ZERO);
		} else if (a1 instanceof StringToken && a2 instanceof StringToken) {
			context.stack.push(a1.data !== a2.data ? IntegerToken.ONE : IntegerToken.ZERO);
		} else {
			context.stack.push(IntegerToken.ONE);
		}
	}
}

export class LessThanOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const arg2 = context.stack.pop().dereference();
		const arg1 = context.stack.pop().dereference();
		if (arg1 instanceof StringToken || arg2 instanceof StringToken) {
			context.stack.push(
				toStr(arg1).toUpperCase() < toStr(arg2).toUpperCase() ? IntegerToken.ONE : IntegerToken.ZERO
			);
		} else {
			context.stack.push(toInteger(arg1) < toInteger(arg2) ? IntegerToken.ONE : IntegerToken.ZERO);
		}
	}
}

export class LessThanOrEqualToOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const arg2 = context.stack.pop().dereference();
		const arg1 = context.stack.pop().dereference();
		if (arg1 instanceof StringToken || arg2 instanceof StringToken) {
			context.stack.push(
				toStr(arg1).toUpperCase() <= toStr(arg2).toUpperCase() ? IntegerToken.ONE : IntegerToken.ZERO
			);
		} else {
			context.stack.push(toInteger(arg1) <= toInteger(arg2) ? IntegerToken.ONE : IntegerToken.ZERO);
		}
	}
}

export class GreaterThanOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const arg2 = context.stack.pop().dereference();
		const arg1 = context.stack.pop().dereference();
		if (arg1 instanceof StringToken || arg2 instanceof StringToken) {
			context.stack.push(
				toStr(arg1).toUpperCase() > toStr(arg2).toUpperCase() ? IntegerToken.ONE : IntegerToken.ZERO
			);
		} else {
			context.stack.push(toInteger(arg1) > toInteger(arg2) ? IntegerToken.ONE : IntegerToken.ZERO);
		}
	}
}

export class GreaterThanOrEqualToOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const arg2 = context.stack.pop().dereference();
		const arg1 = context.stack.pop().dereference();
		if (arg1 instanceof StringToken || arg2 instanceof StringToken) {
			context.stack.push(
				toStr(arg1).toUpperCase() >= toStr(arg2).toUpperCase() ? IntegerToken.ONE : IntegerToken.ZERO
			);
		} else {
			context.stack.push(toInteger(arg1) >= toInteger(arg2) ? IntegerToken.ONE : IntegerToken.ZERO);
		}
	}
}

// ── Logical Operators ──

export class LogicalAndOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const arg2 = context.stack.pop().dereference();
		const arg1 = context.stack.pop().dereference();
		context.stack.push(arg1.toBoolean() && arg2.toBoolean() ? IntegerToken.ONE : IntegerToken.ZERO);
	}
}

export class LogicalOrOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const arg2 = context.stack.pop().dereference();
		const arg1 = context.stack.pop().dereference();
		context.stack.push(arg1.toBoolean() || arg2.toBoolean() ? IntegerToken.ONE : IntegerToken.ZERO);
	}
}

export class LogicalNotOperator extends IptCommand {
	override execute(context: IptExecutionContext): void {
		const token = context.stack.pop().dereference();
		context.stack.push(token.toBoolean() ? IntegerToken.ZERO : IntegerToken.ONE);
	}
}
