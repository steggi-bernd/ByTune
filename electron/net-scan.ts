/**
 * What else answers on the network besides UPnP players (upnp.ts): Cast devices
 * over mDNS, and Echos and Fire TVs by the Spotify Connect service they all run.
 * The packets are read in src/lib/netScan.ts, one copy with the phone.
 */
import { askLan } from "./net-lan";
import { devicesFromMdns, MDNS_ADDRESS, MDNS_PORT, mdnsQuery, readMdns, type MdnsService, type NetDevice } from "../src/lib/netScan";

export async function scanMdns(waitMs = 2500): Promise<NetDevice[]> {
  const services = new Map<string, MdnsService>();
  await askLan(MDNS_ADDRESS, MDNS_PORT, Buffer.from(mdnsQuery()), waitMs, (answer, from) => readMdns(new Uint8Array(answer), from, services));
  return devicesFromMdns(services.values());
}
