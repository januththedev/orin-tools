import { config } from 'dotenv';
config({ path: '../.env.local' });

import { Sandbox } from '@vercel/sandbox';

async function main() {
  const sandbox = await Sandbox.getOrCreate({
    name: 'my-sandbox-516708',
    persistent: true,
    networkPolicy: 'deny-all',
  });
  // Enforce the locked-down egress policy even if the named sandbox
  // already existed with different settings.
  await sandbox.update({ networkPolicy: 'deny-all' });

  try {
    await sandbox.writeFiles([
      {
        path: '/vercel/generated.mjs',
        content: Buffer.from("console.log('Hello from generated code');\n"),
      },
    ]);
    const result = await sandbox.runCommand('node', ['/vercel/generated.mjs']);
    const out = (await result.stdout()).trim();
    const err = (await result.stderr()).trim();
    if (out) console.log(out);
    if (err) console.error(err);
  } finally {
    await sandbox.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
