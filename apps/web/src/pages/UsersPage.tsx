import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AuthUser, UserRole } from '@bannerlord-panel/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ROLES: UserRole[] = ['user', 'moderator', 'admin'];

export function UsersPage() {
  const { user: me, can } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('user');

  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('user');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editDisabled, setEditDisabled] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.listUsers();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (can('users:manage')) void load();
  }, [can, load]);

  if (!can('users:manage')) {
    return <p className="text-danger">Admin access required.</p>;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api.createUser({
        username: username.trim(),
        password,
        role,
        displayName: displayName.trim() || undefined,
      });
      setUsername('');
      setPassword('');
      setDisplayName('');
      setRole('user');
      setStatus('User created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(u: AuthUser) {
    setEditId(u.id);
    setEditRole(u.role);
    setEditDisplayName(u.displayName ?? '');
    setEditPassword('');
    setEditDisabled(u.disabled);
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api.updateUser(editId, {
        role: editRole,
        displayName: editDisplayName.trim() || null,
        disabled: editDisabled,
        ...(editPassword ? { password: editPassword } : {}),
      });
      setEditId(null);
      setStatus('User updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(u: AuthUser) {
    if (u.id === me?.id) return;
    if (!window.confirm(`Delete user "${u.username}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteUser(u.id);
      setStatus(`Deleted ${u.username}.`);
      if (editId === u.id) setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Users</h2>
        <p className="mt-1 text-sm text-muted">
          Create user and moderator accounts. Users can start/stop/restart;
          moderators can also create servers and request deletes.
        </p>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {status ? <p className="text-sm text-success">{status}</p> : null}

      <Card>
        <CardHeader title="Create account" />
        <form onSubmit={(e) => void onCreate(e)} className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-username">Username</Label>
            <Input
              id="new-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
            />
          </div>
          <div>
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div>
            <Label htmlFor="new-display">Display name</Label>
            <Input
              id="new-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-role">Role</Label>
            <select
              id="new-role"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Create user
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Accounts" description={`${users.length} user(s)`} />
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Username</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{u.username}</div>
                    {u.displayName ? (
                      <div className="text-xs text-muted">{u.displayName}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 capitalize">{u.role}</td>
                  <td className="py-2 pr-3">
                    {u.disabled ? 'Disabled' : 'Active'}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => startEdit(u)}
                      >
                        Edit
                      </Button>
                      {u.id !== me?.id ? (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => void onDelete(u)}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editId ? (
        <Card>
          <CardHeader title="Edit user" />
          <form
            onSubmit={(e) => void onSaveEdit(e)}
            className="grid gap-3 px-4 pb-4 sm:grid-cols-2"
          >
            <div>
              <Label htmlFor="edit-role">Role</Label>
              <select
                id="edit-role"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as UserRole)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="edit-display">Display name</Label>
              <Input
                id="edit-display"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-password">New password (optional)</Label>
              <Input
                id="edit-password"
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                minLength={8}
              />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editDisabled}
                  onChange={(e) => setEditDisabled(e.target.checked)}
                />
                Disabled
              </label>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditId(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
