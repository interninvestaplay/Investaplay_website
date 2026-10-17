// Sound Effects Utility for QuizzyFox Web
// Generates cute baby fox yips, playful chirps, and wink chimes using Web Audio API

let audioCtx: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

/**
 * Cute baby fox playful yip / bark sound ("Yip-yip! 🦊")
 * Plays real recorded cute animal audio with high-pitch baby fox playback
 */
export const playCuteFoxSound = () => {
  try {
    const audio = new Audio('/audio/fox-bark-short.mp3');
    audio.playbackRate = 1.28; // Cute playful baby fox pitch
    audio.volume = 0.9;
    audio.currentTime = 0;
    
    const promise = audio.play();
    if (promise !== undefined) {
      promise.catch(() => {
        // Fallback to longer version
        const fallback = new Audio('/audio/fox-bark.mp3');
        fallback.playbackRate = 1.25;
        fallback.volume = 0.9;
        fallback.play().catch(() => {});
      });
    }
  } catch (err) {
    console.warn('Fox sound play error:', err);
  }
};

/**
 * Playful magical twinkle chime when Fox winks
 */
export const playWinkChime = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [659.25, 880, 1174.66, 1760]; // E5, A5, D6, A6

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const noteTime = now + idx * 0.05;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0, noteTime);
      gain.gain.linearRampToValueAtTime(0.2, noteTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.25);
    });
  } catch (err) {
    console.warn('Wink chime error:', err);
  }
};
