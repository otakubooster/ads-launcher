/**
 * Launching (Launch, Launch log, Creatives, Copy, Presets) is off unless
 * NEXT_PUBLIC_LAUNCH_FEATURES=1, for teams that launch elsewhere and use the app to
 * monitor and control ads. Read at build time, so it works in client components.
 */
export const LAUNCH_FEATURES = process.env.NEXT_PUBLIC_LAUNCH_FEATURES === "1";

export const LAUNCH_PATHS = ["/launch", "/launches", "/creatives", "/copy", "/presets"];

export function isLaunchPath(pathname: string) {
  return LAUNCH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
