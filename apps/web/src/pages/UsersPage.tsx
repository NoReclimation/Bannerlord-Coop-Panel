import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AuthUser, GameServerRecord, UserRole } from '@bannerlord-panel/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ROLES: UserRole[] = ['user', 'moderator', 'admin'];

export function UsersPage() {
  const { user: me, can } = useAuth();
  const canManage = can('users:manage');
  const canAssign = can('servers:assign');

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [servers, setServers] = useState<GameServerRecord[]>([]);
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
  const [editServerIds, setEditServerIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [usersData, serversData] = await Promise.all([
        api.listUsers(),
        canAssign ? api.listServers() : Promise.resolve({ servers: [] }),
      ]);
      setUsers(usersData.users);
      setServers(serversData.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setBusy(false);
    }
  }, [canAssign]);

  useEffect(() => {
    if (canManage || canAssign) void load();
  }, [canManage, canAssign, load]);

  if (!canManage && !canAssign) {
    return <p className="text-danger">Access required.</p>;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
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

  async function startEdit(u: AuthUser) {
    setEditId(u.id);
    setEditRole(u.role);
    setEditDisplayName(u.displayName ?? '');
    setEditPassword('');
    setEditDisabled(u.disabled);
    setEditServerIds(new Set());

    if (!canAssign || u.role !== 'user') return;

    setBusy(true);
    setError(null);
    try {
      const data = await api.listUserServers(u.id);
      setEditServerIds(new Set(data.serverIds));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load server access',
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleEditServer(serverId: string) {
    setEditServerIds((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editId || (!canManage && !canAssign)) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (canManage) {
        await api.updateUser(editId, {
          role: editRole,
          displayName: editDisplayName.trim() || null,
          disabled: editDisabled,
          ...(editPassword ? { password: editPassword } : {}),
        });
      }
      if (canAssign && editRole === 'user') {
        await api.setUserServers(editId, [...editServerIds]);
      }
      setEditId(null);
      setStatus(canManage ? 'User updated.' : 'Server assignments saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(u: AuthUser) {
    if (!canManage || u.id === me?.id) return;
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

  const editUser = users.find((u) => u.id === editId) ?? null;
  const showServerAccess =
    canAssign && editId != null && editRole === 'user';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Users</h2>
        <p className="mt-1 text-sm text-muted">
          {canManage
            ? 'Create accounts and assign servers. Regular users only see servers assigned to them.'
            : 'Assign servers to user accounts. Regular users only see servers assigned to them.'}
        </p>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {status ? <p className="text-sm text-success">{status}</p> : null}

      {canManage ? (
        <Card>
          <CardHeader title="Create account" />
          <form
            onSubmit={(e) => void onCreate(e)}
            className="grid gap-3 px-4 pb-4 sm:grid-cols-2"
          >
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
      ) : null}

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
                <tr
                  key={u.id}
                  className="border-b border-border/60 last:border-0"
                >
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
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void startEdit(u)}
                        >
                          Edit
                        </Button>
                      ) : canAssign && u.role === 'user' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void startEdit(u)}
                        >
                          Assign servers
                        </Button>
                      ) : null}
                      {canManage && u.id !== me?.id ? (
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

      {editId && (canManage || showServerAccess) ? (
        <Card>
          <CardHeader
            title={
              canManage
                ? `Edit user${editUser ? ` — ${editUser.username}` : ''}`
                : `Assign servers — ${editUser?.username ?? ''}`
            }
            description={
              showServerAccess
                ? 'Only checked servers appear on this user\'s dashboard.'
                : undefined
            }
          />
          <form
            onSubmit={(e) => void onSaveEdit(e)}
            className="grid gap-3 px-4 pb-4 sm:grid-cols-2"
          >
            {canManage ? (
              <>
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
              </>
            ) : null}

            {showServerAccess ? (
              <div className="sm:col-span-2 space-y-2 border-t border-border pt-3">
                <Label>Server access</Label>
                {servers.length === 0 ? (
                  <p className="text-sm text-muted">No servers available.</p>
                ) : (
                  <ul className="space-y-2">
                    {servers.map((s) => (
                      <li key={s.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editServerIds.has(s.id)}
                            onChange={() => toggleEditServer(s.id)}
                          />
                          <span className="font-medium">{s.name}</span>
                          <span className="text-muted">
                            UDP {s.gamePort} · {s.saveName}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : canManage && editRole !== 'user' ? (
              <p className="sm:col-span-2 text-sm text-muted border-t border-border pt-3">
                Admins and moderators can access every server. Switch the role
                to <span className="font-medium text-fg">user</span> to assign
                specific servers.
              </p>
            ) : null}

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
