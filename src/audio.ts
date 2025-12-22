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

  // Resume if suspended (handles browser autoplay policy)
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const frequency = getFrequency(degree, config.key);

  // Create oscillator
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  // Create gain
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0.3;

  // Connect and play
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start();

  // Fade out
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
  oscillator.stop(ctx.currentTime + 0.6);
}

export function resumeAudio(): void {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
}
