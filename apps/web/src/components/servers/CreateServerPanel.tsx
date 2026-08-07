import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GameInstallation, ModpackPreset } from '@bannerlord-panel/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';

export function CreateServerPanel({
  onCreated,
  onCancel,
}: {
  onCreated?: () => void;
  onCancel?: () => void;
}) {
  const navigate = useNavigate();
  const [installations, setInstallations] = useState<GameInstallation[]>([]);
  const [modpacks, setModpacks] = useState<ModpackPreset[]>([]);
  const [hostId, setHostId] = useState('');
  const [name, setName] = useState('coop-1');
  const [modpackId, setModpackId] = useState('');
  const [password, setPassword] = useState('');
  const [saveName, setSaveName] = useState('saveauto1');
  const [startAfter, setStartAfter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [instData, hostsData] = await Promise.all([
          api.listInstallations(),
          api.listHosts().catch(() => ({ hosts: [] })),
        ]);
        setInstallations(instData.installations);

        const firstInstall = instData.installations[0];
        const resolvedHostId =
          firstInstall?.hostId ?? hostsData.hosts[0]?.id ?? '';
        setHostId(resolvedHostId);

        if (resolvedHostId) {
          const packsData = await api
            .listModpacks(resolvedHostId)
            .catch(() => ({ modpacks: [] as ModpackPreset[] }));
          setModpacks(packsData.modpacks);
          if (packsData.modpacks[0]) {
            setModpackId(packsData.modpacks[0].id);
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load create form',
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (installations.length === 0) {
        throw new Error('Import an installation first');
      }
      if (!modpackId) {
        throw new Error('Select a modpack');
      }
      const { server } = await api.createServer({
        name: name.trim(),
        hostId: hostId || undefined,
        installationId: installations[0]?.id,
        modpackId,
        password,
        saveName: saveName.trim() || 'saveauto1',
        start: startAfter,
      });
      onCreated?.();
      navigate(`/servers/${server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy && !loading && installations.length > 0 && modpacks.length > 0;

  return (
    <Card>
      <CardHeader
        title="Create server"
        description="Creates the instance folder, Docker container, and optionally starts it."
        action={
          onCancel ? (
            <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
              Cancel
            </Button>
          ) : null
        }
      />
      <form className="space-y-4 p-4" onSubmit={(e) => void handleSubmit(e)}>
        {installations.length === 0 && !loading ? (
          <p className="text-sm text-muted">
            No installations registered. Go to{' '}
            <Link to="/installations" className="text-accent hover:underline">
              Installations
            </Link>{' '}
            and import a DedicatedServer package first.
          </p>
        ) : null}

        {installations.length > 0 && modpacks.length === 0 && !loading ? (
          <p className="text-sm text-muted">
            No modpacks on this host yet. Create one under{' '}
            <Link to="/mods" className="text-accent hover:underline">
              Mods
            </Link>{' '}
            first.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="srv-name">Name</Label>
            <Input
              id="srv-name"
              value={name}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="srv-modpack">Modpack</Label>
            <Select
              id="srv-modpack"
              value={modpackId}
              required
              disabled={loading || modpacks.length === 0}
              onChange={(e) => setModpackId(e.target.value)}
            >
              <option value="" disabled>
                {loading ? 'Loading…' : 'Select…'}
              </option>
              {modpacks.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name} ({pack.enabledOrderedIds.length} modules)
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="srv-save">Save name</Label>
            <Input
              id="srv-save"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="srv-pass">Join password (optional)</Label>
            <Input
              id="srv-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        <Checkbox
          label="Start server after create"
          checked={startAfter}
          onChange={(e) => setStartAfter(e.target.checked)}
        />

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <Button type="submit" disabled={!canSubmit}>
          {startAfter ? 'Create & start' : 'Create'}
        </Button>
      </form>
    </Card>
  );
}
