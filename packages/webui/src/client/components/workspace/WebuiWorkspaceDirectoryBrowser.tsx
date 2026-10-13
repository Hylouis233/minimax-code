// The workspace directory browser (ticket #76; §15.1's `components/workspace/…` row).
//
// The picker the composer opens for a working directory: it lists a directory, walks up and down,
// accepts a typed absolute path, and hands the chosen directory back. It owns its listing, loading and
// error state; the composer owns the open/closed flag and the value, and passes the browse command in.


import { WebuiIconFolder } from "../../icons.js";
import type { WebuiTransport } from "../../contracts/transport.js";
import type { WebuiWorkspaceDirectoryListing } from "../../../shared/contracts/workspace.js";
import { looksLikeAbsoluteWorkspacePath } from "../../paths.js";
import { useCallback, useEffect, useState, type ReactElement } from "react";

export function WebuiWorkspaceDirectoryBrowser({
  browseWorkspaceDirs,
  initialDir,
  onSelect,
  onCancel,
}: {
  readonly browseWorkspaceDirs?: WebuiTransport["browseWorkspaceDirs"];
  readonly initialDir?: string;
  readonly onSelect: (dir: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [listing, setListing] = useState<WebuiWorkspaceDirectoryListing>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [manualPath, setManualPath] = useState(initialDir ?? "");

  const browse = useCallback(
    (dir?: string) => {
      if (!browseWorkspaceDirs) return;
      setLoading(true);
      setError(undefined);
      void browseWorkspaceDirs(dir ? { dir } : {})
        .then((next) => {
          setListing(next);
          setManualPath(next.dir);
        })
        .catch((reason: unknown) => {
          setError(
            reason instanceof Error ? reason.message : String(reason),
          );
        })
        .finally(() => setLoading(false));
    },
    [browseWorkspaceDirs],
  );

  useEffect(() => {
    browse(initialDir);
  }, [browse, initialDir]);

  const submitManualPath = useCallback(() => {
    const value = manualPath.trim();
    if (!value) {
      setError("请输入项目目录的绝对路径");
      return;
    }
    if (!looksLikeAbsoluteWorkspacePath(value)) {
      setError("需要绝对路径，例如 /home/you/projects/my-project");
      return;
    }
    onSelect(value);
  }, [manualPath, onSelect]);

  if (!browseWorkspaceDirs)
    return (
      <div className="flex flex-col gap-2" data-webui-workspace-manual="true">
        <label className="webui-commit-dialog-label">
          <span>项目绝对路径</span>
          <input
            value={manualPath}
            autoFocus
            placeholder="/home/you/projects/my-project"
            onChange={(event) => {
              setManualPath(event.target.value);
              setError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitManualPath();
            }}
          />
        </label>
        {error ? (
          <p className="webui-commit-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="webui-workspace-browser-actions">
          <button
            type="button"
            className="webui-workspace-browser-action"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="webui-workspace-browser-action webui-workspace-browser-action--primary"
            onClick={submitManualPath}
          >
            使用此目录
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-2" data-webui-workspace-browser="true">
      <div className="flex items-center gap-2">
        {listing?.parent ? (
          <button
            type="button"
            className="webui-workspace-option webui-workspace-option--desktop"
            data-webui-workspace-action="up"
            onClick={() => browse(listing.parent)}
          >
            <span className="min-w-0 flex-1 truncate text-left">上一级</span>
          </button>
        ) : null}
        <span
          className="min-w-0 flex-1 truncate text-text_default_secondary text-size_12"
          title={listing?.dir}
        >
          {listing?.dir ?? "正在读取目录…"}
        </span>
      </div>
      {error ? (
        <p className="webui-commit-dialog-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="webui-composer-menu-empty">正在读取目录…</p>
      ) : listing?.entries.length ? (
        listing.entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className="webui-workspace-option webui-workspace-option--desktop"
            data-webui-workspace-action="enter"
            onClick={() => browse(entry.path)}
          >
            <WebuiIconFolder className="flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              {entry.name}
            </span>
          </button>
        ))
      ) : (
        <p className="webui-composer-menu-empty">此目录下没有子目录</p>
      )}
      {listing?.truncated ? (
        <p className="webui-composer-menu-empty">子目录过多，仅显示前若干项</p>
      ) : null}
      <div className="webui-workspace-browser-actions">
        <button
          type="button"
          className="webui-workspace-browser-action"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="webui-workspace-browser-action webui-workspace-browser-action--primary"
          disabled={!listing}
          onClick={() => {
            if (listing) onSelect(listing.dir);
          }}
        >
          使用此目录
        </button>
      </div>
    </div>
  );
}

/** What the retry affordance on a failed turn should do. */
