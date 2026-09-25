import { createHmac } from "node:crypto";
export function queryMetadata(secret: string, query: string) { return { query_hash: createHmac("sha256", secret).update(query).digest("hex"), query_length: [...query].length }; }
export function sanitizeDebug(debug: Record<string,string>): Record<string,string> { return Object.fromEntries(Object.entries(debug).map(([key, value]) => [key, value.replace(/https?:\/\/\S+/g, "provider")])); }
