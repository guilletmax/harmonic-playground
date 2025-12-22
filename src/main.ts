// Main - SVG rendering and animation loop

import {
  createInitialState,
  activateDegree,
  decayTension,
  getNodeVisuals,
  getResolutionHints,
  tonicDegrees,
  config,
  type SystemState,
  type ResolutionEvent,
} from './engine';
import { playDegree, resumeAudio } from './audio';

const SVG_NS = 'http://www.w3.org/2000/svg';

let state: SystemState;
let lastTime: number = 0;
let nodeElements: Map<number, SVGGElement> = new Map();

function init() {
  state = createInitialState();
  const canvas = document.getElementById('canvas') as unknown as SVGSVGElement;

  // Create node elements
  for (const [degree, node] of state.nodes) {
    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('node');
    group.dataset.degree = String(degree);

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(node.x));
    circle.setAttribute('cy', String(node.y));
    circle.setAttribute('r', String(node.baseSize));
    circle.setAttribute('fill', getNodeColor(node.stability, 0));
    circle.setAttribute('filter', 'url(#glow)');

    group.appendChild(circle);
    canvas.appendChild(group);
    nodeElements.set(degree, group);

    // Click handler
    group.addEventListener('click', () => onNodeClick(degree));
  }

  // Resume audio on first interaction
  document.addEventListener('click', resumeAudio, { once: true });

  // Start animation loop
  requestAnimationFrame(animate);
}

function getNodeColor(stability: number, hintStrength: number = 0): string {
  // Warm color for stable, cool for unstable
  // When hinted, shift toward brighter/warmer to say "come here"
  const hue = 30 + stability * 30 + hintStrength * 10; // shift warmer when hinted
  const saturation = 70 + stability * 20 + hintStrength * 10;
  const lightness = 50 + stability * 15 + hintStrength * 10;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function onNodeClick(degree: number) {
  resumeAudio(); // Ensure audio context is active
  playDegree(degree);
  const resolutions = activateDegree(state, degree);

  // Trigger resolution feedback
  for (const resolution of resolutions) {
    triggerResolutionFeedback(resolution);
  }

  updateVisuals();
}

function triggerResolutionFeedback(event: ResolutionEvent) {
  const fromElement = nodeElements.get(event.from);
  const toElement = nodeElements.get(event.to);

  if (fromElement) {
    fromElement.classList.add('resolving');
    setTimeout(() => fromElement.classList.remove('resolving'), config.resolveDuration);
  }

  if (toElement) {
    toElement.classList.add('resolved-target');
    setTimeout(() => toElement.classList.remove('resolved-target'), config.growDuration);
  }
}

function updateBackground() {
  const tension = state.globalTension;
  // Cool dark blue at rest, warm amber at high tension
  const r = Math.round(10 + tension * 25);
  const g = Math.round(10 + tension * 8);
  const b = Math.round(15 - tension * 10);
  document.body.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
}

function updateVisuals() {
  updateBackground();
  const hints = getResolutionHints(state);
  const time = performance.now() / 1000;

  // Tonic breathing: when tension exists, home "calls"
  const tonicBreathIntensity = state.globalTension > 0.1 ? state.globalTension : 0;
  const tonicBreath = tonicBreathIntensity > 0
    ? Math.sin(time * 1.5) * 0.5 + 0.5  // 0 to 1 oscillation, slow breath
    : 0;

  for (const [degree, node] of state.nodes) {
    const element = nodeElements.get(degree);
    if (!element) continue;

    const circle = element.querySelector('circle')!;
    const { currentSize, glowIntensity, motionAmplitude } = getNodeVisuals(node);
    const hintStrength = hints.get(degree) ?? 0;
    const isTonic = tonicDegrees.includes(degree);

    let finalSize = currentSize;
    let finalOpacity = 0.3 + glowIntensity * 0.7;

    // Resolution hint effect
    if (hintStrength > 0.1) {
      const hintPulse = 1 + Math.sin(time * 3) * 0.05 * hintStrength;
      finalSize *= hintPulse;
      finalOpacity = Math.min(1, finalOpacity + hintStrength * 0.3);
    }

    // Tonic breathing: synchronized gentle pulse when tension exists elsewhere
    if (isTonic && tonicBreathIntensity > 0 && node.tension < 0.1) {
      const breathScale = 1 + tonicBreath * 0.08 * tonicBreathIntensity;
      const breathGlow = tonicBreath * 0.2 * tonicBreathIntensity;
      finalSize *= breathScale;
      finalOpacity = Math.min(1, finalOpacity + breathGlow);
    }

    circle.setAttribute('r', String(finalSize));
    circle.setAttribute('fill', getNodeColor(node.stability, hintStrength));
    circle.style.opacity = String(finalOpacity);

    // Apply motion by adjusting circle position (for tense nodes)
    if (motionAmplitude > 0.01) {
      const offsetX = Math.sin(time * 2 + degree) * motionAmplitude;
      const offsetY = Math.cos(time * 2.5 + degree * 0.7) * motionAmplitude;
      circle.setAttribute('cx', String(node.x + offsetX));
      circle.setAttribute('cy', String(node.y + offsetY));
    } else {
      circle.setAttribute('cx', String(node.x));
      circle.setAttribute('cy', String(node.y));
    }
  }
}

function animate(time: number) {
  if (lastTime === 0) lastTime = time;
  const deltaTime = (time - lastTime) / 1000;
  lastTime = time;

  decayTension(state, deltaTime);
  updateVisuals();

  requestAnimationFrame(animate);
}

// Start
init();
