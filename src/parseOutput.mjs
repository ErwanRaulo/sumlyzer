export function stripNpmNoise(output) {
  return output.replace(/^npm warn .*\n?/gm, "");
}
