/**
 * Read-only Twitch chat over the IRC WebSocket, logged in anonymously
 * (justinfan). No Twitch app or token needed. The real server will move to
 * EventSub later; this keeps the OBS page self-contained for now.
 */

export interface ChatMessage {
  login: string;
  display: string;
  color: string;
  text: string;
  /** Emote ids in message order, one entry per occurrence. */
  emotes: string[];
  mod: boolean;
  broadcaster: boolean;
  /** Subscriber (or founder) badge. */
  sub: boolean;
}

export interface TwitchStatus { state: string; msgs: number; channel: string }

export class TwitchChat {
  readonly status: TwitchStatus;
  private ws: WebSocket | null = null;
  private retry = 1000;

  constructor(
    private channel: string,
    private onMessage: (m: ChatMessage) => void,
    /** A ban or timeout: remove that user's Bibo. */
    private onClear: (login: string) => void,
    /** Someone subscribed (or was gifted a sub). */
    private onSub?: (login: string, display: string, color: string) => void,
  ) {
    this.status = { state: 'connecting', msgs: 0, channel };
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    this.ws = ws;
    this.status.state = 'connecting';
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      ws.send(`JOIN #${this.channel}`);
    };
    ws.onmessage = (ev) => {
      for (const line of String(ev.data).split('\r\n')) if (line) this.line(line);
    };
    ws.onclose = () => {
      this.status.state = `disconnected, retrying in ${Math.round(this.retry / 1000)}s`;
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(30000, this.retry * 2);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private line(raw: string): void {
    let rest = raw, tags: Record<string, string> = {};
    if (rest[0] === '@') {
      const sp = rest.indexOf(' ');
      tags = parseTags(rest.slice(1, sp));
      rest = rest.slice(sp + 1);
    }
    let prefix = '';
    if (rest[0] === ':') {
      const sp = rest.indexOf(' ');
      prefix = rest.slice(1, sp);
      rest = rest.slice(sp + 1);
    }
    const ti = rest.indexOf(' :');
    const trailing = ti >= 0 ? rest.slice(ti + 2) : '';
    const [cmd] = (ti >= 0 ? rest.slice(0, ti) : rest).split(' ');

    switch (cmd) {
      case 'PING': this.ws?.send(`PONG :${trailing}`); break;
      case 'RECONNECT': this.ws?.close(); break;
      case 'JOIN': this.status.state = 'connected'; this.retry = 1000; break;
      case 'CLEARCHAT': if (trailing) this.onClear(trailing.toLowerCase()); break;
      case 'PRIVMSG': {
        const login = prefix.split('!')[0].toLowerCase();
        let text = trailing;
        // /me messages arrive wrapped in ACTION.
        if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) text = text.slice(8, -1);
        const badges = tags['badges'] ?? '';
        this.status.msgs++;
        this.onMessage({
          login,
          display: tags['display-name'] || login,
          color: tags['color'] ?? '',
          text,
          emotes: parseEmotes(tags['emotes'] ?? ''),
          mod: tags['mod'] === '1',
          broadcaster: badges.includes('broadcaster/'),
          sub: /(^|,)(subscriber|founder)\//.test(badges),
        });
        break;
      }
      case 'USERNOTICE': {
        // New subs, resubs and gift subs: the new subscriber gets a jetpack entrance.
        const id = tags['msg-id'];
        if (id === 'sub' || id === 'resub') this.onSub?.(tags['login'] ?? '', tags['display-name'] || tags['login'] || '', tags['color'] ?? '');
        else if (id === 'subgift') this.onSub?.((tags['msg-param-recipient-user-name'] ?? '').toLowerCase(), tags['msg-param-recipient-display-name'] ?? '', '');
        break;
      }
    }
  }
}

function parseTags(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of s.split(';')) {
    const i = kv.indexOf('=');
    out[kv.slice(0, i)] = kv.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
  }
  return out;
}

/** "25:0-4,12-16/1902:6-10" -> ids in message order. */
export function parseEmotes(tag: string): string[] {
  if (!tag) return [];
  const hits: [number, string][] = [];
  for (const part of tag.split('/')) {
    const [id, ranges] = part.split(':');
    if (!ranges) continue;
    for (const r of ranges.split(',')) hits.push([parseInt(r, 10), id]);
  }
  return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
}
