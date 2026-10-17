// Prints the demo content: a programme's bytes, for put-file, or the SQL for a demo site.
//
// A new demo site (PLAN R130):
//   node packages/db/demo/print.ts file a | kubectl exec -i deploy/aiontheballot-api -- \
//     node dist/put-file.js <site-id> sources      # then b
//   node packages/db/demo/print.ts sql <site-slug>  # run as the owner, the same day
//
// A demo site's draft election of fictional parties and the demo's criteria (PLAN R214):
//   node packages/db/demo/print.ts programme <1-11> | kubectl exec -i deploy/aiontheballot-api -- \
//     node dist/put-file.js <site-id> sources      # each of the 11
//   node packages/db/demo/print.ts fill <site-slug> <election-slug>  # run as the owner, the same day
//
// A .ts path: Node runs this script as TypeScript, and doesn't map .js to .ts.
import {
  DEMO_PROGRAMMES,
  demoContentSql,
  type DemoProgramme,
  programmeText,
} from './demo-content.ts';
import { demoElectionSql, demoProgrammeText } from './demo-election.ts';

const [what, which, other] = process.argv.slice(2);
if (what === 'file' && which !== undefined && Object.hasOwn(DEMO_PROGRAMMES, which)) {
  process.stdout.write(programmeText(which as DemoProgramme));
} else if (what === 'sql' && which !== undefined) {
  process.stdout.write(demoContentSql(which));
} else if (what === 'programme' && which !== undefined) {
  process.stdout.write(demoProgrammeText(Number(which)));
} else if (what === 'fill' && which !== undefined && other !== undefined) {
  process.stdout.write(demoElectionSql(which, other));
} else {
  console.error(
    'usage: print.ts file a|b, print.ts sql <site-slug>, print.ts programme <n>, or print.ts fill <site-slug> <election-slug>',
  );
  process.exit(1);
}
