import { watch } from "node:fs";
import path from "node:path";

const IGNORED_SEGMENTS = new Set(["node_modules", "coverage", ".git"]);

function isIgnored(relPath) {
  return relPath.split(path.sep).some((segment) => IGNORED_SEGMENTS.has(segment) || segment.startsWith("."));
}

function matchWorkspace(relPath, workspaces) {
  const normalized = relPath.split(path.sep).join("/");
  return workspaces.find((wsPath) => normalized === wsPath || normalized.startsWith(`${wsPath}/`));
}

export function watchWorkspaces({ root, workspaces, onChange, debounceMs = 300, isSuppressed = () => false }) {
  const pending = new Set();
  let timer = null;

  const watcher = watch(root, { recursive: true }, (eventType, filename) => {
    if (!filename || isIgnored(filename)) {
      return;
    }

    const wsPath = matchWorkspace(filename, workspaces);
    if (!wsPath || isSuppressed(wsPath)) {
      return;
    }

    pending.add(wsPath);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = new Set(pending);
      pending.clear();
      onChange(changed);
    }, debounceMs);
  });

  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    }
  };
}
