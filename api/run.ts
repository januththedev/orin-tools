import { randomUUID } from "node:crypto";
export const config = { maxDuration: 10 };
export default function handler(req: any, res: any) { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.status(410).json({ error: { code: "ORIN_RUN_DISABLED", message: "Public code execution is disabled.", retryable: false, retry_after: null, request_id: String(req.headers?.["x-request-id"] ?? randomUUID()) } }); }
