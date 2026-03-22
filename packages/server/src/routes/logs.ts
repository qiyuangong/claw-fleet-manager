import type { FastifyInstance } from 'fastify';
import { validateInstanceId } from '../validate.js';

function demuxDockerChunk(chunk: Buffer): string[] {
  const lines: string[] = [];
  let offset = 0;

  while (offset + 8 <= chunk.length) {
    const size = chunk.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > chunk.length) break;

    const text = chunk.toString('utf-8', start, end).trim();
    if (text) {
      lines.push(...text.split('\n').map((line) => line.trim()).filter(Boolean));
    }

    offset = end;
  }

  if (lines.length === 0) {
    const fallback = chunk.toString('utf-8').trim();
    if (fallback) {
      lines.push(...fallback.split('\n').map((line) => line.trim()).filter(Boolean));
    }
  }

  return lines;
}

export async function logRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/ws/logs/:id',
    { websocket: true },
    async (socket: any, request) => {
      const { id } = request.params;

      if (!validateInstanceId(id)) {
        socket.send(JSON.stringify({ error: 'Invalid instance id' }));
        socket.close();
        return;
      }

      let logStream: any;
      try {
        logStream = await app.docker.getContainerLogs(id, { follow: true, tail: 100 }) as any;
      } catch (error: any) {
        socket.send(JSON.stringify({ error: error.message }));
        socket.close();
        return;
      }

      logStream.on('data', (chunk: Buffer) => {
        for (const line of demuxDockerChunk(chunk)) {
          socket.send(JSON.stringify({ id, line, ts: Date.now() }));
        }
      });

      logStream.on('end', () => socket.close());
      logStream.on('error', (error: Error) => {
        socket.send(JSON.stringify({ error: error.message }));
        socket.close();
      });

      socket.on('close', () => {
        logStream.destroy();
      });
    },
  );

  app.get('/ws/logs', { websocket: true }, async (socket: any) => {
    const containers = await app.docker.listFleetContainers();
    const streams: any[] = [];

    for (const container of containers) {
      try {
        const logStream = await app.docker.getContainerLogs(
          container.name,
          { follow: true, tail: 20 },
        ) as any;
        streams.push(logStream);
        logStream.on('data', (chunk: Buffer) => {
          for (const line of demuxDockerChunk(chunk)) {
            socket.send(JSON.stringify({ id: container.name, line, ts: Date.now() }));
          }
        });
      } catch {
        // best effort
      }
    }

    socket.on('close', () => {
      for (const stream of streams) {
        stream.destroy();
      }
    });
  });
}
