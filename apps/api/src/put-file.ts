import {
  createFileStore,
  FILE_BUCKETS,
  type FileBucket,
  type FileSpace,
} from '@aiontheballot/db/file-store';

/**
 * Puts the bytes read from standard input on the file store (FILES_ROOT), in a tenant's bucket or the platform's
 * space, and prints their SHA-256 and size: how files reach the volume before the admin can upload them (M2). Their
 * rows are written separately, by SQL, after this, naming the same tenant and bucket (ADR-0004). Run it in an API pod:
 *
 *   kubectl exec -i deploy/aiontheballot-api -- node dist/put-file.js <tenant-id> public_assets < logo.png
 *   kubectl exec -i deploy/aiontheballot-api -- node dist/put-file.js platform < brand-asset.png
 */
const USAGE = `usage: put-file.js <tenant-id> <${FILE_BUCKETS.join('|')}> < file, or put-file.js platform < file`;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const isBucket = (value: string | undefined): value is FileBucket =>
  FILE_BUCKETS.some((bucket) => bucket === value);

const parseSpace = (args: readonly string[]): FileSpace => {
  if (args.length === 1 && args[0] === 'platform') {
    return 'platform';
  }
  const [tenantId, bucket] = args;
  if (args.length !== 2 || !tenantId || !isBucket(bucket)) {
    return fail(USAGE);
  }
  return { tenantId, bucket };
};

const root = process.env.FILES_ROOT || fail('FILES_ROOT is not set');
const space = parseSpace(process.argv.slice(2));
const chunks: Uint8Array[] = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk as Uint8Array);
}
const bytes = Buffer.concat(chunks);
if (bytes.byteLength === 0) {
  fail('Nothing on standard input');
}
try {
  const sha256 = await createFileStore(root).put(space, bytes);
  console.log(JSON.stringify({ sha256, byteSize: bytes.byteLength }));
} catch (error) {
  fail(error instanceof TypeError ? `${error.message}\n${USAGE}` : String(error));
}
