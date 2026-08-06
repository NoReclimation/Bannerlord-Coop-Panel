import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Socket } from 'socket.io-client';
import Anser from 'anser';
import {
  WsEvents,
  type ConsoleLinePayload,
  type ConsoleStatusPayload,
  type PlayerCountPayload,
} from '@bannerlord-panel/shared';
import { getAccessToken } from '@/lib/api';
import { acquireClientSocket, releaseClientSocket } from '@/lib/client-socket';
import { parsePulsePlayerCount } from '@/lib/pulse';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MAX_LINES = 4000;
const HISTORY_KEY = 'bp.consoleHistory';

interface DisplayLine {
  id: number;
  raw: string;
  stream: 'stdout' | 'stderr';
  at: string;
  html: string;
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.slice(-100) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-100)));
}

function toHtml(line: string, stream: 'stdout' | 'stderr'): string {
  const html = Anser.ansiToHtml(Anser.escapeForHtml(line), {
    use_classes: false,
  });
  if (stream === 'stderr') {
    return `<span style="color:#e85d5d">${html}</span>`;
  }
  return html;
}

export function ServerConsole({ serverId }: { serverId: string }) {
  const { can } = useAuth();
  const canWrite = can('console:write');
  const [lines, setLines] = useState<DisplayLine[]>([]);
  const [status, setStatus] = useState('Connecting…');
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const lineId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const pausedRef = useRef(paused);
  const bufferRef = useRef<DisplayLine[]>([]);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && bufferRef.current.length > 0) {
      setLines((prev) =>
        [...prev, ...bufferRef.current].slice(-MAX_LINES),
      );
      bufferRef.current = [];
    }
  }, [paused]);

  const appendLine = useCallback((payload: ConsoleLinePayload) => {
    const entry: DisplayLine = {
      id: ++lineId.current,
      raw: payload.line,
      stream: payload.stream,
      at: payload.at,
      html: toHtml(payload.line, payload.stream),
    };
    const fromPulse = parsePulsePlayerCount(payload.line);
    if (fromPulse !== null) {
      setPlayerCount(fromPulse);
    }
    if (pausedRef.current) {
      bufferRef.current.push(entry);
      if (bufferRef.current.length > MAX_LINES) {
        bufferRef.current = bufferRef.current.slice(-MAX_LINES);
      }
      return;
    }
    setLines((prev) => [...prev, entry].slice(-MAX_LINES));
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setStatus('Not authenticated');
      return;
    }

    setPlayerCount(null);
    const socket = acquireClientSocket(token);
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      setStatus('Connected — subscribing…');
      socket.emit(WsEvents.ConsoleSubscribe, { serverId });
    };

    const onDisconnect = () => {
      setConnected(false);
      setStatus('Disconnected — reconnecting…');
    };

    const onConnectError = (err: Error) => {
      setStatus(`Connection error: ${err.message}`);
    };

    const onConsoleLine = (payload: ConsoleLinePayload) => {
      if (payload.serverId !== serverId) return;
      appendLine(payload);
    };

    const onPlayerCount = (payload: PlayerCountPayload) => {
      if (payload.serverId !== serverId) return;
      setPlayerCount(payload.playerCount);
    };

    const onConsoleStatus = (payload: ConsoleStatusPayload) => {
      if (payload.serverId !== serverId) return;
      setStatus(payload.message ?? (payload.streaming ? 'Live' : 'Idle'));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on(WsEvents.ConsoleLine, onConsoleLine);
    socket.on(WsEvents.PlayerCount, onPlayerCount);
    socket.on(WsEvents.ConsoleStatus, onConsoleStatus);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.emit(WsEvents.ConsoleUnsubscribe, { serverId });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off(WsEvents.ConsoleLine, onConsoleLine);
      socket.off(WsEvents.PlayerCount, onPlayerCount);
      socket.off(WsEvents.ConsoleStatus, onConsoleStatus);
      socketRef.current = null;
      releaseClientSocket();
    };
  }, [serverId, appendLine]);

  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, paused]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => l.raw.toLowerCase().includes(q));
  }, [lines, search]);

  function clearConsole() {
    setLines([]);
    bufferRef.current = [];
  }

  function downloadLog() {
    const text = lines.map((l) => l.raw).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `console-${serverId}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function sendCommand() {
    const cmd = command.trim();
    if (!cmd || !canWrite || !socketRef.current) return;
    socketRef.current.emit(WsEvents.ConsoleCommand, {
      serverId,
      command: cmd,
    });
    const nextHistory = [...history.filter((h) => h !== cmd), cmd];
    setHistory(nextHistory);
    saveHistory(nextHistory);
    setHistoryIndex(-1);
    setCommand('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendCommand();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next =
        historyIndex < 0
          ? history.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setCommand(history[next] ?? '');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex < 0) return;
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(-1);
        setCommand('');
      } else {
        setHistoryIndex(next);
        setCommand(history[next] ?? '');
      }
    }
  }

  return (
    <Card>
      <CardHeader
        title="Live Console"
        description={status}
        action={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">
              {playerCount != null ? (
                <>
                  <span className="font-medium text-text">{playerCount}</span>
                  {playerCount === 1
                    ? ' player connected'
                    : ' players connected'}
                </>
              ) : (
                '— players connected'
              )}
            </span>
            <span
              className={cn(
                'inline-flex size-2 rounded-full',
                connected ? 'bg-success' : 'bg-danger',
              )}
              title={connected ? 'Connected' : 'Disconnected'}
            />
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Input
          className="max-w-xs"
          placeholder="Search console…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button size="sm" variant="secondary" onClick={clearConsole}>
          Clear
        </Button>
        <Button size="sm" variant="secondary" onClick={downloadLog}>
          Download log
        </Button>
      </div>

      <div className="h-[420px] overflow-auto bg-[#070b14] px-3 py-2 font-mono text-[12px] leading-5">
        {filtered.length === 0 ? (
          <p className="text-muted">Waiting for console output…</p>
        ) : (
          filtered.map((line) => (
            <div
              key={line.id}
              className="whitespace-pre-wrap break-all text-text/90"
              dangerouslySetInnerHTML={{ __html: line.html }}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 border-t border-border p-3">
        <Input
          placeholder={
            canWrite
              ? 'Enter command — ↑/↓ history — Enter to send'
              : 'Read-only console'
          }
          value={command}
          disabled={!canWrite}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button disabled={!canWrite || !command.trim()} onClick={sendCommand}>
          Send
        </Button>
      </div>
    </Card>
  );
}
