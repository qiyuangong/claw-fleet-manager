// packages/server/src/validate.ts
export const DOCKER_INSTANCE_ID_RE = /^openclaw-\d+$/;
export const PROFILE_INSTANCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function validateInstanceId(id: string, mode: 'docker' | 'profiles'): boolean {
  return mode === 'docker'
    ? DOCKER_INSTANCE_ID_RE.test(id)
    : PROFILE_INSTANCE_ID_RE.test(id);
}
