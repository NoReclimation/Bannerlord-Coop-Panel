/** Global / host settings related to port allocation. */
export interface PortSettings {
  /** First UDP game port to assign on a host. Default 4200. */
  gamePortBase: number;
  /** First engine/dedicatedcustomserver port when exposed. Default 7210. */
  enginePortBase: number;
}

export const DEFAULT_PORT_SETTINGS: PortSettings = {
  gamePortBase: 4200,
  enginePortBase: 7210,
};

/**
 * Ports the Coop DedicatedServer process actually binds inside the container.
 * Current builds hardcode these (server-config.json has no port key); the panel
 * publishes host gamePort/enginePort → these container ports via Docker NAT.
 */
export const COOP_CONTAINER_LISTEN = {
  gamePort: 4200,
  enginePort: 7210,
} as const;

/**
 * Process-level Coop server-config fields the panel manages.
 * `steam` is always forced false; `port` is allocator-owned (Docker publish).
 */
export interface ServerProcessConfig {
  saveName: string;
  autosaveMinutes: number;
  password: string;
  logFile: boolean;
  /** Allocated by the panel — not editable in the UI. */
  port: number;
  /** Always false for panel-managed servers. */
  steam: false;
}
