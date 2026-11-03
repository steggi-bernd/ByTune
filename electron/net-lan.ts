/**
 * A question to everything on the local network. Multicast leaves a computer
 * through one interface only, the one with the best route, and with a VPN or a
 * virtual machine around that isn't always the real network: then nothing
 * answers, although everything is there. So it goes out through each of them.
 */
import * as dgram from "dgram";
import * as os from "os";

/** UDP may lose a question, and slow devices answer late. */
const ASK_AGAIN_MS = 600;

/** This computer's own addresses on its networks. */
export function lanAddresses(nets: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(nets)) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

/** Asks the group through every network, and hears every answer for `waitMs`. */
export async function askLan(group: string, port: number, question: Buffer, waitMs: number, onAnswer: (answer: Buffer, from: string) => void): Promise<void> {
  const addresses = lanAddresses();
  const sockets = await Promise.all(
    // Not on any network, as far as it can tell: the system may still know a way.
    (addresses.length ? addresses : [null]).map(async (address) => {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      socket.on("message", (answer, rinfo) => onAnswer(answer, rinfo?.address ?? ""));
      socket.on("error", () => undefined);
      await new Promise<void>((resolve) => socket.bind(0, resolve));
      if (address) socket.setMulticastInterface(address);
      return socket;
    })
  );
  const ask = (): void => {
    for (const socket of sockets) socket.send(question, port, group);
  };
  ask();
  const again = setTimeout(ask, ASK_AGAIN_MS);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  clearTimeout(again);
  for (const socket of sockets) socket.close();
}
