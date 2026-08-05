/** Host / node that runs a Management Agent. */
export type HostStatus = 'online' | 'offline' | 'disabled';

export interface HostNode {
  id: string;
  name: string;
  /** Agent base URL or WebSocket URL. */
  endpoint: string;
  /** Panel data root on that host, e.g. /var/lib/bannerlord-panel */
  dataRoot: string;
  status: HostStatus;
  capabilities?: string[];
  createdAt?: string;
}
