import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import type { FileEntry } from '@bannerlord-panel/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

const TEXT_EXT = new Set([
  '.txt',
  '.json',
  '.xml',
  '.yml',
  '.yaml',
  '.md',
  '.log',
  '.cfg',
  '.ini',
  '.csv',
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
  '.css',
  '.html',
  '.sh',
  '.env',
]);

function parentPath(path: string): string {
  if (!path || path === '.') return '.';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop();
  return parts.length ? parts.join('/') : '.';
}

function joinPath(dir: string, name: string): string {
  if (!dir || dir === '.') return name;
  return `${dir.replace(/\/$/, '')}/${name}`;
}

function isTextName(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXT.has(lower.slice(dot));
}

function isZipName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function highlightLine(line: string, ext: string): string {
  if (ext === '.json') {
    return line
      .replace(
        /("(?:\\.|[^"\\])*")\s*:/g,
        '<span class="text-accent">$1</span>:',
      )
      .replace(
        /:\s*("(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?)/g,
        ': <span class="text-muted">$1</span>',
      );
  }
  if (ext === '.xml' || ext === '.html') {
    return line.replace(
      /(&lt;\/?[\w:-]+|&gt;)/g,
      '<span class="text-accent">$1</span>',
    );
  }
  return line;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function ServerFileManager({ serverId }: { serverId: string }) {
  const { can } = useAuth();
  const canWrite = can('servers:write');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cwd, setCwd] = useState('.');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorTruncated, setEditorTruncated] = useState(false);

  const crumbs = useMemo(() => {
    if (!cwd || cwd === '.') return [{ label: 'data', path: '.' }];
    const parts = cwd.split('/').filter(Boolean);
    const items = [{ label: 'data', path: '.' }];
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      items.push({ label: part, path: acc });
    }
    return items;
  }, [cwd]);

  const load = useCallback(
    async (path = cwd) => {
      setBusy(true);
      setError(null);
      try {
        const data = await api.listFiles(serverId, path);
        setCwd(data.path);
        setEntries(data.entries);
        setSelected(new Set());
        setSearchResults(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to list files');
      } finally {
        setBusy(false);
      }
    },
    [cwd, serverId],
  );

  useEffect(() => {
    void load('.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const displayEntries = searchResults ?? entries;

  async function openDir(path: string) {
    await load(path);
  }

  async function openFile(entry: FileEntry) {
    if (entry.type === 'dir') {
      await openDir(entry.path);
      return;
    }
    if (!isTextName(entry.name)) {
      setStatus('Binary file — use Download');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api.readFile(serverId, entry.path);
      if (data.encoding !== 'utf8') {
        setStatus('Binary content — use Download');
        return;
      }
      setEditorPath(data.path);
      setEditorContent(data.content);
      setEditorDirty(false);
      setEditorTruncated(Boolean(data.truncated));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
    } finally {
      setBusy(false);
    }
  }

  async function saveEditor() {
    if (!editorPath || !canWrite) return;
    setBusy(true);
    setError(null);
    try {
      await api.writeFile(serverId, editorPath, editorContent, 'utf8');
      setEditorDirty(false);
      setStatus(`Saved ${editorPath}`);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function handleUpload(files: FileList | File[]) {
    if (!canWrite) return;
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of list) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]!);
        }
        const content = btoa(binary);
        const dest = joinPath(cwd, file.name);
        await api.writeFile(serverId, dest, content, 'base64');
      }
      setStatus(`Uploaded ${list.length} file(s)`);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(path: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      const blob = await api.downloadFile(serverId, path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleMkdir() {
    if (!canWrite) return;
    const name = window.prompt('New folder name');
    if (!name?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.mkdir(serverId, joinPath(cwd, name.trim()));
      setStatus(`Created folder ${name.trim()}`);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'mkdir failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(entry: FileEntry) {
    if (!canWrite) return;
    const name = window.prompt('Rename to', entry.name);
    if (!name?.trim() || name === entry.name) return;
    setBusy(true);
    setError(null);
    try {
      await api.renameFile(serverId, entry.path, joinPath(cwd, name.trim()));
      setStatus(`Renamed to ${name.trim()}`);
      if (editorPath === entry.path) setEditorPath(null);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(paths: string[]) {
    if (!canWrite || !paths.length) return;
    if (!window.confirm(`Delete ${paths.length} item(s)?`)) return;
    setBusy(true);
    setError(null);
    try {
      for (const path of paths) {
        await api.deleteFile(serverId, path);
      }
      setStatus(`Deleted ${paths.length} item(s)`);
      if (editorPath && paths.includes(editorPath)) setEditorPath(null);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveSelected() {
    if (!canWrite || selected.size === 0) return;
    const destDir = window.prompt(
      'Move selected items into folder (relative path)',
      cwd,
    );
    if (destDir === null) return;
    setBusy(true);
    setError(null);
    try {
      for (const from of selected) {
        const name = from.split('/').pop()!;
        const to = joinPath(destDir.trim() || '.', name);
        await api.moveFile(serverId, from, to);
      }
      setStatus(`Moved ${selected.size} item(s)`);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSearch() {
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api.searchFiles(serverId, cwd, q);
      setSearchResults(data.entries);
      setStatus(`${data.entries.length} match(es)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleExtract(entry: FileEntry) {
    if (!canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.extractZip(serverId, entry.path);
      setStatus(`Extracted to ${result.path}`);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extract failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCompress() {
    if (!canWrite || selected.size === 0) return;
    const destName = window.prompt('Zip file name', 'archive.zip');
    if (!destName?.trim()) return;
    const dest = joinPath(cwd, destName.trim());
    setBusy(true);
    setError(null);
    try {
      const result = await api.compressFiles(
        serverId,
        Array.from(selected),
        dest,
      );
      setStatus(`Created ${result.path} (${formatSize(result.size)})`);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compress failed');
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!canWrite || !e.dataTransfer.files.length) return;
    void handleUpload(e.dataTransfer.files);
  }

  const editorExt = editorPath
    ? editorPath.slice(editorPath.lastIndexOf('.')).toLowerCase()
    : '';

  const highlighted = useMemo(() => {
    if (!editorPath) return '';
    return editorContent
      .split('\n')
      .map((line) => {
        const escaped = escapeHtml(line);
        return highlightLine(escaped, editorExt);
      })
      .join('\n');
  }, [editorContent, editorExt, editorPath]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Files"
          description="Browse the server data directory (path-jailed on the agent)."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void load(cwd)}
              >
                Refresh
              </Button>
              {canWrite ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void handleMkdir()}
                  >
                    New folder
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void handleUpload(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </>
              ) : null}
            </div>
          }
        />

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1">
                {i > 0 ? <span className="text-muted">/</span> : null}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => void openDir(c.path)}
                >
                  {c.label}
                </button>
              </span>
            ))}
            {cwd !== '.' ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-2"
                onClick={() => void openDir(parentPath(cwd))}
              >
                Up
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="max-w-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch();
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void handleSearch()}
            >
              Search
            </Button>
            {searchResults ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearchResults(null);
                  setSearch('');
                }}
              >
                Clear search
              </Button>
            ) : null}
            {canWrite && selected.size > 0 ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void handleMoveSelected()}
                >
                  Move ({selected.size})
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void handleCompress()}
                >
                  Zip selected
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void handleDelete(Array.from(selected))}
                >
                  Delete ({selected.size})
                </Button>
              </>
            ) : null}
          </div>

          <div
            className={`overflow-hidden rounded-lg border ${
              dragOver ? 'border-accent bg-accent/5' : 'border-border'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (canWrite) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-muted">
                <tr>
                  {canWrite ? <th className="w-8 px-3 py-2" /> : null}
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Modified</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayEntries.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canWrite ? 5 : 4}
                      className="px-3 py-8 text-center text-muted"
                    >
                      {busy
                        ? 'Loading…'
                        : dragOver
                          ? 'Drop files to upload'
                          : 'Empty folder'}
                    </td>
                  </tr>
                ) : (
                  displayEntries.map((entry) => (
                    <tr
                      key={entry.path}
                      className="border-t border-border hover:bg-surface-2/60"
                    >
                      {canWrite ? (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(entry.path)}
                            onChange={() => toggleSelect(entry.path)}
                            aria-label={`Select ${entry.name}`}
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left hover:text-accent"
                          onClick={() => void openFile(entry)}
                        >
                          {entry.type === 'dir' ? (
                            <span className="mr-1.5 inline-block w-4 text-muted">
                              /
                            </span>
                          ) : (
                            <span className="mr-1.5 inline-block w-4 text-muted">
                              ·
                            </span>
                          )}
                          {entry.name}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {entry.type === 'dir' ? '—' : formatSize(entry.size)}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {formatModified(entry.modifiedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {entry.type === 'file' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void handleDownload(entry.path, entry.name)
                              }
                            >
                              Download
                            </Button>
                          ) : null}
                          {canWrite ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void handleRename(entry)}
                              >
                                Rename
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void handleDelete([entry.path])}
                              >
                                Delete
                              </Button>
                              {entry.type === 'file' && isZipName(entry.name) ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void handleExtract(entry)}
                                >
                                  Extract
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {canWrite ? (
            <p className="text-xs text-muted">
              Drag and drop files onto the table to upload into this folder.
            </p>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {status ? <p className="text-sm text-muted">{status}</p> : null}
        </div>
      </Card>

      {editorPath ? (
        <Card>
          <CardHeader
            title={editorPath}
            description={
              editorTruncated
                ? 'File was truncated when loaded'
                : editorDirty
                  ? 'Unsaved changes'
                  : 'Text editor'
            }
            action={
              <div className="flex gap-2">
                {canWrite ? (
                  <Button
                    size="sm"
                    disabled={busy || !editorDirty}
                    onClick={() => void saveEditor()}
                  >
                    Save
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (
                      editorDirty &&
                      !window.confirm('Discard unsaved changes?')
                    ) {
                      return;
                    }
                    setEditorPath(null);
                    setEditorDirty(false);
                  }}
                >
                  Close
                </Button>
              </div>
            }
          />
          <div className="grid gap-0 lg:grid-cols-2">
            <textarea
              className="min-h-[320px] w-full resize-y border-0 bg-bg/40 p-4 font-mono text-sm text-text outline-none focus:ring-0"
              value={editorContent}
              readOnly={!canWrite}
              spellCheck={false}
              onChange={(e) => {
                setEditorContent(e.target.value);
                setEditorDirty(true);
              }}
            />
            <pre
              className="hidden min-h-[320px] overflow-auto border-l border-border bg-surface-2/40 p-4 font-mono text-sm leading-relaxed lg:block"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
