import { answer } from '../../src/worker/watchdog.js';

// Says it extracted something it couldn't have: a unit numbered 0, twice.
answer({
  ok: true,
  result: {
    status: 'done',
    units: [
      { index: 0, label: '§ 0', body: 'inventado' },
      { index: 0, label: '§ 0', body: 'inventado' },
    ],
  },
});
