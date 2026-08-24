// physicsSolver.js
//
// The "numerical solver" layer. This is the only file that knows
// how to advance time. It pulls effective parameters from
// materials.js, pulls forces from contactModel.js, sums them with
// gravity, and integrates F=ma forward with semi-implicit
// (symplectic) Euler — same scheme the original drop-only sim used.
//
// All quantities in/out of stepBall are SI: meters, m/s, seconds,
// downward = positive y. Pixel conversion belongs in the component,
// not here.
//
// Why substeps: a stiff contact spring (large k) has a short natural
// oscillation period. If the simulation timestep is larger than
// that period, explicit Euler-family integrators blow up — this is
// exactly the "your timestep might be too large" failure mode the
// doc calls out. Rather than picking a fixed substep count and
// hoping, this solver estimates the spring's natural frequency each
// call and picks enough substeps to stay safely inside the stable
// range.

import { effectiveContactStiffness, effectiveContactDamping, effectiveFriction } from "./materials";
import { normalContactForce, frictionForce } from "./contactModel";

const STABILITY_SAFETY_FACTOR = 6; // higher = more conservative (more substeps)

function stableSubstepCount(dt, stiffness, mass, minSubsteps) {
  if (stiffness <= 0 || mass <= 0) return minSubsteps;
  const naturalFreq = Math.sqrt(stiffness / mass); // rad/s
  const maxStableH = 2 / (naturalFreq * STABILITY_SAFETY_FACTOR);
  const needed = Math.ceil(dt / maxStableH);
  return Math.max(minSubsteps, needed, 1);
}

// state: { xM, yM, vxM, vyM }  — yM is the ball CENTER height (down positive)
// params: { dt, gravity, groundYM, ballRadiusM, mass, ballMaterial, groundMaterial, minSubsteps? }
export function stepBall(state, params) {
  const { dt, gravity, groundYM, ballRadiusM, mass, ballMaterial, groundMaterial, minSubsteps = 2 } = params;

  const k = effectiveContactStiffness(ballMaterial, groundMaterial, ballRadiusM);
  const c = effectiveContactDamping(ballMaterial, groundMaterial, ballRadiusM);
  const mu = effectiveFriction(ballMaterial, groundMaterial);

  const substeps = stableSubstepCount(dt, k, mass, minSubsteps);
  const h = dt / substeps;

  let x = state.xM;
  let y = state.yM;
  let vx = state.vxM;
  let vy = state.vyM;

  let lastContact = { inContact: false, penetrationM: 0, normalForceN: 0, frictionForceN: 0 };

  for (let i = 0; i < substeps; i++) {
    const penetration = y + ballRadiusM - groundYM; // > 0 means overlapping the ground
    const inContact = penetration > 0;

    let normalF = 0;
    let frictionF = 0;
    let fy = mass * gravity; // gravity, downward positive
    let fx = 0;

    if (inContact) {
      normalF = normalContactForce({
        penetration,
        penetrationRate: vy, // rate the overlap is changing, while in contact
        stiffness: k,
        damping: c,
      });
      fy -= normalF; // contact pushes back up, against gravity/downward motion

      frictionF = frictionForce({
        normalForce: normalF,
        tangentialVelocity: vx,
        frictionCoeff: mu,
        mass,
        dt: h,
      });
      fx += frictionF;
    }

    vy += (fy / mass) * h;
    vx += (fx / mass) * h;
    y += vy * h;
    x += vx * h;

    lastContact = {
      inContact,
      penetrationM: Math.max(penetration, 0),
      normalForceN: normalF,
      frictionForceN: frictionF,
    };
  }

  return {
    state: { xM: x, yM: y, vxM: vx, vyM: vy },
    contact: lastContact,
    substepsUsed: substeps,
  };
}
