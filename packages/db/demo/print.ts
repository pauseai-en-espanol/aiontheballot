// Prints the demo content (PLAN R130): a programme's bytes, for put-file, or the SQL for a demo site.
//
//   node packages/db/demo/print.ts file a | kubectl exec -i deploy/aiontheballot-api -- \
//     node dist/put-file.js <site-id> sources      # then b
//   node packages/db/demo/print.ts sql <site-slug>  # run as the owner, the same day
//
// A .ts path: Node runs this script as TypeScript, and doesn't map .js to .ts.
import {
  DEMO_PROGRAMMES,
  demoContentSql,
  type DemoProgramme,
  programmeText,
} from './demo-content.ts';

const [what, which] = process.argv.slice(2);
if (what === 'file' && which !== undefined && Object.hasOwn(DEMO_PROGRAMMES, which)) {
  process.stdout.write(programmeText(which as DemoProgramme));
} else if (what === 'sql' && which !== undefined) {
  process.stdout.write(demoContentSql(which));
} else {
  console.error('usage: print.ts file a|b, or print.ts sql <site-slug>');
  process.exit(1);
}
