/** Playback only. Never touches microphone tracks, constraints or the V8 context lease. */
export const LIVE_VOICE_VOLUME_KEY = 'soundblend_live_voice_volume_v1';
const CHANGE = 'sb:live-voice-volume';
let memoryVolume = 1, volatileVolume: number | null = null;
export function getLiveVoiceVolume(): number {
  if (volatileVolume !== null) return volatileVolume;
  try {
    const raw = localStorage.getItem(LIVE_VOICE_VOLUME_KEY);
    if (raw === null || !raw.trim()) return 1;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
  } catch { return memoryVolume; }
}
export function setLiveVoiceVolume(value: number): void {
  if (!Number.isFinite(value)) return;
  memoryVolume = Math.max(0, Math.min(1, value));
  try { localStorage.setItem(LIVE_VOICE_VOLUME_KEY, String(memoryVolume)); volatileVolume = null; }
  catch { volatileVolume = memoryVolume; }
  window.dispatchEvent(new Event(CHANGE));
}
export function subscribeLiveVoiceVolume(callback: () => void): () => void {
  const storage = (event: StorageEvent) => { if (event.key === LIVE_VOICE_VOLUME_KEY || event.key === null) callback(); };
  window.addEventListener(CHANGE, callback); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(CHANGE, callback); window.removeEventListener('storage', storage); };
}

/** A media element gives generated speech a normal media playback path where
 * supported. It CANNOT force Android's system audio category while the mic is
 * open. The optional local attenuation remains effective on either route. */
export class LiveVoiceOutput {
  readonly input: GainNode;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private disposed = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: () => void;
  private mode: 'media' | 'direct' = 'direct';
  get route(): 'media' | 'direct' { return this.mode; }
  constructor(readonly context: AudioContext) {
    this.input = context.createGain(); this.input.gain.value = getLiveVoiceVolume();
    this.unsubscribe = subscribeLiveVoiceVolume(() => {
      if (this.disposed) return;
      const value = getLiveVoiceVolume(); this.input.gain.cancelScheduledValues(context.currentTime);
      if (value === 0) this.input.gain.setValueAtTime(0, context.currentTime);
      else this.input.gain.setTargetAtTime(value, context.currentTime, 0.015);
    });
    try {
      this.destination = context.createMediaStreamDestination();
      const audio = document.createElement('audio'); this.audio = audio;
      audio.dataset.sbLiveVoiceOutput = ''; audio.hidden = true; audio.setAttribute('aria-hidden', 'true');
      audio.setAttribute('playsinline', ''); audio.autoplay = true; audio.volume = 1; audio.muted = false;
      audio.srcObject = this.destination.stream;
      audio.addEventListener('error', this.fallback);
      document.body.appendChild(audio); this.input.connect(this.destination); this.mode = 'media';
      this.resume();
    } catch { this.fallback(); }
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private closeMedia(): void {
    this.clearTimer();
    const audio = this.audio; this.audio = null;
    if (audio) { audio.removeEventListener('error', this.fallback); audio.pause(); audio.srcObject = null; audio.remove(); }
    this.destination?.stream.getTracks().forEach(track => track.stop());
    try { this.destination?.disconnect(); } catch { /* detached already */ }
    this.destination = null;
  }
  private readonly fallback = (): void => {
    if (this.disposed) return;
    this.closeMedia();
    try { this.input.disconnect(); } catch { /* not connected yet */ }
    this.input.connect(this.context.destination); this.mode = 'direct';
  };
  /** Called inside the Live tap first; retries on playback after an interrupt. */
  resume(): void {
    const audio = this.audio;
    if (this.disposed || !audio || this.pending || !audio.paused) return;
    this.pending = true;
    this.clearTimer(); this.timer = setTimeout(() => { if (this.audio === audio) this.fallback(); }, 3000);
    try {
      void Promise.resolve(audio.play()).then(() => {
        if (this.disposed || this.audio !== audio) { audio.pause(); audio.srcObject = null; return; }
        this.clearTimer();
      }).catch(() => { if (!this.disposed && this.audio === audio) this.fallback(); })
        .finally(() => { this.pending = false; });
    } catch { this.pending = false; this.fallback(); }
  }
  pause(): void { if (!this.disposed) this.audio?.pause(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.unsubscribe(); this.closeMedia();
    try { this.input.disconnect(); } catch { /* already detached */ }
  }
}
