// Standalone module for cyborg handler state — no engine dependencies.
// This breaks circular imports between palaceCommands ↔ iptscrae-editor ↔ cyborgEngine.

export let cyborgHandlers: Record<string, any> | null = null;

export function setCyborgHandlers(handlers: Record<string, any> | null): void {
	cyborgHandlers = handlers;
}
