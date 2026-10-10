import { createFileStore, isTenantId } from '@aiontheballot/db/file-store';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The file half of a tenant purge (ADR-0004): `private.purge_tenant()` deletes the tenant's rows, and this deletes
 * its bytes from the volume, which SQL can't reach. It acts only on proof that the purge happened, read from standard
 * input: the owner's query below prints `purged <tenant-id>` only for a tenant that `purge_log` records and that no
 * longer exists. A mistyped id, or a tenant that is merely inactive, gets no such line, and nothing is deleted.
 *
 *   psql -At -c "SELECT 'purged ' || l.purged_tenant_id FROM app.purge_log l
 *                 WHERE l.purged_tenant_id = '<tenant-id>'
 *                   AND NOT EXISTS (SELECT 1 FROM app.tenants t WHERE t.id = l.purged_tenant_id)" \
 *     | kubectl exec -i deploy/aiontheballot-api -- node dist/purge-tenant-files.js <tenant-id> [--delete]
 *
 * Without --delete it only says what it would delete.
 */
const USAGE = 'usage: <proof of the purge> | purge-tenant-files.js <tenant-id> [--delete]';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const args = process.argv.slice(2);
const remove = args[1] === '--delete';
const tenantId =
  args[0] && isTenantId(args[0]) && args.length === (remove ? 2 : 1) ? args[0] : fail(USAGE);
const root = process.env.FILES_ROOT || fail('FILES_ROOT is not set');

let proof = '';
for await (const chunk of process.stdin) {
  proof += String(chunk);
}
if (!proof.split('\n').some((line) => line.trim() === `purged ${tenantId}`)) {
  fail(
    `No proof that tenant ${tenantId} was purged: run the owner's query from this file's header first`,
  );
}

let files = 0;
let bytes = 0;
// The tenant's folder, and whatever of it a halted sweep set aside.
for (const folder of [join(root, tenantId), join(root, 'retired', tenantId)]) {
  try {
    for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        files += 1;
        bytes += (await stat(join(entry.parentPath, entry.name))).size;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
if (remove) {
  // Refused while a sweep runs: said plainly, without a stack.
  await createFileStore(root)
    .removeTenant(tenantId)
    .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
  console.log(`Deleted ${files} files (${bytes} bytes) of tenant ${tenantId}`);
} else {
  console.log(
    `Would delete ${files} files (${bytes} bytes) of tenant ${tenantId}. Pass --delete to do it.`,
  );
}
