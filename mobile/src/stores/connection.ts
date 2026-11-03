/**
 * Whether and where the server answers from here: at home the direct way,
 * anywhere else the address away from home, or not at all. Asked again whenever
 * the network changes or the app comes back to the front.
 */
import { AppState } from "react-native";
import { create } from "zustand";
import Player from "../../modules/media3-player";
import { pickAddress, type Reach } from "../addresses";
import { serverIdAt } from "../jellyfin";
import { useSession } from "./session";

const ASK_MS = 4000;
/** Over mobile data the address at home mostly won't answer; no reason to wait long for it. */
const ASK_HOME_ON_MOBILE_MS = 1200;
/** Out of reach with the app open: the server may be back any moment. */
const ASK_AGAIN_MS = 30_000;

interface ConnectionState {
  reach: Reach;
  /** the network the phone is on costs by the byte */
  metered: boolean;
  check(): Promise<Reach>;
}

let asking: Promise<Reach> | null = null;
let again: ReturnType<typeof setTimeout> | null = null;

async function ask(): Promise<Reach> {
  const session = useSession.getState().session;
  if (!session) return "offline";
  const [homeId, awayId] = await Promise.all([
    serverIdAt(session.home, useConnection.getState().metered ? ASK_HOME_ON_MOBILE_MS : ASK_MS),
    session.away ? serverIdAt(session.away, ASK_MS) : Promise.resolve(null),
  ]);
  const { reach, server, serverId } = pickAddress(session, session.serverId, homeId, awayId);
  if (server) await useSession.getState().moveTo(server, serverId);
  useConnection.setState({ reach });
  if (again) clearTimeout(again);
  again = null;
  if (reach === "offline" && AppState.currentState === "active") {
    again = setTimeout(() => void useConnection.getState().check(), ASK_AGAIN_MS);
  }
  return reach;
}

export const useConnection = create<ConnectionState>(() => ({
  reach: "home",
  metered: false,
  check() {
    asking ??= ask().finally(() => {
      asking = null;
    });
    return asking;
  },
}));

/** Listens for the app's lifetime. */
export function watchConnection(): void {
  void Player.getNetwork().then(({ metered }) => useConnection.setState({ metered }));
  Player.addListener("onNetwork", ({ connected, metered }) => {
    useConnection.setState(connected ? { metered } : { metered, reach: "offline" });
    if (connected) void useConnection.getState().check();
  });
  AppState.addEventListener("change", (state) => {
    if (state === "active") void useConnection.getState().check();
  });
}
