// Main - Simplified visualization
// Two dimensions: WHERE you are (home vs away) + WHICH WAY you're going

import {
  createInitialState,
  playNote,
  decay,
  getTotalTension,
  getNodeColor,
  homeness,
  nodePositions,
  config,
  type State,
  type Resolution,
} from './engine';
import { playDegree, playChord, initAudio, startMicrophoneTracking, stopMicrophoneTracking, setChordMode, getChordMode, initEssentia, loadChordModel } from './audio';

const SVG_NS = 'http://www.w3.org/2000/svg';

const romanNumerals: Record<number, string> = {
  1: 'I',
  2: 'ii',
  3: 'iii',
  4: 'IV',
  5: 'V',
  6: 'vi',
  7: 'vii°',
};

let state: State;
let lastTime = 0;
let nodeElements: Map<number, SVGGElement> = new Map();

// Glitter trail
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
};
let particles: Particle[] = [];
let glitterGroup: SVGGElement;

// Microphone tracking - burning light
let micActive = false;
let burningLight: SVGGElement | null = null;
let currentPitchHz: number | null = null;
let lastPitchPos: { x: number; y: number } | null = null;
let lastValidPitchTime = 0;

// Dwell tracking - trigger note when holding pitch
let dwellDegree: number | null = null;
let dwellStartTime = 0;
const DWELL_THRESHOLD_MS = 150; // How long to hold before triggering

// Chord mode - detected degrees
let detectedChordDegrees: number[] = [];

// Detected chord name display
let chordNameElement: HTMLDivElement | null = null;

// Chromatic note - adjacent degrees that could resolve to
let chromaticAdjacentDegrees: number[] = [];

// Root frequencies for each key (middle octave) - all chromatic keys
const rootFrequencies: Record<string, number> = {
  'C': 261.63,
  'C#': 277.18,
  'Db': 277.18,
  'D': 293.66,
  'D#': 311.13,
  'Eb': 311.13,
  'E': 329.63,
  'F': 349.23,
  'F#': 369.99,
  'Gb': 369.99,
  'G': 392.0,
  'G#': 415.30,
  'Ab': 415.30,
  'A': 440.0,
  'A#': 466.16,
  'Bb': 466.16,
  'B': 493.88,
};

// Key cycles - what each natural key cycles through when pressed repeatedly
const keyCycles: Record<string, string[]> = {
  'C': ['C', 'C#'],
  'D': ['D', 'Db'],
  'E': ['E', 'Eb'],
  'F': ['F', 'F#'],
  'G': ['G', 'Gb'],
  'A': ['A', 'Ab'],
  'B': ['B', 'Bb'],
};

// Track current key cycle index for each natural key
const keyCycleIndex: Record<string, number> = {
  'C': 0, 'D': 0, 'E': 0, 'F': 0, 'G': 0, 'A': 0, 'B': 0,
};

// Key indicator element
let keyIndicator: HTMLDivElement | null = null;

function getRootHz(): number {
  return rootFrequencies[config.key] || 261.63;
}

// Result type for pitch position
type PitchPosition = {
  x: number;
  y: number;
  inKey: boolean;
  degree: number | null;
  adjacentDegrees: number[]; // For chromatic notes: the two scale degrees it sits between
};

// Convert Hz to continuous position in radial space
function hzToPosition(hz: number): PitchPosition {
  // Guard against invalid Hz
  if (!hz || hz <= 0 || !isFinite(hz)) {
    return { x: 50, y: 50, inKey: true, degree: null, adjacentDegrees: [] };
  }

  // Convert Hz to semitones from C
  const semitones = 12 * Math.log2(hz / getRootHz());

  if (!isFinite(semitones)) {
    return { x: 50, y: 50, inKey: true, degree: null, adjacentDegrees: [] };
  }

  // Normalize to one octave (0-12)
  let octaveSemitones = ((semitones % 12) + 12) % 12;

  // Handle wrap-around: if very close to 12, treat as 0
  if (octaveSemitones > 11.5) {
    octaveSemitones = 0;
  }

  // Map semitones to scale degrees (major scale)
  // C=0, D=2, E=4, F=5, G=7, A=9, B=11
  const scaleDegrees = [
    { semi: 0, degree: 1 },   // C
    { semi: 2, degree: 2 },   // D
    { semi: 4, degree: 3 },   // E
    { semi: 5, degree: 4 },   // F
    { semi: 7, degree: 5 },   // G
    { semi: 9, degree: 6 },   // A
    { semi: 11, degree: 7 },  // B
  ];

  // Find lower and upper adjacent scale degrees
  let lowerDegree = scaleDegrees[scaleDegrees.length - 1]; // B (wraps from C)
  let upperDegree = scaleDegrees[0]; // C

  for (let i = 0; i < scaleDegrees.length; i++) {
    if (scaleDegrees[i].semi <= octaveSemitones) {
      lowerDegree = scaleDegrees[i];
      upperDegree = scaleDegrees[(i + 1) % scaleDegrees.length];
    }
  }

  // Calculate distance to lower degree
  let distToLower = octaveSemitones - lowerDegree.semi;
  if (distToLower < 0) distToLower += 12; // Handle wrap

  // Gap between the two scale degrees
  let gap = upperDegree.semi - lowerDegree.semi;
  if (gap <= 0) gap += 12; // Handle wrap (B to C)

  // How far between the two degrees (0 = at lower, 1 = at upper)
  const t = distToLower / gap;

  // Check if we're close enough to snap to a scale degree
  const distToNearest = Math.min(distToLower, gap - distToLower);
  const inKey = distToNearest < 0.25;

  if (inKey) {
    // Snap to the nearest scale degree
    const nearestDegree = distToLower < (gap - distToLower) ? lowerDegree : upperDegree;
    const pos = nodePositions[nearestDegree.degree];
    return { x: pos.x, y: pos.y, inKey: true, degree: nearestDegree.degree, adjacentDegrees: [] };
  }

  // Chromatic note: interpolate position between the two adjacent scale degrees
  const lowerPos = nodePositions[lowerDegree.degree];
  const upperPos = nodePositions[upperDegree.degree];

  return {
    x: lowerPos.x + (upperPos.x - lowerPos.x) * t,
    y: lowerPos.y + (upperPos.y - lowerPos.y) * t,
    inKey: false,
    degree: null,
    adjacentDegrees: [lowerDegree.degree, upperDegree.degree]
  };
}

function spawnGlitter(degree: number) {
  const pos = nodePositions[degree];
  const color = getNodeColor(degree, state);
  const count = 12 + Math.random() * 8;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.3 + Math.random() * 0.5;
    particles.push({
      x: pos.x,
      y: pos.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      maxLife: 1.5 + Math.random() * 1,
      size: 0.3 + Math.random() * 0.4,
      hue: color.h + (Math.random() - 0.5) * 30,
    });
  }
}

function updateParticles(deltaTime: number) {
  // Update existing particles
  particles = particles.filter(p => {
    p.life -= deltaTime / p.maxLife;
    p.x += p.vx * deltaTime * 10;
    p.y += p.vy * deltaTime * 10;
    p.vx *= 0.98;  // Drag
    p.vy *= 0.98;
    return p.life > 0;
  });

  // Render particles
  while (glitterGroup.firstChild) {
    glitterGroup.removeChild(glitterGroup.firstChild);
  }

  for (const p of particles) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(p.x));
    circle.setAttribute('cy', String(p.y));
    circle.setAttribute('r', String(p.size * p.life));
    circle.setAttribute('fill', `hsla(${p.hue}, 80%, 70%, ${p.life * 0.8})`);
    glitterGroup.appendChild(circle);
  }
}

async function init() {
  state = createInitialState();

  // Initialize Essentia.js for chord detection (async WASM load)
  initEssentia().then(ready => {
    if (ready) console.log('Essentia ready for chord detection');
  });

  // Load trained chord model
  loadChordModel().then(ready => {
    if (ready) console.log('Trained chord model loaded!');
  });

  // Create chord name display element
  chordNameElement = document.createElement('div');
  chordNameElement.id = 'chord-name';
  chordNameElement.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: 'Georgia', serif;
    font-size: 72px;
    font-weight: normal;
    color: rgba(255, 255, 255, 0);
    text-shadow:
      0 0 20px rgba(255, 200, 100, 0.5),
      0 0 40px rgba(255, 200, 100, 0.3),
      0 0 60px rgba(255, 200, 100, 0.2);
    pointer-events: none;
    user-select: none;
    transition: color 0.3s ease-out, text-shadow 0.3s ease-out;
    z-index: 100;
  `;
  document.body.appendChild(chordNameElement);

  // Create key indicator element
  keyIndicator = document.createElement('div');
  keyIndicator.id = 'key-indicator';
  keyIndicator.textContent = config.key;
  document.body.appendChild(keyIndicator);

  const canvas = document.getElementById('canvas') as unknown as SVGSVGElement;

  // Create glitter layer (behind nodes)
  glitterGroup = document.createElementNS(SVG_NS, 'g');
  glitterGroup.setAttribute('id', 'glitter');
  canvas.appendChild(glitterGroup);

  // Create burning light (for mic input)
  burningLight = document.createElementNS(SVG_NS, 'g');
  burningLight.setAttribute('id', 'burning-light');
  burningLight.style.display = 'none';

  // Outer glow
  const outerGlow = document.createElementNS(SVG_NS, 'circle');
  outerGlow.setAttribute('r', '4');
  outerGlow.setAttribute('fill', 'rgba(255, 200, 100, 0.3)');
  outerGlow.setAttribute('filter', 'url(#glow)');
  outerGlow.classList.add('outer-glow');

  // Inner core
  const innerCore = document.createElementNS(SVG_NS, 'circle');
  innerCore.setAttribute('r', '1.5');
  innerCore.setAttribute('fill', 'rgba(255, 255, 220, 0.95)');
  innerCore.classList.add('inner-core');

  burningLight.appendChild(outerGlow);
  burningLight.appendChild(innerCore);

  // Create nodes
  for (let degree = 1; degree <= 7; degree++) {
    const pos = nodePositions[degree];
    const home = homeness[degree];

    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('node');
    group.dataset.degree = String(degree);

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(pos.x));
    circle.setAttribute('cy', String(pos.y));

    // Size based on homeness
    const size = config.minSize + (config.maxSize - config.minSize) * home;
    circle.setAttribute('r', String(size));

    // Initial color
    const color = getNodeColor(degree, state);
    circle.setAttribute('fill', `hsl(${color.h}, ${color.s}%, ${color.l}%)`);
    circle.setAttribute('filter', 'url(#glow)');

    // Roman numeral label
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(pos.x));
    label.setAttribute('y', String(pos.y));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('fill', 'rgba(255, 255, 255, 0.9)');
    label.setAttribute('font-family', 'Georgia, serif');
    label.setAttribute('font-size', String(size * 0.5));
    label.setAttribute('pointer-events', 'none');
    label.textContent = romanNumerals[degree];

    group.appendChild(circle);
    group.appendChild(label);
    canvas.appendChild(group);
    nodeElements.set(degree, group);

    // Click handler (shift+click for chord)
    group.addEventListener('click', (e) => onNodeClick(degree, e.shiftKey));
  }

  // Add burning light on top
  canvas.appendChild(burningLight!);

  // Unlock audio on first interaction (Safari requirement)
  document.addEventListener('click', initAudio, { once: true });

  // Keyboard handler for mic toggle and key changes
  const keys = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

  document.addEventListener('keydown', async (e) => {
    // Mic toggle
    if (e.key === 'm' || e.key === 'M') {
      if (micActive) {
        stopMicrophoneTracking();
        micActive = false;
        burningLight!.style.display = 'none';
        currentPitchHz = null;
        console.log('Mic OFF');
      } else {
        initAudio();
        const success = await startMicrophoneTracking((hz, chordDegrees, chordName, chordQuality) => {
          currentPitchHz = hz;
          detectedChordDegrees = chordDegrees;
          updateChordDisplay(chordName, chordQuality);
        });
        if (success) {
          micActive = true;
          burningLight!.style.display = 'block';
          console.log('Mic ON - sing or play an instrument!');
          console.log('Press P to toggle chord detection mode');
        }
      }
    }

    // Key change (C,D,E,F,G,A,B - but not P which toggles chord mode)
    const keyUpper = e.key.toUpperCase();
    if (keys.includes(keyUpper) && keyUpper !== 'P') {
      const cycle = keyCycles[keyUpper];
      const currentKey = config.key;

      // Check if we're already on this key's cycle
      const currentIndexInCycle = cycle.indexOf(currentKey);
      if (currentIndexInCycle !== -1) {
        // Same key pressed - cycle to next variant
        keyCycleIndex[keyUpper] = (currentIndexInCycle + 1) % cycle.length;
      } else {
        // Different key pressed - start at natural (index 0)
        keyCycleIndex[keyUpper] = 0;
      }

      config.key = cycle[keyCycleIndex[keyUpper]];
      state = createInitialState(); // Reset state for new key
      updateKeyIndicator();
      updateVisuals();
      console.log('Key changed to:', config.key);
    }

    // Chord mode toggle
    if (e.key === 'p' || e.key === 'P') {
      const newMode = !getChordMode();
      setChordMode(newMode);
      detectedChordDegrees = [];
      updateModeIndicator(newMode);
      // Clear chord display immediately when switching to pitch mode
      if (!newMode) {
        if (chordFadeTimeout) {
          clearTimeout(chordFadeTimeout);
          chordFadeTimeout = null;
        }
        if (chordNameElement) {
          chordNameElement.style.color = 'rgba(255, 255, 255, 0)';
        }
        lastDisplayedChord = null;
      }
    }
  });

  // Start animation loop
  requestAnimationFrame(animate);
}

function onNodeClick(degree: number, shift: boolean = false) {
  initAudio();

  if (shift) {
    playChord(degree);
  } else {
    playDegree(degree);
  }

  // Spawn glitter
  spawnGlitter(degree);

  const resolution = playNote(state, degree);

  if (resolution) {
    triggerResolutionFeedback(resolution);
  }

  // Log state
  const tensionList = Array.from(state.tensions.entries())
    .map(([d, t]) => `${d}:${t.toFixed(2)}`)
    .join(' ');

  console.log(
    `Note ${degree} | ` +
    `home: ${homeness[degree].toFixed(1)} | ` +
    `dir: ${state.direction} | ` +
    `tension: [${tensionList || 'none'}]` +
    (resolution ? ` | RESOLVED ${resolution.from}→${resolution.to}` : '')
  );

  updateVisuals();
}

function triggerResolutionFeedback(resolution: Resolution) {
  const fromElement = nodeElements.get(resolution.from);
  const toElement = nodeElements.get(resolution.to);

  if (fromElement) {
    fromElement.classList.add('resolving');
    setTimeout(() => fromElement.classList.remove('resolving'), 200);
  }

  if (toElement) {
    toElement.classList.add('resolved-target');
    setTimeout(() => toElement.classList.remove('resolved-target'), 150);
  }
}

function updateBackground() {
  const tension = getTotalTension(state);
  // Cool dark blue at rest, warm amber at high tension
  const r = Math.round(10 + tension * 25);
  const g = Math.round(10 + tension * 8);
  const b = Math.round(15 - tension * 10);
  document.body.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
}

function updateModeIndicator(chordMode: boolean) {
  const indicator = document.getElementById('mode-indicator');
  if (indicator) {
    indicator.textContent = chordMode ? 'C' : 'P';
    indicator.classList.toggle('chord-mode', chordMode);
  }
}

function updateKeyIndicator() {
  if (keyIndicator) {
    keyIndicator.textContent = config.key;
    // Add/remove accidental class for styling
    const hasAccidental = config.key.includes('#') || config.key.includes('b');
    keyIndicator.classList.toggle('has-accidental', hasAccidental);
  }
}

let lastDisplayedChord: string | null = null;
let chordFadeTimeout: number | null = null;

function updateChordDisplay(chordName: string | null, quality: string | null) {
  if (!chordNameElement) return;

  if (chordName && chordName !== lastDisplayedChord) {
    // New chord detected - show it
    chordNameElement.textContent = chordName;
    chordNameElement.style.color = 'rgba(255, 255, 255, 0.9)';

    // Color based on chord quality
    if (quality === 'minor') {
      // Minor chord - cooler blue
      chordNameElement.style.textShadow = `
        0 0 20px rgba(150, 180, 255, 0.6),
        0 0 40px rgba(150, 180, 255, 0.4),
        0 0 60px rgba(150, 180, 255, 0.2)
      `;
    } else if (quality === 'dim') {
      // Diminished - purple/mysterious
      chordNameElement.style.textShadow = `
        0 0 20px rgba(200, 100, 255, 0.6),
        0 0 40px rgba(200, 100, 255, 0.4),
        0 0 60px rgba(200, 100, 255, 0.2)
      `;
    } else if (quality === '7') {
      // 7th chord - warm orange
      chordNameElement.style.textShadow = `
        0 0 20px rgba(255, 150, 100, 0.6),
        0 0 40px rgba(255, 150, 100, 0.4),
        0 0 60px rgba(255, 150, 100, 0.2)
      `;
    } else {
      // Major chord - bright gold
      chordNameElement.style.textShadow = `
        0 0 20px rgba(255, 220, 100, 0.6),
        0 0 40px rgba(255, 220, 100, 0.4),
        0 0 60px rgba(255, 220, 100, 0.2)
      `;
    }

    lastDisplayedChord = chordName;

    // Clear any pending fade
    if (chordFadeTimeout) {
      clearTimeout(chordFadeTimeout);
    }
  }

  if (!chordName && lastDisplayedChord) {
    // Chord stopped - start fade out after delay
    if (!chordFadeTimeout) {
      chordFadeTimeout = window.setTimeout(() => {
        if (chordNameElement) {
          chordNameElement.style.color = 'rgba(255, 255, 255, 0)';
        }
        lastDisplayedChord = null;
        chordFadeTimeout = null;
      }, 500); // Hold for 500ms before fading
    }
  }
}

function updateVisuals() {
  updateBackground();
  const time = performance.now() / 1000;
  const totalTension = getTotalTension(state);

  for (let degree = 1; degree <= 7; degree++) {
    const element = nodeElements.get(degree);
    if (!element) continue;

    const circle = element.querySelector('circle')!;
    const pos = nodePositions[degree];
    const home = homeness[degree];
    const tension = state.tensions.get(degree) ?? 0;

    // Size: base from homeness, grows with tension
    const baseSize = config.minSize + (config.maxSize - config.minSize) * home;
    const size = baseSize + tension * 2;

    // Color from engine
    const color = getNodeColor(degree, state);

    // Opacity: brighter when tense or when it's a target
    let opacity = 0.5 + home * 0.3;
    if (tension > 0.1) {
      opacity = Math.min(1, opacity + tension * 0.3);
    }

    // Chord mode: highlight detected degrees
    const isChordNote = getChordMode() && detectedChordDegrees.includes(degree);
    if (isChordNote) {
      opacity = 1;
    }

    // Chromatic note: glow adjacent degrees (resolution targets)
    const isResolutionTarget = chromaticAdjacentDegrees.includes(degree);
    if (isResolutionTarget) {
      opacity = Math.min(1, opacity + 0.3);
    }

    // Tonic breathing when tension exists elsewhere
    let finalSize = size;
    if (degree === 1 && totalTension > 0.1 && tension < 0.1) {
      const breath = Math.sin(time * 1.5) * 0.5 + 0.5;
      const breathScale = 1 + breath * 0.08 * totalTension;
      finalSize = size * breathScale;
      opacity = Math.min(1, opacity + breath * 0.15 * totalTension);
    }

    // Chord mode: pulse detected notes
    if (isChordNote) {
      const pulse = Math.sin(time * 4) * 0.5 + 0.5;
      finalSize = size * (1.1 + pulse * 0.15);
    }

    circle.setAttribute('r', String(finalSize));

    // Motion for tense nodes
    if (tension > 0.1) {
      const drift = tension * 0.5;
      const offsetX = Math.sin(time * 2 + degree) * drift;
      const offsetY = Math.cos(time * 2.5 + degree * 0.7) * drift;
      circle.setAttribute('cx', String(pos.x + offsetX));
      circle.setAttribute('cy', String(pos.y + offsetY));
    } else {
      circle.setAttribute('cx', String(pos.x));
      circle.setAttribute('cy', String(pos.y));
    }

    circle.setAttribute('fill', `hsl(${color.h}, ${color.s}%, ${color.l}%)`);
    circle.style.opacity = String(opacity);
  }
}

function updateBurningLight() {
  if (!burningLight || !micActive) return;

  const now = performance.now();

  if (currentPitchHz === null) {
    // No pitch detected - fade out gradually over 800ms
    const timeSincePitch = now - lastValidPitchTime;
    const fadeOpacity = Math.max(0.15, 1 - timeSincePitch / 800);
    burningLight.style.opacity = String(fadeOpacity);

    // Don't reset stable pitch - keep it for jump filtering

    // Still update position smoothly if we have a last position
    if (lastPitchPos && fadeOpacity > 0.15) {
      const circles = burningLight.querySelectorAll('circle');
      circles.forEach(c => {
        c.setAttribute('cx', String(lastPitchPos!.x));
        c.setAttribute('cy', String(lastPitchPos!.y));
      });
    }
    return;
  }

  lastValidPitchTime = now;
  burningLight.style.opacity = '1';

  const stableHz = currentPitchHz;

  // Debug: show detected pitch
  console.log('Hz:', Math.round(stableHz), '→ semitones:', (12 * Math.log2(stableHz / getRootHz())).toFixed(1));

  const rawPos = hzToPosition(stableHz);

  if (!isFinite(rawPos.x) || !isFinite(rawPos.y)) {
    return;
  }

  // Dwell detection - trigger note effects when holding pitch
  if (rawPos.degree !== null) {
    if (rawPos.degree === dwellDegree) {
      // Same note - check if we've dwelled long enough
      if (now - dwellStartTime >= DWELL_THRESHOLD_MS) {
        const degree = rawPos.degree;

        // Trigger the note - same as clicking
        console.log('[Mic] BEFORE playNote:', degree, 'tensions:', [...state.tensions.entries()]);
        spawnGlitter(degree);
        const resolution = playNote(state, degree);
        console.log('[Mic] AFTER playNote:', degree, 'resolution:', resolution, 'tensions:', [...state.tensions.entries()]);
        if (resolution) {
          triggerResolutionFeedback(resolution);
        }

        // Log state (same as click)
        const tensionList = Array.from(state.tensions.entries())
          .map(([d, t]) => `${d}:${t.toFixed(2)}`)
          .join(' ');
        console.log(
          `[Mic] Note ${degree} | ` +
          `home: ${homeness[degree].toFixed(1)} | ` +
          `dir: ${state.direction} | ` +
          `tension: [${tensionList || 'none'}]` +
          (resolution ? ` | RESOLVED ${resolution.from}→${resolution.to}` : '')
        );

        updateVisuals();
        // Reset to prevent re-triggering (require leaving and coming back)
        dwellDegree = null;
      }
    } else {
      // New note - start dwell timer
      dwellDegree = rawPos.degree;
      dwellStartTime = now;
    }
  } else {
    // Not on a note - reset dwell
    dwellDegree = null;
  }

  // Track adjacent degrees for chromatic notes (for resolution glow)
  chromaticAdjacentDegrees = rawPos.adjacentDegrees;

  let pos = { ...rawPos };

  // Add subtle wobble for chromatic notes
  if (!rawPos.inKey && rawPos.adjacentDegrees.length > 0) {
    const wobble = Math.sin(now * 0.015) * 0.8;
    pos.x += wobble;
    pos.y += Math.cos(now * 0.012) * 0.5;
  }

  // Smooth movement (but snap when close)
  const smoothing = 0.25;
  if (lastPitchPos) {
    const dx = pos.x - lastPitchPos.x;
    const dy = pos.y - lastPitchPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 1) {
      // Close enough, snap to target
    } else {
      pos.x = lastPitchPos.x + dx * smoothing;
      pos.y = lastPitchPos.y + dy * smoothing;
    }
  }
  lastPitchPos = { x: pos.x, y: pos.y };

  // Update position
  const circles = burningLight.querySelectorAll('circle');
  circles.forEach(c => {
    c.setAttribute('cx', String(pos.x));
    c.setAttribute('cy', String(pos.y));
  });

  // Color: warm if in-key, cooler if out-of-key
  const outerGlow = burningLight.querySelector('.outer-glow');
  if (outerGlow) {
    if (pos.inKey) {
      outerGlow.setAttribute('fill', 'rgba(255, 200, 100, 0.5)');
    } else {
      outerGlow.setAttribute('fill', 'rgba(200, 150, 255, 0.4)');
    }
  }

  // Spawn glitter trail from burning light
  if (Math.random() < 0.3) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.1 + Math.random() * 0.2;
    particles.push({
      x: pos.x,
      y: pos.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      maxLife: 0.8 + Math.random() * 0.5,
      size: 0.2 + Math.random() * 0.3,
      hue: pos.inKey ? 45 : 280,
    });
  }
}

function animate(time: number) {
  if (lastTime === 0) lastTime = time;
  const deltaTime = (time - lastTime) / 1000;
  lastTime = time;

  decay(state, deltaTime);
  updateParticles(deltaTime);
  updateBurningLight();
  updateVisuals();

  requestAnimationFrame(animate);
}

// Start
init();
