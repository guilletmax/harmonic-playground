// Main - SVG rendering and animation loop

import {
  createInitialState,
  activateDegree,
  decayTension,
  getNodeVisuals,
  getResolutionHints,
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

function updateVisuals() {
  const hints = getResolutionHints(state);

  for (const [degree, node] of state.nodes) {
    const element = nodeElements.get(degree);
    if (!element) continue;

    const circle = element.querySelector('circle')!;
    const { currentSize, glowIntensity, motionAmplitude } = getNodeVisuals(node);
    const hintStrength = hints.get(degree) ?? 0;

    circle.setAttribute('r', String(currentSize));
    circle.setAttribute('fill', getNodeColor(node.stability, hintStrength));

    // Apply glow via opacity - boost if this node is a resolution target
    const baseOpacity = 0.3 + glowIntensity * 0.7;
    const hintBoost = hintStrength * 0.3;
    circle.style.opacity = String(Math.min(1, baseOpacity + hintBoost));

    // Subtle pulse effect for hinted nodes
    if (hintStrength > 0.1) {
      const time = performance.now() / 1000;
      const hintPulse = 1 + Math.sin(time * 3) * 0.05 * hintStrength;
      const hintedSize = currentSize * hintPulse;
      circle.setAttribute('r', String(hintedSize));
    }

    // Apply motion by adjusting circle position
    if (motionAmplitude > 0.01) {
      const time = performance.now() / 1000;
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
