// Optional phase timings (`--timings` or ONP_SPEC_TIMINGS=1): shows where the
// time goes in a big repository. Off by default; costs nothing when off.

const phases = [];
let enabled = Boolean(process.env.ONP_SPEC_TIMINGS);

export function enableTimings(on = true) {
  enabled = on;
}

export function timed(label, fn) {
  if (!enabled) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    phases.push([label, performance.now() - t0]);
  }
}

export function renderTimings() {
  if (!enabled || phases.length === 0) return '';
  const width = Math.max(...phases.map(([l]) => l.length));
  const lines = phases.map(([l, ms]) => `  ${l.padEnd(width)}  ${ms.toFixed(0).padStart(7)} ms`);
  return `timings:\n${lines.join('\n')}`;
}
