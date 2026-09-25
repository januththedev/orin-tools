import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";

export interface RunQuota { allowed: boolean; retryAfter: number; }

export class RunQuotaUnavailable extends Error {}

export class MemoryRunQuota {
  private readonly rows = new Map<string, { start: number; count: number }>();
  async consume(identity: string, limit: number, windowMs: number): Promise<RunQuota> {
    const now = Date.now(); const current = this.rows.get(identity);
    if (!current || now - current.start >= windowMs) { this.rows.set(identity, { start: now, count: 1 }); return { allowed: true, retryAfter: 0 }; }
    current.count += 1; return { allowed: current.count <= limit, retryAfter: current.count <= limit ? 0 : Math.ceil((current.start + windowMs - now) / 1000) };
  }
}

export class RedisRunQuota {
  private readonly redis: Redis;
  constructor(url: string, token: string) { this.redis = new Redis({ url, token }); }
  async consume(identity: string, limit: number, windowMs: number): Promise<RunQuota> {
    const bucket = Math.floor(Date.now() / windowMs);
    const key = `orin-tools:run:${createHash("sha256").update(identity).digest("hex")}:${bucket}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.pexpire(key, windowMs * 2);
      return { allowed: count <= limit, retryAfter: count <= limit ? 0 : Math.ceil(windowMs / 1000) };
    } catch { throw new RunQuotaUnavailable("Run quota state is unavailable."); }
  }
}
