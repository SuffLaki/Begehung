// Sprachaufnahme als WAV (16 kHz, mono).
// WAV statt MediaRecorder, weil iOS bei MediaRecorder ein Format liefert
// (audio/mp4), das nicht jeder Transkriptionsdienst annimmt. Dieses Verfahren
// ist in der Jarvis-iPhone-App bereits auf dem iPhone erprobt.

import { confirmDialog, useApp } from '../state/appStore';

const TARGET_RATE = 16000;
const MAX_SECONDS = 120;

export async function ensureMicConsent(): Promise<boolean> {
  const app = useApp.getState();
  if (app.settings.micConsent) return true;
  const ok = await confirmDialog({
    title: 'Mikrofon verwenden?',
    message: 'Für die Spracheingabe nimmt die App auf, solange du die Aufnahme laufen lässt. Die Aufnahme bleibt auf dem Gerät, bis du sie zur Auswertung an den KI-Dienst sendest (nur wenn in den Einstellungen erlaubt). Danach fragt iOS noch einmal nach.',
    confirmLabel: 'Mikrofon erlauben',
    cancelLabel: 'Nicht jetzt',
  });
  if (ok) await app.updateSettings((s) => { s.micConsent = true; });
  return ok;
}

export function micSupported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
}

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  level = 0;
  onLevel: ((level: number, seconds: number) => void) | null = null;
  onLimit: (() => void) | null = null;

  async start(): Promise<void> {
    if (!micSupported()) throw new Error('Mikrofon wird von diesem Browser nicht unterstützt (HTTPS erforderlich).');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NotAllowedError') throw new Error('Mikrofonzugriff verweigert. Unter iOS: Einstellungen → Safari → Mikrofon → „Erlauben“.');
      throw new Error('Mikrofon konnte nicht geöffnet werden.');
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.startedAt = Date.now();
    this.node.onaudioprocess = (ev) => {
      const data = ev.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      this.level = Math.min(1, Math.sqrt(sum / data.length) * 6);
      const secs = (Date.now() - this.startedAt) / 1000;
      this.onLevel?.(this.level, secs);
      if (secs >= MAX_SECONDS) this.onLimit?.();
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(this.node);
    this.node.connect(mute);
    mute.connect(this.ctx.destination);
  }

  get seconds(): number {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  async stop(): Promise<{ wav: Blob; seconds: number }> {
    const rate = this.ctx?.sampleRate ?? 48000;
    const seconds = this.seconds;
    this.release();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let off = 0;
    for (const c of this.chunks) { all.set(c, off); off += c.length; }
    this.chunks = [];
    return { wav: encodeWav(downsample(all, rate, TARGET_RATE), TARGET_RATE), seconds };
  }

  cancel() {
    this.release();
    this.chunks = [];
  }

  private release() {
    if (this.node) { this.node.onaudioprocess = null; this.node.disconnect(); }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }
}

function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return buf;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = start; j < end; j++) s += buf[j];
    out[i] = s / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
