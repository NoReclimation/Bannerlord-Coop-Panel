import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GameInstallation } from '@bannerlord-panel/shared';
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
  const [name, setName] = useState('coop-1');
  const [installationId, setInstallationId] = useState('');
  const [password, setPassword] = useState('');
  const [saveName, setSaveName] = useState('saveauto1');
  const [startAfter, setStartAfter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.listInstallations();
        setInstallations(data.installations);
        if (data.installations[0]) {
          setInstallationId(data.installations[0].id);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load installations',
        );
      }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!installationId) {
        throw new Error('Select an installation (import one first)');
      }
      const { server } = await api.createServer({
        name: name.trim(),
        installationId,
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
        {installations.length === 0 ? (
          <p className="text-sm text-muted">
            No installations registered. Go to{' '}
            <Link to="/installations" className="text-accent hover:underline">
              Installations
            </Link>{' '}
            and import a DedicatedServer package first.
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
            <Label htmlFor="srv-inst">Installation</Label>
            <Select
              id="srv-inst"
              value={installationId}
              required
              onChange={(e) => setInstallationId(e.target.value)}
            >
              <option value="" disabled>
                Select…
              </option>
              {installations.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.id} ({inst.gameVersion})
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

        <Button type="submit" disabled={busy || installations.length === 0}>
          {startAfter ? 'Create & start' : 'Create'}
        </Button>
      </form>
    </Card>
  );
}
