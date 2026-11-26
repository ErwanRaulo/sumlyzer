// Windows env names are case-insensitive ("Path"): replace the key instead of adding a duplicate.
export function withPath(env, value, platform = process.platform) {
  if (platform !== "win32") {
    return { ...env, PATH: value };
  }

  const isPathKey = (key) => key.toUpperCase() === "PATH";
  const key = Object.keys(env).find(isPathKey) ?? "Path";
  const rest = Object.fromEntries(Object.entries(env).filter(([name]) => !isPathKey(name)));

  return { ...rest, [key]: value };
}
