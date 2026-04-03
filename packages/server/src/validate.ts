// packages/server/src/validate.ts
export const DOCKER_INSTANCE_ID_RE = /^openclaw-\d+$/;
export const MANAGED_INSTANCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const PROFILE_INSTANCE_ID_RE = MANAGED_INSTANCE_ID_RE;

export function validateInstanceId(id: string, mode: 'docker' | 'profiles'): boolean {
  if (mode === 'docker') return MANAGED_INSTANCE_ID_RE.test(id);
  // In profile mode, reject docker-style IDs (openclaw-N) to avoid cross-mode confusion
  if (DOCKER_INSTANCE_ID_RE.test(id)) return false;
  return PROFILE_INSTANCE_ID_RE.test(id);
}
