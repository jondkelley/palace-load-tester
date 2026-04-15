/** Preload API exposed on window via contextBridge */
export interface PalaceAPI {
    getAppVersion(): Promise<string>;
    /** Windows: `win:` + MachineGuid; macOS: `mac:` + IOPlatformUUID; else null. */
    getMachineUuid(): Promise<string | null>;
    /** Stable 32-bit unsigned integer derived from the machine UUID. */
    getClientId(): Promise<number>;
    connect(ip: string, port: number): void;
    send(payload: ArrayBuffer): void;
    serverDown(msg: string): void;
    openContextMenu(setup: ContextMenuSetup): Promise<void>;
    launchHyperLink(link: string): void;
    handleData(callback: (...args: unknown[]) => void): void;
    chatLogWrite(server: string, html: string): Promise<void>;
    chatLogList(): Promise<{ server: string; logs: { filename: string; size: number; modified: number }[] }[]>;
    chatLogRead(server: string, filename: string): Promise<string | null>;
    openChatArchive(): void;
    openChatLogsFolder(): void;
    /** Open the Iptscrae reference window, optionally scrolled to a hash anchor (e.g. "SAY"). */
    openIptReference(hash?: string): void;
    httpRequest(opts: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{ ok: boolean; status?: number; headers?: Record<string, string>; body?: string; url?: string; error?: string }>;
    /** Claim any palace:// URL queued before the window was ready (startup-via-link case). */
    getPendingPalaceUrl(): Promise<string | null>;
    /** Register a callback invoked whenever the OS forwards a palace:// URL to this running app. */
    handlePalaceUrl(callback: (url: string) => void): void;
}

export interface ContextMenuSetup {
    items: ContextMenuItem[];
}

export interface ContextMenuItem {
    label: string;
    id?: string;
    enabled?: boolean;
    checked?: boolean;
    type?: 'normal' | 'separator' | 'checkbox';
}

/** Binary protocol message header */
export interface PacketHeader {
    type: number;
    length: number;
    refNum: number;
}

/** Room spot (hotspot / door) */
export interface SpotInfo {
    id: number;
    name: string;
    type: number;
    flags: number;
    x: number;
    y: number;
    state: number;
    dest: number;
    points: { h: number; v: number }[];
    states: SpotState[];
    script: string;
    handlers: { [key: string]: any[] };
}

export interface SpotState {
    pictID: number;
    x: number;
    y: number;
}

/** User info received from server */
export interface UserInfo {
    id: number;
    name: string;
    x: number;
    y: number;
    color: number;
    face: number;
    props: PropSpec[];
    status: number;
}

/** Prop specification (ID + CRC) */
export interface PropSpec {
    id: number;
    crc: number;
}

/** Cached prop data */
export interface CachedProp {
    id: number;
    crc: number;
    src: string;
    img: HTMLImageElement;
    w: number;
    h: number;
    flags: number;
    data?: Uint8Array;
}

/** Room description from server */
export interface RoomInfo {
    id: number;
    name: string;
    bgFile: string;
    artist: string;
    flags: number;
    faces: number;
    spots: SpotInfo[];
    images: LooseImage[];
    draws: DrawCommand[];
    users: UserInfo[];
    password: boolean;
}

export interface LooseImage {
    name: string;
    x: number;
    y: number;
    id: number;
    alpha: number;
}

export interface DrawCommand {
    type: number;
    data: Uint8Array;
}

/** Drawing preferences */
export interface DrawPrefs {
    type: number;
    size: number;
    front: boolean;
    color: string;
    fill: string;
}

/** Preferences stored in localStorage */
export interface PrefsData {
    general: Record<string, unknown>;
    control: Record<string, unknown>;
    draw: DrawPrefs;
    registration?: RegistrationData;
}

export interface RegistrationData {
    username: string;
    wizpass: string;
    puid: number;
}

/** Server list entry */
export interface ServerEntry {
    name: string;
    address: string;
    port: number;
    users: number;
}
