/* Divina S58 - physics-based exhaust DSP (AudioWorkletProcessor).
   Digital waveguide network: 6 cyl pulses -> 2 bank pipes -> 18deg X-pipe (4-port scattering)
   -> 2 tail pipes (valved muffler) -> open-end radiation -> titanium shell formants,
   V12 harmonic waveshaper, J-pipe Helmholtz notch, turbo whistle, overrun pops. */
const FIRING = [1, 5, 3, 6, 2, 4];
const TWO_PI = Math.PI * 2;

class DelayLine {
  constructor(maxSamples) {
    let n = 1;
    while (n < maxSamples + 8) n <<= 1;
    this.buf = new Float32Array(n);
    this.mask = n - 1;
    this.w = 0;
  }
  read(d) {
    const pos = this.w - d;
    const i0 = Math.floor(pos);
    const f = pos - i0;
    return this.buf[i0 & this.mask] * (1 - f) + this.buf[(i0 + 1) & this.mask] * f;
  }
  write(x) {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }
}

class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, q, fs) {
    const w = TWO_PI * f / fs, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2;
    const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    if (type === 'notch') { b0 = 1; b1 = -2 * c; b2 = 1; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; }        // constant 0 dB peak
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }       // lp
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

class S58Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const fs = sampleRate;
    this.fs = fs;
    const o = (options && options.processorOptions) || {};
    this.c = o.c || 615;                                  // m/s, gas at 1023 K
    this.Ldiv = [(o.b1 || 2296) / 1000, (o.b2 || 1966) / 1000];   // downpipe + midpipe, metres
    this.Lstock = [(o.stock || 2300) / 1000, (o.stock || 2300) / 1000];
    this.Ltail = (o.tail || 1100) / 1000;
    const maxD = Math.ceil(3.2 / this.c * fs) + 16;
    this.dF = [new DelayLine(maxD), new DelayLine(maxD)];
    this.dB = [new DelayLine(maxD), new DelayLine(maxD)];
    this.dTf = [new DelayLine(maxD), new DelayLine(maxD)];
    this.dTb = [new DelayLine(maxD), new DelayLine(maxD)];

    this.p = { rpm: 1000, throttle: 0, divina: true, valveClosed: false, antiDrone: true, master: 1 };
    this.port.onmessage = (e) => Object.assign(this.p, e.data);

    this.rpmS = 1000; this.thrS = 0; this.m = 1; this.vs = 0; this.nd = 1; this.tsp = 0;
    this.acc = 0; this.idx = 0; this.lastCyl = 1; this.sinceReport = 0;
    this.kr = 1 - Math.exp(-1 / (0.02 * fs));
    this.kt = 1 - Math.exp(-1 / (0.03 * fs));
    this.km = 1 - Math.exp(-1 / (0.25 * fs));
    this.kv = 1 - Math.exp(-1 / (0.05 * fs));

    this.NP = 10;                                          // pulse pool per bank
    this.pAct = [new Uint8Array(this.NP), new Uint8Array(this.NP)];
    this.pAge = [new Float32Array(this.NP), new Float32Array(this.NP)];
    this.pAmp = [new Float32Array(this.NP), new Float32Array(this.NP)];
    this.pTau = [new Float32Array(this.NP), new Float32Array(this.NP)];
    this.pTa = [new Float32Array(this.NP), new Float32Array(this.NP)];

    this.lpB = [0, 0]; this.lpF = [0, 0]; this.lpTf = [0, 0]; this.lpTb = [0, 0]; this.lpEng = [0, 0];
    this.hpX = [0, 0]; this.hpY = [0, 0];
    this.tipPrev = [0, 0];
    this.dcS = [0, 0];
    this.jn1 = 0; this.jn2 = 0; this.jn3 = 0;
    this.ph1 = 0; this.ph2 = 0; this.ph3 = 0;
    this.crackEnv = 0; this.crackLP = 0;

    const fmts = [850, 1280, 1750, 2200];                  // Ti Grade 2, 1.0 mm shell modes
    this.fmtG = [1.0, 0.8, 0.7, 0.55];
    this.fmtHP = [new Biquad(), new Biquad()];
    this.fmt = [fmts.map(() => new Biquad()), fmts.map(() => new Biquad())];
    this.notch = [new Biquad(), new Biquad()];
    this.vlp1 = [new Biquad(), new Biquad()]; this.vlp2 = [new Biquad(), new Biquad()];
    this.dcb = [new Biquad(), new Biquad()];
    this.stockLP = [new Biquad(), new Biquad()];
    this.stockLP2 = [new Biquad(), new Biquad()];
    for (let ch = 0; ch < 2; ch++) {
      this.fmtHP[ch].set('hp', 600, 0.707, fs);
      for (let k = 0; k < fmts.length; k++) this.fmt[ch][k].set('bp', fmts[k], 9, fs);
      this.notch[ch].set('notch', 204, 3.0, fs);             // J-pipe Helmholtz
      this.vlp1[ch].set('lp', 1300, 0.707, fs);
      this.vlp2[ch].set('lp', 1300, 0.707, fs);
      this.dcb[ch].set('hp', 22, 0.707, fs);
      this.stockLP[ch].set('lp', 1900, 0.8, fs);
      this.stockLP2[ch].set('lp', 3200, 0.707, fs);
    }
  }

  addPulse(bank, amp, tau, ta) {
    const act = this.pAct[bank];
    for (let i = 0; i < this.NP; i++) {
      if (!act[i]) {
        act[i] = 1; this.pAge[bank][i] = 0; this.pAmp[bank][i] = amp;
        this.pTau[bank][i] = tau; this.pTa[bank][i] = ta; return;
      }
    }
  }

  fire(cyl, thr, rpmN) {
    const bank = cyl <= 3 ? 0 : 1;                         // cyl 1-3 -> bank 1, 4-6 -> bank 2
    const idle = 1 - rpmN;
    const scatter = 1 + (Math.random() * 2 - 1) * (0.04 + 0.08 * idle);
    const amp = (0.22 + 0.78 * thr) * (0.55 + 0.45 * Math.min(1, rpmN * 1.6 + 0.2)) * scatter;
    const tau = 0.0012 * Math.pow(1 / (0.35 + rpmN), 0.35);   // blow-down shortens with RPM
    this.addPulse(bank, amp, tau, 0.00022);
    this.lastCyl = cyl;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const n = L.length, fs = this.fs, c = this.c, p = this.p;
    const mt = p.divina ? 1 : 0;
    const vt = p.valveClosed ? 1 : 0;
    const thrT = p.throttle;
    const hpR = 1 - TWO_PI * 20 / fs;
    const inj = [0, 0];
    for (let s = 0; s < n; s++) {
      this.rpmS += (p.rpm - this.rpmS) * this.kr;
      this.thrS += (thrT - this.thrS) * this.kt;
      this.m += (mt - this.m) * this.km;
      this.vs += (vt - this.vs) * this.kv;
      const m = this.m, thr = this.thrS;
      const rpmN = clamp((this.rpmS - 1000) / 6200, 0, 1);

      // pitch instability (idle lope + load flutter)
      this.jn1 += 0.0009 * ((Math.random() * 2 - 1) - this.jn1);
      this.jn2 += 0.003 * ((Math.random() * 2 - 1) - this.jn2);
      const jit = (0.006 * (1 - rpmN) + 0.0012 * thr) * this.jn1 * 8 + 0.0006 * thr * this.jn2 * 4;
      const rpmEff = this.rpmS * (1 + jit);

      // 720-degree crank, a firing event every 120 degrees
      this.acc += rpmEff * 6 / fs;                         // rpm/60*360 deg per second
      while (this.acc >= 120) {
        this.acc -= 120;
        this.fire(FIRING[this.idx], thr, rpmN);
        this.idx = (this.idx + 1) % 6;
      }

      // overrun pops & crackles
      if (thr < 0.06 && this.rpmS > 2200) {
        const rate = (p.divina ? 26 : 16) * clamp((this.rpmS - 2200) / 4500, 0, 1);
        if (Math.random() < rate / fs) {
          const b = Math.random() < 0.5 ? 0 : 1;
          const big = Math.random() < 0.25;
          this.addPulse(b, (big ? 2.4 : 1.1) * (0.6 + 0.8 * Math.random()), big ? 0.0009 : 0.00035, 0.00008);
          this.crackEnv = Math.max(this.crackEnv, big ? 0.9 : 0.5);
        }
      }

      // windowed asymmetric gas pulses per bank + 20 Hz DC block
      for (let b = 0; b < 2; b++) {
        let v = 0;
        const act = this.pAct[b];
        for (let i = 0; i < this.NP; i++) {
          if (!act[i]) continue;
          const t = this.pAge[b][i] / fs, ta = this.pTa[b][i], tau = this.pTau[b][i];
          if (t > ta + 8 * tau) { act[i] = 0; continue; }
          const sh = t < ta ? 0.5 * (1 - Math.cos(Math.PI * t / ta)) : Math.exp(-(t - ta) / tau);
          v += this.pAmp[b][i] * sh;
          this.pAge[b][i] += 1;
        }
        const y = v - this.hpX[b] + hpR * this.hpY[b];
        this.hpX[b] = v; this.hpY[b] = y; inj[b] = y;
      }

      // pipe delays from physical lengths / c_gas (crossfaded stock <-> Divina)
      const D0 = lerp(this.Lstock[0], this.Ldiv[0], m) / c * fs;
      const D1 = lerp(this.Lstock[1], this.Ldiv[1], m) / c * fs;
      const DT = this.Ltail / c * fs;
      const aLoss = lerp(0.5, 0.14, m);
      const xc = lerp(0.22, 1.0, m);                       // X-pipe cross-coupling
      const drive = 0.8 + 1.6 * thr * (0.5 + 0.5 * m);     // venturi / gas-velocity drive

      const f1 = this.dF[0].read(D0), f2 = this.dF[1].read(D1);
      const b1 = this.dB[0].read(D0), b2 = this.dB[1].read(D1);
      const tb1 = this.dTb[0].read(DT), tb2 = this.dTb[1].read(DT);
      const tf1 = this.dTf[0].read(DT), tf2 = this.dTf[1].read(DT);

      this.lpEng[0] += 0.55 * (b1 - this.lpEng[0]);
      this.lpEng[1] += 0.55 * (b2 - this.lpEng[1]);
      const e0 = 0.5 * this.lpEng[0] + inj[0];
      const e1 = 0.5 * this.lpEng[1] + inj[1];

      // 18-degree X-pipe: 4-port parallel junction, venturi soft saturation
      let pJ = 0.5 * (f1 + f2 + tb1 + tb2);
      pJ = Math.tanh(drive * pJ) / drive;
      const oB1 = xc * (pJ - f1) + (1 - xc) * tb1;
      const oB2 = xc * (pJ - f2) + (1 - xc) * tb2;
      const oT1 = xc * (pJ - tb1) + (1 - xc) * f1;
      const oT2 = xc * (pJ - tb2) + (1 - xc) * f2;

      const kl = 1 - aLoss;
      this.lpF[0] += kl * (e0 - this.lpF[0]); this.lpF[1] += kl * (e1 - this.lpF[1]);
      this.lpB[0] += kl * (oB1 - this.lpB[0]); this.lpB[1] += kl * (oB2 - this.lpB[1]);
      this.lpTf[0] += kl * (oT1 - this.lpTf[0]); this.lpTf[1] += kl * (oT2 - this.lpTf[1]);
      this.dF[0].write(0.99 * this.lpF[0]); this.dF[1].write(0.99 * this.lpF[1]);
      this.dB[0].write(0.99 * this.lpB[0]); this.dB[1].write(0.99 * this.lpB[1]);
      this.dTf[0].write(0.99 * this.lpTf[0]); this.dTf[1].write(0.99 * this.lpTf[1]);

      // open tail end: radiation (high-pass-like) + reflection (-0.88, lowpassed)
      this.lpTb[0] += 0.6 * (tf1 - this.lpTb[0]); this.lpTb[1] += 0.6 * (tf2 - this.lpTb[1]);
      this.dTb[0].write(-0.88 * this.lpTb[0]); this.dTb[1].write(-0.88 * this.lpTb[1]);
      const rad0 = tf1 - 0.85 * this.tipPrev[0], rad1 = tf2 - 0.85 * this.tipPrev[1];
      this.tipPrev[0] = tf1; this.tipPrev[1] = tf2;
      let l = 0.8 * rad0 + 0.2 * rad1, r = 0.8 * rad1 + 0.2 * rad0;

      // V12 harmonic waveshaper (2x order), Divina only
      const k12 = 0.55 * m;
      if (k12 > 0.001) {
        const sl = l * l, sr = r * r;
        this.dcS[0] += 0.002 * (sl - this.dcS[0]); this.dcS[1] += 0.002 * (sr - this.dcS[1]);
        l += k12 * (sl - this.dcS[0]) * 1.6; r += k12 * (sr - this.dcS[1]) * 1.6;
      }

      // Ti shell formants, excited by the high-passed pulse flow
      const fg = (0.02 + m * (0.12 + 0.30 * thr)) * (0.5 + 0.8 * rpmN);
      const el = this.fmtHP[0].process(l), er = this.fmtHP[1].process(r);
      let fl = 0, fr = 0;
      for (let k = 0; k < 4; k++) {
        fl += this.fmt[0][k].process(el) * this.fmtG[k];
        fr += this.fmt[1][k].process(er) * this.fmtG[k];
      }
      l += fg * fl * 3; r += fg * fr * 3;

      // stock muffler voicing (darker)
      if (m < 0.999) {
        const sl2 = this.stockLP2[0].process(this.stockLP[0].process(l));
        const sr2 = this.stockLP2[1].process(this.stockLP[1].process(r));
        l = lerp(sl2, l, m); r = lerp(sr2, r, m);
      }

      // turbo spool & whistle
      const tTarget = thr * clamp((this.rpmS - 1500) / 4200, 0, 1);
      this.tsp += (tTarget - this.tsp) * (tTarget > this.tsp ? 1 / (0.7 * fs) : 1 / (1.4 * fs));
      this.jn3 += 0.01 * ((Math.random() * 2 - 1) - this.jn3);
      if (this.tsp > 0.01) {
        const f1w = 1500 + 1500 * this.tsp, f2w = f1w * 1.013;
        this.ph1 += TWO_PI * f1w / fs; this.ph2 += TWO_PI * f2w / fs; this.ph3 += TWO_PI * f1w * 2 / fs;
        if (this.ph1 > TWO_PI) this.ph1 -= TWO_PI;
        if (this.ph2 > TWO_PI) this.ph2 -= TWO_PI;
        if (this.ph3 > TWO_PI) this.ph3 -= TWO_PI;
        const aw = 0.016 * Math.pow(this.tsp, 1.6) * (1 + 0.35 * this.jn3);
        l += aw * (Math.sin(this.ph1) + 0.25 * Math.sin(this.ph3));
        r += aw * (Math.sin(this.ph2) + 0.25 * Math.sin(this.ph3 * 1.01));
      }

      // crackle noise
      if (this.crackEnv > 1e-4) {
        const nz = Math.random() * 2 - 1;
        this.crackLP += 0.35 * (nz - this.crackLP);
        const cr = (nz - this.crackLP) * this.crackEnv * 0.35;
        l += cr; r += cr * 0.9;
        this.crackEnv *= 0.9985;
      }

      // valved rear muffler: ~-18 dB with dark roll-off when closed
      const cl = this.vlp2[0].process(this.vlp1[0].process(l)) * 0.2;
      const cr2 = this.vlp2[1].process(this.vlp1[1].process(r)) * 0.2;
      l = lerp(l, cl, this.vs); r = lerp(r, cr2, this.vs);

      // Helmholtz J-pipe notch @204 Hz (depth tracks cruise load)
      const ndT = (p.antiDrone && p.divina) ? clamp(1.0 - 0.45 * thr, 0.5, 1) : 0;
      this.nd += (ndT - this.nd) * this.kv * 0.2;
      const nl = this.notch[0].process(l), nr = this.notch[1].process(r);
      l -= this.nd * (l - nl); r -= this.nd * (r - nr);

      l = this.dcb[0].process(l); r = this.dcb[1].process(r);
      const g = 7 * (1 + 1.5 * (1 - rpmN)) * p.master;
      L[s] = Math.tanh(l * g); R[s] = Math.tanh(r * g);
    }
    this.sinceReport += n;
    if (this.sinceReport >= 1024) {
      this.sinceReport = 0;
      this.port.postMessage({ theta: (this.idx * 120 + this.acc) % 720, cyl: this.lastCyl, rpm: this.rpmS, tsp: this.tsp });
    }
    return true;
  }
}
registerProcessor('s58-exhaust', S58Processor);
