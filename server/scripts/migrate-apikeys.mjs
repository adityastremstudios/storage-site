// One-time migration: hash every plaintext API key already in the database.
//
// Existing integrations keep working — apiKeyAuth hashes the incoming header
// and compares, so the key your connector already holds still authenticates.
// After this runs, the plaintext value no longer exists anywhere.
//
//   cd server && node scripts/migrate-apikeys.mjs
//
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

async function main() {
  const connectors = await prisma.apiConnector.findMany({
    select: { id: true, name: true, apiKey: true, apiKeyHash: true },
  });

  let migrated = 0;
  let skipped = 0;

  for (const c of connectors) {
    if (c.apiKeyHash) { skipped += 1; continue; }

    // Plaintext keys are the ones still carrying the uet_ prefix.
    if (!c.apiKey || !c.apiKey.startsWith('uet_')) {
      console.warn(`  ! connector ${c.id} (${c.name}) has an unrecognised key format — rotate it manually`);
      skipped += 1;
      continue;
    }

    const hash = sha256(c.apiKey);
    await prisma.apiConnector.update({
      where: { id: c.id },
      data: { apiKeyHash: hash, apiKeyPrefix: c.apiKey.slice(0, 12), apiKey: hash },
    });
    console.log(`  ✓ ${c.name} (${c.apiKey.slice(0, 12)}…) hashed`);
    migrated += 1;
  }

  console.log(`\nDone. ${migrated} hashed, ${skipped} skipped.`);
  if (migrated) {
    console.log('Existing keys still work. Rotate any key that was ever visible in the admin UI:');
    console.log('  POST /api/connectors/:id/rotate');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
