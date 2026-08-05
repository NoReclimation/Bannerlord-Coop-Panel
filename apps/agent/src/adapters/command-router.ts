import type {
  AgentCommandRequest,
  AgentCommandResponse,
  FsCompressPayload,
  FsPathPayload,
  FsRenamePayload,
  FsSearchPayload,
  FsWritePayload,
  InstallationImportPayload,
  InstallationInspectPayload,
  ServerBackupCreatePayload,
  ServerBackupIdPayload,
  ServerBackupRestorePayload,
  ServerCreatePayload,
  ServerIdPayload,
  ServerPutConfigPayload,
} from '@bannerlord-panel/shared';
import type { DockerServerManager } from '../docker/server-manager.js';
import type { ServerFileManager } from '../fs/server-file-manager.js';
import type { BackupManager } from '../fs/backup-manager.js';
import type { InstallationManager } from '../fs/installation-manager.js';

interface ConfigLookupPayload extends ServerIdPayload {
  gamePort: number;
}

interface FsExtractPayload extends FsPathPayload {
  dest?: string;
}

/**
 * Dispatches agent commands to Docker / filesystem / backup services.
 */
export class AgentCommandRouter {
  constructor(
    private readonly docker: DockerServerManager,
    private readonly files: ServerFileManager,
    private readonly backups: BackupManager,
    private readonly installations: InstallationManager,
  ) {}

  async handle(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    try {
      switch (request.action) {
        case 'server.create': {
          const payload = request.payload as ServerCreatePayload;
          const result = await this.docker.create(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'server.start': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.start(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.stop': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.stop(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.restart': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.restart(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.kill': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.kill(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.delete': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.delete(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.status': {
          const { serverId } = request.payload as ServerIdPayload;
          const result = await this.docker.status(serverId);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'server.getConfig': {
          const { serverId, gamePort } = request.payload as ConfigLookupPayload;
          const result = await this.docker.getConfig(serverId, gamePort);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'server.putConfig': {
          const payload = request.payload as ServerPutConfigPayload & {
            gamePort: number;
          };
          const result = await this.docker.putConfig(payload, payload.gamePort);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'server.backup': {
          const payload = request.payload as ServerBackupCreatePayload;
          const result = await this.backups.create(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'server.restoreBackup': {
          const payload = request.payload as ServerBackupRestorePayload;
          await this.backups.restore(payload);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.deleteBackup': {
          const payload = request.payload as ServerBackupIdPayload;
          await this.backups.delete(payload);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.readBackup': {
          const payload = request.payload as ServerBackupIdPayload;
          const result = await this.backups.read(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'installation.ensureDirs': {
          const result = await this.installations.ensureDirs();
          return { requestId: request.requestId, ok: true, result };
        }
        case 'installation.inspect': {
          const payload = request.payload as InstallationInspectPayload;
          const result = await this.installations.inspect(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'installation.import': {
          const payload = request.payload as InstallationImportPayload;
          const result = await this.installations.importFromPath(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'fs.list': {
          const { serverId, path } = request.payload as FsPathPayload;
          const result = await this.files.list(serverId, path);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'fs.read': {
          const { serverId, path } = request.payload as FsPathPayload;
          const result = await this.files.read(serverId, path);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'fs.write': {
          const payload = request.payload as FsWritePayload;
          const result = await this.files.write(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'fs.mkdir': {
          const { serverId, path } = request.payload as FsPathPayload;
          const result = await this.files.mkdir(serverId, path);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'fs.rename': {
          const payload = request.payload as FsRenamePayload;
          const result = await this.files.rename(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'fs.move': {
          const payload = request.payload as FsRenamePayload;
          const result = await this.files.move(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'fs.delete': {
          const { serverId, path } = request.payload as FsPathPayload;
          await this.files.delete(serverId, path);
          return { requestId: request.requestId, ok: true };
        }
        case 'fs.search': {
          const payload = request.payload as FsSearchPayload;
          const result = await this.files.search(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'fs.extractZip': {
          const payload = request.payload as FsExtractPayload;
          const result = await this.files.extractZip(
            payload.serverId,
            payload.path,
            payload.dest,
          );
          return { requestId: request.requestId, ok: true, result };
        }
        case 'fs.compress': {
          const payload = request.payload as FsCompressPayload;
          const result = await this.files.compress(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        default:
          return {
            requestId: request.requestId,
            ok: false,
            error: `Unsupported action: ${request.action}`,
          };
      }
    } catch (err) {
      return {
        requestId: request.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
