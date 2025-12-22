Harmonic Playground

Technical Product Specification (v1)

Document type: Musical Experience Design & Engineering Spec
Audience: Frontend engineer, creative technologist, audio engineer
Goal: Build a fully interactive harmonic tension sandbox
Non-goal: Song playback, rhythm, guitar mapping (explicitly out of scope)

⸻

1. Product Definition

What this is

A real-time, interactive harmonic visualization system where users click musical degrees (1–7) and observe how harmonic tension and resolution propagate visually and sonically.

What this is not
	•	Not a sequencer
	•	Not a rhythm game
	•	Not a teaching app with lessons
	•	Not tied to any physical instrument

⸻

2. Core User Flow (MVP)
	1.	User selects:
	•	Key (abstract root reference only)
	•	Scale / mode (e.g. Major)
	2.	System displays a network of harmonic nodes
	3.	User clicks a node
	4.	System:
	•	plays the sound
	•	updates harmonic state
	•	animates tension / resolution visually
	5.	User continues interacting freely

There is no win state, no scoring, no instructions required.

⸻

3. System Architecture Overview

UI Layer
 ├─ Node Rendering
 ├─ Animation Engine
 ├─ Input Handling
 └─ Visual Feedback

Harmonic Engine
 ├─ Scale Definition
 ├─ Degree State Graph
 ├─ Resolution Relationship Logic
 └─ Tension Decay Logic

Audio Engine
 ├─ Oscillator / Sampler
 ├─ Envelope Control
 └─ Optional Expressive Modulation

All layers are state-driven.

⸻

4. Musical Data Model

4.1 Degree Definition

type Degree = {
  id: number;  // 1–7
};

4.2 Scale Definition

type Scale = {
  name: string;
  enabledDegrees: number[]; // e.g. Major = [1,2,3,4,5,6,7]
};

4.3 Harmonic Node State

type HarmonicNode = {
  degree: number;

  // visual state
  position: { x: number; y: number };
  baseSize: number;
  currentSize: number;
  glowIntensity: number;
  motionAmplitude: number;

  // harmonic state
  tension: number;       // 0.0 – 1.0, current unresolved tension
  stability: number;     // inherentStability * (1 - tension)
};


⸻

5. Harmonic Engine (Core Logic)

5.1 Degree Stability (Music Theory Foundation)

Each scale degree has inherent stability based on its relationship to the tonic triad:

type DegreeProfile = {
  degree: number;
  inherentStability: number;  // 0.0 (unstable) – 1.0 (stable)
};

const degreeProfiles: DegreeProfile[] = [
  { degree: 1, inherentStability: 1.0 },  // Tonic - home base
  { degree: 2, inherentStability: 0.3 },  // Supertonic - unstable
  { degree: 3, inherentStability: 0.8 },  // Mediant - stable (tonic triad)
  { degree: 4, inherentStability: 0.2 },  // Subdominant - unstable, pulls down
  { degree: 5, inherentStability: 0.7 },  // Dominant - stable (tonic triad)
  { degree: 6, inherentStability: 0.4 },  // Submediant - moderate
  { degree: 7, inherentStability: 0.1 },  // Leading tone - most unstable
];

⸻

5.2 Resolution Relationships (Major Scale v1)

Define where unstable degrees "want" to resolve:

type ResolutionRule = {
  from: number;        // Unstable degree
  to: number;          // Resolution target
  pullStrength: number; // How strongly it pulls (0.0 – 1.0)
};

const resolutionRules: ResolutionRule[] = [
  { from: 7, to: 1, pullStrength: 1.0 },  // Leading tone → Tonic (half-step)
  { from: 4, to: 3, pullStrength: 0.8 },  // Fa → Mi (half-step in major)
  { from: 2, to: 1, pullStrength: 0.5 },  // Re → Do
  { from: 2, to: 3, pullStrength: 0.4 },  // Re → Mi (alternate resolution)
  { from: 6, to: 5, pullStrength: 0.5 },  // La → Sol
  { from: 6, to: 1, pullStrength: 0.3 },  // La → Do (deceptive motion)
];

This defines the harmonic "gravity" of the system. Scale-specific and swappable.

⸻

5.3 System State

Track both per-node and global tension:

type SystemState = {
  globalTension: number;           // 0.0 – 1.0, overall system unrest
  unresolvedTensions: Map<number, number>; // degree → tension amount
};

Unresolved tensions accumulate when unstable degrees are played and
release when their resolution targets are played.

⸻

5.4 On Note Activation

When user clicks degree D:

function activateDegree(D: number) {
  // 1. Play the sound
  playSound(D);

  // 2. Check if this resolves any existing tension
  for (rule in resolutionRules where rule.to === D) {
    const unresolvedAmount = state.unresolvedTensions.get(rule.from) ?? 0;
    if (unresolvedAmount > 0) {
      // Resolution! Release tension proportional to pull strength
      const released = unresolvedAmount * rule.pullStrength;
      state.unresolvedTensions.set(rule.from, unresolvedAmount - released);
      state.globalTension -= released;

      // Visual/audio feedback: satisfaction, calm
      triggerResolutionFeedback(rule.from, D, released);
    }
  }

  // 3. Add new tension based on degree's instability
  const profile = degreeProfiles.find(p => p.degree === D);
  const instability = 1 - profile.inherentStability;

  if (instability > 0) {
    state.unresolvedTensions.set(D,
      (state.unresolvedTensions.get(D) ?? 0) + instability
    );
    state.globalTension += instability;
  }

  // 4. Normalize
  normalizeState();
}

⸻

5.5 State Normalization

function normalizeState() {
  state.globalTension = clamp(state.globalTension, 0, 1);

  for each [degree, tension] in state.unresolvedTensions:
    state.unresolvedTensions.set(degree, clamp(tension, 0, 1));
}

⸻

5.6 Passive Decay (Executed Every Frame)

Unresolved tension fades naturally over time (harmonic memory decay):

function decayTension(deltaTime: number) {
  const decayAmount = config.decayRate * deltaTime; // 0.15 per second default

  for each [degree, tension] in state.unresolvedTensions:
    const newTension = max(0, tension - decayAmount);
    state.unresolvedTensions.set(degree, newTension);

  // Recalculate global tension from remaining unresolved
  state.globalTension = sum(state.unresolvedTensions.values()) / 7;
}

⸻

5.7 Visual State Derivation

Map system state to node visuals:

function updateNodeVisuals() {
  for each node:
    const profile = degreeProfiles.find(p => p.degree === node.degree);
    const unresolved = state.unresolvedTensions.get(node.degree) ?? 0;

    // Tension = how much this node "wants to move"
    node.tension = unresolved;

    // Stability = inherent stability minus current unresolved tension
    node.stability = profile.inherentStability * (1 - unresolved);
}


⸻

6. Visual Mapping Rules

6.1 Initial State (At Rest)

Before any interaction, nodes reflect their inherent stability:

function initializeNodeVisuals() {
  for each node:
    const profile = degreeProfiles.find(p => p.degree === node.degree);
    const stability = profile.inherentStability;

    // Stable nodes are larger and brighter at rest
    node.baseSize = config.minSize + (config.maxSize - config.minSize) * stability;
    node.glowIntensity = config.baseGlow * stability;
    node.motionAmplitude = 0;  // All nodes start calm
}

Result: Tonic (1) appears largest and brightest. Leading tone (7) is smallest and dimmest. The visual hierarchy communicates "home" without any labels.

6.2 Size Mapping (During Interaction)

node.currentSize =
  node.baseSize + (config.sizeGain * node.tension);

Tension makes nodes swell beyond their resting size.

6.3 Glow Mapping

node.glowIntensity =
  (config.baseGlow * node.stability) + (config.tensionGlow * node.tension);

Two glow sources: stable warmth + tense energy. Different colors optional (warm vs cool).

6.4 Motion Mapping

node.motionAmplitude =
  config.maxMotion * node.tension;

Only tense nodes move. Stable nodes sit still.
Motion style: gentle drift or wobble, not jitter.

6.5 Resolution Feedback

When tension resolves (e.g., 7 → 1):

function triggerResolutionFeedback(from: number, to: number, amount: number) {
  // 1. The resolved node (from) quickly settles back to rest size
  animate(nodes[from].currentSize, nodes[from].baseSize, {
    duration: config.resolveDuration,
    easing: config.easing
  });

  // 2. The resolution target (to) pulses briefly — a soft "landing" glow
  animate(nodes[to].glowIntensity, nodes[to].glowIntensity + config.resolvePulse, {
    duration: config.growDuration,
    easing: config.easing,
    then: fadeBack
  });

  // 3. Optional: subtle connecting flash between the two nodes
  //    (a brief line or particle that appears and fades)
}

The feeling: tension melts, home base briefly welcomes.

6.6 Visual Summary

| State          | Size     | Glow       | Motion   |
|----------------|----------|------------|----------|
| Stable at rest | Large    | Warm       | None     |
| Unstable at rest| Small   | Dim        | None     |
| Tense (active) | Swelling | Bright     | Drifting |
| Resolving      | Shrinking| Pulse down | Settling |

⸻

7. Node Layout Geometry

Requirements
	•	Layout must be static per scale
	•	No circular pitch ladder
	•	No keyboard / staff metaphors
	•	Spatial position reinforces harmonic relationships

Layout Strategy (v1)

Tonic (1) sits at the center — the visual "home."
Stable degrees (3, 5) orbit close to center.
Unstable degrees (2, 4, 6, 7) sit at the periphery.
Resolution targets are spatially adjacent to their sources.

Concrete positions (normalized 0–1 coordinate space):

const nodePositions: Record<number, { x: number; y: number }> = {
  1: { x: 0.50, y: 0.50 },  // Center - home
  3: { x: 0.35, y: 0.45 },  // Close to tonic
  5: { x: 0.65, y: 0.45 },  // Close to tonic
  2: { x: 0.25, y: 0.30 },  // Between 1 and 3
  4: { x: 0.20, y: 0.60 },  // Near 3 (resolves down)
  6: { x: 0.80, y: 0.60 },  // Near 5 (resolves down)
  7: { x: 0.75, y: 0.25 },  // Near 1 (resolves up) - top right, "leading" toward center
};

No edges or lines between nodes. Spatial proximity implies relationship.

⸻

8. Input Handling

Interaction Rules
	•	Click = immediate sound + state update
	•	Repeated clicks compound tension
	•	No cooldown
	•	No blocking
	•	No input throttling

Rapid Click Behavior

Clicking the same node repeatedly stacks tension, then clamps at 1.0.

Example: Spam-clicking degree 7 (instability 0.9)
  - Click 1: tension = 0.9
  - Click 2: tension = 1.8 → clamps to 1.0
  - Click 3+: stays at 1.0

This feels natural — hammering a note keeps it maximally tense.
Tension only drops via decay or resolution.

Optional (Later)
	•	Click + hold sustains tension
	•	Multi-touch / multi-click chords

⸻

9. Audio Engine (MVP)

Requirements
	•	Clean tone (sine or soft piano)
	•	Fast attack (~10ms)
	•	Medium decay (~500ms)
	•	No reverb initially

Frequency Mapping

Standard 12-TET tuning (A4 = 440Hz).

Major scale intervals from root: [0, 2, 4, 5, 7, 9, 11] semitones

const degreeToSemitone: Record<number, number> = {
  1: 0,   // Root
  2: 2,   // Whole step
  3: 4,   // Major third
  4: 5,   // Perfect fourth
  5: 7,   // Perfect fifth
  6: 9,   // Major sixth
  7: 11,  // Major seventh
};

const rootFrequencies: Record<string, number> = {
  'C': 261.63,
  'D': 293.66,
  'E': 329.63,
  'F': 349.23,
  'G': 392.00,
  'A': 440.00,
  'B': 493.88,
};

function getFrequency(degree: number, key: string): number {
  const rootFreq = rootFrequencies[key];
  const semitones = degreeToSemitone[degree];
  return rootFreq * Math.pow(2, semitones / 12);
}

Pitch identity is internal only — never shown to user.

⸻

10. Rendering Requirements

Performance
	•	60 FPS target
	•	Smooth interpolation (lerp / easing)
	•	No particle effects

Visual Tone
	•	Dark neutral background
	•	High contrast glow
	•	Calm animation curves (no sharp snapping)

⸻

11. Configuration Surface

type AppConfig = {
  // Musical (naturals only for MVP; sharps/flats deferred)
  key: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  scale: Scale;  // See Section 4.2

  // Timing
  decayRate: number;        // Tension units per second (default: 0.15)

  // Visual - sizes in pixels
  minSize: number;          // Smallest node at rest (default: 30)
  maxSize: number;          // Largest node at rest (default: 80)
  sizeGain: number;         // Extra size per tension unit (default: 40)

  // Visual - glow
  baseGlow: number;         // Glow multiplier at rest (default: 0.3)
  tensionGlow: number;      // Additional glow per tension (default: 0.7)
  resolvePulse: number;     // Glow boost on resolution (default: 0.5)

  // Visual - motion
  maxMotion: number;        // Max drift amplitude in pixels (default: 8)

  // Animation
  growDuration: number;     // Tension growth animation ms (default: 150)
  resolveDuration: number;  // Resolution animation ms (default: 200)
  easing: string;           // Easing function (default: 'ease-out')
};

const defaultConfig: AppConfig = {
  key: 'C',
  scale: MajorScale,
  decayRate: 0.15,
  minSize: 30,
  maxSize: 80,
  sizeGain: 40,
  baseGlow: 0.3,
  tensionGlow: 0.7,
  resolvePulse: 0.5,
  maxMotion: 8,
  growDuration: 150,
  resolveDuration: 200,
  easing: 'ease-out',
};


⸻

12. MVP Scope (Strict)

Included
	•	Major scale
	•	Degrees 1–7
	•	Mouse/touch input
	•	Visual tension system
	•	Single timbre audio

Excluded
	•	Rhythm / timing
	•	Instruments
	•	Recording
	•	MIDI
	•	Lessons
	•	Chord labels
	•	Note names

⸻

13. Success Criteria (Developer-Testable)
	•	Playing 7 causes node 7 to visibly swell and drift (tension)
	•	Playing 1 after 7 triggers resolution: node 7 settles, node 1 pulses
	•	Stable degrees (1, 3, 5) appear larger at rest than unstable ones (7, 4)
	•	Tension decays visibly over time if unresolved
	•	State is deterministic
	•	No visual clutter
	•	No UI explanation required to explore

⸻

14. Future Extensions (Explicitly Deferred)
	•	Altered degrees (♭3, ♭7, etc.)
	•	Scale switching animation
	•	Guitar / piano mapping
	•	Song-driven harmonic states
	•	Adaptive difficulty / guidance

⸻

15. Final Summary (for dev handoff)

You are building:
	•	a stateful harmonic graph
	•	driven by resolution relationships (unstable → stable)
	•	where tension accumulates on unstable degrees and releases when resolved
	•	rendered as size, glow, and motion
	•	with immediate auditory feedback

If implemented faithfully, users will feel harmony, not learn about it.
