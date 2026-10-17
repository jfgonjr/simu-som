'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SpectrogramCanvas, { CrankState } from './SpectrogramCanvas';
import DivinaMark from './DivinaMark';
import { S58_WORKLET_SRC } from '@/lib/s58Worklet';
import {
  C_GAS, GEOMETRY, RPM_IDLE, RPM_REDLINE, WORKLET_OPTIONS,
  bank1TotalMm, bank2TotalMm, deltaLenMm, deltaTUs, firingHz, jPipeQuarterWaveHz,
} from '@/lib/s58Params';

function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { id: T; text: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 overflow-hidden rounded-sm border border-sand-deep">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-3 text-sm transition-colors ${value === o.id ? 'bg-sand text-ink font-semibold' : 'text-sand hover:bg-coal'}`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export default function AudioSimulator() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [sliderRpm, setSliderRpm] = useState(RPM_IDLE);
  const [shownRpm, setShownRpm] = useState(RPM_IDLE);
  const [turbo, setTurbo] = useState(0);
  const [divina, setDivina] = useState(true);
  const [valveClosed, setValveClosed] = useState(false);
  const [antiDrone, setAntiDrone] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [pedal, setPedal] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const rpmRef = useRef(RPM_IDLE);
  const crankRef = useRef<CrankState>({ theta: 0, cyl: 1, rpm: RPM_IDLE, tsp: 0, t: 0 });
  const sliderRef = useRef(sliderRpm);
  const pedalRef = useRef(false);
  const flagsRef = useRef({ divina, valveClosed, antiDrone });
  sliderRef.current = sliderRpm;
  flagsRef.current = { divina, valveClosed, antiDrone };

  const start = useCallback(async () => {
    try {
      setError(null);
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC({ latencyHint: 'interactive' });
      const blob = new Blob([S58_WORKLET_SRC], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      await ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(ctx, 's58-exhaust', {
        numberOfInputs: 0,
        outputChannelCount: [2],
        processorOptions: WORKLET_OPTIONS,
      });
      node.port.onmessage = (e: MessageEvent) => {
        const d = e.data as { theta: number; cyl: number; rpm: number; tsp: number };
        crankRef.current = { ...d, t: performance.now() };
      };
      const master = ctx.createGain();
      master.gain.value = volume;
      const an = ctx.createAnalyser();
      node.connect(master);
      master.connect(an);
      an.connect(ctx.destination);
      if (ctx.state === 'suspended') await ctx.resume();
      ctxRef.current = ctx; nodeRef.current = node; masterRef.current = master;
      setAnalyser(an);
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start Web Audio.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(async () => {
    nodeRef.current?.disconnect();
    await ctxRef.current?.close();
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    ctxRef.current = null; nodeRef.current = null; masterRef.current = null; blobUrlRef.current = null;
    setAnalyser(null);
    setRunning(false);
  }, []);

  useEffect(() => () => { void stop(); }, [stop]);
  useEffect(() => { if (masterRef.current) masterRef.current.gain.value = volume; }, [volume]);

  // Vehicle dynamics: RPM inertia, throttle (load) and overrun detection, streamed to the worklet.
  useEffect(() => {
    if (!running) return;
    let raf = 0, last = performance.now(), lastUi = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let rpm = rpmRef.current, thr: number;
      if (pedalRef.current) {
        rpm = Math.min(RPM_REDLINE, rpm + 2600 * (1 - 0.45 * (rpm / RPM_REDLINE)) * dt);
        thr = 1;
      } else {
        const err = sliderRef.current - rpm;
        if (err > 40) { rpm += Math.min(err, 3200 * dt); thr = 0.75; }
        else if (err < -40) { rpm -= Math.min(-err, 2200 * dt); thr = 0; }  // lift-off: overrun pops
        else { rpm = sliderRef.current; thr = 0.28; }
      }
      rpmRef.current = rpm;
      const f = flagsRef.current;
      nodeRef.current?.port.postMessage({ rpm, throttle: thr, divina: f.divina, valveClosed: f.valveClosed, antiDrone: f.antiDrone });
      if (now - lastUi > 100) { lastUi = now; setShownRpm(rpm); setTurbo(crankRef.current.tsp); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // Space bar = pedal
  useEffect(() => {
    const set = (v: boolean) => (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !running) return;
      e.preventDefault();
      pedalRef.current = v; setPedal(v);
    };
    const down = set(true), up = set(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [running]);

  const pedalDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pedalRef.current = true; setPedal(true);
  };
  const pedalUp = () => { pedalRef.current = false; setPedal(false); };

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-4">
        <DivinaMark />
        <div>
          <h1 className="font-brand text-3xl italic leading-none sm:text-4xl">Divina</h1>
          <p className="mt-1 text-sm text-sand-dim">BMW S58 3.0L twin-turbo I6 · quad-tip equal-length exhaust · acoustic simulator</p>
        </div>
        <button
          onClick={running ? stop : start}
          className={`ml-auto rounded-sm border px-5 py-3 text-sm font-semibold transition-colors ${running ? 'border-sand-deep text-sand hover:bg-coal' : 'border-sand bg-sand text-ink hover:bg-white'}`}
        >
          {running ? 'Stop engine' : 'Start engine'}
        </button>
      </header>

      {error && <p role="alert" className="rounded-sm border border-brass px-4 py-3 text-sm text-brass">{error}</p>}

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]" aria-label="Controls">
        <div className="space-y-5 rounded-sm border border-sand-deep/60 bg-coal/60 p-5">
          <div className="flex items-end justify-between">
            <label htmlFor="rpm" className="text-sm text-sand-dim">Target RPM</label>
            <div className="text-right">
              <div className="font-brand text-5xl leading-none tabular-nums">{Math.round(shownRpm).toLocaleString('en-US')}</div>
              <div className="mt-1 text-xs text-sand-dim">firing {firingHz(shownRpm).toFixed(0)} Hz · turbo {Math.round(turbo * 100)}%</div>
            </div>
          </div>
          <input id="rpm" type="range" min={RPM_IDLE} max={RPM_REDLINE} step={10} value={sliderRpm} onChange={(e) => setSliderRpm(Number(e.target.value))} disabled={!running} />
          <button
            disabled={!running}
            onPointerDown={pedalDown}
            onPointerUp={pedalUp}
            onPointerCancel={pedalUp}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: 'none' }}
            className={`w-full select-none rounded-sm border py-5 text-base font-semibold transition-colors disabled:opacity-40 ${pedal ? 'border-sand bg-sand text-ink' : 'border-sand text-sand hover:bg-coal'}`}
          >
            {pedal ? 'Full throttle…' : 'Hold to rev (or hold Space)'}
          </button>
          <p className="text-xs text-sand-dim">Release the pedal above ~2,200 rpm and the model enters overrun: pops and crackles scale with RPM.</p>
        </div>

        <div className="space-y-4 rounded-sm border border-sand-deep/60 bg-coal/60 p-5">
          <div>
            <p className="mb-2 text-sm text-sand-dim">Sound</p>
            <Segmented label="Exhaust" value={divina ? 'divina' : 'stock'} onChange={(v) => setDivina(v === 'divina')}
              options={[{ id: 'stock', text: 'Stock OEM S58' }, { id: 'divina', text: 'Divina V12' }]} />
          </div>
          <div>
            <p className="mb-2 text-sm text-sand-dim">Rear muffler valve</p>
            <Segmented label="Valve" value={valveClosed ? 'closed' : 'open'} onChange={(v) => setValveClosed(v === 'closed')}
              options={[{ id: 'open', text: 'Valve open' }, { id: 'closed', text: 'Valve closed −18 dB' }]} />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Helmholtz J-pipes (204 Hz anti-drone)</span>
            <input type="checkbox" className="h-5 w-5 accent-[#d6c3a1]" checked={antiDrone} disabled={!divina} onChange={(e) => setAntiDrone(e.target.checked)} />
          </label>
          <div>
            <label htmlFor="vol" className="text-sm text-sand-dim">Volume</label>
            <input id="vol" type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
          </div>
        </div>
      </section>

      <section aria-label="Analysis" className="space-y-3">
        <h2 className="font-brand text-2xl italic">Live spectrogram · 0–3 kHz</h2>
        <SpectrogramCanvas analyser={analyser} rpmRef={rpmRef} crankRef={crankRef} divina={divina} />
        <p className="text-xs text-sand-dim">Horizontal ticks on the right track the firing harmonics (3×, 6×, 9× … crank order). The wheel shows one 720° cycle; sand = bank 1 (cyl 1-3), brass = bank 2 (cyl 4-6).</p>
      </section>

      <section aria-label="Model" className="grid gap-px overflow-hidden rounded-sm border border-sand-deep/60 bg-sand-deep/40 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Gas', `750 °C · c = ${C_GAS} m/s`],
          ['Bank 1 / Bank 2', `${bank1TotalMm} / ${bank2TotalMm} mm (Δ ${deltaLenMm} mm)`],
          ['Δt from lengths', `${deltaTUs.toFixed(0)} µs (spec: 579 µs)`],
          ['J-pipes', `2 × ${GEOMETRY.jPipeMm} mm · λ/4 = ${jPipeQuarterWaveHz.toFixed(0)} Hz @ c; notch at 204 Hz`],
        ].map(([k, v]) => (
          <div key={k} className="bg-ink p-4"><div className="text-sand-dim">{k}</div><div className="mt-1">{v}</div></div>
        ))}
      </section>
    </div>
  );
}
