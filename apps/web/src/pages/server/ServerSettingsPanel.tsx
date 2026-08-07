import { useEffect, useMemo, useState } from 'react';
import type { ServerConfigBundle } from '@bannerlord-panel/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

const DIFFICULTY_LEVELS = ['', 'VeryEasy', 'Easy', 'Realistic'] as const;

const DIFFICULTY_FIELDS: { key: string; label: string; kind: 'select' | 'bool' }[] =
  [
    { key: 'playerReceivedDamage', label: 'Player received damage', kind: 'select' },
    {
      key: 'playerTroopsReceivedDamage',
      label: 'Player troops received damage',
      kind: 'select',
    },
    { key: 'combatAIDifficulty', label: 'Combat AI difficulty', kind: 'select' },
    { key: 'recruitmentDifficulty', label: 'Recruitment difficulty', kind: 'select' },
    {
      key: 'playerMapMovementSpeed',
      label: 'Player map movement speed',
      kind: 'select',
    },
    {
      key: 'stealthAndDisguiseDifficulty',
      label: 'Stealth and disguise',
      kind: 'select',
    },
    {
      key: 'persuasionSuccessChance',
      label: 'Persuasion success chance',
      kind: 'select',
    },
    {
      key: 'clanMemberDeathChance',
      label: 'Clan member death chance',
      kind: 'select',
    },
    { key: 'battleDeath', label: 'Battle death', kind: 'select' },
    { key: 'birthAndDeath', label: 'Birth and death', kind: 'bool' },
    {
      key: 'autoAllocateClanMemberPerks',
      label: 'Auto-allocate clan member perks',
      kind: 'bool',
    },
  ];

const DEFAULT_MOD_OPTIONS: Record<string, unknown> = {
  fastForwardEnabled: true,
  autoPauseEnabled: true,
  clientsCanUseCheats: false,
  goldFoodInfluenceChangeInSettlements: true,
  goldFoodInfluenceChangeInBattles: 'OneDayMax',
  goldFoodInfluenceChangeForDisconnectedPlayers: false,
  playerBattleAiJoinWindowHours: 24,
  speedLimitWhilePlayersInBattle: true,
  wandererLimit: 32,
  wandererLimitScalesWithPlayers: false,
  playerKingdomClanTierRequired: 4,
  smithingStaminaRecoveryOutsideSettlements: true,
  smithingStaminaRecoveryMultiplier: 0.1,
  maximumLootersMultiplier: 1.0,
};

function levelLabel(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'Use save/default';
  }
  return String(value);
}

export function ServerSettingsPanel({ serverId }: { serverId: string }) {
  const { can, user } = useAuth();
  const canWrite = can('servers:write');
  const showConfigPaths =
    user?.role === 'admin' || user?.role === 'moderator';
  const [config, setConfig] = useState<ServerConfigBundle | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const paths = useMemo(
    () => ({
      process: `servers/${serverId}/data/server-config.json`,
      mod: `servers/${serverId}/mod-config.json`,
    }),
    [serverId],
  );

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.getServerConfig(serverId);
      const merged: ServerConfigBundle = {
        process: data.config.process,
        modConfig: {
          difficulty: { ...data.config.modConfig.difficulty },
          modOptions: {
            ...DEFAULT_MOD_OPTIONS,
            ...data.config.modConfig.modOptions,
          },
        },
      };
      setConfig(merged);
      setStatus('Settings loaded from disk.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [serverId]);

  function setDifficulty(key: string, value: string | boolean | '') {
    setConfig((prev) => {
      if (!prev) return prev;
      const difficulty = { ...prev.modConfig.difficulty };
      if (value === '') delete difficulty[key];
      else difficulty[key] = value;
      return {
        ...prev,
        modConfig: { ...prev.modConfig, difficulty },
      };
    });
  }

  function setModOption(key: string, value: unknown) {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        modConfig: {
          ...prev.modConfig,
          modOptions: { ...prev.modConfig.modOptions, [key]: value },
        },
      };
    });
  }

  async function save() {
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const { process, modConfig } = config;
      // Strip empty difficulty keys; never send port/steam from client as writable
      const difficulty: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(modConfig.difficulty)) {
        if (v !== '' && v !== undefined) difficulty[k] = v;
      }
      await api.putServerConfig(serverId, {
        process: {
          saveName: process.saveName,
          autosaveMinutes: process.autosaveMinutes,
          password: process.password,
          logFile: process.logFile,
        },
        modConfig: { difficulty, modOptions: modConfig.modOptions },
      });
      setStatus('Settings saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <p className="text-sm text-muted">
        {error ?? (busy ? 'Loading settings…' : 'No config')}
      </p>
    );
  }

  const opts = config.modConfig.modOptions;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">Bannerlord Dedicated Server</h3>
          <p className="mt-1 text-sm text-muted">
            Configure modules, choose a compatible campaign save, and manage the
            Coop server.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Reload from disk
        </Button>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Server Settings"
          description="Process options, campaign difficulty, and Coop gameplay."
        />
        <div className="grid gap-4 p-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <Card className="border-border/80 bg-surface-2/40">
              <CardHeader
                title="Dedicated Server"
                description="Process-level options stored in server-config.json."
              />
              <div className="space-y-4 p-4">
                <div>
                  <Label>Save name</Label>
                  <Input
                    value={config.process.saveName}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        process: { ...config.process, saveName: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Autosave interval (minutes; 0 disables)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={config.process.autosaveMinutes}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        process: {
                          ...config.process,
                          autosaveMinutes: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={config.process.password}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        process: { ...config.process, password: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Port (allocated)</Label>
                  <Input value={config.process.port} readOnly disabled />
                </div>
                <Checkbox
                  label="Write the dedicated-server log file"
                  checked={config.process.logFile}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      process: {
                        ...config.process,
                        logFile: e.target.checked,
                      },
                    })
                  }
                />
              </div>
            </Card>

            <Card className="border-border/80 bg-surface-2/40">
              <CardHeader
                title="Campaign Difficulty"
                description="Leave as Use save/default to keep the save's own setting."
              />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {DIFFICULTY_FIELDS.map((field) =>
                  field.kind === 'bool' ? (
                    <Checkbox
                      key={field.key}
                      label={field.label}
                      checked={Boolean(config.modConfig.difficulty[field.key])}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setDifficulty(field.key, e.target.checked)
                      }
                    />
                  ) : (
                    <div key={field.key}>
                      <Label>{field.label}</Label>
                      <Select
                        value={String(
                          config.modConfig.difficulty[field.key] ?? '',
                        )}
                        disabled={!canWrite}
                        onChange={(e) =>
                          setDifficulty(field.key, e.target.value)
                        }
                      >
                        {DIFFICULTY_LEVELS.map((level) => (
                          <option key={level || 'default'} value={level}>
                            {levelLabel(level)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ),
                )}
              </div>
            </Card>
          </div>

          <Card className="border-border/80 bg-surface-2/40">
            <CardHeader
              title="Coop Gameplay"
              description="modOptions stored in mod-config.json."
            />
            <div className="space-y-3 p-4">
              <Checkbox
                label="Allow fast forward"
                checked={Boolean(opts.fastForwardEnabled)}
                disabled={!canWrite}
                onChange={(e) =>
                  setModOption('fastForwardEnabled', e.target.checked)
                }
              />
              <Checkbox
                label="Enable Coop automatic pausing"
                checked={Boolean(opts.autoPauseEnabled)}
                disabled={!canWrite}
                onChange={(e) =>
                  setModOption('autoPauseEnabled', e.target.checked)
                }
              />
              <Checkbox
                label="Clients can use cheats"
                checked={Boolean(opts.clientsCanUseCheats)}
                disabled={!canWrite}
                onChange={(e) =>
                  setModOption('clientsCanUseCheats', e.target.checked)
                }
              />
              <Checkbox
                label="Gold & food change in settlements"
                checked={Boolean(opts.goldFoodInfluenceChangeInSettlements)}
                disabled={!canWrite}
                onChange={(e) =>
                  setModOption(
                    'goldFoodInfluenceChangeInSettlements',
                    e.target.checked,
                  )
                }
              />
              <div>
                <Label>Economy changes during battles</Label>
                <Select
                  value={String(opts.goldFoodInfluenceChangeInBattles ?? 'OneDayMax')}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setModOption(
                      'goldFoodInfluenceChangeInBattles',
                      e.target.value,
                    )
                  }
                >
                  <option value="Disabled">Disabled</option>
                  <option value="OneDayMax">OneDayMax</option>
                  <option value="Enabled">Enabled</option>
                </Select>
              </div>
              <Checkbox
                label="Gold & food for disconnected players"
                checked={Boolean(
                  opts.goldFoodInfluenceChangeForDisconnectedPlayers,
                )}
                disabled={!canWrite}
                onChange={(e) =>
                  setModOption(
                    'goldFoodInfluenceChangeForDisconnectedPlayers',
                    e.target.checked,
                  )
                }
              />
              <div>
                <Label>AI battle join window (hours)</Label>
                <Input
                  type="number"
                  value={Number(opts.playerBattleAiJoinWindowHours ?? 24)}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setModOption(
                      'playerBattleAiJoinWindowHours',
                      Number(e.target.value),
                    )
                  }
                />
              </div>
              <Checkbox
                label="Speed limit while players in battle"
                checked={Boolean(opts.speedLimitWhilePlayersInBattle)}
                disabled={!canWrite}
                onChange={(e) =>
                  setModOption(
                    'speedLimitWhilePlayersInBattle',
                    e.target.checked,
                  )
                }
              />
              <div>
                <Label>Wanderer limit</Label>
                <Input
                  type="number"
                  value={Number(opts.wandererLimit ?? 32)}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setModOption('wandererLimit', Number(e.target.value))
                  }
                />
              </div>
              <Checkbox
                label="Wanderer limit scales with players"
                checked={Boolean(opts.wandererLimitScalesWithPlayers)}
                disabled={!canWrite}
                onChange={(e) =>
                  setModOption(
                    'wandererLimitScalesWithPlayers',
                    e.target.checked,
                  )
                }
              />
              <div>
                <Label>Kingdom clan tier required</Label>
                <Input
                  type="number"
                  value={Number(opts.playerKingdomClanTierRequired ?? 4)}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setModOption(
                      'playerKingdomClanTierRequired',
                      Number(e.target.value),
                    )
                  }
                />
              </div>
              <Checkbox
                label="Smithing stamina recovery outside settlements"
                checked={Boolean(
                  opts.smithingStaminaRecoveryOutsideSettlements,
                )}
                disabled={!canWrite}
                onChange={(e) =>
                  setModOption(
                    'smithingStaminaRecoveryOutsideSettlements',
                    e.target.checked,
                  )
                }
              />
              <div>
                <Label>Smithing stamina recovery multiplier</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={Number(opts.smithingStaminaRecoveryMultiplier ?? 0.1)}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setModOption(
                      'smithingStaminaRecoveryMultiplier',
                      Number(e.target.value),
                    )
                  }
                />
              </div>
              <div>
                <Label>Maximum looters multiplier</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={Number(opts.maximumLootersMultiplier ?? 1)}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setModOption(
                      'maximumLootersMultiplier',
                      Number(e.target.value),
                    )
                  }
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="text-xs text-muted">
            {showConfigPaths ? (
              <>
                <p>{paths.process}</p>
                <p>{paths.mod}</p>
              </>
            ) : null}
            {status ? (
              <p className={showConfigPaths ? 'mt-1 text-success' : 'text-success'}>
                {status}
              </p>
            ) : null}
            {error ? (
              <p className={showConfigPaths ? 'mt-1 text-danger' : 'text-danger'}>
                {error}
              </p>
            ) : null}
          </div>
          {canWrite ? (
            <Button disabled={busy} onClick={() => void save()}>
              Save settings
            </Button>
          ) : (
            <p className="text-sm text-muted">Read-only for your role</p>
          )}
        </div>
      </Card>
    </div>
  );
}
