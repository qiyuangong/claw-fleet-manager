import type { FastifyInstance } from 'fastify';

function frameToLine(chunk: Buffer): string {
  return chunk.toString('utf-8').replace(/^.{8}/, '').trim();
}

export async function logRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/ws/logs/:id',
    { websocket: true },
    async (socket: any, request) => {
      const { id } = request.params;

      let logStream: any;
      try {
        logStream = await app.docker.getContainerLogs(id, { follow: true, tail: 100 }) as any;
      } catch (error: any) {
        socket.send(JSON.stringify({ error: error.message }));
        socket.close();
        return;
      }

      logStream.on('data', (chunk: Buffer) => {
        const line = frameToLine(chunk);
        if (line) {
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
          const line = frameToLine(chunk);
          if (line) {
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
