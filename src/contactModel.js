// contactModel.js
//
// The "constitutive equations" layer. Pure functions: given a
// physical situation (penetration, velocities, effective material
// parameters), return a force. No integration, no state, no
// knowledge of pixels or React — that separation is the point.
//
// Two models live here:
//
// 1) Normal contact force — a Kelvin-Voigt (spring + damper) model:
//       F = k * x + c * dx/dt
//    where x is penetration depth. This is the doc's
//    sigma = E*epsilon + eta*epsilon_dot, converted from
//    stress/strain into force/penetration via k = E*A/L (done in
//    materials.js). It's a standard "penalty method" for contact:
//    the ball is allowed a tiny bit of overlap with the ground, and
//    that overlap is what generates the elastic push-back.
//
// 2) Tangential friction force — Coulomb's model:
//       |F_friction| <= mu * N
//    applied opposite the sliding direction, capped so it can't
//    reverse the motion it's supposed to be slowing down.

export function normalContactForce({ penetration, penetrationRate, stiffness, damping }) {
  if (penetration <= 0) return 0; // no contact, no force
  const elastic = stiffness * penetration; // sigma = E*epsilon term
  const viscous = damping * penetrationRate; // eta*epsilon_dot term
  const force = elastic + viscous;
  // A contact can only push (normal force >= 0). Without this clamp,
  // a fast-separating, heavily-damped contact could compute a
  // negative "sticky" force, which isn't physical for simple contact
  // (no adhesion modeled here).
  return Math.max(force, 0);
}

export function frictionForce({ normalForce, tangentialVelocity, frictionCoeff, mass, dt }) {
  if (normalForce <= 0 || tangentialVelocity === 0 || dt <= 0) return 0;
  const maxFriction = frictionCoeff * normalForce;
  // Force that would exactly cancel the remaining tangential motion
  // this substep. Capping at this prevents kinetic friction from
  // overshooting and reversing the ball's direction, which a naive
  // "always apply mu*N" implementation can do at low sliding speed.
  const stoppingForce = Math.abs((mass * tangentialVelocity) / dt);
  const magnitude = Math.min(maxFriction, stoppingForce);
  return -Math.sign(tangentialVelocity) * magnitude;
}
