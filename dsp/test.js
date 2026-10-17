const fs0 = 48000;
global.sampleRate = fs0;
global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
global.registerProcessor = () => {};
eval(require('fs').readFileSync(__dirname + '/worklet.js', 'utf8') + ';global.__P=S58Processor;');

function run(opts, secs) {
  const p = new global.__P({ processorOptions: {} });
  Object.assign(p.p, opts);
  p.rpmS = opts.rpm; p.thrS = opts.throttle; p.vs = opts.valveClosed ? 1 : 0;
  p.m = opts.divina === false ? 0 : 1;
  const N = Math.floor(secs * fs0), out = new Float32Array(N);
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let i = 0; i < N; i += 128) {
    p.process([[]], [[L, R]]);
    for (let j = 0; j < 128 && i + j < N; j++) out[i + j] = 0.5 * (L[j] + R[j]);
  }
  return out;
}
function rms(a, s = 0.5) {
  let t = 0, k = 0, pk = 0;
  for (let i = Math.floor(s * fs0); i < a.length; i++) { t += a[i] * a[i]; k++; pk = Math.max(pk, Math.abs(a[i])); }
  return [Math.sqrt(t / k), pk];
}
function spec(a, f0, f1) {
  const N = 16384, off = a.length - N, res = [];
  for (let f = f0; f <= f1; f += 5) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
      re += w * a[off + i] * Math.cos(2 * Math.PI * f * i / fs0);
      im -= w * a[off + i] * Math.sin(2 * Math.PI * f * i / fs0);
    }
    res.push([f, Math.hypot(re, im)]);
  }
  return res;
}
const cases = {
  'idle divina': { rpm: 1000, throttle: 0.2, divina: true },
  '3000 cruise divina': { rpm: 3000, throttle: 0.3, divina: true },
  '6000 WOT divina': { rpm: 6000, throttle: 1, divina: true },
  '7200 WOT divina': { rpm: 7200, throttle: 1, divina: true },
  '6000 WOT stock': { rpm: 6000, throttle: 1, divina: false },
  '6000 WOT divina valve closed': { rpm: 6000, throttle: 1, divina: true, valveClosed: true },
  'overrun 5000 divina': { rpm: 5000, throttle: 0, divina: true },
};
for (const [k, o] of Object.entries(cases)) {
  const a = run(o, 2.5), [r, pk] = rms(a);
  const bad = a.some((x) => !isFinite(x));
  const sp = spec(a, 40, 1200).sort((x, y) => y[1] - x[1]).slice(0, 3).map((x) => x[0]);
  console.log(k.padEnd(32), 'rms', r.toFixed(3), 'peak', pk.toFixed(3), 'NaN?', bad, 'topHz', sp.join(','), 'fire', (3 * o.rpm / 60).toFixed(0));
}
const a = run(cases['6000 WOT divina'], 2.5), b = run(cases['6000 WOT divina valve closed'], 2.5);
console.log('valve atten dB', (20 * Math.log10(rms(b)[0] / rms(a)[0])).toFixed(1));
const n1 = run({ rpm: 3060, throttle: 0.3, divina: true, antiDrone: true }, 2.5);
const n0 = run({ rpm: 3060, throttle: 0.3, divina: true, antiDrone: false }, 2.5);
const e = (x) => spec(x, 195, 215).reduce((s, y) => s + y[1], 0);
console.log('204Hz notch effect dB', (20 * Math.log10(e(n1) / e(n0))).toFixed(1));
