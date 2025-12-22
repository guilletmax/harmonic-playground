// Audio Engine - from design spec Section 9

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

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function playDegree(degree: number): void {
  const ctx = getAudioContext();
  const frequency = getFrequency(degree, config.key);

  // Create oscillator
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

  // Create envelope
  const gainNode = ctx.createGain();
  const now = ctx.currentTime;
  const attackTime = 0.01;
  const decayTime = 0.5;

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.3, now + attackTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + attackTime + decayTime);

  // Connect and play
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(now);
  oscillator.stop(now + attackTime + decayTime + 0.1);
}

export function resumeAudio(): void {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
}
