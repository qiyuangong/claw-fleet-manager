// packages/server/src/authorize.ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from './types.js';

export function hasProfileAccess(user: User | undefined, id: string | undefined): boolean {
  if (!user || !id) return false;
  if (user.role === 'admin') return true;
  const assignedProfiles = Array.isArray(user.assignedProfiles) ? user.assignedProfiles : [];
  return assignedProfiles.includes(id);
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user || request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
}

export async function requireProfileAccess(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
  const id = (request.params as Record<string, string>).id;
  if (!hasProfileAccess(request.user, id)) {
    return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
}
