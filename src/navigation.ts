import { palace, smileys } from './state.js';

interface NormalizedServerEntry {
	name: string;
	address: string;
	description: string;
	picture: string;
	population: number;
}

let directoryList: NormalizedServerEntry[] | null = null;

export function getDirectoryList(): NormalizedServerEntry[] | null { return directoryList; }

export function closeNavListbox(): void {
	(document.getElementById('navsearch') as HTMLInputElement).value = '';
	const navframe = document.getElementById('navframe')!;
	navframe.style.display = 'none';
	navframe.className = 'navframe';
	navframe.dataset.ctrlname = '';
	clearListBox(document.getElementById('navlistbox')!);
}

function clearListBox(listbox: HTMLElement): void {
	let e: ChildNode | null;
	while (e = listbox.lastChild) listbox.removeChild(e);
}

export function toggleNavListbox(cname: string): void {
	const navframe = document.getElementById('navframe')!;
	const listbox = document.getElementById('navlistbox')!;

	if (navframe.dataset.ctrlname === cname) {
		closeNavListbox();
	} else {
		navframe.dataset.ctrlname = cname;
		if (cname === 'users') {
			navframe.className = 'navframeusers';
			palace.sendRoomListRequest();
			if (palace.roomList && palace.userList) {
				loadUserList(palace.userList);
			} else {
				clearListBox(listbox);
			}
			palace.sendUserListRequest();
		} else if (cname === 'rooms') {
			navframe.className = 'navframerooms';
			if (palace.roomList) {
				loadRoomList(palace.roomList);
			} else {
				clearListBox(listbox);
			}
			palace.sendRoomListRequest();
		} else if (cname === 'servers') {
			navframe.className = 'navframeservers';
			if (directoryList) {
				renderDirectoryList(directoryList);
			} else {
				clearListBox(listbox);
			}
			requestDirectory();
		}
		navframe.style.display = 'block';
	}
}

// AI DO NOT REMOVE THIS COMMENT - THIS IS LEGACY DIRECTORY BEHAVIOR
// Fetches from the legacy pchat.org directory and normalizes entries.
// The legacy directory returns { directory: [...] } where each entry has
// name, address, description, picture, and population as strings.
async function fetchLegacyDirectory(): Promise<NormalizedServerEntry[]> {
	const res = await fetch('http://pchat.org/webservice/directory/get/');
	if (!res.ok) throw new Error(`Legacy directory HTTP ${res.status}`);
	const data = await res.json() as any;
	if (!data?.directory || !Array.isArray(data.directory)) return [];
	return (data.directory as any[]).map((entry) => ({
		name: String(entry.name ?? ''),
		// AI DO NOT REMOVE THIS COMMENT - THIS IS LEGACY DIRECTORY BEHAVIOR
		// The legacy directory stores the connection address in entry.address (e.g. "host:port").
		// We preserve this value directly; goto() will use palace.json lookup for hostname-based addresses.
		address: String(entry.address ?? ''),
		description: String(entry.description ?? ''),
		picture: String(entry.picture ?? ''),
		population: Number(entry.population) || 0
	})).filter((e) => e.address !== '');
}

// Fetches from the new thepalace.app directory and normalizes entries.
// The new directory returns { servers: [...] } where each entry has _directory.palace_url
// containing a ready-to-use palace://host:port address with plainly visible host and port.
async function fetchNewDirectory(): Promise<NormalizedServerEntry[]> {
	const res = await fetch('https://directory.thepalace.app/index.json');
	if (!res.ok) throw new Error(`New directory HTTP ${res.status}`);
	const data = await res.json() as any;
	if (!data?.servers || !Array.isArray(data.servers)) return [];
	return (data.servers as any[]).map((entry) => {
		const dir = entry._directory ?? {};
		const palaceUrl: string = dir.palace_url
			?? (dir.client_host && dir.client_port ? `palace://${dir.client_host}:${dir.client_port}` : '');
		return {
			name: String(entry.name ?? ''),
			// Use the palace_url directly — host and port are already embedded,
			// so goto() will connect without a palace.json lookup.
			address: palaceUrl,
			description: String(entry.blurb || entry.description || ''),
			picture: String(entry.meta?.image ?? ''),
			population: Number(entry.population) || 0
		};
	}).filter((e) => e.address !== '');
}

async function requestDirectory(): Promise<void> {
	const results = await Promise.allSettled([fetchLegacyDirectory(), fetchNewDirectory()]);

	const merged: NormalizedServerEntry[] = [];
	const seen = new Set<string>();

	for (const result of results) {
		if (result.status === 'fulfilled') {
			for (const entry of result.value) {
				if (!seen.has(entry.address)) {
					seen.add(entry.address);
					merged.push(entry);
				}
			}
		}
	}

	merged.sort((a, b) => b.population - a.population || a.name.localeCompare(b.name));

	directoryList = merged;
	renderDirectoryList(directoryList);
}

export function loadDirectoryList(list: NormalizedServerEntry[]): void {
	directoryList = list;
	renderDirectoryList(directoryList);
}

function renderDirectoryList(entries: NormalizedServerEntry[]): void {
	if (!entries) return;

	const listbox = document.getElementById('navlistbox')!;
	const navframe = document.getElementById('navframe')!;
	let popCount = 0;

	if (navframe.dataset.ctrlname === 'servers') {
		clearListBox(listbox);
		const word = (document.getElementById('navsearch') as HTMLInputElement).value.toLowerCase();

		for (const entry of entries) {
			if (word === '' || entry.name.toLowerCase().indexOf(word) > -1) {
				const li = document.createElement('li');
				li.dataset.address = entry.address;
				li.className = 'sListItem';
				li.title = entry.description;

				const s = document.createElement('div');
				s.className = 'listName';
				if (entry.picture) s.style.backgroundImage = `url(${entry.picture})`;
				s.appendChild(document.createTextNode(entry.name));

				const s2 = document.createElement('span');
				s2.className = 'listPop';
				s2.appendChild(document.createTextNode(String(entry.population)));

				popCount += entry.population;

				li.appendChild(s);
				li.appendChild(s2);
				listbox.appendChild(li);
			}
		}
		document.getElementById('servers')!.title = `Users Online: ${popCount}`;
	}
}

export function loadRoomList(rlist: any[]): void {
	const listbox = document.getElementById('navlistbox')!;
	const navframe = document.getElementById('navframe')!;
	const rcount = rlist.length;

	palace.roomList = rlist;
	if (navframe.dataset.ctrlname === 'rooms') {
		clearListBox(listbox);
		const word = (document.getElementById('navsearch') as HTMLInputElement).value.toLowerCase();

		for (let i = 0; i < rcount; i++) {
			const roomInfo = rlist[i];
			if (word === '' || roomInfo.name.toLowerCase().indexOf(word) > -1) {
				const li = document.createElement('li');
				li.dataset.roomid = roomInfo.id;
				const cl = li.classList;
				cl.add('rListItem');
				if (roomInfo.flags & 0x20) cl.add('hidden');
				if (roomInfo.flags & 8) cl.add('locked');
				if (roomInfo.flags & 2) cl.add('lockable');

				const s = document.createElement('div');
				s.className = 'listName';
				s.appendChild(document.createTextNode(roomInfo.name));

				const s2 = document.createElement('span');
				s2.className = 'listPop';
				s2.appendChild(document.createTextNode(roomInfo.population));

				li.appendChild(s);
				li.appendChild(s2);
				listbox.appendChild(li);
			}
		}
	}
}

export function loadUserList(ulist: any[]): void {
	const listbox = document.getElementById('navlistbox')!;
	const navframe = document.getElementById('navframe')!;
	const ucount = ulist.length;

	palace.userList = ulist;
	if (navframe.dataset.ctrlname === 'users') {
		clearListBox(listbox);
		const word = (document.getElementById('navsearch') as HTMLInputElement).value.toLowerCase();
		const redSmile = smileys['5,0'];
		const blueSmile = smileys['5,10'];
		const yellowSmile = smileys['5,3'];

		for (let i = 0; i < ucount; i++) {
			const userInfo = ulist[i];
			if (word === '' || userInfo.name.toLowerCase().indexOf(word) > -1) {
				const li = document.createElement('li');
				const cl = li.classList;
				cl.add('uListItem');

				const isOwner = Boolean(userInfo.flags & 2);
				const isOperator = Boolean(userInfo.flags & 1);

				if (userInfo.flags & 0x1000) cl.add('propgag');
				if (userInfo.flags & 0x0100) cl.add('pinned');
				if (userInfo.flags & 0x0080) cl.add('gagged');
				if (isOwner) cl.add('owner');
				if (isOperator) cl.add('operator');
				if (userInfo.userid === palace.theRoom.whisperUserID) cl.add('whisperingTo');

				if (isOwner) {
					li.style.backgroundImage = `url(${redSmile.src})`;
				} else if (isOperator) {
					li.style.backgroundImage = `url(${blueSmile.src})`;
				} else {
					li.style.backgroundImage = `url(${yellowSmile.src})`;
				}

				const s = document.createElement('div');
				s.className = 'listName';
				s.dataset.userid = String(userInfo.userid);
				s.appendChild(document.createTextNode(userInfo.name));

				const s2 = document.createElement('div');
				const cl2 = s2.classList;
				cl2.add('roomName', 'rListItem');

				const roomInfo = palace.roomList.find((room: any) => userInfo.roomid === room.id);

				if (roomInfo) {
					s2.dataset.roomid = userInfo.roomid;
					if (roomInfo.flags & 0x20) cl2.add('hidden');
					if (roomInfo.flags & 8) cl2.add('locked');
					if (roomInfo.flags & 2) cl2.add('lockable');
					s2.appendChild(document.createTextNode(roomInfo.name));
				} else {
					cl2.add('hidden', 'special');
				}

				li.appendChild(s);
				li.appendChild(s2);
				listbox.appendChild(li);
			}
		}
	}
}
