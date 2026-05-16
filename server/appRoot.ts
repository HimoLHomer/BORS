import path from "node:path";

/** Project root: cwd in dev, `BORS_APP_ROOT` when packaged (Electron app.asar — node_modules). */
export function appRoot(): string {
  const fromEnv = process.env.BORS_APP_ROOT?.trim();
  if (fromEnv) return fromEnv;
  return process.cwd();
}

export function appPath(...segments: string[]): string {
  return path.join(appRoot(), ...segments);
}
