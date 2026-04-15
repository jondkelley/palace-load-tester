/**
 * Iptscrae Reference page — entry point.
 * Highlights all <pre> code blocks (preserving <a> links) and wires up
 * search + back/forward navigation.
 */
import { tokenizeForHighlight, scopeTokens, TOKEN_CLASS } from './iptscrae-highlight.js';

// ─── Syntax-highlight <pre> blocks while preserving <a> tags ───

/**
 * Walk a <pre>'s childNodes, tokenize text nodes for highlighting,
 * and re-wrap <a> elements so they keep href but gain correct syntax classes.
 */
function highlightPreserveLinks(pre: HTMLPreElement): void {
	const frag = document.createDocumentFragment();

	for (const node of Array.from(pre.childNodes)) {
		if (node.nodeType === Node.TEXT_NODE) {
			// Pure text — tokenize and highlight
			appendHighlighted(frag, node.textContent || '');
		} else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'A') {
			// <a href="#...">CMDNAME</a> — highlight the inner text,
			// then wrap the highlighted span(s) inside the link
			const a = node as HTMLAnchorElement;
			const text = a.textContent || '';
			const innerFrag = document.createDocumentFragment();
			appendHighlighted(innerFrag, text);
			const newA = document.createElement('a');
			newA.href = a.href;
			if (a.hasAttribute('title')) newA.title = a.title;
			newA.appendChild(innerFrag);
			frag.appendChild(newA);
		} else {
			frag.appendChild(node.cloneNode(true));
		}
	}

	pre.textContent = '';
	pre.appendChild(frag);
}

function appendHighlighted(parent: DocumentFragment | HTMLElement, text: string): void {
	const tokens = tokenizeForHighlight(text);
	scopeTokens(tokens);
	for (const tok of tokens) {
		const cls = TOKEN_CLASS[tok.type];
		if (cls) {
			const span = document.createElement('span');
			span.className = cls;
			span.textContent = tok.text;
			parent.appendChild(span);
		} else {
			parent.appendChild(document.createTextNode(tok.text));
		}
	}
}

for (const pre of document.querySelectorAll<HTMLPreElement>('.cmd-card pre')) {
	highlightPreserveLinks(pre);
}

// ─── Search functionality ───

const searchBox = document.getElementById('search-box') as HTMLInputElement;
const searchClear = document.getElementById('search-clear') as HTMLButtonElement;
const searchWrap = searchBox.parentElement!;

function doSearch(): void {
	const query = searchBox.value.toLowerCase().trim();
	searchWrap.classList.toggle('has-text', searchBox.value.length > 0);
	const cards = document.querySelectorAll('.cmd-card');
	cards.forEach(card => {
		if (!query) {
			(card as HTMLElement).style.display = '';
			return;
		}
		const text = card.textContent!.toLowerCase();
		(card as HTMLElement).style.display = text.includes(query) ? '' : 'none';
	});
}

searchBox.addEventListener('input', doSearch);

// ESC to clear search
searchBox.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') {
		searchBox.value = '';
		doSearch();
		searchBox.blur();
	}
});

// X button clears search
searchClear.addEventListener('click', () => {
	searchBox.value = '';
	doSearch();
	searchBox.focus();
});

// "/" shortcut to focus search (when not already typing)
document.addEventListener('keydown', (e) => {
	if (e.key === '/' && document.activeElement !== searchBox) {
		e.preventDefault();
		searchBox.focus();
		searchBox.select();
	}
});

// ─── Card flash on hash navigation ───

function flashTargetCard(): void {
	const hash = location.hash.slice(1);
	if (!hash) return;
	const el = document.getElementById(hash);
	if (!el || !el.classList.contains('cmd-card')) return;
	el.classList.remove('flash');
	// Force reflow so re-adding the class restarts the animation
	void el.offsetWidth;
	el.classList.add('flash');
}

// Flash on initial load if there's a hash
flashTargetCard();

// ─── Active nav link tracking ───

const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]'));
const sectionIds = navLinks.map(a => a.getAttribute('href')!.slice(1));

function updateActiveNav(): void {
	const scrollY = (document.querySelector('main') as HTMLElement).scrollTop || window.scrollY;
	let activeId = sectionIds[0];
	for (const id of sectionIds) {
		const el = document.getElementById(id);
		if (el && el.offsetTop <= scrollY + 120) activeId = id;
	}
	for (const link of navLinks) {
		link.classList.toggle('active', link.getAttribute('href') === '#' + activeId);
	}
}

// Listen on both window scroll and main scroll (in case main is the scroll container)
window.addEventListener('scroll', updateActiveNav, { passive: true });
document.querySelector('main')?.addEventListener('scroll', updateActiveNav, { passive: true });
updateActiveNav();

// ─── Back / Forward navigation ───

const btnBack = document.getElementById('nav-back') as HTMLButtonElement;
const btnFwd = document.getElementById('nav-forward') as HTMLButtonElement;

const history: string[] = [location.hash];
let historyIdx = 0;
let ignoreNext = false;

function updateButtons(): void {
	btnBack.disabled = historyIdx <= 0;
	btnFwd.disabled = historyIdx >= history.length - 1;
}

function pushHash(hash: string): void {
	if (ignoreNext) { ignoreNext = false; return; }
	// Trim forward history when navigating from middle
	if (historyIdx < history.length - 1) history.length = historyIdx + 1;
	// Only push if different from current
	if (history[history.length - 1] !== hash) {
		history.push(hash);
		historyIdx = history.length - 1;
	}
	updateButtons();
}

window.addEventListener('hashchange', () => {
	pushHash(location.hash);
	flashTargetCard();
});

btnBack.addEventListener('click', () => {
	if (historyIdx <= 0) return;
	historyIdx--;
	ignoreNext = true;
	location.hash = history[historyIdx];
	updateButtons();
	flashTargetCard();
});

btnFwd.addEventListener('click', () => {
	if (historyIdx >= history.length - 1) return;
	historyIdx++;
	ignoreNext = true;
	location.hash = history[historyIdx];
	updateButtons();
	flashTargetCard();
});

updateButtons();
