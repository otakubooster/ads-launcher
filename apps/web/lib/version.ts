/** The deployed commit (Vercel sets VERCEL_GIT_COMMIT_SHA), so anyone can see which update is live. */
export function appVersion() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "";
  return { commit: sha ? sha.slice(0, 7) : "dev", message: (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").split("\n")[0]!.slice(0, 80) };
}
