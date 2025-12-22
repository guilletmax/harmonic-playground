// Harmonic Engine - from design spec Section 5

export type DegreeProfile = {
  degree: number;
  inherentStability: number;
};

export const degreeProfiles: DegreeProfile[] = [
  { degree: 1, inherentStability: 1.0 },
  { degree: 2, inherentStability: 0.3 },
  { degree: 3, inherentStability: 0.8 },
  { degree: 4, inherentStability: 0.2 },
  { degree: 5, inherentStability: 0.7 },
  { degree: 6, inherentStability: 0.4 },
  { degree: 7, inherentStability: 0.1 },
];

export type ResolutionRule = {
  from: number;
  to: number;
  pullStrength: number;
};

export const resolutionRules: ResolutionRule[] = [
  { from: 7, to: 1, pullStrength: 1.0 },
  { from: 4, to: 3, pullStrength: 0.8 },
  { from: 2, to: 1, pullStrength: 0.5 },
  { from: 2, to: 3, pullStrength: 0.4 },
  { from: 6, to: 5, pullStrength: 0.5 },
  { from: 6, to: 1, pullStrength: 0.3 },
];

export type Config = {
  key: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  decayRate: number;
  minSize: number;
  maxSize: number;
  sizeGain: number;
  baseGlow: number;
  tensionGlow: number;
  resolvePulse: number;
  maxMotion: number;
  growDuration: number;
  resolveDuration: number;
};

export const config: Config = {
  key: 'C',
  decayRate: 0.15,
  minSize: 3,
  maxSize: 6,
  sizeGain: 3,
  baseGlow: 0.3,
  tensionGlow: 0.7,
  resolvePulse: 0.5,
  maxMotion: 0.8,
  growDuration: 150,
  resolveDuration: 200,
};

export type NodeState = {
  degree: number;
  x: number;
  y: number;
  baseSize: number;
  tension: number;
  stability: number;
};

// Tonic degrees - the "home" zone
export const tonicDegrees = [1, 3, 5];

export const nodePositions: Record<number, { x: number; y: number }> = {
  1: { x: 50, y: 50 },
  3: { x: 35, y: 45 },
  5: { x: 65, y: 45 },
  2: { x: 25, y: 30 },
  4: { x: 20, y: 60 },
  6: { x: 80, y: 60 },
  7: { x: 75, y: 25 },
};

export type SystemState = {
  nodes: Map<number, NodeState>;
  unresolvedTensions: Map<number, number>;
  globalTension: number;
};

export function createInitialState(): SystemState {
  const nodes = new Map<number, NodeState>();

  for (const profile of degreeProfiles) {
    const pos = nodePositions[profile.degree];
    const baseSize = config.minSize + (config.maxSize - config.minSize) * profile.inherentStability;

    nodes.set(profile.degree, {
      degree: profile.degree,
      x: pos.x,
      y: pos.y,
      baseSize,
      tension: 0,
      stability: profile.inherentStability,
    });
  }

  return {
    nodes,
    unresolvedTensions: new Map(),
    globalTension: 0,
  };
}

export type ResolutionEvent = {
  from: number;
  to: number;
  amount: number;
};

export function activateDegree(state: SystemState, degree: number): ResolutionEvent[] {
  const resolutions: ResolutionEvent[] = [];

  // Check if this resolves any existing tension
  for (const rule of resolutionRules) {
    if (rule.to === degree) {
      const unresolvedAmount = state.unresolvedTensions.get(rule.from) ?? 0;
      if (unresolvedAmount > 0) {
        const released = unresolvedAmount * rule.pullStrength;
        state.unresolvedTensions.set(rule.from, unresolvedAmount - released);
        state.globalTension -= released;

        resolutions.push({ from: rule.from, to: degree, amount: released });
      }
    }
  }

  // Add new tension based on degree's instability
  const profile = degreeProfiles.find((p) => p.degree === degree)!;
  const instability = 1 - profile.inherentStability;

  if (instability > 0) {
    const current = state.unresolvedTensions.get(degree) ?? 0;
    state.unresolvedTensions.set(degree, Math.min(1, current + instability));
    state.globalTension = Math.min(1, state.globalTension + instability);
  }

  // Update node states
  updateNodeStates(state);

  return resolutions;
}

export function decayTension(state: SystemState, deltaTime: number): void {
  const decayAmount = config.decayRate * deltaTime;

  for (const [degree, tension] of state.unresolvedTensions) {
    const newTension = Math.max(0, tension - decayAmount);
    if (newTension === 0) {
      state.unresolvedTensions.delete(degree);
    } else {
      state.unresolvedTensions.set(degree, newTension);
    }
  }

  // Recalculate global tension
  let total = 0;
  for (const tension of state.unresolvedTensions.values()) {
    total += tension;
  }
  state.globalTension = Math.min(1, total / 7);

  updateNodeStates(state);
}

function updateNodeStates(state: SystemState): void {
  for (const [degree, node] of state.nodes) {
    const profile = degreeProfiles.find((p) => p.degree === degree)!;
    const unresolved = state.unresolvedTensions.get(degree) ?? 0;

    node.tension = unresolved;
    node.stability = profile.inherentStability * (1 - unresolved);
  }
}

export function getNodeVisuals(node: NodeState) {
  const currentSize = node.baseSize + config.sizeGain * node.tension;
  const glowIntensity = config.baseGlow * node.stability + config.tensionGlow * node.tension;
  const motionAmplitude = config.maxMotion * node.tension;

  return { currentSize, glowIntensity, motionAmplitude };
}

// Returns how much each degree is "wanted" as a resolution target
export function getResolutionHints(state: SystemState): Map<number, number> {
  const hints = new Map<number, number>();

  for (const [degree, tension] of state.unresolvedTensions) {
    if (tension > 0.05) {
      // Find resolution targets for this tense degree
      for (const rule of resolutionRules) {
        if (rule.from === degree) {
          const current = hints.get(rule.to) ?? 0;
          hints.set(rule.to, Math.min(1, current + tension * rule.pullStrength));
        }
      }
    }
  }

  return hints;
}
