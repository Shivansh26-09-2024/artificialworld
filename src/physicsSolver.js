// physicsSolver.js
//
// The "numerical solver" layer. This is the only file that knows
// how to advance time. It pulls effective parameters from
// materials.js, pulls forces from contactModel.js and (for hollow
// balls) gasModel.js, sums them with gravity, and integrates F=ma
// forward with semi-implicit (symplectic) Euler.
//
// All quantities in/out of stepBall are SI: meters, m/s, seconds,
// downward = positive y. Pixel conversion belongs in the component,
// not here.
//
// Why substeps: a stiff contact spring (large k) has a short natural
// oscillation period. If the simulation timestep is larger than
// that period, explicit Euler-family integrators blow up. Rather
// than picking a fixed substep count and hoping, this solver
// estimates the spring's natural frequency each call and picks
// enough substeps to stay safely inside the stable range.

import { effectiveContactStiffness, effectiveContactDamping, effectiveFriction } from "./materials";
import { normalContactForce, frictionForce } from "./contactModel";
import { currentInternalVolume, gasPressure, gasOverpressureForce } from "./gasModel";

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

  // Gas layer setup (section 11-12): only applies to hollow balls.
  // Computed once per step (not per substep) since it only needs the
  // material flag + initial pressure, both constant for this call.
  const isHollow = !!ballMaterial.hollow;
  const initialVolumeM3 = isHollow ? currentInternalVolume({ ballRadiusM, penetrationM: 0 }) : 0;
  const initialPressurePa = isHollow ? ballMaterial.gasInitialPressurePa : 0;

  const substeps = stableSubstepCount(dt, k, mass, minSubsteps);
  const h = dt / substeps;

  let x = state.xM;
  let y = state.yM;
  let vx = state.vxM;
  let vy = state.vyM;

  let lastContact = {
    inContact: false,
    penetrationM: 0,
    normalForceN: 0,
    frictionForceN: 0,
    gasPressurePa: isHollow ? initialPressurePa : null,
    gasForceN: 0,
  };

  for (let i = 0; i < substeps; i++) {
    const penetration = y + ballRadiusM - groundYM; // > 0 means overlapping the ground
    const inContact = penetration > 0;

    let normalF = 0;
    let frictionF = 0;
    let gasP = isHollow ? initialPressurePa : null;
    let gasF = 0;
    let fy = mass * gravity; // gravity, downward positive
    let fx = 0;

    if (inContact) {
      normalF = normalContactForce({
        penetration,
        penetrationRate: vy, // rate the overlap is changing, while in contact
        stiffness: k,
        damping: c,
      });

      if (isHollow) {
        const currentVolumeM3 = currentInternalVolume({ ballRadiusM, penetrationM: penetration });
        gasP = gasPressure({
          initialPressurePa,
          initialVolumeM3,
          currentVolumeM3,
        });
        const contactAreaM2 = Math.PI * ballRadiusM * ballRadiusM; // same area convention as materials.js stiffness calc
        gasF = gasOverpressureForce({ internalPressurePa: gasP, contactAreaM2 });
      }

      fy -= normalF + gasF; // contact spring AND gas overpressure both push back up

      frictionF = frictionForce({
        normalForce: normalF + gasF, // gas overpressure increases the normal load, so it increases available friction too
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
      gasPressurePa: gasP,
      gasForceN: gasF,
    };
  }

  return {
    state: { xM: x, yM: y, vxM: vx, vyM: vy },
    contact: lastContact,
    substepsUsed: substeps,
  };
}
