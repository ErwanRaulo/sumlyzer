// Environment variable names are case-insensitive on Windows, where PATH is usually
// spelled "Path". Adding a "PATH" key next to it would hand the child two entries,
// and which one wins is unspecified, so the existing key is replaced instead.
export function withPath(env, value, platform = process.platform) {
  if (platform !== "win32") {
    return { ...env, PATH: value };
  }

  const keys = Object.keys(env).filter((key) => key.toUpperCase() === "PATH");
  const result = { ...env };
  for (const key of keys) {
    delete result[key];
  }
  result[keys[0] ?? "Path"] = value;

  return result;
}
