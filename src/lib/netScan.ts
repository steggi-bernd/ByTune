/**
 * What answers on the local network, in both apps: the questions to send (SSDP
 * and mDNS), the answers read, and one list of devices out of them. The sockets
 * are each app's own (electron/net-scan.ts, the phone's native module).
 */

/** Everything that plays on request has a kind; `pairOnly` devices can be told about but only reached over Bluetooth. */
export type NetDeviceKind = "upnp" | "cast" | "echo" | "firetv";

export interface NetDevice {
  id: string;
  kind: NetDeviceKind;
  name: string;
  model: string;
  host: string;
  port: number;
  /** UPnP: its description document */
  location?: string;
}

export const SSDP_ADDRESS = "239.255.255.250";
export const SSDP_PORT = 1900;
export const MDNS_ADDRESS = "224.0.0.251";
export const MDNS_PORT = 5353;

export const SSDP_SEARCH = [
  "M-SEARCH * HTTP/1.1",
  `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  "MX: 2",
  "ST: urn:schemas-upnp-org:device:MediaRenderer:1",
  "",
  "",
].join("\r\n");

const CAST_SERVICE = "_googlecast._tcp.local";
const CONNECT_SERVICE = "_spotify-connect._tcp.local";
export const MDNS_SERVICES = [CAST_SERVICE, CONNECT_SERVICE];

function encodeName(name: string): number[] {
  const out: number[] = [];
  for (const label of name.split(".")) {
    out.push(label.length);
    for (let i = 0; i < label.length; i++) out.push(label.charCodeAt(i));
  }
  out.push(0);
  return out;
}

/** One mDNS packet asking for all these services. */
export function mdnsQuery(services: string[] = MDNS_SERVICES): Uint8Array {
  const out = [0, 0, 0, 0, 0, services.length, 0, 0, 0, 0, 0, 0];
  for (const service of services) out.push(...encodeName(service), 0, 12, 0, 1);
  return Uint8Array.from(out);
}

function latin(bytes: Uint8Array, from: number, to: number): string {
  // Names are UTF-8; a device's friendly name can hold any letter.
  let out = "";
  let i = from;
  while (i < to) {
    const b = bytes[i];
    const size = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    let code = size === 1 ? b : b & (0xff >> (size + 1));
    for (let k = 1; k < size; k++) code = (code << 6) | (bytes[i + k] & 63);
    out += String.fromCodePoint(code);
    i += size;
  }
  return out;
}

function readName(bytes: Uint8Array, start: number): { name: string; end: number } {
  const labels: string[] = [];
  let at = start;
  let end = -1;
  for (let guard = 0; guard < 64 && at < bytes.length; guard++) {
    const len = bytes[at];
    if (len === 0) {
      at += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = at + 2;
      at = ((len & 0x3f) << 8) | bytes[at + 1];
      continue;
    }
    labels.push(latin(bytes, at + 1, at + 1 + len));
    at += len + 1;
  }
  return { name: labels.join("."), end: end < 0 ? at : end };
}

export interface MdnsService {
  service: "cast" | "connect";
  instance: string;
  host: string;
  port: number;
  txt: Record<string, string>;
}

/** What one packet tells about the services asked for; `from` is the sender's address. */
export function readMdns(bytes: Uint8Array, from: string, into: Map<string, MdnsService>): void {
  if (bytes.length < 12) return;
  const word = (at: number): number => (bytes[at] << 8) | bytes[at + 1];
  const questions = word(4);
  const records = word(6) + word(8) + word(10);
  let at = 12;
  for (let i = 0; i < questions; i++) at = readName(bytes, at).end + 4;
  const entry = (fullName: string): MdnsService | null => {
    const service = fullName.endsWith(CAST_SERVICE) ? "cast" : fullName.endsWith(CONNECT_SERVICE) ? "connect" : null;
    if (!service) return null;
    let found = into.get(fullName);
    if (!found) {
      found = { service, instance: fullName.split("._")[0], host: from, port: 0, txt: {} };
      into.set(fullName, found);
    }
    return found;
  };
  for (let i = 0; i < records && at < bytes.length; i++) {
    const { name, end } = readName(bytes, at);
    at = end;
    const type = word(at);
    const size = word(at + 8);
    const data = at + 10;
    if (type === 12 && MDNS_SERVICES.includes(name)) {
      entry(readName(bytes, data).name);
    } else if (type === 33) {
      const found = entry(name);
      if (found) found.port = word(data + 4);
    } else if (type === 16) {
      const found = entry(name);
      if (found) {
        let p = data;
        while (p < data + size) {
          const len = bytes[p];
          const text = latin(bytes, p + 1, p + 1 + len);
          const eq = text.indexOf("=");
          if (eq > 0) found.txt[text.slice(0, eq)] = text.slice(eq + 1);
          p += len + 1;
        }
      }
    }
    at = data + size;
  }
}

/** What a Spotify Connect device says about itself tells an Echo from anything else; the rest here isn't for us. */
export function kindOfConnect(info: { brandDisplayName?: string; modelDisplayName?: string; deviceType?: string } | null): NetDeviceKind | null {
  const brand = (info?.brandDisplayName ?? "").toLowerCase();
  const model = (info?.modelDisplayName ?? "").toLowerCase();
  if (brand.includes("amazon") && model.includes("echo")) return "echo";
  if (brand.includes("amazon") && (info?.deviceType === "TV" || model.startsWith("aft"))) return "firetv";
  return null;
}

/** The Cast devices among the services; a speaker group is a device like any other. */
export function castDevices(services: Iterable<MdnsService>): NetDevice[] {
  const out: NetDevice[] = [];
  for (const s of services) {
    if (s.service !== "cast" || !s.port) continue;
    out.push({
      id: `cast:${s.txt.id ?? s.instance}`,
      kind: "cast",
      name: s.txt.fn ?? s.instance,
      model: s.txt.md ?? "Google Cast",
      host: s.host,
      port: s.port,
    });
  }
  return out;
}

/** A Connect device's public "who are you", without a login. */
async function connectInfo(s: MdnsService): Promise<any> {
  if (!s.port) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`http://${s.host}:${s.port}${s.txt.CPath ?? "/"}?action=getInfo&version=2.7.1`, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The devices among all the services that answered. */
export async function devicesFromMdns(services: Iterable<MdnsService>): Promise<NetDevice[]> {
  const all = [...services];
  const casts = castDevices(all);
  const taken = new Set(casts.map((d) => d.host));
  const others = await Promise.all(all.filter((s) => s.service === "connect" && !taken.has(s.host)).map(async (s) => pairOnlyDevice(s, await connectInfo(s))));
  return [...casts, ...others.filter((d): d is NetDevice => !!d)];
}

const NAME_OF_KIND: Partial<Record<NetDeviceKind, string>> = { echo: "Echo", firetv: "Fire TV" };

/** An Echo or Fire TV by what its Connect service says; they can't be sent music, but they're worth showing. */
export function pairOnlyDevice(s: MdnsService, info: { remoteName?: string; brandDisplayName?: string; modelDisplayName?: string; deviceType?: string } | null): NetDevice | null {
  const kind = kindOfConnect(info);
  if (!kind) return null;
  const model = (info?.modelDisplayName ?? "").replace(/_/g, " ");
  const name = (info?.remoteName ?? "").trim() || `${NAME_OF_KIND[kind]} (${s.host.split(".").pop()})`;
  return { id: `${kind}:${s.host}`, kind, name, model, host: s.host, port: s.port };
}
