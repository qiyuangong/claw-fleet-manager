// packages/server/src/authorize.ts
import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user || request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
}

export async function requireProfileAccess(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
  if (request.user.role === 'admin') return;
  const id = (request.params as Record<string, string>).id;
  const assignedProfiles = Array.isArray(request.user.assignedProfiles) ? request.user.assignedProfiles : [];
  if (!id || !assignedProfiles.includes(id)) {
    return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
}
