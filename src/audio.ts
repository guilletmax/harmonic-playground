// Audio Engine - Simple sine wave synthesis

import { config } from './engine';
import { PitchDetector } from 'pitchy';
import * as tf from '@tensorflow/tfjs';

// Essentia.js for advanced chord detection
// @ts-ignore - essentia.js types are complex
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
// @ts-ignore
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';

let essentia: any = null;
let essentiaReady = false;

// TensorFlow.js model for chord detection
let chordModel: tf.LayersModel | null = null;
let modelReady = false;

// Load trained chord model
export async function loadChordModel(): Promise<boolean> {
  try {
    chordModel = await tf.loadLayersModel('/chord-model.json');
    modelReady = true;
    console.log('Chord model loaded successfully');
    return true;
  } catch (err) {
    console.error('Failed to load chord model:', err);
    return false;
  }
}

// Chord patterns for converting model output (degrees) to chord names
const CHORD_PATTERNS: { degrees: number[]; name: string; quality: string }[] = [
  { degrees: [1, 3, 5], name: 'I', quality: 'major' },
  { degrees: [2, 4, 6], name: 'ii', quality: 'minor' },
  { degrees: [3, 5, 7], name: 'iii', quality: 'minor' },
  { degrees: [4, 6, 1], name: 'IV', quality: 'major' },
  { degrees: [5, 7, 2], name: 'V', quality: 'major' },
  { degrees: [6, 1, 3], name: 'vi', quality: 'minor' },
  { degrees: [7, 2, 4], name: 'vii°', quality: 'dim' },
  { degrees: [1, 4, 5], name: 'sus4', quality: 'sus' },
  { degrees: [1, 2, 5], name: 'sus2', quality: 'sus' },
  { degrees: [1, 3, 5, 7], name: 'maj7', quality: 'major' },
  { degrees: [5, 7, 2, 4], name: 'V7', quality: '7' },
];

function matchDegreePattern(degrees: number[]): { name: string; quality: string } | null {
  if (degrees.length === 0) return null;

  let bestMatch = '';
  let bestQuality = '';
  let bestScore = 0;

  for (const pattern of CHORD_PATTERNS) {
    const patternSet = new Set(pattern.degrees);
    let matches = 0;
    for (const d of degrees) {
      if (patternSet.has(d)) matches++;
    }
    const precision = matches / degrees.length;
    const recall = matches / pattern.degrees.length;
    const score = (precision + recall) / 2;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = pattern.name;
      bestQuality = pattern.quality;
    }
  }

  if (bestScore < 0.6) {
    return { name: degrees.join('-'), quality: 'unknown' };
  }

  return { name: bestMatch, quality: bestQuality };
}

// Initialize Essentia WASM (call early)
export async function initEssentia(): Promise<boolean> {
  if (essentiaReady) return true;
  try {
    // EssentiaWASM is already the module (not a factory)
    essentia = new Essentia(EssentiaWASM);
    essentiaReady = true;
    console.log('Essentia.js initialized:', essentia.version);
    return true;
  } catch (err) {
    console.error('Failed to initialize Essentia.js:', err);
    return false;
  }
}

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
let pitchCallback: ((hz: number | null, chordDegrees: number[], chordName: string | null, chordQuality: string | null) => void) | null = null;
let animationId: number | null = null;
let pitchDetector: PitchDetector<Float32Array> | null = null;

export async function startMicrophoneTracking(
  onPitch: (hz: number | null, chordDegrees: number[], chordName: string | null, chordQuality: string | null) => void
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

    // Initialize Pitchy detector
    pitchDetector = PitchDetector.forFloat32Array(analyser.fftSize);

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
  pitchDetector = null;
  console.log('Microphone tracking stopped');
}

function detectPitch(): void {
  if (!analyser || !pitchCallback || !pitchDetector) return;

  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);

  // Check if there's enough signal
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / buffer.length);

  if (rms < 0.005) {
    pitchCallback(null, [], null, null);
  } else {
    const sr = ensureContext().sampleRate;

    // Chord mode: detect multiple notes
    if (chordMode) {
      const { degrees, chordName, chordQuality } = detectChordWithName(buffer, sr);
      if (chordName) {
        console.log('Chord:', chordName);
      }
      pitchCallback(null, degrees, chordName, chordQuality);
    } else {
      // Single pitch mode using Pitchy
      const [pitch, clarity] = pitchDetector.findPitch(buffer, sr);

      // Only accept if clarity is good enough and pitch is in reasonable range
      if (clarity > 0.8 && pitch > 60 && pitch < 1000) {
        console.log('Pitchy:', Math.round(pitch), 'Hz, clarity:', clarity.toFixed(2));
        pitchCallback(pitch, [], null, null);
      } else {
        pitchCallback(null, [], null, null);
      }
    }
  }

  animationId = requestAnimationFrame(detectPitch);
}

// Chord detection mode
let chordMode = false;

// Smoothing: track how many consecutive frames each degree has been detected
const degreeFrameCounts: number[] = [0, 0, 0, 0, 0, 0, 0, 0]; // index 0 unused, 1-7 for degrees
const FRAMES_TO_ACTIVATE = 5; // Must be detected this many frames to light up

// Chord templates - defined by scale degrees (1-7)
// These are the diatonic chords in a major key
type ChordTemplate = { name: string; degrees: number[]; quality: 'major' | 'minor' | 'dim' | '7' };

const chordTemplates: ChordTemplate[] = [
  // Diatonic triads in major key
  { name: 'I', degrees: [1, 3, 5], quality: 'major' },      // C major in key of C
  { name: 'ii', degrees: [2, 4, 6], quality: 'minor' },     // D minor
  { name: 'iii', degrees: [3, 5, 7], quality: 'minor' },    // E minor
  { name: 'IV', degrees: [4, 6, 1], quality: 'major' },     // F major
  { name: 'V', degrees: [5, 7, 2], quality: 'major' },      // G major
  { name: 'vi', degrees: [6, 1, 3], quality: 'minor' },     // A minor
  { name: 'vii°', degrees: [7, 2, 4], quality: 'dim' },     // B diminished
  // Dominant 7th (very common)
  { name: 'V7', degrees: [5, 7, 2, 4], quality: '7' },      // G7 in key of C
];

// Chord detection state with hysteresis (stickiness)
let currentChord: string | null = null;
let currentChordQuality: string | null = null;
let currentChordFrames = 0;
let candidateChord: string | null = null;
let candidateFrames = 0;

// Tuning parameters
const FRAMES_TO_ESTABLISH = 6;    // Frames needed to establish a NEW chord
const HYSTERESIS_BONUS = 0.08;    // Score bonus for current chord (stickiness)

export function setChordMode(enabled: boolean): void {
  chordMode = enabled;
  // Reset all state
  for (let i = 0; i < degreeFrameCounts.length; i++) {
    degreeFrameCounts[i] = 0;
  }
  currentChord = null;
  currentChordQuality = null;
  currentChordFrames = 0;
  candidateChord = null;
  candidateFrames = 0;
  console.log('Chord mode:', enabled ? 'ON' : 'OFF');
}

export function getChordMode(): boolean {
  return chordMode;
}

// Match scale degree scores against chord templates with hysteresis
function matchChordTemplate(degreeScores: number[]): { name: string; score: number; quality: string } | null {
  // degreeScores is 1-indexed: [unused, deg1, deg2, deg3, deg4, deg5, deg6, deg7]
  const results: { name: string; score: number; quality: string }[] = [];

  for (const template of chordTemplates) {
    // Calculate score: sum of scores at chord degrees
    let chordEnergy = 0;
    for (const degree of template.degrees) {
      chordEnergy += degreeScores[degree];
    }
    // Normalize by number of notes in chord
    chordEnergy /= template.degrees.length;

    // Penalize energy in non-chord tones
    let nonChordEnergy = 0;
    let nonChordCount = 0;
    for (let d = 1; d <= 7; d++) {
      if (!template.degrees.includes(d)) {
        nonChordEnergy += degreeScores[d];
        nonChordCount++;
      }
    }
    if (nonChordCount > 0) {
      nonChordEnergy /= nonChordCount;
    }

    // Final score: chord energy minus penalty for non-chord tones
    let finalScore = chordEnergy - nonChordEnergy * 0.3;

    // HYSTERESIS: Give bonus to current chord (makes it "sticky")
    if (template.name === currentChord) {
      finalScore += HYSTERESIS_BONUS;
    }

    results.push({ name: template.name, score: finalScore, quality: template.quality });
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);
  const bestMatch = results[0];

  // Only return if score is above threshold
  if (bestMatch && bestMatch.score > 0.25) {
    return bestMatch;
  }
  return null;
}

// Detect chord with name using trained TensorFlow model (or fallback to template matching)
function detectChordWithName(buffer: Float32Array, sampleRate: number): { degrees: number[]; chordName: string | null; chordQuality: string | null } {
  if (!essentiaReady || !essentia) {
    return { degrees: [], chordName: null, chordQuality: null };
  }

  try {
    // Convert to Essentia vector
    const vectorSignal = essentia.arrayToVector(buffer);

    // Apply windowing
    const windowed = essentia.Windowing(
      vectorSignal,
      false,
      buffer.length,
      'hann',
      0,
      true
    ).frame;

    // Compute spectrum
    const spectrum = essentia.Spectrum(windowed, buffer.length).spectrum;

    // Extract spectral peaks
    const peaks = essentia.SpectralPeaks(
      spectrum,
      0,
      5000,
      100,
      40,
      'magnitude',
      sampleRate
    );

    // Compute HPCP
    const hpcpResult = essentia.HPCP(
      peaks.frequencies,
      peaks.magnitudes,
      true,
      500,
      0,
      5000,
      false,
      40,
      false,
      'unitMax',
      440,
      sampleRate,
      12,
      'squaredCosine',
      1
    ).hpcp;

    // Convert HPCP to C-based array (matching training data)
    // Essentia HPCP: 0=A, 1=A#, 2=B, 3=C, etc.
    const hpcp: number[] = [];
    for (let i = 0; i < 12; i++) {
      // Rotate so index 0 = C
      hpcp.push(hpcpResult.get((i + 3) % 12));
    }

    // USE TRAINED MODEL if available
    if (modelReady && chordModel) {
      return detectWithModel(hpcp);
    }

    // FALLBACK: Template matching (original approach)
    return detectWithTemplates(hpcp);

  } catch (err) {
    console.error('Chord detection error:', err);
    return { degrees: [], chordName: null, chordQuality: null };
  }
}

// Detect using trained TensorFlow model
function detectWithModel(hpcp: number[]): { degrees: number[]; chordName: string | null; chordQuality: string | null } {
  if (!chordModel) return { degrees: [], chordName: null, chordQuality: null };

  // Run inference
  const input = tf.tensor2d([hpcp]);
  const prediction = chordModel.predict(input) as tf.Tensor;
  const probs = prediction.dataSync() as Float32Array;

  input.dispose();
  prediction.dispose();

  // Convert model output (7 sigmoid values) to detected degrees
  const threshold = 0.65; // Higher = less sensitive, fewer false positives
  const detectedDegrees: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (probs[i] > threshold) {
      detectedDegrees.push(i + 1); // 1-indexed degrees
    }
  }

  // Apply hysteresis for stability
  const match = matchDegreePattern(detectedDegrees);

  if (match) {
    // Hysteresis logic
    if (match.name === candidateChord) {
      candidateFrames++;
      if (candidateFrames >= FRAMES_TO_ESTABLISH || match.name === currentChord) {
        if (match.name !== currentChord) {
          console.log('Model chord:', match.name, 'degrees:', detectedDegrees);
        }
        currentChord = match.name;
        currentChordQuality = match.quality;
        currentChordFrames++;
        candidateChord = null;
        candidateFrames = 0;
      }
    } else if (match.name !== currentChord) {
      candidateChord = match.name;
      candidateFrames = 1;
    } else {
      currentChordFrames++;
    }
  } else {
    candidateFrames = Math.max(0, candidateFrames - 1);
    currentChordFrames = Math.max(0, currentChordFrames - 1);
    if (currentChordFrames === 0) {
      currentChord = null;
      currentChordQuality = null;
    }
  }

  return { degrees: detectedDegrees, chordName: currentChord, chordQuality: currentChordQuality };
}

// Fallback: template matching (original approach)
function detectWithTemplates(hpcp: number[]): { degrees: number[]; chordName: string | null; chordQuality: string | null } {
  // Map HPCP to current key's scale degrees
  const keyOffsets: Record<string, number> = {
    A: 9, 'A#': 10, B: 11, C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8
  };
  const keyOffset = keyOffsets[config.key] || 0;

  // Major scale intervals: 0, 2, 4, 5, 7, 9, 11 semitones
  const majorScaleIntervals = [0, 2, 4, 5, 7, 9, 11];

  // Build degree scores (1-indexed array)
  const degreeScores: number[] = [0]; // Index 0 unused
  for (let degree = 1; degree <= 7; degree++) {
    const semitone = majorScaleIntervals[degree - 1];
    const hpcpIndex = (keyOffset + semitone) % 12;
    degreeScores.push(hpcp[hpcpIndex]);
  }

  // Match chord template
  const match = matchChordTemplate(degreeScores);

  // Hysteresis
  if (match) {
    if (match.name === candidateChord) {
      candidateFrames++;
      if (candidateFrames >= FRAMES_TO_ESTABLISH) {
        currentChord = match.name;
        currentChordQuality = match.quality;
        currentChordFrames = 1;
        candidateChord = null;
        candidateFrames = 0;
      }
    } else if (match.name !== currentChord) {
      candidateChord = match.name;
      candidateFrames = 1;
    } else {
      currentChordFrames++;
    }
  } else {
    currentChordFrames = Math.max(0, currentChordFrames - 2);
    candidateFrames = Math.max(0, candidateFrames - 1);
    if (currentChordFrames === 0) {
      currentChord = null;
      currentChordQuality = null;
    }
  }

  const degrees = computeDegreesFromDegreeScores(degreeScores);
  return { degrees, chordName: currentChord, chordQuality: currentChordQuality };
}

// Compute scale degrees from degree scores for visualization
function computeDegreesFromDegreeScores(degreeScores: number[]): number[] {
  // degreeScores is 1-indexed: [unused, deg1, deg2, ...]
  const scores: { degree: number; score: number }[] = [];
  for (let degree = 1; degree <= 7; degree++) {
    scores.push({ degree, score: degreeScores[degree] });
  }

  const maxScore = Math.max(...scores.map(s => s.score));
  if (maxScore < 0.1) return [];

  scores.sort((a, b) => b.score - a.score);

  const relativeThreshold = maxScore * 0.4;
  const absoluteThreshold = 0.15;
  const rawDegrees = scores
    .filter(s => s.score > relativeThreshold && s.score > absoluteThreshold)
    .slice(0, 4)
    .map(s => s.degree);

  // Temporal smoothing
  const smoothedDegrees: number[] = [];
  for (let degree = 1; degree <= 7; degree++) {
    const wasDetected = rawDegrees.includes(degree);
    if (wasDetected) {
      degreeFrameCounts[degree] = Math.min(degreeFrameCounts[degree] + 1, FRAMES_TO_ACTIVATE + 3);
    } else {
      degreeFrameCounts[degree] = Math.max(degreeFrameCounts[degree] - 2, 0);
    }
    if (degreeFrameCounts[degree] >= FRAMES_TO_ACTIVATE) {
      smoothedDegrees.push(degree);
    }
  }

  return smoothedDegrees;
}


