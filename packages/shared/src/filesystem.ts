/** Server-scoped filesystem entries (paths relative to server root). */
export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  modifiedAt: string;
}

export interface FsListResult {
  path: string;
  entries: FileEntry[];
}

export interface FsReadResult {
  path: string;
  encoding: 'utf8' | 'base64';
  content: string;
  size: number;
  truncated?: boolean;
}

export interface FsWritePayload {
  serverId: string;
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
}

export interface FsPathPayload {
  serverId: string;
  path: string;
}

export interface FsRenamePayload {
  serverId: string;
  from: string;
  to: string;
}

export interface FsSearchPayload {
  serverId: string;
  path: string;
  query: string;
}

export interface FsCompressPayload {
  serverId: string;
  paths: string[];
  dest: string;
}
