/**
 * Chat Log Archive — entry point.
 * Lists saved chat log files grouped by server, ordered by date descending.
 * Clicking a log entry shows its contents in the viewer panel.
 */

interface LogEntry { filename: string; size: number; modified: number; }
interface ServerGroup { server: string; logs: LogEntry[]; }

const viewer = document.getElementById('viewer')!;
let activeEntry: HTMLElement | null = null;

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}

function parseLogFilename(filename: string): { date: string } {
	const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.html$/);
	if (match) return { date: match[1] };
	return { date: filename.replace(/\.html$/, '') };
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Extract the <body> content from a full HTML log file. */
function extractBody(html: string): string {
	const match = html.match(/<body[^>]*>([\s\S]*?)(<\/body>|$)/i);
	return match ? match[1] : html;
}

async function viewLog(server: string, filename: string, entryEl: HTMLElement): Promise<void> {
	if (activeEntry) activeEntry.classList.remove('active');
	activeEntry = entryEl;
	entryEl.classList.add('active');

	const info = parseLogFilename(filename);
	viewer.innerHTML = `<div class="viewer-header"><strong>${escapeHtml(server)}</strong> &mdash; ${escapeHtml(info.date)}</div><div class="viewer-content" style="opacity:.5">Loading...</div>`;

	const html = await window.apiBridge.chatLogRead(server, filename);
	if (html === null) {
		viewer.innerHTML = '<div class="viewer-empty">Unable to read log file.</div>';
		return;
	}

	const header = viewer.querySelector('.viewer-header')!;
	const content = document.createElement('div');
	content.className = 'viewer-content';
	content.innerHTML = extractBody(html);
	viewer.innerHTML = '';
	viewer.appendChild(header);
	viewer.appendChild(content);
}

async function loadArchive(): Promise<void> {
	const container = document.getElementById('archive-list')!;
	let data: ServerGroup[];
	try {
		data = await window.apiBridge.chatLogList();
	} catch {
		container.innerHTML = '<div class="empty-state">Unable to load chat logs.</div>';
		return;
	}

	if (!data || data.length === 0) {
		container.innerHTML = '<div class="empty-state">No chat logs found.<br>Enable "Stream log to file" in the chat log context menu to start recording.</div>';
		return;
	}

	container.innerHTML = '';
	for (const group of data) {
		const groupEl = document.createElement('div');
		groupEl.className = 'server-group';
		groupEl.dataset.server = group.server.toLowerCase();

		const header = document.createElement('div');
		header.className = 'server-header';
		header.innerHTML = `<span class="server-arrow">&#9660;</span><span class="server-name">${escapeHtml(group.server)}</span><span class="server-count">${group.logs.length}</span>`;
		header.onclick = () => groupEl.classList.toggle('collapsed');
		groupEl.appendChild(header);

		const list = document.createElement('div');
		list.className = 'log-list';

		for (const log of group.logs) {
			const info = parseLogFilename(log.filename);
			const entry = document.createElement('div');
			entry.className = 'log-entry';
			entry.dataset.search = `${group.server} ${info.date}`.toLowerCase();
			entry.innerHTML = `<span class="log-date">${escapeHtml(info.date)}</span><span class="log-size">${formatSize(log.size)}</span>`;
			entry.onclick = () => viewLog(group.server, log.filename, entry);
			list.appendChild(entry);
		}

		groupEl.appendChild(list);
		container.appendChild(groupEl);
	}
}

// Open folder link
document.getElementById('open-folder')!.onclick = () => window.apiBridge.openChatLogsFolder();

// Search filtering
const searchBox = document.getElementById('search-box') as HTMLInputElement;
searchBox.addEventListener('input', () => {
	const query = searchBox.value.toLowerCase().trim();
	const groups = document.querySelectorAll('.server-group');
	groups.forEach(group => {
		const entries = group.querySelectorAll('.log-entry');
		let anyVisible = false;
		entries.forEach(entry => {
			const el = entry as HTMLElement;
			const match = !query || (el.dataset.search?.includes(query) ?? false);
			el.style.display = match ? '' : 'none';
			if (match) anyVisible = true;
		});
		const serverMatch = !query || (group as HTMLElement).dataset.server?.includes(query);
		(group as HTMLElement).style.display = (anyVisible || serverMatch) ? '' : 'none';
		if (query && anyVisible) group.classList.remove('collapsed');
	});
});

loadArchive();
