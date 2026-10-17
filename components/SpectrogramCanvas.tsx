'use client';

import { useEffect, useRef } from 'react';
import { FIRING_ORDER } from '@/lib/s58Params';

export interface CrankState {
  theta: number; // crank degrees, 0..720
  cyl: number;
  rpm: number;
  tsp: number; // turbo spool 0..1
  t: number; // performance.now() of the report
}

interface Props {
  analyser: AnalyserNode | null;
  rpmRef: React.MutableRefObject<number>;
  crankRef: React.MutableRefObject<CrankState>;
  divina: boolean;
}

const W = 960;
const H = 288;
const STEP = 2;
const MAX_HZ = 3000;
const SAND = '#d6c3a1';
const BRASS = '#b08a4a';

const makeU8 = (n: number) => new Uint8Array(new ArrayBuffer(n));
const makeF32 = (n: number) => new Float32Array(new ArrayBuffer(n * 4));
type U8 = ReturnType<typeof makeU8>;
type F32 = ReturnType<typeof makeF32>;

function buildLut(): Uint8ClampedArray {
  const stops: [number, number[]][] = [
    [0, [5, 5, 4]],
    [0.22, [38, 27, 17]],
    [0.5, [140, 98, 52]],
    [0.78, [214, 195, 161]],
    [1, [255, 250, 235]],
  ];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = Math.pow(i / 255, 1.35);
    let k = 0;
    while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
    const [x0, c0] = stops[k];
    const [x1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return lut;
}

export default function SpectrogramCanvas({ analyser, rpmRef, crankRef, divina }: Props) {
  const specRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const divinaRef = useRef(divina);
  divinaRef.current = divina;

  useEffect(() => {
    const spec = specRef.current, ov = overlayRef.current, wave = waveRef.current, wheel = wheelRef.current;
    if (!spec || !ov || !wave || !wheel) return;
    const sctx = spec.getContext('2d')!, octx = ov.getContext('2d')!;
    const wctx = wave.getContext('2d')!, hctx = wheel.getContext('2d')!;
    sctx.fillStyle = '#050505';
    sctx.fillRect(0, 0, W, H);
    const lut = buildLut();
    const col = sctx.createImageData(STEP, H);
    let raf = 0;

    let freq: U8 | null = null;
    let td: F32 | null = null;
    let maxBin = 1;
    if (analyser) {
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.55;
      analyser.minDecibels = -92;
      analyser.maxDecibels = -22;
      freq = makeU8(analyser.frequencyBinCount);
      td = makeF32(analyser.fftSize);
      maxBin = Math.floor(MAX_HZ / (analyser.context.sampleRate / analyser.fftSize));
    }
    const yOf = (hz: number) => H - (hz / MAX_HZ) * H;

    const drawOverlay = () => {
      octx.clearRect(0, 0, W, H);
      // V12 sweet-spot band 400-900 Hz and J-pipe line at 204 Hz
      octx.fillStyle = 'rgba(214,195,161,0.06)';
      octx.fillRect(0, yOf(900), W, yOf(400) - yOf(900));
      octx.strokeStyle = 'rgba(214,195,161,0.55)';
      octx.setLineDash([4, 5]);
      octx.lineWidth = 1;
      octx.beginPath(); octx.moveTo(0, yOf(204)); octx.lineTo(W, yOf(204)); octx.stroke();
      octx.setLineDash([]);
      octx.font = '11px system-ui, sans-serif';
      octx.fillStyle = 'rgba(214,195,161,0.8)';
      octx.fillText('204 Hz J-pipe', 8, yOf(204) - 4);
      octx.fillText('400–900 Hz', 8, yOf(900) + 12);
      // axis
      for (let hz = 500; hz <= 3000; hz += 500) {
        octx.fillStyle = 'rgba(214,195,161,0.45)';
        octx.fillText(hz >= 1000 ? hz / 1000 + ' kHz' : hz + ' Hz', W - 52, yOf(hz) + 12);
      }
      // firing-order harmonics: f = (rpm/60) * 3k
      const rps = rpmRef.current / 60;
      octx.lineWidth = 1;
      for (let k = 1; 3 * k * rps < MAX_HZ && k <= 14; k++) {
        const f = 3 * k * rps, y = yOf(f);
        octx.strokeStyle = k === 1 ? 'rgba(255,250,235,0.85)' : 'rgba(176,138,74,0.55)';
        octx.beginPath(); octx.moveTo(W - 120, y); octx.lineTo(W - 70, y); octx.stroke();
        octx.fillStyle = k === 1 ? '#fffaeb' : BRASS;
        octx.fillText(`${3 * k}×`, W - 66, y + 4);
      }
    };

    const drawWave = () => {
      const w = wave.width, h = wave.height;
      wctx.clearRect(0, 0, w, h);
      wctx.strokeStyle = 'rgba(214,195,161,0.15)';
      wctx.beginPath(); wctx.moveTo(0, h / 2); wctx.lineTo(w, h / 2); wctx.stroke();
      if (!analyser || !td) return;
      analyser.getFloatTimeDomainData(td);
      let start = 0;
      for (let i = 1; i < td.length / 2; i++) if (td[i - 1] < 0 && td[i] >= 0) { start = i; break; }
      const n = 1200;
      wctx.strokeStyle = SAND;
      wctx.lineWidth = 1.4;
      wctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w, y = h / 2 - td[start + i] * h * 0.46;
        i ? wctx.lineTo(x, y) : wctx.moveTo(x, y);
      }
      wctx.stroke();
    };

    const drawWheel = () => {
      const s = wheel.width, cx = s / 2, cy = s / 2, R = s * 0.38;
      hctx.clearRect(0, 0, s, s);
      const c = crankRef.current;
      const now = performance.now();
      const theta = (c.theta + c.rpm * 6 * ((now - c.t) / 1000)) % 720;
      hctx.strokeStyle = 'rgba(214,195,161,0.3)';
      hctx.lineWidth = 1.5;
      hctx.beginPath(); hctx.arc(cx, cy, R, 0, Math.PI * 2); hctx.stroke();
      hctx.font = '12px system-ui, sans-serif';
      hctx.textAlign = 'center';
      hctx.textBaseline = 'middle';
      FIRING_ORDER.forEach((cyl, i) => {
        const a0 = i * 120;
        const ang = (a0 / 720) * Math.PI * 2 - Math.PI / 2;
        const px = cx + Math.cos(ang) * R, py = cy + Math.sin(ang) * R;
        const since = (theta - a0 + 720) % 720;
        const glow = Math.exp(-since / 35);
        const bank1 = cyl <= 3;
        hctx.fillStyle = `rgba(${bank1 ? '214,195,161' : '176,138,74'},${0.18 + 0.82 * glow})`;
        hctx.beginPath(); hctx.arc(px, py, 14 + 5 * glow, 0, Math.PI * 2); hctx.fill();
        hctx.fillStyle = glow > 0.4 ? '#050505' : SAND;
        hctx.fillText(String(cyl), px, py + 0.5);
        hctx.fillStyle = 'rgba(214,195,161,0.45)';
        hctx.fillText(`${a0}°`, cx + Math.cos(ang) * (R + 30), cy + Math.sin(ang) * (R + 30));
      });
      const pa = (theta / 720) * Math.PI * 2 - Math.PI / 2;
      hctx.strokeStyle = '#fffaeb';
      hctx.lineWidth = 2;
      hctx.beginPath(); hctx.moveTo(cx, cy); hctx.lineTo(cx + Math.cos(pa) * (R - 18), cy + Math.sin(pa) * (R - 18)); hctx.stroke();
      hctx.fillStyle = SAND;
      hctx.font = '13px system-ui, sans-serif';
      hctx.fillText('720° cycle', cx, cy - 10);
      hctx.fillStyle = 'rgba(214,195,161,0.6)';
      hctx.fillText(FIRING_ORDER.join('-'), cx, cy + 10);
    };

    const loop = () => {
      if (analyser && freq) {
        analyser.getByteFrequencyData(freq);
        for (let y = 0; y < H; y++) {
          const bin = Math.min(maxBin, Math.floor((1 - y / (H - 1)) * maxBin));
          const v = freq[bin];
          for (let x = 0; x < STEP; x++) {
            const i = (y * STEP + x) * 4;
            col.data[i] = lut[v * 3]; col.data[i + 1] = lut[v * 3 + 1]; col.data[i + 2] = lut[v * 3 + 2]; col.data[i + 3] = 255;
          }
        }
        sctx.drawImage(spec, -STEP, 0);
        sctx.putImageData(col, W - STEP, 0);
      }
      drawOverlay();
      drawWave();
      drawWheel();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [analyser, rpmRef, crankRef]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="space-y-3">
        <div className="relative w-full overflow-hidden rounded-sm border border-sand-deep/60 bg-ink" style={{ aspectRatio: `${W} / ${H}` }}>
          <canvas ref={specRef} width={W} height={H} className="absolute inset-0 h-full w-full" />
          <canvas ref={overlayRef} width={W} height={H} className="absolute inset-0 h-full w-full" />
        </div>
        <canvas ref={waveRef} width={W} height={90} className="h-[90px] w-full rounded-sm border border-sand-deep/60 bg-ink" aria-label="Waveform" />
      </div>
      <canvas ref={wheelRef} width={260} height={260} className="mx-auto aspect-square w-full max-w-[260px] rounded-sm border border-sand-deep/60 bg-ink" aria-label="Firing order cycle" />
    </div>
  );
}
