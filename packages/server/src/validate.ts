export const INSTANCE_ID_RE = /^openclaw-\d+$/;

export function validateInstanceId(id: string): boolean {
  return INSTANCE_ID_RE.test(id);
}
