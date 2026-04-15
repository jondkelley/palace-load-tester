import { httpGetAsync } from './utility.js';
import { prefs } from './preferences.js';
import { chatLogScrollLock } from './interface.js';

interface VideoPlayerInfo {
	id: string | RegExpMatchArray;
	anchor: HTMLAnchorElement;
	container: HTMLElement;
	parent: HTMLElement;
	icon?: string;
	title?: string;
	ratio?: number;
	playRatio?: number;
}

export function makeHyperLinks(str: string, parent?: HTMLElement): HTMLSpanElement {
	const linkSearch = /(\bhttps?:\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/i;
	const parts = str.split(linkSearch);
	const l = parts.length;
	const s = document.createElement('span');

	if (l > 1) {
		for (let i = 0; i < l; i++) {
			const link = parts[i];
			if (link.length > 0) {
				const txt = document.createTextNode(link);
				if (linkSearch.test(link)) {
					const a = document.createElement('a');
					a.style.color = '#6cb6ff';
					a.tabIndex = -1;
				a.onfocus = function () { a.blur(); };
					a.addEventListener('click', function (this: HTMLAnchorElement, e) {
						e.preventDefault();
						window.apiBridge.launchHyperLink(this.href);
					});
					a.appendChild(txt);
					a.href = link;
					s.appendChild(a);

					const youTube = matchYoutubeUrl(link);

					if (youTube) {
						createYoutubePlayer({ id: youTube, anchor: a, container: s, parent: parent! });
					} else {
						const faceBook = matchFacebookUrl(link);
						if (faceBook) {
							createFacebookPlayer({ id: faceBook, anchor: a, container: s, parent: parent! });
						} else {
							const vimeo = matchVimeoUrl(link);
							if (vimeo) {
								createVimeoPlayer({ id: vimeo, anchor: a, container: s, parent: parent! });
							}
						}
					}
				} else {
					s.appendChild(txt);
				}
			}
		}
	} else {
		s.textContent = str;
	}
	return s;
}

function matchYoutubeUrl(url: string): string | undefined {
	const m = url.match(/^(?:https?:\/\/)?(?:m\.|www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/);
	if (m) return m[1];
}

function createYoutubePlayer(info: VideoPlayerInfo): void {
	const id = info.id;
	const embedUrl = `https://www.youtube.com/embed/${id}?autoplay=1`;
	info.icon = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
	httpGetAsync(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
		'json',
		(yt: any) => {
			if (yt) {
				if (yt.title) info.title = yt.title;
				if (yt.thumbnail_url) info.icon = yt.thumbnail_url;
			}
			createChatVideoPlayer('youtube', info, embedUrl);
		},
		(_err: number) => {
			createChatVideoPlayer('youtube', info, embedUrl);
		}
	);
}

function matchFacebookUrl(url: string): RegExpMatchArray | undefined {
	const m = url.match(/^https:\/\/www\.facebook\.com\/(?:(.*?)\/)?(?:videos|reel)\/(.*\/)?([0-9]+)/);
	if (m) return m;
}

function createFacebookPlayer(info: VideoPlayerInfo): void {
	const match = info.id as RegExpMatchArray;
	const isReel = match[0].includes('/reel/');
	if (isReel) info.playRatio = 177.78;
	const originalUrl = match[0];
	const source = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(`https://www.facebook.com${originalUrl.replace(/^https:\/\/www\.facebook\.com/, '')}`)}&autoplay=1&mute=0`;
	info.icon = 'img/facebook-logo.svg';
	info.title = '';
	createChatVideoPlayer('facebook', info, source);
}

function matchVimeoUrl(url: string): string | undefined {
	const m = url.match(/^https:\/\/vimeo.com(.*)\/([0-9]+)/);
	if (m) return m[2];
}

function createVimeoPlayer(info: VideoPlayerInfo): void {
	httpGetAsync(`https://api.vimeo.com/videos/${info.id}?access_token=3842fc48186684845f76f44e607ae85a`,
		'json',
		(vm: any) => {
			if (vm && vm.privacy.embed === 'public') {
				info.icon = vm.pictures.sizes[Math.floor((vm.pictures.sizes.length - 1) / 2)].link;
				info.title = vm.name;
				info.ratio = ((vm.height / vm.width) * 100);
				createChatVideoPlayer('vimeo', info, `https://player.vimeo.com/video/${info.id}?autoplay=1&title=1`);
			}
		}
	);
}

function closeAllLogVideos(): void {
	const closeButtons = document.getElementsByClassName('closechatvideo');
	for (let i = 0; i < closeButtons.length; i++) {
		(closeButtons[i] as HTMLElement).click();
	}
}

function createChatVideoPlayer(type: string, info: VideoPlayerInfo, source: string): void {
	const pb = document.createElement('div');
	pb.onclick = function () {
		closeAllLogVideos();
		const frame = document.createElement('iframe');
		const closeyt = document.createElement('div');
		closeyt.className = 'closechatvideo';
		closeyt.onclick = () => {
			chatLogScrollLock(() => {
				info.parent.style.position = 'static';
				info.parent.style.zIndex = '';
				info.container.className = '';
				if (info.playRatio && info.ratio) info.container.style.paddingBottom = `${info.ratio}%`;
				info.container.replaceChild(pb, frame);
				info.container.insertBefore(info.anchor, pb);
				info.container.removeChild(closeyt);
			});
		};
		frame.setAttribute('allowFullScreen', '');
		frame.setAttribute('scrolling', 'no');
		frame.setAttribute('allow', 'autoplay; fullscreen');
		frame.referrerPolicy = 'strict-origin-when-cross-origin';
		frame.tabIndex = -1;
		frame.frameBorder = '0';
		frame.className = 'chatvideoiframe';
		frame.width = '100%';
		frame.height = '100%';

		frame.src = source;
		chatLogScrollLock(() => {
			info.container.className = 'chatvideocontainer';
			if (info.playRatio) info.container.style.paddingBottom = `${info.playRatio}%`;
			info.container.replaceChild(frame, pb);
			info.container.removeChild(info.anchor);
			info.container.appendChild(closeyt);
			info.parent.style.top = `${-(info.parent.firstChild!.nextSibling! as HTMLElement).offsetHeight + 2}px`;
			info.parent.style.position = 'sticky';
			info.parent.style.zIndex = '100';
			info.parent.style.top = `${-((info as any).containerOffsetTop + 2)}px`;
		});
	};

	const title = document.createElement('div');
	title.className = 'chatvideotitle';
	title.innerText = info.title || '';
	pb.appendChild(title);
	pb.className = 'chatvideocontainer';
	pb.style.backgroundImage = `url(img/${type}-play.svg), url(${info.icon})`;

	chatLogScrollLock(() => {
		if (info.ratio) {
			info.container.style.paddingBottom = `${info.ratio}%`;
			pb.style.paddingBottom = `${info.ratio}%`;
		}
		info.container.appendChild(pb);
	});
	if (prefs.general.autoplayvideos) {
		pb.click();
	}
}
