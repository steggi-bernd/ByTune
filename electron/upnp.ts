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
import { describe, isLanUrl, parseSsdp, type Renderer } from "./upnp-control";

export * from "./upnp-control";

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
