/** Who is signed in where. The login token lives in the phone's secure store; the password is never kept. */
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import Player from "../../modules/media3-player";
import { authHeader, signIn, signOut, type Session } from "../jellyfin";

const KEY = "session";

interface SessionState {
  ready: boolean;
  session: Session | null;
  restore(): Promise<void>;
  signIn(server: string, username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

/** The player's streams go out under this login. */
const authorizePlayer = (s: Session): Promise<void> =>
  Player.setAuth(s.server, { Authorization: authHeader(s.deviceId, s.token) });

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  session: null,

  async restore() {
    let session: Session | null = null;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      session = raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      /* unreadable: sign in again */
    }
    if (session) await authorizePlayer(session);
    set({ session, ready: true });
  },

  async signIn(server, username, password) {
    const session = await signIn(server, username, password);
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    await authorizePlayer(session);
    set({ session });
  },

  async signOut() {
    const { session } = get();
    set({ session: null });
    await SecureStore.deleteItemAsync(KEY);
    if (session) await signOut(session);
  },
}));
