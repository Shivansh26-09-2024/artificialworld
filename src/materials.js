// materials.js
//
// This file is the "material library" layer described in the doc:
// it holds ONLY properties + parameters (density, stiffness-related
// modulus, damping, friction). It contains NO physics equations —
// those live in contactModel.js. This file just answers
// "what are the numbers for this material", not "what do they do".
//
// Units are SI (meters, kilograms, seconds, Pascals) EXCEPT where
// noted. Real rubber has E on the order of 1e7-1e8 Pa; that value
// makes an explicit real-time integrator extremely stiff (see the
// stability note in physicsSolver.js), so youngsModulus here is
// scaled down for a stable, watchable demo. It's a relative
// stiffness knob, not a literal physical constant — swap in real
// values if you move to an implicit/production solver.

export const BALL_MATERIALS = {
  rubber: {
    name: "Rubber (tennis-ball-like)",
    massKg: 0.058, // real tennis ball mass, set directly (hollow shell, so density*volume would overestimate)
    density: 1100, // kg/m^3 — kept for reference / future use (e.g. a gas layer), not used in the contact force calc below
    youngsModulus: 5e4, // Pa (scaled, see file note)
    dampingCoeff: 400, // Pa*s — Kelvin-Voigt "eta", controls energy loss on impact
    frictionCoeff: 0.8,
  },
  superball: {
    name: "Superball (high-restitution rubber)",
    massKg: 0.03,
    density: 1200,
    youngsModulus: 9e4,
    dampingCoeff: 60, // much lower damping -> bounces back higher, closer to elastic
    frictionCoeff: 0.85,
  },
  steel: {
    name: "Steel ball bearing",
    massKg: 0.5,
    density: 7800,
    youngsModulus: 2.1e6, // much stiffer than rubber -> short, sharp, low bounce
    dampingCoeff: 30,
    frictionCoeff: 0.4,
  },
};

export const GROUND_MATERIALS = {
  concrete: {
    name: "Concrete",
    youngsModulus: 2e5,
    dampingCoeff: 50,
    frictionCoeff: 0.9,
  },
  ice: {
    name: "Ice",
    youngsModulus: 1.5e5,
    dampingCoeff: 40,
    frictionCoeff: 0.05, // same elasticity ballpark as concrete, but friction is the whole story here
  },
};

// --- Combination rules -----------------------------------------
// A contact involves TWO materials (ball + ground). These functions
// turn a pair of material definitions into the single effective
// parameters the contact model needs. This is still "just numbers":
// no force/state calculation happens here.

function seriesCombine(a, b) {
  // Two springs (or dashpots) in series combine like this — it's
  // dominated by whichever side is softer, which matches intuition:
  // a soft ball on a hard floor behaves like the ball's own stiffness.
  return (a * b) / (a + b);
}

// F = k * penetration, with k = E * A / L (from sigma = E * epsilon,
// F/A = E * (deltaL / L)). We use the ball's cross-section for A and
// its radius as the characteristic length L.
export function effectiveContactStiffness(ballMat, groundMat, ballRadiusM) {
  const area = Math.PI * ballRadiusM * ballRadiusM;
  const kBall = (ballMat.youngsModulus * area) / ballRadiusM;
  const kGround = (groundMat.youngsModulus * area) / ballRadiusM;
  return seriesCombine(kBall, kGround);
}

export function effectiveContactDamping(ballMat, groundMat, ballRadiusM) {
  const area = Math.PI * ballRadiusM * ballRadiusM;
  const cBall = (ballMat.dampingCoeff * area) / ballRadiusM;
  const cGround = (groundMat.dampingCoeff * area) / ballRadiusM;
  return seriesCombine(cBall, cGround);
}

// Coulomb friction coefficient for a pair of surfaces. Geometric mean
// is a common, simple convention when you only have per-material mu's.
export function effectiveFriction(ballMat, groundMat) {
  return Math.sqrt(ballMat.frictionCoeff * groundMat.frictionCoeff);
}
