import { palace, smileys } from './state.js';
import { showConfirmDialog, showPromptDialog } from './utility.js';
import { prefs, setGeneralPref } from './preferences.js';
import { selectedBagProps, setSelectedBagProps, propBagSet, refreshPropBagView, deletePropsFromDB, createNewProps, saveProp, getActiveCategory, removePropsFromCategory, renderCategoryBar, propBagDB, PalaceProp, propBagCategories } from './props.js';
import { IptEngine } from './client.js';
import { getAdminPasswords, setAdminPasswords, deleteAdminPassword } from './client.js';
import { PalaceExecutionContext } from './iptscrae/index.js';
import { IptscraEditor } from './iptscrae-editor.js';
import { CyborgEngine } from './iptscrae/cyborgEngine.js';
import { toggleNavListbox, closeNavListbox, loadUserList, loadRoomList, loadDirectoryList, getDirectoryList } from './navigation.js';
import { openPropEditor } from './prop-editor.js';

export let logField = document.getElementById('log')!;
export let viewScale = 1;
let viewScaleTimer: ReturnType<typeof setTimeout> | null = null;
const keysDown: boolean[] = [];
export let escapeHeld = false;
let lastActivity = Date.now();
let idleFired = false;
const IDLE_THRESHOLD = 600000; // 10 minutes

export function getIdleSeconds(): number {
	return ((Date.now() - lastActivity) / 1000) | 0;
}

function resetActivity(): void {
	lastActivity = Date.now();
	idleFired = false;
}

setInterval(() => {
	if (!idleFired && palace && palace.theRoom && (Date.now() - lastActivity) >= IDLE_THRESHOLD) {
		idleFired = true;
		palace.theRoom.executeEvent('IDLE');
	}
}, 5000);

{
	const activityReset = () => resetActivity();
	window.addEventListener('mousemove', activityReset, true);
	window.addEventListener('mousedown', activityReset, true);
	window.addEventListener('keydown', activityReset, true);

	// Initialize Coloris color picker (must defer to DOMContentLoaded since
	// Coloris queues its DOM setup there, and modules run before that event)
	document.addEventListener('DOMContentLoaded', () => {
		(window as any).Coloris({
			el: '[data-coloris]',
			theme: 'default',
			themeMode: 'dark',
			alpha: true,
			format: 'rgb',
			formatToggle: false,
			wrap: false,
			margin: 6,
		});

		// Toggle Coloris: clicking the same swatch again closes the picker.
		// mousedown detects the toggle-close case before the click event,
		// then click capture eats the event so Coloris doesn't reopen.
		let colorisActiveInput: Element | null = null;
		let colorisClosing = false;

		const animateColorisClose = () => {
			const picker = document.getElementById('clr-picker');
			if (!picker) return;
			picker.classList.add('clr-closing');
			picker.addEventListener('animationend', () => {
				picker.classList.remove('clr-closing');
				(window as any).Coloris.close();
			}, { once: true });
		};

		document.addEventListener('mousedown', (e) => {
			const target = (e.target as HTMLElement).closest('[data-coloris]');
			if (!target) {
				// Click outside: animate close if picker is open
				const picker = document.getElementById('clr-picker');
				if (picker?.classList.contains('clr-open') && !(e.target as HTMLElement).closest('#clr-picker,.clr-picker')) {
					colorisClosing = true;
					animateColorisClose();
					colorisActiveInput = null;
					e.stopImmediatePropagation();
				}
				return;
			}
			const picker = document.getElementById('clr-picker');
			if (picker?.classList.contains('clr-open') && colorisActiveInput === target) {
				colorisClosing = true;
				animateColorisClose();
				colorisActiveInput = null;
			}
		}, true);

		document.addEventListener('click', (e) => {
			if (colorisClosing) {
				colorisClosing = false;
				e.stopImmediatePropagation();
				e.preventDefault();
				return;
			}
			const target = (e.target as HTMLElement).closest('[data-coloris]');
			if (!target) return;
			colorisActiveInput = target;
			// Set transform-origin so the picker scales from the input
			requestAnimationFrame(() => {
				const picker = document.getElementById('clr-picker');
				if (!picker) return;
				const pr = picker.getBoundingClientRect();
				const ir = target.getBoundingClientRect();
				const ox = (ir.left + ir.width / 2) - pr.left;
				const oy = (ir.top + ir.height / 2) - pr.top;
				picker.style.transformOrigin = `${ox}px ${oy}px`;
			});
		}, true);
	});

	// certain elements shouldn't accept focus!
	let items: HTMLCollectionOf<HTMLElement> = document.getElementsByTagName('button');
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		item.tabIndex = -1;
		item.onfocus = function () { item.blur(); };
	}
	const inputs = document.getElementsByTagName('input');
	for (let i = 0; i < inputs.length; i++) {
		const item = inputs[i];
		if (item.type !== 'text' && item.type) {
			item.tabIndex = -1;
		}
	}

	const preventFileDrop = (event: DragEvent) => {
		event.preventDefault();
		event.dataTransfer!.effectAllowed = 'none';
		event.dataTransfer!.dropEffect = 'none';
	};
	window.addEventListener('dragover', preventFileDrop);
	window.addEventListener('drop', preventFileDrop);

	document.getElementById('submitauthenticate')!.onclick = () => {
		palace.sendAuthenticate(
			(document.getElementById('authusername') as HTMLInputElement).value,
			(document.getElementById('authpassword') as HTMLInputElement).value
		);
		toggleZoomPanel('authenticate');
	};

	const chatbox = document.getElementById('chatbox')!;
	const charCount = document.getElementById('chatbar-charcount')!;
	const hintsPanel = document.getElementById('chatbar-hints')!;
	const whisperClose = document.getElementById('chatbar-whisper-close')!;

	whisperClose.onclick = () => {
		if (palace.theRoom?.whisperUserID) palace.theRoom.exitWhisperMode();
	};

	const CHAT_COMMANDS = [
		{ cmd: '~name', desc: 'Change your username' },
		{ cmd: '~op', desc: 'Request operator access' },
		{ cmd: '~susr', desc: 'Super user login' },
		{ cmd: '~clean', desc: 'Clear room drawings & loose props' },
		{ cmd: '~address', desc: 'Show server address' },
		{ cmd: '~pid', desc: 'List worn prop IDs' },
		{ cmd: '~catpids', desc: 'List prop IDs in active category' },
		{ cmd: '/', desc: 'Execute Iptscrae script' },
	];

	let hintIndex = -1;

	function getChatText(): string {
		return chatbox.textContent || '';
	}

	function setChatText(text: string): void {
		chatbox.textContent = text;
		// Move cursor to end
		const range = document.createRange();
		const sel = window.getSelection()!;
		if (chatbox.childNodes.length > 0) {
			range.setStartAfter(chatbox.lastChild!);
		} else {
			range.setStart(chatbox, 0);
		}
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
	}

	function updateCharCount(): void {
		const len = [...getChatText()].length;
		if (len > 200) {
			charCount.textContent = `${len}/250`;
			charCount.classList.remove('chatbar-hidden');
			charCount.classList.toggle('warn', len >= 200 && len < 240);
			charCount.classList.toggle('limit', len >= 240);
		} else {
			charCount.classList.add('chatbar-hidden');
		}
	}

	function updateHints(): void {
		const text = getChatText();
		if (text.length > 0 && (text[0] === '~' || text[0] === '/')) {
			const matches = CHAT_COMMANDS.filter(c => c.cmd.startsWith(text.split(' ')[0]));
			if (matches.length > 0 && text.split(' ').length < 2) {
				hintsPanel.innerHTML = '';
				matches.forEach((m, i) => {
					const item = document.createElement('div');
					item.className = 'chatbar-hint-item';
					if (i === hintIndex) item.classList.add('active');
					item.innerHTML = `<span class="chatbar-hint-cmd">${m.cmd}</span><span class="chatbar-hint-desc">${m.desc}</span>`;
					item.onmousedown = (e) => {
						e.preventDefault();
						setChatText(m.cmd + ' ');
						hintsPanel.classList.add('chatbar-hidden');
						hintIndex = -1;
					};
					hintsPanel.appendChild(item);
				});
				hintsPanel.classList.remove('chatbar-hidden');
				return;
			}
		}
		hintsPanel.classList.add('chatbar-hidden');
		hintIndex = -1;
	}

	chatbox.addEventListener('input', () => {
		updateCharCount();
		updateHints();
	});

	chatbox.addEventListener('paste', (e: Event) => {
		e.preventDefault();
		const clipEvent = e as ClipboardEvent;
		const text = clipEvent.clipboardData?.getData('text/plain') || '';
		document.execCommand('insertText', false, text);
	});

	chatbox.onkeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			if (palace.theRoom?.whisperUserID) {
				palace.theRoom.exitWhisperMode();
				event.preventDefault();
			}
			if (!hintsPanel.classList.contains('chatbar-hidden')) {
				hintsPanel.classList.add('chatbar-hidden');
				hintIndex = -1;
				event.preventDefault();
			}
			return;
		}

		// Navigate hints with arrow keys
		if (!hintsPanel.classList.contains('chatbar-hidden')) {
			const items = hintsPanel.querySelectorAll('.chatbar-hint-item');
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				hintIndex = Math.min(hintIndex + 1, items.length - 1);
				items.forEach((el, i) => el.classList.toggle('active', i === hintIndex));
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				hintIndex = Math.max(hintIndex - 1, 0);
				items.forEach((el, i) => el.classList.toggle('active', i === hintIndex));
				return;
			}
			if (event.key === 'Tab' && hintIndex >= 0) {
				event.preventDefault();
				const cmd = CHAT_COMMANDS.filter(c => c.cmd.startsWith(getChatText().split(' ')[0]))[hintIndex];
				if (cmd) {
					setChatText(cmd.cmd + ' ');
					hintsPanel.classList.add('chatbar-hidden');
					hintIndex = -1;
				}
				return;
			}
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			let chat = getChatText();
			if (chat.length > 0) {
				const chatCmd = chat.match(/^~([^ ]+)\s{0,1}(.*)$/);
				if (chatCmd && chatCmd.length > 2) {
					switch (chatCmd[1]) {
						case 'removemelater':
							palace.theUserStatus = 0x0002;
							updateAdminGlow();
							break;
						case 'op':
						case 'susr':
							palace.sendOperatorRequest(chatCmd[2]);
							break;
						case 'clean':
							palace.sendDrawClear(3);
							palace.sendPropDelete(-1);
							break;
						case 'name': {
							const newName = chatCmd[2]?.trim();
							if (newName) {
								palace.sendUserName(newName);
								setGeneralPref('userName', newName);
							} else {
								showPromptDialog('Enter new username:', palace.theUser?.name || '').then((name: string | null) => {
									if (name) {
										palace.sendUserName(name);
										setGeneralPref('userName', name);
									}
								});
							}
							break;
						}
						case 'address':
							logmsg(`${palace.ip}:${palace.port}`);
							break;
						case 'pid':
							if (palace.theUser?.props?.length > 0) {
								logmsg(palace.theUser.props.join(' '));
							} else {
								logmsg('No props worn.');
							}
							break;
						case 'catpids': {
							const catId = getActiveCategory();
							if (catId) {
								const cat = propBagCategories.find(c => c.id === catId);
								if (cat && cat.props.length > 0) {
									logmsg(cat.props.join(' '));
								} else {
									logmsg('Category is empty.');
								}
							} else {
								logmsg('No category selected.');
							}
							break;
						}
						default:
							break;
					}
				} else if (chat.charAt(0) === '/') {
					if (escapeHeld) { logmsg('Script halted by user.'); return; }
					if (palace.debugMode) console.log(`Executing IPT command: ${chat.slice(1)}`);
					IptEngine.execute(chat.slice(1));
				} else if (palace.theRoom) {
					const result = palace.theRoom.executeSyncEventWithChatStr('OUTCHAT', (ctx: PalaceExecutionContext) => {
						ctx.whoChatId = palace.theUserID;
						ctx.chatStr = chat;
					});
					if (result !== null) chat = result;
					while (chat.length > 0) {
						const chars = [...chat];
						const seg = chars.slice(0, 250).join('');
						chat = chars.slice(250).join('');
						if (palace.theRoom.whisperUserID) {
							palace.sendWhisper(seg, palace.theRoom.whisperUserID);
						} else {
							palace.sendXtlk(seg);
						}
					}
				}
				chatbox.textContent = '';
				updateCharCount();
				hintsPanel.classList.add('chatbar-hidden');
				hintIndex = -1;
			}
		}
	};

	const propBag = document.getElementById('props')!;

	document.getElementById('deleteprops')!.onclick = async () => {
		const catId = getActiveCategory();
		if (catId) {
			removePropsFromCategory(catId, selectedBagProps);
			renderCategoryBar();
		} else {
			if (!await showConfirmDialog(`Delete ${selectedBagProps.length} prop${selectedBagProps.length > 1 ? 's' : ''} permanently?`)) return;
			deletePropsFromDB(selectedBagProps);
		}
		setSelectedBagProps([]);
		refreshPropBagView(true);
		setPropButtons();
		enablePropButtons();
	};

	document.getElementById('editprop')!.onclick = () => {
		if (selectedBagProps.length > 0) {
			const pid = selectedBagProps[0];
			const store = propBagDB.transaction("props", "readonly").objectStore("props");
			const get = store.get(pid);
			get.onsuccess = () => {
				const prop = new PalaceProp(pid, get.result);
				if (prop) {
					if (prop.isComplete) {
						openPropEditor(prop);
					} else {
						prop.img.addEventListener('load', () => openPropEditor(prop), { once: true });
					}
				}
			};
		}
	};

	const savepropEl = document.getElementById('saveprop') as HTMLButtonElement;
	savepropEl.onclick = function () {
		const pids: any[] = [];
		for (let i = palace.theUser.props.length; --i >= 0;) {
			pids.push(palace.theUser.props[i]);
		}
		saveProp(pids);
		savepropEl.disabled = true;
	};

	document.body.onresize = () => {
		if (logField.dataset.state === '1') logField.scrollTop = logField.scrollHeight - logField.clientHeight;
		if (propBag.dataset.state === '1') refreshPropBagView();
		scale2Fit();
	};

	window.addEventListener('keypress', (keyboard: KeyboardEvent) => {
		const el = document.activeElement as HTMLElement;
		if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.contentEditable !== 'true' && !keyboard.metaKey && !keyboard.ctrlKey) {
			chatbox.focus();
		}
	}, false);

	document.body.onkeyup = (keyboard: KeyboardEvent) => {
		if (keyboard.keyCode > 36 && keyboard.keyCode < 41) keysDown[keyboard.keyCode] = false;
	};

	let spotMoveTimer: ReturnType<typeof setTimeout> | null = null;

	document.body.onkeydown = (keyboard: KeyboardEvent) => {
		if (keyboard.key === 'Tab') {
			keyboard.preventDefault();
			if (document.activeElement === chatbox) {
				chatbox.blur();
			} else {
				chatbox.focus();
			}
			return;
		}
		if (document.activeElement!.nodeName === 'BODY' && !keyboard.metaKey && !keyboard.ctrlKey) {
			let x = 0;
			let y = 0;

			if (keyboard.keyCode > 36 && keyboard.keyCode < 41) {
				keysDown[keyboard.keyCode] = true;
				keyboard.preventDefault();
			}

			const room = palace?.theRoom;
			if (room && room.authoring && room.selectedSpot) {
				const m = 1;//keyboard.altKey ? 1 : 4;
				if (keysDown[37]) x = -m;
				if (keysDown[38]) y = -m;
				if (keysDown[39]) x = m;
				if (keysDown[40]) y = m;
				if (x !== 0 || y !== 0) {
					room.selectedSpot.x += x;
					room.selectedSpot.y += y;
					room.setSpotNameTag(room.selectedSpot);
					room.refresh();
					room.refreshTop();
					if (spotMoveTimer) clearTimeout(spotMoveTimer);
					spotMoveTimer = setTimeout(() => { spotMoveTimer = null; palace.sendRoomSetDesc(); }, 2000);
				}
			} else {
				const m = keyboard.altKey ? 1 : 4;
				if (keysDown[37]) x = -m;
				if (keysDown[38]) y = -m;
				if (keysDown[39]) x = m;
				if (keysDown[40]) y = m;
				if (palace) palace.move(x, y);
			}
		}
	};

	window.addEventListener('keyup', (e: KeyboardEvent) => {
		if (e.key === 'Escape') escapeHeld = false;
		if (palace && palace.theRoom && palace.theRoom.hideUserNames && !platformCtrlKey(e) && !e.altKey) {
			palace.theRoom.hideUserNames = false;
			palace.theRoom.toggleUserNames(true);
		}
	}, true);

	window.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			escapeHeld = true;
			closeNavListbox();
			if (palace?.theRoom) {
				const wasRunning = CyborgEngine.running || IptEngine.running;
				// ESC always halts cyborg scripts
				CyborgEngine.abort();
				// ESC halts room scripts if noUserScripts is off
				if (!palace.theRoom.noUserScripts) {
					IptEngine.abort();
				}
				if (wasRunning) {
					logmsg('Script halted by user.');
				}
			}
		}
	}, true);

	window.addEventListener('blur', () => {
		escapeHeld = false;
	});

	window.addEventListener('keydown', (e: KeyboardEvent) => {
		if (platformCtrlKey(e)) {
			if (e.altKey && palace && palace.theRoom && !palace.theRoom.hideUserNames) {
				palace.theRoom.hideUserNames = true;
				palace.theRoom.toggleUserNames(false);
			}
			switch (e.key) {
				case 'd':
					(document.getElementById('servers') as HTMLButtonElement).click();
					break;
				case 'g':
					(document.getElementById('rooms') as HTMLButtonElement).click();
					break;
				case 'f':
					if (document.activeElement !== document.getElementById('ipteditor-textarea')) {
						(document.getElementById('users') as HTMLButtonElement).click();
					}
					break;
			}
		}
	}, true);

	document.getElementById('authenticate')!.onkeydown = (event: KeyboardEvent) => {
		if (event.keyCode === 13) {
			document.getElementById('submitauthenticate')!.click();
		}
	};

	document.getElementById('muteaudio')!.onclick = () => {
		palace.muteAllMedia(!palace.mediaMuted);
	};

	document.getElementById('authoringbtn')!.onclick = () => {
		const room = palace.theRoom;
		if (!room || !(palace.isOperator || palace.isOwner)) return;
		if (!room.authoring && (room.flags & 0x0001) && (room as any).password) {
			logmsg('This room is locked and cannot be authored.');
			return;
		}
		room.authoring = !room.authoring;
		if (room.authoring) {
			for (let i = room.spots.length - 1; i >= 0; i--) {
				const s = room.spots[i] as any;
				if (s._addedByScript) {
					if (s.img?.parentNode) s.img.parentNode.removeChild(s.img);
					if (s.webEmbed?.parentNode) s.webEmbed.parentNode.removeChild(s.webEmbed);
					room.spots.splice(i, 1);
				}
			}
		}
		if (!room.authoring) room.selectedSpot = null;
		logmsg(room.authoring ? 'Authoring mode enabled.' : 'Authoring mode disabled.');
		room.refreshTop();
	};

	const serverConnectField = document.getElementById('palaceserver')!;
	let serverFieldHovered = false;
	let hoverFadeTimer: ReturnType<typeof setTimeout> | null = null;
	const fadeSwapText = (newText: string) => {
		if (hoverFadeTimer) { clearTimeout(hoverFadeTimer); hoverFadeTimer = null; }
		serverConnectField.style.opacity = '0';
		hoverFadeTimer = setTimeout(() => {
			serverConnectField.innerText = newText;
			serverConnectField.style.opacity = '1';
			hoverFadeTimer = null;
		}, 250);
	};
	serverConnectField.onmouseenter = function () {
		serverFieldHovered = true;
		if (document.activeElement !== serverConnectField) {
			fadeSwapText(`${palace.ip}:${palace.port}`.replace(':9998', ''));
		}
	};
	serverConnectField.onmouseleave = function () {
		serverFieldHovered = false;
		if (document.activeElement !== serverConnectField) {
			fadeSwapText(palace.servername);
		}
	};
	serverConnectField.onfocus = function () {
		if (hoverFadeTimer) { clearTimeout(hoverFadeTimer); hoverFadeTimer = null; }
		serverConnectField.style.opacity = '1';
		serverConnectField.contentEditable = 'true';
		serverConnectField.innerText = `${palace.ip}:${palace.port}`.replace(':9998', '');

		const selection = window.getSelection()!;
		const range = document.createRange();
		range.selectNodeContents(serverConnectField);
		selection.removeAllRanges();
		selection.addRange(range);
	};
	serverConnectField.onmousedown = function (event: MouseEvent) {
		if (document.activeElement !== serverConnectField) {
			serverConnectField.focus();
			event.preventDefault();
		}
	};
	serverConnectField.onblur = function () {
		serverConnectField.innerText = serverFieldHovered
			? `${palace.ip}:${palace.port}`.replace(':9998', '')
			: palace.servername;
		serverConnectField.contentEditable = 'false';
		if (window.getSelection) {
			window.getSelection()!.removeAllRanges();
		}
	};
	serverConnectField.onkeydown = (event: KeyboardEvent) => {
		if (event.keyCode === 13) {
			palace.goto((event.currentTarget as HTMLElement).innerText);
			palace.servername = '';
			(event.currentTarget as HTMLElement).blur();
			return true;
		}
	};

	const toggleNav = function (this: unknown, event: MouseEvent) {
		toggleNavListbox((event.currentTarget as HTMLElement).id);
	};
	document.getElementById('users')!.onclick = toggleNav;
	document.getElementById('rooms')!.onclick = toggleNav;
	document.getElementById('servers')!.onclick = toggleNav;

	document.getElementById('navsearch')!.oninput = () => {
		switch (document.getElementById('navframe')!.dataset.ctrlname) {
			case 'users':
				loadUserList(palace.userList);
				break;
			case 'rooms':
				loadRoomList(palace.roomList);
				break;
			case 'servers': {
				const dl = getDirectoryList();
				if (dl) loadDirectoryList(dl);
				break;
			}
		}
	};

	document.getElementById('navlistbox')!.onclick = (event: MouseEvent) => {
		const lb = document.getElementById('navlistbox')!;
		const type = lb.parentElement!.dataset.ctrlname!;
		let t = event.target as HTMLElement;
		if (t.nodeName !== 'LI' && type !== 'users') t = t.parentNode as HTMLElement;

		if (t.dataset.userid) {
			palace.theRoom.enterWhisperMode(Number(t.dataset.userid), t.innerText);
			toggleNavListbox(type);
		} else if (t.dataset.roomid) {
			palace.gotoroom(Number(t.dataset.roomid));
			toggleNavListbox(type);
		} else if (t.dataset.address) {
			palace.goto(t.dataset.address);
			toggleNavListbox(type);
		}
	};

	const logHandle = document.createElement('div');
	logHandle.className = 'sidepanel-handle';
	logField.prepend(logHandle);

	logHandle.onmousedown = function (event: MouseEvent) {
		event.preventDefault();
		const initialX = event.pageX - window.scrollX;
		const initialW = logField.offsetWidth;
		const dragOverlay = document.createElement('div');
		dragOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;';
		document.body.appendChild(dragOverlay);

		const mouseMoveLog = (event: MouseEvent) => {
			logField.style.pointerEvents = 'none';
			palace.container.classList.add('dragging');
			event.stopImmediatePropagation();
			const w = initialX - event.x + initialW;
			chatLogScrollLock(() => {
				logField.style.width = `${w}px`;
			});
			setBodyWidth();
			setGeneralPref('chatLogWidth', w);
			scale2Fit();
		};

		const mouseUpLog = (event: MouseEvent) => {
			event.preventDefault();
			logField.style.pointerEvents = '';
			palace.container.classList.remove('dragging');
			dragOverlay.remove();
			window.removeEventListener('mouseup', mouseUpLog, true);
			window.removeEventListener('mousemove', mouseMoveLog, true);
		};

		window.addEventListener('mouseup', mouseUpLog, true);
		window.addEventListener('mousemove', mouseMoveLog, true);
	};

	// ─── Chat log context menu ───
	let chatLogStreaming = false;
	setTimeout(() => { chatLogStreaming = prefs.general.chatLogStreaming === true; }, 0);

	logField.addEventListener('contextmenu', (e: MouseEvent) => {
		e.preventDefault();
		(async () => {
			const selection = window.getSelection();
			const selectedText = selection?.toString().trim() || '';
			const hasSelection = selectedText.length > 0;
			const searchLabel = hasSelection
				? `Search Google for "${selectedText.length > 30 ? selectedText.slice(0, 30) + '…' : selectedText}"`
				: 'Search Google';
			const menuIndex = await (window.apiBridge.openContextMenu as any)({
				x: Math.round(e.clientX),
				y: Math.round(e.clientY),
				items: [
					{ id: 0, label: 'Copy', type: 'normal', enabled: hasSelection },
					{ id: 1, label: 'Select All', type: 'normal', enabled: true },
					{ type: 'separator' },
					{ id: 5, label: searchLabel, type: 'normal', enabled: hasSelection },
					{ type: 'separator' },
					{ id: 2, label: 'Clear Log', type: 'normal', enabled: true },
					{ type: 'separator' },
					{ id: 3, label: 'Stream log to file', type: 'checkbox', checked: chatLogStreaming, enabled: true },
					{ id: 4, label: 'Chat Log Archive...', type: 'normal', enabled: true },
				]
			}) as number | undefined;
			switch (menuIndex) {
				case 0: document.execCommand('copy'); break;
				case 1: {
					const range = document.createRange();
					range.selectNodeContents(logField);
					const sel = window.getSelection()!;
					sel.removeAllRanges();
					sel.addRange(range);
					break;
				}
				case 2: logField.innerHTML = ''; break;
				case 3: chatLogStreaming = !chatLogStreaming;
					setGeneralPref('chatLogStreaming', chatLogStreaming);
					logmsg(chatLogStreaming ? 'Chat log streaming enabled.' : 'Chat log streaming disabled.');
					break;
				case 4: window.apiBridge.openChatArchive(); break;
				case 5: window.apiBridge.launchHyperLink(`https://www.google.com/search?q=${encodeURIComponent(selectedText)}`); break;
			}
		})();
	});

	// ─── Chat log streaming (write appended entries to file) ───
	let streamingRoomId: number | null = null;
	const logObserver = new MutationObserver((mutations) => {
		if (!chatLogStreaming) return;
		const server = palace.servername;
		if (!server) return;
		const room = palace.theRoom;
		if (!room || room.id < 0) return;
		// Log room change header
		if (room.id !== streamingRoomId) {
			streamingRoomId = room.id;
			window.apiBridge.chatLogWrite(server, `<div class="room-header">${room.name || 'Unknown'} #${room.id}</div>`);
		}
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node instanceof HTMLElement) {
					window.apiBridge.chatLogWrite(server, node.outerHTML);
				}
			}
		}
	});
	logObserver.observe(logField, { childList: true });

	document.getElementById('preferences')!.onclick = () => {
		// Snapshot current values before opening
		const prefEls = {
			username: document.getElementById('prefusername') as HTMLInputElement,
			home: document.getElementById('prefhomepalace') as HTMLInputElement,
			viewfitscale: document.getElementById('prefviewfitscale') as HTMLInputElement,
			viewscaleall: document.getElementById('prefviewscaleall') as HTMLInputElement,
			disablesounds: document.getElementById('prefdisablesounds') as HTMLInputElement,
			autoplayvideos: document.getElementById('prefautoplayvideos') as HTMLInputElement,
			shownametags: document.getElementById('prefshownametags') as HTMLInputElement,
			iptdebug: document.getElementById('prefiptdebug') as HTMLInputElement,
			debugmode: document.getElementById('prefdebugmode') as HTMLInputElement,
			rclickslide: document.getElementById('prefrclickslide') as HTMLInputElement,
			updatechannel: document.getElementById('prefupdatechannel') as HTMLSelectElement,
			updatenotify: document.getElementById('prefupdatenotify') as HTMLInputElement,
			updateurl: document.getElementById('prefupdateurl') as HTMLInputElement,
		};
		const snapshot = {
			username: prefEls.username.value,
			home: prefEls.home.value,
			viewfitscale: prefEls.viewfitscale.checked,
			viewscaleall: prefEls.viewscaleall.checked,
			disablesounds: prefEls.disablesounds.checked,
			autoplayvideos: prefEls.autoplayvideos.checked,
			shownametags: prefEls.shownametags.checked,
			iptdebug: prefEls.iptdebug.checked,
			debugmode: prefEls.debugmode.checked,
			rclickslide: prefEls.rclickslide.checked,
			updatechannel: prefEls.updatechannel.value,
			updatenotify: prefEls.updatenotify.checked,
			updateurl: prefEls.updateurl.value,
		};
		toggleZoomPanel('prefs');
		// Wire OK/Cancel only while open
		const okBtn = document.getElementById('prefok')!;
		const cancelBtn = document.getElementById('prefcancel')!;
		const close = () => { toggleZoomPanel('prefs', 0); okBtn.onclick = null; cancelBtn.onclick = null; };
		okBtn.onclick = () => {
			palace.sendUserName(prefEls.username.value);
			setGeneralPref('userName', prefEls.username.value);
			setGeneralPref('home', prefEls.home.value);
			setGeneralPref('viewScales', prefEls.viewfitscale.checked);
			setGeneralPref('viewScaleAll', prefEls.viewscaleall.checked);
			scale2Fit();
			setGeneralPref('disableSounds', prefEls.disablesounds.checked);
			setGeneralPref('autoplayvideos', prefEls.autoplayvideos.checked);
			setGeneralPref('shownametags', prefEls.shownametags.checked);
			setGeneralPref('iptDebug', prefEls.iptdebug.checked);
			IptEngine.debugMode = prefEls.iptdebug.checked;
			CyborgEngine.debugMode = prefEls.iptdebug.checked;
			setGeneralPref('debugMode', prefEls.debugmode.checked);
			palace.debugMode = prefEls.debugmode.checked;
			setGeneralPref('rClickSlide', prefEls.rclickslide.checked);
			setGeneralPref('updateChannel', prefEls.updatechannel.value);
			setGeneralPref('updateNotifications', prefEls.updatenotify.checked);
			setGeneralPref('updateManifestUrl', prefEls.updateurl.value.trim());
			close();
		};
		cancelBtn.onclick = () => {
			prefEls.username.value = snapshot.username;
			prefEls.home.value = snapshot.home;
			prefEls.viewfitscale.checked = snapshot.viewfitscale;
			prefEls.viewscaleall.checked = snapshot.viewscaleall;
			prefEls.disablesounds.checked = snapshot.disablesounds;
			prefEls.autoplayvideos.checked = snapshot.autoplayvideos;
			prefEls.shownametags.checked = snapshot.shownametags;
			prefEls.iptdebug.checked = snapshot.iptdebug;
			prefEls.debugmode.checked = snapshot.debugmode;
			prefEls.rclickslide.checked = snapshot.rclickslide;
			prefEls.updatechannel.value = snapshot.updatechannel;
			prefEls.updatenotify.checked = snapshot.updatenotify;
			prefEls.updateurl.value = snapshot.updateurl;
			close();
		};
	};

	// Preferences tab switching
	document.querySelectorAll('.pref-tab-btn').forEach((btn) => {
		(btn as HTMLElement).onclick = () => {
			document.querySelectorAll('.pref-tab-btn').forEach(b => b.classList.remove('active'));
			document.querySelectorAll('.pref-tab-pane').forEach(p => (p as HTMLElement).style.display = 'none');
			btn.classList.add('active');
			const pane = document.querySelector(`.pref-tab-pane[data-pref-pane="${(btn as HTMLElement).dataset.prefTab}"]`) as HTMLElement;
			if (pane) pane.style.display = '';
		};
	});

	// "Check Now" button in Updates prefs pane
	(async () => {
		const versionLabel = document.getElementById('prefcurrentversion') as HTMLSpanElement;
		const checkBtn = document.getElementById('prefcheckupdates') as HTMLButtonElement;
		versionLabel.textContent = await window.apiBridge.getAppVersion();
		checkBtn.onclick = async () => {
			const channelEl = document.getElementById('prefupdatechannel') as HTMLSelectElement;
			const urlEl     = document.getElementById('prefupdateurl') as HTMLInputElement;
			const channel   = channelEl.value;
			const manifestUrl = urlEl.value.trim() || undefined;
			checkBtn.disabled = true;
			checkBtn.textContent = 'Checking…';
			try {
				const result = await (window.apiBridge as any).checkForUpdates(channel, manifestUrl);
				if (result?.updateAvailable) {
					// Close prefs and show the banner
					(document.getElementById('prefscheckbox') as HTMLInputElement).checked = false;
					const banner     = document.getElementById('update-banner') as HTMLElement;
					const versionEl  = document.getElementById('update-version') as HTMLElement;
					const nowBtn     = document.getElementById('update-now-btn') as HTMLButtonElement;
					const progressEl = document.getElementById('update-progress') as HTMLElement;
					versionEl.textContent = result.latestVersion;
					banner.dataset.downloadUrl = result.downloadUrl ?? '';
					nowBtn.style.display = result.downloadUrl ? '' : 'none';
					progressEl.style.display = 'none';
					banner.style.display = '';
				} else {
					checkBtn.textContent = 'Up to date';
					setTimeout(() => { checkBtn.textContent = 'Check Now'; checkBtn.disabled = false; }, 2500);
					return;
				}
			} catch {
				checkBtn.textContent = 'Error';
				setTimeout(() => { checkBtn.textContent = 'Check Now'; checkBtn.disabled = false; }, 2500);
				return;
			}
			checkBtn.textContent = 'Check Now';
			checkBtn.disabled = false;
		};
	})();

	// Update banner wiring
	document.getElementById('update-dismiss')!.onclick = () => {
		(document.getElementById('update-banner') as HTMLElement).style.display = 'none';
	};
	document.getElementById('update-now-btn')!.onclick = async () => {
		const banner = document.getElementById('update-banner') as HTMLElement;
		const nowBtn = document.getElementById('update-now-btn') as HTMLButtonElement;
		const progressEl = document.getElementById('update-progress') as HTMLElement;
		nowBtn.style.display = 'none';
		progressEl.style.display = '';
		const url = banner.dataset.downloadUrl ?? '';
		(window.apiBridge as any).onUpdateProgress((pct: number) => {
			progressEl.textContent = `Downloading… ${pct}%`;
		});
		await (window.apiBridge as any).downloadAndApplyUpdate(url);
	};

	const iptEditor = new IptscraEditor();
	document.getElementById('ipteditorbutton')!.onclick = () => {
		iptEditor.toggle();
	};

	let adminMenuClosedAt = 0;
	document.getElementById('adminmenu')!.onclick = () => {
		if (!palace.theRoom) return;
		if (Date.now() - adminMenuClosedAt < 300) return;
		const isOp = palace.isOperator || palace.isOwner;
		const room = palace.theRoom;
		const hasSelectedSpot = room.selectedSpot != null;
		const btn = document.getElementById('adminmenu')!;
		const rect = btn.getBoundingClientRect();
		(async () => {
			const menuIndex = await (window.apiBridge.openContextMenu as any)({
				x: Math.round(rect.left),
				y: Math.round(rect.bottom),
				items: [
					{ id: 0, label: "Admin Mode...", type: "normal", enabled: true },
					{ type: "separator" },
					{ id: 1, label: "New Room", type: "normal", enabled: isOp },
					{ id: 2, label: "Room Info", type: "normal", enabled: isOp },
					{ type: "separator" },
					{ id: 3, label: "New Door", type: "normal", enabled: isOp },
					{ id: 4, label: "Door Info...", type: "normal", enabled: isOp && hasSelectedSpot },
					{ id: 5, label: "Door Layers", type: "normal", enabled: isOp && hasSelectedSpot, submenu: [
						{ id: 50, label: "Move to Bottom", type: "normal", enabled: true },
						{ id: 51, label: "Move Backward", type: "normal", enabled: true },
						{ id: 52, label: "Move Forward", type: "normal", enabled: true },
						{ id: 53, label: "Move to Top", type: "normal", enabled: true }
					]},
					{ id: 6, label: "Rotate Door", type: "normal", enabled: isOp && hasSelectedSpot, submenu: [
						{ id: 60, label: "0°", type: "normal", enabled: true },
						{ id: 61, label: "90°", type: "normal", enabled: true },
						{ id: 62, label: "180°", type: "normal", enabled: true },
						{ id: 63, label: "270°", type: "normal", enabled: true }
					]},
					{ type: "separator" },
					{ id: 7, label: "Authoring", type: "checkbox", enabled: isOp, checked: room.authoring || false, accelerator: "CmdOrCtrl+Shift+A" },
					{ id: 8, label: "Drag Images", type: "checkbox", enabled: isOp, checked: room.dragImages || false },
					{ type: "separator" },
					{ id: 9, label: "Show Coords", type: "checkbox", enabled: true, checked: room.showCoords || false }
				]
			}) as number;
			adminMenuClosedAt = Date.now();
			switch (menuIndex) {
				case 0: {
					const overlay = document.createElement('div');
					overlay.className = 'dlg-overlay';
					const box = document.createElement('div');
					box.className = 'dlg-box';
					const label = document.createElement('p');
					label.className = 'dlg-message';
					label.textContent = 'Enter operator password:';
					const input = document.createElement('input');
					input.type = 'password';
					input.className = 'dlg-input';

					// Auto-login checkbox
					const checkRow = document.createElement('label');
					checkRow.className = 'admin-auto-label';
					const checkbox = document.createElement('input');
					checkbox.type = 'checkbox';
					const serverKey = palace.serverKey();
					const savedPasswords = getAdminPasswords();
					if (savedPasswords[serverKey]?.autoLogin) checkbox.checked = true;
					checkRow.appendChild(checkbox);
					checkRow.appendChild(document.createTextNode(' Auto admin on connect'));

					// Saved passwords list
					const savedList = document.createElement('div');
					savedList.className = 'admin-saved-list';
					const buildSavedList = () => {
						savedList.innerHTML = '';
						const store = getAdminPasswords();
						const keys = Object.keys(store);
						if (keys.length === 0) return;
						const header = document.createElement('div');
						header.className = 'admin-saved-header';
						header.textContent = 'Saved passwords:';
						savedList.appendChild(header);
						for (const k of keys) {
							const row = document.createElement('div');
							row.className = 'admin-saved-row';
							const nameSpan = document.createElement('span');
							nameSpan.className = 'admin-saved-name';
							nameSpan.textContent = k;
							if (store[k].autoLogin) nameSpan.title = 'Auto-login enabled';
							const autoIcon = document.createElement('span');
							autoIcon.className = 'admin-saved-auto';
							autoIcon.textContent = store[k].autoLogin ? '⚡' : '';
							const delBtn = document.createElement('button');
							delBtn.className = 'admin-saved-del';
							delBtn.textContent = '✕';
							delBtn.title = 'Delete saved password';
							delBtn.addEventListener('click', () => {
								deleteAdminPassword(k);
								buildSavedList();
								if (k === serverKey) checkbox.checked = false;
							});
							row.appendChild(nameSpan);
							row.appendChild(autoIcon);
							row.appendChild(delBtn);
							savedList.appendChild(row);
						}
					};
					buildSavedList();

					const btnRow = document.createElement('div');
					btnRow.className = 'dlg-buttons';
					const cancelBtn = document.createElement('button');
					cancelBtn.className = 'dlg-btn-cancel';
					cancelBtn.textContent = 'Cancel';
					const okBtn = document.createElement('button');
					okBtn.className = 'dlg-btn-ok';
					okBtn.textContent = 'OK';
					btnRow.appendChild(cancelBtn);
					btnRow.appendChild(okBtn);
					box.appendChild(label);
					box.appendChild(input);
					box.appendChild(checkRow);
					box.appendChild(savedList);
					box.appendChild(btnRow);
					overlay.appendChild(box);
					document.body.appendChild(overlay);
					input.focus();

					// Pre-fill saved password for current server
					if (savedPasswords[serverKey]) {
						try { input.value = atob(savedPasswords[serverKey].password); } catch { /* corrupted */ }
					}

					const finish = (value: string) => {
						if (value) {
							// Update autoLogin preference
							const store = getAdminPasswords();
							if (store[serverKey]) {
								store[serverKey].autoLogin = checkbox.checked;
							} else if (checkbox.checked) {
								store[serverKey] = { password: btoa(value), autoLogin: true };
							}
							setAdminPasswords(store);
							palace.sendOperatorRequest(value);
						}
						overlay.remove();
					};
					okBtn.addEventListener('click', () => finish(input.value));
					cancelBtn.addEventListener('click', () => finish(''));
					input.addEventListener('keydown', (e: KeyboardEvent) => {
						if (e.key === 'Enter') finish(input.value);
						else if (e.key === 'Escape') finish('');
					});
					break;
				}
				case 1:
					palace.sendNewRoom();
					break;
				case 2:
					showRoomEditor(room);
					break;
				case 3:
					if ((room.flags & 0x0001) && (room as any).password) {
						logmsg('This room is locked and cannot be authored.');
						break;
					}
					palace.sendNewSpot();
					if (!room.authoring) {
						room.authoring = true;
						logmsg('Authoring mode enabled.');
						room.refreshTop();
					}
					break;
				case 4:
					if (room.selectedSpot) {
						const { showSpotEditor } = await import('./core.js');
						showSpotEditor(room.selectedSpot, room);
					}
					break;
				case 7:
					if (!room.authoring && (room.flags & 0x0001) && (room as any).password) {
						logmsg('This room is locked and cannot be authored.');
						break;
					}
					room.authoring = !room.authoring;
					if (room.authoring) {
						// Remove client-side spots created by scripts
						for (let i = room.spots.length - 1; i >= 0; i--) {
							const s = room.spots[i] as any;
							if (s._addedByScript) {
								if (s.img?.parentNode) s.img.parentNode.removeChild(s.img);
								if (s.webEmbed?.parentNode) s.webEmbed.parentNode.removeChild(s.webEmbed);
								room.spots.splice(i, 1);
							}
						}
					}
					if (!room.authoring) room.selectedSpot = null;
					logmsg(room.authoring ? 'Authoring mode enabled.' : 'Authoring mode disabled.');
					room.refreshTop();
					break;
				case 8:
					room.dragImages = !room.dragImages;
					logmsg(room.dragImages ? 'Drag Images enabled.' : 'Drag Images disabled.');
					break;
				case 9:
					room.showCoords = !room.showCoords;
					logmsg(room.showCoords ? 'Coordinates display enabled.' : 'Coordinates display disabled.');
					room.refreshTop();
					break;
			}
		})();
	};

	document.getElementById('chatlog')!.onclick = () => {
		toggleToolBarControl('log');
	};

	document.getElementById('propbag')!.onclick = () => {
		toggleToolBarControl('props');
		toggleToolBarControl('propcontrols');
	};

	const filepropsEl = document.getElementById('fileprops') as HTMLInputElement;
	filepropsEl.onchange = function () {
		createNewProps(Array.from(filepropsEl.files!));
		filepropsEl.value = '';
	};

	document.getElementById('removeprops')!.onclick = () => { palace.setprops([]); };

	// setup draw controls
	const drawsizeEl = document.getElementById('drawsize') as HTMLInputElement;
	drawsizeEl.oninput = function () {
		prefs.draw.size = Number(drawsizeEl.value);
		updateDrawPreview();
	};

	document.getElementById('drawtype')!.onclick = () => {
		prefs.draw.type++;
		if (prefs.draw.type > 1) {
			prefs.draw.type = 0;
		}
		setDrawType();
		updateDrawPreview();
	};

	const drawEraser = document.getElementById('drawundo')!;
	drawEraser.ondblclick = () => {
		palace.sendDrawClear(3);
	};
	drawEraser.onclick = () => {
		palace.sendDrawClear(4);
	};

	const drawcolorEl = document.getElementById('drawcolor') as HTMLInputElement;
	drawcolorEl.onchange = function () {
		prefs.draw.color = drawcolorEl.value;
		drawcolorEl.style.backgroundColor = prefs.draw.color;
		updateDrawPreview();
	};

	const drawfillEl = document.getElementById('drawfill') as HTMLInputElement;
	drawfillEl.onchange = function () {
		prefs.draw.fill = drawfillEl.value;
		drawfillEl.style.backgroundColor = prefs.draw.fill;
		updateDrawPreview();
	};

	document.getElementById('drawing')!.onclick = () => {
		toggleToolBarControl('drawcontrols');
	};

	// setup preferences - old individual handlers removed; OK/Cancel in preferences onclick above
}

export function platformCtrlKey(keyboardEvent: KeyboardEvent | MouseEvent): boolean {
	const mac = /^Mac/.test(navigator.platform);
	return (!mac && keyboardEvent.ctrlKey) || (mac && keyboardEvent.metaKey);
}

export function updateDrawPreview(): void {
	const drawCxt = (document.getElementById('drawpreview') as HTMLCanvasElement).getContext('2d')!;
	const genericSmiley = smileys['5,0'];
	const w = drawCxt.canvas.width;
	const h = drawCxt.canvas.height;
	const sw = genericSmiley.naturalWidth / 2 / 2;
	const sh = genericSmiley.naturalHeight / 2 / 2;

	drawCxt.canvas.onclick = () => { prefs.draw.front = !prefs.draw.front; updateDrawPreview(); };

	drawCxt.clearRect(0, 0, w, h);
	drawCxt.lineWidth = prefs.draw.size;
	drawCxt.lineJoin = 'round';
	drawCxt.lineCap = 'round';
	drawCxt.fillStyle = prefs.draw.fill;
	drawCxt.strokeStyle = prefs.draw.color;

	if (prefs.draw.front === true) {
		drawCxt.globalCompositeOperation = 'source-over';
		drawCxt.filter = 'grayscale(100%)';
		drawCxt.drawImage(genericSmiley, 0, 0, 42, 42, w / 2 - sw, h / 2 - sh, 21, 21);
		drawCxt.filter = 'none';
	}

	if (prefs.draw.type === 2) {
		drawCxt.globalCompositeOperation = 'destination-out';
	} else {
		drawCxt.globalCompositeOperation = 'source-over';
	}

	if (prefs.draw.type < 3) {
		drawCxt.beginPath();
		drawCxt.moveTo(4, h - 4);
		drawCxt.lineTo(w / 2, 4);
		drawCxt.lineTo(w - 4, h - 4);

		if (prefs.draw.type === 1) {
			drawCxt.closePath();
			drawCxt.fill();
		}
		drawCxt.stroke();
	}

	if (prefs.draw.front === false) {
		drawCxt.globalCompositeOperation = 'source-over';
		drawCxt.filter = 'grayscale(100%)';
		drawCxt.drawImage(genericSmiley, 0, 0, 42, 42, w / 2 - sw, h / 2 - sh, 21, 21);
		drawCxt.filter = 'none';
	}
}

export function setDrawType(): void {
    const dt = document.getElementById('drawtype')!;
    switch (prefs.draw.type) {
        case 1:
            dt.style.backgroundImage = 'url(img/bucket.svg)';
            dt.dataset.tooltip = 'Bucket';
            break;
        default:
            dt.style.backgroundImage = 'url(img/pen.svg)';
            dt.dataset.tooltip = 'Pen';
    }
}

export function log(data: { msg: string }): void {
	logmsg(data.msg);
}

export function logerror(msg: string): void {
	const lmsg = document.createElement('div');
	lmsg.className = 'logmsg';
	lmsg.innerHTML = msg;
	logAppend(lmsg);
}

export function logmsg(msg: string): void {
	const lmsg = document.createElement('div');
	lmsg.className = 'logmsg';
	lmsg.appendChild(document.createTextNode(msg));
	logAppend(lmsg);
}

export function logAppend(logspan: HTMLElement): void {
	chatLogScrollLock(() => {
		if (logField.children.length > 400)
			while (logField.children.length > 300)
				logField.removeChild(logField.firstChild!);
		logField.appendChild(logspan);
	});
}

export function logspecial(name: string): void {
	const logspan = document.createElement('div');
	logspan.className = `logmsg special ${name}`;
	logAppend(logspan);
}

export function chatLogScrollLock(callback?: () => void): void {
	const scrollLock = Math.abs((logField.scrollHeight - logField.clientHeight) - logField.scrollTop.fastRound()) < 2;
	if (callback) callback();
	if (scrollLock) logField.scrollTop = logField.scrollHeight - logField.clientHeight;
}

export function setUserInterfaceAvailability(disable: boolean): void {
	(document.getElementById('users') as HTMLButtonElement).disabled = disable;
	(document.getElementById('rooms') as HTMLButtonElement).disabled = disable;
	const adminBtn = document.getElementById('adminmenu') as HTMLButtonElement;
	adminBtn.disabled = disable;
	if (disable) {
		adminBtn.classList.remove('rank-operator', 'rank-owner');
		const authBtn = document.getElementById('authoringbtn')!;
		authBtn.classList.remove('visible', 'active');
	}
}

export function updateAdminGlow(): void {
	const btn = document.getElementById('adminmenu') as HTMLButtonElement;
	btn.classList.remove('rank-operator', 'rank-owner');
	const authBtn = document.getElementById('authoringbtn')!;
	const isAdmin = palace.isOperator || palace.isOwner;
	if (palace.isOwner) {
		btn.classList.add('rank-owner');
	} else if (palace.isOperator) {
		btn.classList.add('rank-operator');
	}
	authBtn.classList.toggle('visible', isAdmin);
	if (!isAdmin) authBtn.classList.remove('active');
}

export function scale2Fit(): void {
	if (viewScaleTimer) {
		clearTimeout(viewScaleTimer);
		viewScaleTimer = null;
	}
	const chatBar = document.getElementById('chatbar')!;
	const chatBoxHeight = palace.chatBoxHeight;
	const logWidth = logField.offsetWidth;

	if (!prefs.general.viewScales && (prefs.general.viewScaleAll || (palace.roomWidth > window.innerWidth - logWidth || palace.roomHeight > window.innerHeight - palace.containerOffsetTop - chatBoxHeight))) {
		viewScaleTimer = setTimeout(() => {
			document.body.scrollTop = 0;
			document.body.scrollLeft = 0;
			document.body.style.overflow = 'hidden';
			const scaleW = (window.innerWidth - logWidth) / palace.roomWidth;
			const scaleH = (window.innerHeight - palace.containerOffsetTop - chatBoxHeight) / palace.roomHeight;
			const scale = scaleW < scaleH ? scaleW : scaleH;
			if (viewScale !== scale) palace.container.style.transform = `scale(${scale}) translateZ(0)`;
			viewScale = scale;
			chatBar.style.width = `${palace.roomWidth * scale}px`;
		}, 50);
	} else {
		document.body.style.overflow = 'auto';
		palace.container.style.transform = '';
		viewScale = 1;
		chatBar.style.width = `${palace.roomWidth}px`;
	}
}

export function setBodyWidth(): void {
	let space = 0;
	if (logField.dataset.state === '1') space = logField.offsetWidth;
	document.body.style.width = `${palace.roomWidth + space}px`;
}

export function enablePropButtons(): void {
	let saved = true;
	if (palace.theUser) {
		palace.theUser.props.find((pid: any) => { if (!propBagSet.has(pid)) saved = false; });
		(document.getElementById('saveprop') as HTMLButtonElement).disabled = saved;
		(document.getElementById('removeprops') as HTMLButtonElement).disabled = (palace.theUser.props.length === 0);
	}
}

export function wearSelectedProps(): void | null {
	if (selectedBagProps.length > 9) {
		return null;
	}
	if (selectedBagProps.length > 1) {
		palace.setprops(selectedBagProps);
	} else if (selectedBagProps.length === 1) {
		if (palace.theUser.props.indexOf(selectedBagProps[0]) > -1) {
			palace.removeprop(selectedBagProps[0]);
		} else {
			palace.donprop(selectedBagProps[0]);
		}
	}
}

export function setPropButtons(): void {
	const isSelected = (selectedBagProps.length > 0);
	(document.getElementById('editprop') as HTMLButtonElement).disabled = !isSelected;
	(document.getElementById('deleteprops') as HTMLButtonElement).disabled = !isSelected;
}

function zoomPanelClose(event: AnimationEvent): void {
	event.preventDefault();
	(event.currentTarget as HTMLElement).removeEventListener('animationend', zoomPanelClose);
	if ((event.currentTarget as HTMLElement).dataset.state === '0') (event.currentTarget as HTMLElement).style.display = 'none';
}

export function toggleZoomPanel(name: string, override?: string | number): void {
	const control = document.getElementById(name)!;
	control.removeEventListener('animationend', zoomPanelClose);
	if (control.dataset.state === '1') {
		control.addEventListener('animationend', zoomPanelClose);
	}
	if (override !== undefined) {
		control.dataset.state = String(override);
	} else {
		control.dataset.state = (control.dataset.state === '1' ? '0' : '1');
	}
	if (control.dataset.state === '1') control.style.display = control.dataset.display || 'inline-block';
}

function transitionalDisplayNone(event: TransitionEvent): void {
	event.preventDefault();
	if (event.eventPhase === 2) {
		(event.currentTarget as HTMLElement).removeEventListener('transitionend', transitionalDisplayNone);
		(event.currentTarget as HTMLElement).style.display = 'none';
		if (event.currentTarget === logField) scale2Fit();
	}
}

export function toggleToolBarControl(name: string, show?: boolean): void {
	const control = document.getElementById(name)!;
	control.removeEventListener('transitionend', transitionalDisplayNone);
	if (show === undefined && control.dataset.state === '1') {
		control.addEventListener('transitionend', transitionalDisplayNone);
	}
	control.dataset.state = (control.dataset.state !== '1' || show ? '1' : '0');
	control.style.display = control.dataset.display || 'inline-block';
	if (name === 'log') scale2Fit();
	if (name === 'log' || name === 'props') setBodyWidth();
	if ((name === 'log' || name === 'props') && control.dataset.state === '1') logField.scrollTop = logField.scrollHeight - logField.clientHeight;
	if (name === 'props' && control.dataset.state === '1') refreshPropBagView();
}

function showRoomEditor(room: any): void {
	const overlay = document.createElement('div');
	overlay.className = 'dlg-overlay';

	const box = document.createElement('div');
	box.className = 'dlg-box spot-editor';

	const title = document.createElement('h3');
	title.textContent = 'Author';
	box.appendChild(title);

	const grid = document.createElement('div');
	grid.className = 'spot-editor-grid';

	const addRow = (label: string, ...els: HTMLElement[]) => {
		const lbl = document.createElement('label');
		lbl.textContent = label;
		grid.appendChild(lbl);
		const cell = document.createElement('div');
		cell.className = 'spot-editor-cell';
		els.forEach(e => cell.appendChild(e));
		grid.appendChild(cell);
	};

	// Name
	const nameInput = document.createElement('input');
	nameInput.className = 'dlg-input';
	nameInput.value = room.name || '';
	addRow('Name', nameInput);

	// Picture (background)
	const picInput = document.createElement('input');
	picInput.className = 'dlg-input';
	picInput.value = room.background || '';
	const chooseBtn = document.createElement('button');
	chooseBtn.className = 'dlg-btn-ok dlg-btn-sm';
	chooseBtn.textContent = 'Choose';
	chooseBtn.onclick = async () => {
		const result = await (window.apiBridge as any).openFileDialog?.({
			title: 'Choose Background',
			filters: [{ name: 'Images/Video', extensions: ['jpg','jpeg','png','gif','bmp','svg','webp','mp4','m4v','webm','ogg'] }]
		});
		if (result) picInput.value = result;
	};
	addRow('Picture', picInput, chooseBtn);

	// Artist
	const artistInput = document.createElement('input');
	artistInput.className = 'dlg-input';
	artistInput.value = room.artist || '';
	addRow('Artist', artistInput);

	// Room ID + Lock button
	const roomIdInput = document.createElement('input');
	roomIdInput.className = 'dlg-input dlg-input-sm';
	roomIdInput.type = 'number';
	roomIdInput.value = String(room.id);
	roomIdInput.readOnly = true;

	const lockBtn = document.createElement('button');
	lockBtn.className = 'dlg-btn-ok dlg-btn-sm';
	lockBtn.textContent = room.password ? '\u{1F512}' : '\u{1F513}';
	lockBtn.title = room.password ? 'Room is locked - click to change password' : 'Room is unlocked - click to set password';
	lockBtn.onclick = async () => {
		const pw = await showPromptDialog('Enter room password (leave empty to unlock):', '', true);
		if (pw !== null) {
			if (room.password && pw === room.password) {
				room.password = '';
				room.flags &= ~0x0001;
			} else {
				room.password = pw;
			}
			lockBtn.textContent = room.password ? '\u{1F512}' : '\u{1F513}';
			lockBtn.title = room.password ? 'Room is locked - click to change password' : 'Room is unlocked - click to set password';
		}
	};
	addRow('Room ID', roomIdInput, lockBtn);

	// Options fieldset
	const optSection = document.createElement('fieldset');
	optSection.className = 'spot-editor-options';
	const optLegend = document.createElement('legend');
	optLegend.textContent = 'Options';
	optSection.appendChild(optLegend);

	const optGrid = document.createElement('div');
	optGrid.className = 'spot-editor-opt-grid';

	const roomFlags: [string, number][] = [
		['Private', 0x0002],
		['No Painting Allowed', 0x0004],
		['Drop Zone', 0x0100],
		['No Loose Props', 0x0200],
		['Hidden from Room List', 0x0020],
		['No User Scripts', 0x0010],
		['Wizards Only', 0x0080],
		['No Guests Allowed', 0x0040],
	];

	const flagChecks: { flag: number; cb: HTMLInputElement }[] = [];
	roomFlags.forEach(([name, flag]) => {
		const lbl = document.createElement('label');
		lbl.className = 'spot-editor-chk';
		const cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.checked = Boolean(room.flags & flag);
		lbl.appendChild(cb);
		lbl.appendChild(document.createTextNode(name));
		optGrid.appendChild(lbl);
		flagChecks.push({ flag, cb });
	});
	optSection.appendChild(optGrid);

	box.appendChild(grid);
	box.appendChild(optSection);

	// Buttons
	const btnRow = document.createElement('div');
	btnRow.className = 'dlg-buttons spread';

	const deleteBtn = document.createElement('button');
	deleteBtn.className = 'dlg-btn-danger';
	deleteBtn.textContent = 'Delete';
	deleteBtn.onclick = async () => {
		const confirmed = await showConfirmDialog('Are you sure you want to delete this room?');
		if (confirmed) {
			palace.sendXtlk('`delete');
			close();
		}
	};

	const rightBtns = document.createElement('div');
	rightBtns.className = 'dlg-btn-group';

	const okBtn = document.createElement('button');
	okBtn.className = 'dlg-btn-ok';
	okBtn.textContent = 'OK';

	const cancelBtn = document.createElement('button');
	cancelBtn.className = 'dlg-btn-cancel';
	cancelBtn.textContent = 'Cancel';

	rightBtns.appendChild(okBtn);
	rightBtns.appendChild(cancelBtn);
	btnRow.appendChild(deleteBtn);
	btnRow.appendChild(rightBtns);
	box.appendChild(btnRow);

	overlay.appendChild(box);
	document.body.appendChild(overlay);
	nameInput.focus();
	nameInput.select();

	const close = () => overlay.remove();

	cancelBtn.onclick = close;
	overlay.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') close();
	});

	okBtn.onclick = () => {
		room.name = nameInput.value;
		room.background = picInput.value;
		room.artist = artistInput.value;

		// Rebuild flags
		let flags = room.flags;
		// Clear managed flags
		flags &= ~(0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020 | 0x0040 | 0x0080 | 0x0100 | 0x0200);
		// Set checkbox flags
		flagChecks.forEach(({ flag, cb }) => { if (cb.checked) flags |= flag; });
		// Set lock bit if password is set
		if (room.password) flags |= 0x0001;
		room.flags = flags;

		document.getElementById('palaceroom')!.innerText = room.name;
		palace.sendRoomSetDesc();
		logmsg(`Room "${room.name}" updated.`);
		close();
	};
}
