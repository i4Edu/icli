export interface TeamEvent {
  type: string;
  data: unknown;
}

export interface TeamTransport {
  connect(roomId: string): Promise<void>;
  send(event: TeamEvent): Promise<void>;
  on(handler: (event: TeamEvent) => void): void;
  disconnect(): Promise<void>;
}

export const noopTeamTransport: TeamTransport = {
  async connect() {
    throw new Error('Team mode transport not configured. See docs/future.md.');
  },
  async send() {
    /* no-op */
  },
  on() {
    /* no-op */
  },
  async disconnect() {
    /* no-op */
  },
};

let _transport: TeamTransport = noopTeamTransport;

export function registerTeamTransport(t: TeamTransport): void {
  _transport = t;
}

export function getTeamTransport(): TeamTransport {
  return _transport;
}
