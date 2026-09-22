import handler from '../api/search';

async function t(q: string) {
  const req: any = { method: 'GET', query: { q, n: '5' }, headers: {} };
  let out: any, code = 0;
  const res: any = { setHeader() {}, status(c: number) { code = c; return this; }, json(o: any) { out = o; return this; }, end() { return this; } };
  await handler(req, res);
  console.log('Q:', q);
  console.log('STATUS:', code, '| engines:', (out.engines || []).join(','));
  (out.results || []).forEach((r: any) => console.log('[' + r.engine + '] ' + r.title));
  console.log('debug:', JSON.stringify(out.debug));
  console.log('---');
}

await t('weather in Kandy tomorrow');
await t('weather forecast Kandy tomorrow');
