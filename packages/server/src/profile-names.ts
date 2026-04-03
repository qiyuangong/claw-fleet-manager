const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const RESERVED_PROFILE_NAMES = new Set(['main']);

export function isValidManagedProfileName(name: string): boolean {
  return PROFILE_NAME_RE.test(name) && !RESERVED_PROFILE_NAMES.has(name);
}

export function getManagedProfileNameError(name: string): string {
  if (!PROFILE_NAME_RE.test(name)) {
    return 'name must be lowercase alphanumeric with hyphens';
  }
  if (RESERVED_PROFILE_NAMES.has(name)) {
    return '"main" is reserved by standalone OpenClaw and cannot be managed as a fleet profile';
  }
  return 'Invalid profile name';
}
