import { MetaApiError } from "./errors";

const CREATE = /^act_\d+\/(campaigns|adsets|ads)$/;
const COPY = /^\d+\/copies$/;

/**
 * Every Meta create uses status PAUSED (CLAUDE.md). Enforced here, at the one
 * place every request passes, so no caller can launch live by accident.
 * Going live is a separate POST /{id} with status ACTIVE.
 */
export function assertPausedCreate(method: string, path: string, params: Record<string, unknown> | undefined) {
  if (method !== "POST") return;
  const create = CREATE.exec(path);
  if (create && params?.status !== "PAUSED") {
    throw new MetaApiError({
      kind: "guard",
      message: `Refusing to create ${create[1]} without status PAUSED`,
    });
  }
  if (COPY.test(path) && params?.status_option !== "PAUSED") {
    throw new MetaApiError({ kind: "guard", message: "Refusing to copy without status_option PAUSED" });
  }
}
