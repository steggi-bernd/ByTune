/**
 * UPnP / DLNA renderers (receivers, network speakers, smart TVs): finding
 * them on the local network and steering them — the protocol half of
 * casting (cast.ts runs the session).
 *
 *  - discovery: an SSDP M-SEARCH for MediaRenderer devices, then each one's
 *    description; only http addresses on a private network are followed, so
 *    a reply can't point ByTune at the internet
 *  - control: SOAP calls to the renderer's AVTransport (load, play, pause,
 *    stop, seek, position, state) and RenderingControl (volume)
 *
 * The XML involved is small and fixed in shape, read with patterns rather
 * than a parser; everything put into it is escaped.
 */
import * as dgram from "dgram";

export interface Renderer {
  /** the device's UDN */
  id: string;
  name: string;
  model: string;
  /** its description document — the base for its service URLs */
  location: string;
  avTransport: { url: string; type: string };
  renderingControl?: { url: string; type: string };
}

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const SEARCH = [
  "M-SEARCH * HTTP/1.1",
  `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  "MX: 2",
  "ST: urn:schemas-upnp-org:device:MediaRenderer:1",
  "",
  "",
].join("\r\n");

/** http on a private, loopback or link-local IPv4 address — the only places a renderer lives. */
export function isLanUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:") return false;
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(u.hostname);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  } catch {
    return false;
  }
}

/** An SSDP reply's headers (lower-cased names). */
export function parseSsdp(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const at = line.indexOf(":");
    if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return headers;
}

const tag = (xml: string, name: string): string | undefined =>
  new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i").exec(xml)?.[1]?.trim();

export function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** A renderer from its description document, or null when it can't play (no AVTransport). */
export function parseDescription(xml: string, location: string): Renderer | null {
  const base = tag(xml, "URLBase") || location;
  const services = [...xml.matchAll(/<(?:\w+:)?service>([\s\S]*?)<\/(?:\w+:)?service>/gi)].map((m) => m[1]);
  const find = (kind: string): { url: string; type: string } | undefined => {
    const s = services.find((x) => (tag(x, "serviceType") ?? "").includes(`:service:${kind}:`));
    const type = s ? tag(s, "serviceType") : undefined;
    const control = s ? tag(s, "controlURL") : undefined;
    if (!type || !control) return undefined;
    try {
      const url = new URL(unescapeXml(control), base).toString();
      return isLanUrl(url) ? { url, type } : undefined;
    } catch {
      return undefined;
    }
  };
  const avTransport = find("AVTransport");
  if (!avTransport) return null;
  return {
    id: tag(xml, "UDN") ?? location,
    name: unescapeXml(tag(xml, "friendlyName") ?? "Network player").slice(0, 80),
    model: unescapeXml([tag(xml, "manufacturer"), tag(xml, "modelName")].filter(Boolean).join(" ")).slice(0, 80),
    location,
    avTransport,
    renderingControl: find("RenderingControl"),
  };
}

/** Renderers answering on the local network within `waitMs`. */
export async function discover(waitMs = 2500): Promise<Renderer[]> {
  const locations = new Set<string>();
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  socket.on("message", (msg) => {
    const location = parseSsdp(msg.toString("utf8")).location;
    if (location && isLanUrl(location)) locations.add(location);
  });
  socket.on("error", () => undefined);
  await new Promise<void>((resolve) => socket.bind(0, resolve));
  const search = Buffer.from(SEARCH);
  // Sent twice: UDP may drop one, and slow devices answer late.
  socket.send(search, SSDP_PORT, SSDP_ADDR);
  const again = setTimeout(() => socket.send(search, SSDP_PORT, SSDP_ADDR), 600);
  await new Promise((r) => setTimeout(r, waitMs));
  clearTimeout(again);
  socket.close();
  const found = await Promise.all([...locations].map((l) => describe(l).catch(() => null)));
  const byId = new Map<string, Renderer>();
  for (const r of found) if (r) byId.set(r.id, r);
  return [...byId.values()];
}

export async function describe(location: string): Promise<Renderer | null> {
  if (!isLanUrl(location)) return null;
  // No redirects: a device on the network must not send ByTune elsewhere.
  const res = await fetch(location, { redirect: "error", signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;
  return parseDescription((await res.text()).slice(0, 512 * 1024), location);
}

/** One SOAP action; resolves to the response body, throws with the device's own error text. */
export async function soap(
  service: { url: string; type: string },
  action: string,
  args: Record<string, string | number>
): Promise<string> {
  const body = Object.entries(args)
    .map(([k, v]) => `<${k}>${escapeXml(String(v))}</${k}>`)
    .join("");
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${escapeXml(service.type)}">${body}</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(service.url, {
    method: "POST",
    headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPACTION: `"${service.type}#${action}"` },
    body: envelope,
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  const text = (await res.text()).slice(0, 256 * 1024);
  if (!res.ok) throw new Error(`The player refused ${action}: ${unescapeXml(tag(text, "errorDescription") ?? `HTTP ${res.status}`)}`);
  return text;
}

/** "0:04:12" or "0:04:12.500" → seconds; NOT_IMPLEMENTED and the like → 0. */
export function parseClock(s: string | undefined): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec(s?.trim() ?? "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0) : 0;
}

/** seconds → "H:MM:SS" (what Seek and DIDL durations take). */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export interface SongMeta {
  title: string;
  artist: string;
  album: string;
  duration: number;
  mime: string;
}

/** The DIDL-Lite item a renderer shows while it plays `url`. */
export function didl(url: string, song: SongMeta): string {
  const e = escapeXml;
  return (
    `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">` +
    `<item id="1" parentID="0" restricted="1"><dc:title>${e(song.title)}</dc:title><dc:creator>${e(song.artist)}</dc:creator>` +
    `<upnp:artist>${e(song.artist)}</upnp:artist><upnp:album>${e(song.album)}</upnp:album><upnp:class>object.item.audioItem.musicTrack</upnp:class>` +
    `<res protocolInfo="http-get:*:${e(song.mime)}:*"${song.duration > 0 ? ` duration="${clock(song.duration)}.000"` : ""}>${e(url)}</res></item></DIDL-Lite>`
  );
}

export const transport = {
  load: (r: Renderer, url: string, song: SongMeta) =>
    soap(r.avTransport, "SetAVTransportURI", { InstanceID: 0, CurrentURI: url, CurrentURIMetaData: didl(url, song) }),
  play: (r: Renderer) => soap(r.avTransport, "Play", { InstanceID: 0, Speed: 1 }),
  pause: (r: Renderer) => soap(r.avTransport, "Pause", { InstanceID: 0 }),
  stop: (r: Renderer) => soap(r.avTransport, "Stop", { InstanceID: 0 }),
  seek: (r: Renderer, sec: number) => soap(r.avTransport, "Seek", { InstanceID: 0, Unit: "REL_TIME", Target: clock(sec) }),
  /** where the player is in the song it has, and which song that is (its URI, "" when it doesn't say) */
  async position(r: Renderer): Promise<{ position: number; duration: number; uri: string }> {
    const xml = await soap(r.avTransport, "GetPositionInfo", { InstanceID: 0 });
    return {
      position: parseClock(tag(xml, "RelTime")),
      duration: parseClock(tag(xml, "TrackDuration")),
      uri: unescapeXml(tag(xml, "TrackURI") ?? ""),
    };
  },
  async state(r: Renderer): Promise<string> {
    return tag(await soap(r.avTransport, "GetTransportInfo", { InstanceID: 0 }), "CurrentTransportState") ?? "UNKNOWN";
  },
  volume: (r: Renderer, percent: number) =>
    r.renderingControl
      ? soap(r.renderingControl, "SetVolume", { InstanceID: 0, Channel: "Master", DesiredVolume: Math.round(Math.min(100, Math.max(0, percent))) })
      : Promise.resolve(""),
  /** the player's own volume, 0–100; null when it doesn't say (or has no volume control) */
  async getVolume(r: Renderer): Promise<number | null> {
    if (!r.renderingControl) return null;
    const v = Number(tag(await soap(r.renderingControl, "GetVolume", { InstanceID: 0, Channel: "Master" }), "CurrentVolume"));
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;
  },
  async getMute(r: Renderer): Promise<boolean> {
    if (!r.renderingControl) return false;
    const v = tag(await soap(r.renderingControl, "GetMute", { InstanceID: 0, Channel: "Master" }), "CurrentMute");
    return v === "1" || v?.toLowerCase() === "true";
  },
  mute: (r: Renderer, on: boolean) =>
    r.renderingControl
      ? soap(r.renderingControl, "SetMute", { InstanceID: 0, Channel: "Master", DesiredMute: on ? 1 : 0 })
      : Promise.resolve(""),
};
