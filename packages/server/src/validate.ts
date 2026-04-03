// packages/server/src/validate.ts
export const DOCKER_INSTANCE_ID_RE = /^openclaw-\d+$/;
export const MANAGED_INSTANCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const PROFILE_INSTANCE_ID_RE = MANAGED_INSTANCE_ID_RE;

export function validateInstanceId(id: string): boolean {
  return MANAGED_INSTANCE_ID_RE.test(id);
}
