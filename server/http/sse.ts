import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from '../db/open.ts';
import { all, getSetting } from '../db/open.ts';
import type { Logger } from '../log.ts';
import type { DeviceRef, HelloEvent, JobEvent, PresenceEvent } from '../../shared/types.ts';
import { changesAfter, maxSeq } from '../services/changes.ts';

interface Client {
  res: ServerResponse;
  deviceId: string | null;
}

export class Sse {
  private clients = new Set<Client>();
  private lastSeq: number;
  private timers: NodeJS.Timeout[] = [];
  readonly instance: string;
  private db: Db;
  private log: Logger;

  constructor(db: Db, log: Logger) {
    this.db = db;
    this.log = log;
    this.instance = crypto.randomUUID();
    this.lastSeq = maxSeq(db);
  }

  start(): void {
    this.timers.push(setInterval(() => this.drain(), 2000));
    this.timers.push(setInterval(() => this.raw(': ping\n\n'), 20000));
  }
  stop(): void {
    for (const t of this.timers) clearInterval(t);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  handle(req: IncomingMessage, res: ServerResponse, deviceId: string | null): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const client: Client = { res, deviceId };
    this.clients.add(client);
    const hello: HelloEvent = {
      seq: maxSeq(this.db),
      catalog_version: getSetting<number>(this.db, 'catalog_version', 1),
      instance: this.instance,
      server_time: new Date().toISOString(),
    };
    this.send(res, 'hello', hello);
    this.presence();
    const cleanup = () => {
      if (this.clients.delete(client)) this.presence();
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
  }

  /** Broadcast any change rows newer than the last one we sent (in-process commits + other processes). */
  drain(): void {
    try {
      const rows = changesAfter(this.db, this.lastSeq, 1000);
      for (const c of rows) {
        this.broadcast('change', c, String(c.seq));
        this.lastSeq = c.seq;
      }
    } catch (e) {
      this.log.warn('drain failed', (e as Error).message);
    }
  }

  presence(): void {
    const counts = new Map<string, number>();
    for (const c of this.clients) if (c.deviceId) counts.set(c.deviceId, (counts.get(c.deviceId) ?? 0) + 1);
    const ids = [...counts.keys()];
    let devices: Array<DeviceRef & { tabs: number }> = [];
    if (ids.length) {
      const rows = all<{ id: string; name: string; color: string }>(this.db, `SELECT id, name, color FROM devices WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
      const byId = new Map(rows.map((r) => [r.id, r]));
      devices = ids.map((id) => {
        const d = byId.get(id);
        return { id, name: d?.name ?? 'Unknown', color: d?.color ?? '#6b7280', tabs: counts.get(id) ?? 0 };
      });
    }
    const ev: PresenceEvent = { devices };
    this.broadcast('presence', ev);
  }

  emitJob(ev: JobEvent): void {
    this.broadcast('job', ev);
  }

  broadcast(event: string, data: unknown, id?: string): void {
    const payload = `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.raw(payload);
  }

  private raw(text: string): void {
    for (const c of this.clients) {
      if (c.res.writableEnded || c.res.destroyed) {
        this.clients.delete(c);
        continue;
      }
      c.res.write(text);
    }
  }

  private send(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
