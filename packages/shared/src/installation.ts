/** Versioned shared game installation on a host. */
export interface GameInstallation {
  id: string;
  gameType: 'bannerlord-coop';
  gameVersion: string;
  coopCommit: string;
  /** e.g. layered-v1 */
  layout: string;
  /** Absolute path under the host data root. */
  path: string;
  hostId: string;
  createdAt?: string;
}
