// Harmonic Engine - Simplified Model
// Two dimensions: WHERE you are (home vs away) + WHICH WAY you're going

// ============================================================================
// CORE THEORY: Home vs Away
// ============================================================================

// How "home" each degree is (1 = home, 0 = far from home)
export const homeness: Record<number, number> = {
  1: 1.0,   // Home - tonic
  3: 0.7,   // Near home - part of tonic triad
  5: 0.7,   // Near home - part of tonic triad
  6: 0.4,   // Away - not tonic, not leading
  2: 0.3,   // Away - wants to resolve
  4: 0.2,   // Far - strong pull to 3
  7: 0.1,   // Far - leading tone, strongest pull to 1
};

// Where each degree can resolve (multiple valid targets for some)
export const resolvesTo: Record<number, number[]> = {
  7: [1],     // Leading tone → tonic (always)
  4: [3],     // Fa → mi (always)
  2: [1, 3],  // Re → do OR mi (either works)
  6: [5, 1],  // La → sol OR do (either works)
  // 1, 3, 5 don't need to resolve - they're home
};

// ============================================================================
// STATE
// ============================================================================

export type State = {
  lastNote: number | null;
  direction: 'toward' | 'away' | 'none';
  tensions: Map<number, number>;  // Unresolved tension per degree
};

export function createInitialState(): State {
  return {
    lastNote: null,
    direction: 'none',
    tensions: new Map(),
  };
}

// ============================================================================
// CORE LOGIC
// ============================================================================

export type Resolution = {
  from: number;
  to: number;
};

export function playNote(state: State, degree: number): Resolution | null {
  let resolution: Resolution | null = null;

  // Check if this resolves existing tension
  for (const [tenseDegree, amount] of state.tensions) {
    const targets = resolvesTo[tenseDegree];
    if (targets && targets.includes(degree) && amount > 0) {
      resolution = { from: tenseDegree, to: degree };
      state.tensions.delete(tenseDegree);
    }
  }

  // Add tension if this is an unstable degree
  const noteHomenesss = homeness[degree];
  if (noteHomenesss < 0.5) {
    const currentTension = state.tensions.get(degree) ?? 0;
    state.tensions.set(degree, Math.min(1, currentTension + (1 - noteHomenesss)));
  }

  // Update direction
  if (state.lastNote !== null) {
    const lastHomenesss = homeness[state.lastNote];
    const thisHomenesss = homeness[degree];

    if (thisHomenesss > lastHomenesss) {
      state.direction = 'toward';
    } else if (thisHomenesss < lastHomenesss) {
      state.direction = 'away';
    } else {
      state.direction = 'none';
    }
  }

  state.lastNote = degree;

  return resolution;
}

export function decay(state: State, deltaTime: number): void {
  const decayRate = 0.15;

  for (const [degree, tension] of state.tensions) {
    const newTension = Math.max(0, tension - decayRate * deltaTime);
    if (newTension < 0.01) {
      state.tensions.delete(degree);
    } else {
      state.tensions.set(degree, newTension);
    }
  }

  // Direction fades to none over time if no new notes
  // (handled implicitly - direction only updates on note play)
}

// ============================================================================
// VISUAL HELPERS
// ============================================================================

// Get total system tension (0-1)
export function getTotalTension(state: State): number {
  let total = 0;
  for (const tension of state.tensions.values()) {
    total += tension;
  }
  return Math.min(1, total / 3);
}

// Is this degree a resolution target right now?
export function isResolutionTarget(state: State, degree: number): boolean {
  for (const [tenseDegree] of state.tensions) {
    const targets = resolvesTo[tenseDegree];
    if (targets && targets.includes(degree)) {
      return true;
    }
  }
  return false;
}

// Get color for a degree based on state
export function getNodeColor(
  degree: number,
  state: State
): { h: number; s: number; l: number } {
  const home = homeness[degree];
  const tension = state.tensions.get(degree) ?? 0;
  const isTarget = isResolutionTarget(state, degree);

  // Base hue: warm (45) for home, cool (220) for away
  let h = 45 + (1 - home) * 175;  // 45 (gold) → 220 (blue)
  let s = 70;  // Higher base saturation
  let l = 50;  // Brighter base

  // If this degree has tension, shift toward magenta/pink
  if (tension > 0.1) {
    h = h * 0.3 + 320 * 0.7;  // Strong shift toward magenta
    s = Math.min(100, s + tension * 30);
    l = Math.min(70, l + tension * 20);
  }

  // If this is a resolution target, bright pulsing gold
  if (isTarget) {
    h = 50;  // Strong gold
    s = 100;
    l = 65;
  }

  // Direction influence - more dramatic
  if (state.direction === 'toward' && home > 0.5) {
    // Moving toward home - home notes glow bright warm
    s = Math.min(100, s + 25);
    l = Math.min(75, l + 15);
  } else if (state.direction === 'away' && home < 0.5) {
    // Moving away - away notes get vivid
    s = Math.min(100, s + 25);
    l = Math.min(70, l + 10);
  }

  return {
    h: Math.round(h) % 360,
    s: Math.min(100, Math.max(50, s)),
    l: Math.min(75, Math.max(40, l)),
  };
}

// ============================================================================
// NODE POSITIONS - Radial layout (distance from center = distance from home)
// ============================================================================

// Angles for each degree (in degrees, 0 = right, 90 = down in SVG)
// Layout designed so resolution direction is visible:
//   - 4 above 3 (falls down to resolve)
//   - 2 above 1 (falls down to resolve)
//   - 7 below/left of 1 (rises up to resolve)
//   - 6 above 5 (falls down to resolve)
//   - Stable notes (3, 5) at bottom (grounded)
const nodeAngles: Record<number, number> = {
  1: 0,      // center (angle doesn't matter)
  3: 120,    // stable, lower-left (grounded)
  5: 60,     // stable, lower-right (grounded)
  4: 210,    // far, upper-left (above 3, falls to it)
  2: 270,    // away, directly above (falls to 1)
  6: 330,    // away, upper-right (above 5, falls to it)
  7: 165,    // far, left & slightly below (rises to 1)
};

function calculateNodePosition(degree: number): { x: number; y: number } {
  const home = homeness[degree];
  const distance = (1 - home) * 30;  // 0 at center, 30 at edge

  const angleDeg = nodeAngles[degree];
  const angleRad = angleDeg * Math.PI / 180;

  return {
    x: 50 + Math.cos(angleRad) * distance,
    y: 50 + Math.sin(angleRad) * distance,
  };
}

// Pre-calculate positions
export const nodePositions: Record<number, { x: number; y: number }> = {
  1: calculateNodePosition(1),
  2: calculateNodePosition(2),
  3: calculateNodePosition(3),
  4: calculateNodePosition(4),
  5: calculateNodePosition(5),
  6: calculateNodePosition(6),
  7: calculateNodePosition(7),
};

// ============================================================================
// AUDIO CONFIG
// ============================================================================

export const config = {
  key: 'C' as string,
  decayRate: 0.15,
  minSize: 3,
  maxSize: 6,
};
