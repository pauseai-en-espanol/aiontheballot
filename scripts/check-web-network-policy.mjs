#!/usr/bin/env node
// The web's opt-in NetworkPolicy (PLAN R161), checked in CI after `helm lint`:
// - on, it refuses to render with no gateway, or a gateway without pod labels, since such a policy would shut every
//   visitor out (Cilium drops; the pods stay Ready) or admit a whole namespace;
// - on with the CI values, its rule for the API's pods matches the API Deployment's pod labels, so revalidation (PLAN
//   R151) still reaches every replica: the API's name in the umbrella (nameOverride) and the policy's apiName must agree;
// - on with the preview (ADR-0005), its rule for the admin's pods matches the admin Deployment's pod labels, or every
//   preview would wait for the web app until it gave up.
// Usage: node scripts/check-web-network-policy.mjs (needs helm, and the umbrella's dependencies built)
import { spawnSync } from 'node:child_process';

const helm = (...args) =>
  spawnSync('helm', ['template', 'aiontheballot', ...args], { encoding: 'utf8' });
const fail = (message) => {
  console.error(`check-web-network-policy: ${message}`);
  process.exit(1);
};

for (const [what, extra] of [
  ['no gateway', []],
  [
    'a gateway without pod labels',
    ['--set-json', 'networkPolicy.gateways=[{"namespace":"envoy-gateway-system"}]'],
  ],
]) {
  const rendered = helm(
    'apps/web/helm-chart',
    '--set',
    'image.tag=x',
    '--set',
    'networkPolicy.enabled=true',
    ...extra,
  );
  if (rendered.status === 0) {
    fail(`the web chart rendered its network policy with ${what}`);
  }
}

const umbrella = helm(
  'helm-charts/aiontheballot',
  '--values',
  'helm-charts/aiontheballot/ci/example-values.yaml',
);
if (umbrella.status !== 0) {
  fail(`the umbrella chart didn't render: ${umbrella.stderr}`);
}
const documents = umbrella.stdout.split(/^---$/m);
const policy = documents.find(
  (doc) => /kind: NetworkPolicy/.test(doc) && /name: aiontheballot-web\n/.test(doc),
);
const api = documents.find(
  (doc) => /kind: Deployment/.test(doc) && /name: aiontheballot-api\n/.test(doc),
);
if (!policy || !api) {
  fail('the CI values render no web network policy or no API Deployment: they should render both');
}
const [, instance, name] =
  /- podSelector:\n\s+matchLabels:\n\s+app\.kubernetes\.io\/instance: (\S+)\n\s+app\.kubernetes\.io\/name: (\S+)/.exec(
    policy,
  ) ?? [];
const template = api.slice(api.indexOf('template:'));
const apiName = /app\.kubernetes\.io\/name: (\S+)/.exec(template)?.[1];
const apiInstance = /app\.kubernetes\.io\/instance: (\S+)/.exec(template)?.[1];
if (!name || name !== apiName || instance !== apiInstance) {
  fail(
    `the policy admits API pods named ${name} (${instance}), but the API's pods are ${apiName} (${apiInstance})`,
  );
}
// With the preview on (ADR-0005), its rule for the admin's pods matches the admin Deployment's pod labels, or a
// member's preview would hang until it timed out.
const admin = documents.find(
  (doc) => /kind: Deployment/.test(doc) && /name: aiontheballot-admin\n/.test(doc),
);
const adminTemplate = admin?.slice(admin.indexOf('template:')) ?? '';
const adminName = /app\.kubernetes\.io\/name: (\S+)/.exec(adminTemplate)?.[1];
if (!admin || !new RegExp(`app\\.kubernetes\\.io/name: ${adminName}\\n`).test(policy)) {
  fail(
    `the CI values turn the preview on, but the policy admits no pods named ${adminName} (the admin's)`,
  );
}
console.log(
  `The web's network policy refuses an empty gateway list and admits the API's pods (${apiName}) and, with the preview on, the admin's (${adminName})`,
);
