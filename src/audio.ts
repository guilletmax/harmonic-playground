// Audio Engine - Simple sine wave synthesis

import { config } from './engine';

const degreeToSemitone: Record<number, number> = {
  1: 0,
  2: 2,
  3: 4,
  4: 5,
  5: 7,
  6: 9,
  7: 11,
};

const rootFrequencies: Record<string, number> = {
  C: 261.63,
  D: 293.66,
  E: 329.63,
  F: 349.23,
  G: 392.0,
  A: 440.0,
  B: 493.88,
};

function getFrequency(degree: number, key: string): number {
  const rootFreq = rootFrequencies[key];
  const semitones = degreeToSemitone[degree];
  let freq = rootFreq * Math.pow(2, semitones / 12);

  // Drop leading tone (7) an octave so it resolves UP to tonic
  if (degree === 7) {
    freq = freq / 2;
  }

  return freq;
}

let audioContext: AudioContext | null = null;
let isInitialized = false;

function ensureContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

// Call this synchronously on user gesture to unlock audio (Safari requirement)
export function initAudio(): void {
  if (isInitialized) return;

  const ctx = ensureContext();

  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  // Play a silent buffer to unlock Safari
  const buffer = ctx.createBuffer(1, 1, 22050);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);

  isInitialized = true;
}

export function playDegree(degree: number): void {
  const ctx = ensureContext();

  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const frequency = getFrequency(degree, config.key);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.value = 0.3;

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.5);
}

// Chord intervals (triads built on each degree)
const chordIntervals: Record<number, number[]> = {
  1: [1, 3, 5],    // I - major
  2: [2, 4, 6],    // ii - minor
  3: [3, 5, 7],    // iii - minor
  4: [4, 6, 1],    // IV - major
  5: [5, 7, 2],    // V - major
  6: [6, 1, 3],    // vi - minor
  7: [7, 2, 4],    // vii° - diminished
};

export function playChord(degree: number): void {
  const ctx = ensureContext();

  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const degrees = chordIntervals[degree];

  degrees.forEach((d, i) => {
    const frequency = getFrequency(d, config.key);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.value = 0.2;  // Quieter per note since stacked

    osc.connect(gain);
    gain.connect(ctx.destination);

    // Slight stagger for richness
    const startTime = ctx.currentTime + i * 0.02;
    osc.start(startTime);
    osc.stop(startTime + 0.6);
  });
}

export function resumeAudio(): void {
  initAudio();
}

// ============================================================================
// MICROPHONE PITCH DETECTION
// ============================================================================

let micStream: MediaStream | null = null;
let analyser: AnalyserNode | null = null;
let pitchCallback: ((hz: number | null) => void) | null = null;
let animationId: number | null = null;

export async function startMicrophoneTracking(
  onPitch: (hz: number | null) => void
): Promise<boolean> {
  try {
    const ctx = ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = ctx.createMediaStreamSource(micStream);

    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    pitchCallback = onPitch;
    detectPitch();

    console.log('Microphone tracking started');
    return true;
  } catch (err) {
    console.error('Microphone access denied:', err);
    return false;
  }
}

export function stopMicrophoneTracking(): void {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  analyser = null;
  pitchCallback = null;
  console.log('Microphone tracking stopped');
}

function detectPitch(): void {
  if (!analyser || !pitchCallback) return;

  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);

  // Check if there's enough signal
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / buffer.length);

  if (rms < 0.002) {
    pitchCallback(null);
  } else {
    const sr = ensureContext().sampleRate;
    const hz = autoCorrelate(buffer, sr);
    if (hz) {
      console.log('Raw detection:', Math.round(hz), 'Hz @ sample rate', sr);
    }
    pitchCallback(hz);
  }

  animationId = requestAnimationFrame(detectPitch);
}

// Simple autocorrelation pitch detection
function autoCorrelate(buffer: Float32Array, sampleRate: number): number | null {
  const size = buffer.length;

  // Compute autocorrelation
  const corr = new Float32Array(size);
  for (let lag = 0; lag < size; lag++) {
    let sum = 0;
    for (let i = 0; i < size - lag; i++) {
      sum += buffer[i] * buffer[i + lag];
    }
    corr[lag] = sum;
  }

  // Search range: 80 Hz to 600 Hz
  const minLag = Math.floor(sampleRate / 600); // ~73 samples at 44100
  const maxLag = Math.floor(sampleRate / 80);  // ~551 samples at 44100

  // Find ALL local maxima in the range, then pick the one at longest lag
  // (lowest frequency) that's still strong enough
  const peaks: { lag: number; val: number }[] = [];

  for (let lag = minLag; lag < Math.min(maxLag, size - 1); lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] > corr[lag + 1]) {
      // It's a local max
      if (corr[lag] > corr[0] * 0.3) {
        peaks.push({ lag, val: corr[lag] });
      }
    }
  }

  if (peaks.length === 0) return null;

  // Pick the strongest peak
  let bestPeak = peaks[0];
  for (const p of peaks) {
    if (p.val > bestPeak.val) {
      bestPeak = p;
    }
  }

  const hz = sampleRate / bestPeak.lag;
  return hz;
}
