/**
 * What else answers on the network besides UPnP players (upnp.ts): Cast devices
 * over mDNS, and Echos and Fire TVs by the Spotify Connect service they all run.
 * The packets are read in src/lib/netScan.ts, one copy with the phone.
 */
import * as dgram from "dgram";
import { devicesFromMdns, MDNS_ADDRESS, MDNS_PORT, mdnsQuery, readMdns, type MdnsService, type NetDevice } from "../src/lib/netScan";

export async function scanMdns(waitMs = 2500): Promise<NetDevice[]> {
  const services = new Map<string, MdnsService>();
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  socket.on("message", (msg, rinfo) => readMdns(new Uint8Array(msg), rinfo?.address ?? "", services));
  socket.on("error", () => undefined);
  await new Promise<void>((resolve) => socket.bind(0, resolve));
  const query = Buffer.from(mdnsQuery());
  socket.send(query, MDNS_PORT, MDNS_ADDRESS);
  // UDP may drop one, and sleeping devices answer late.
  const again = setTimeout(() => socket.send(query, MDNS_PORT, MDNS_ADDRESS), 700);
  await new Promise((r) => setTimeout(r, waitMs));
  clearTimeout(again);
  socket.close();
  return devicesFromMdns(services.values());
}
