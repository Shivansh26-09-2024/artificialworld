import React, { useRef, useState, useEffect, useCallback } from "react";
import { BALL_MATERIALS, GROUND_MATERIALS } from "./materials";
import { stepBall } from "./physicsSolver";

// ---- World constants (not material-specific) ----
const G = 9.8; // m/s^2
const PIXELS_PER_METER = 100;
const BALL_RADIUS_M = 0.15;
const GROUND_HEIGHT_PX = 60;

export default function GravitySim() {
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, startT } while mouse is down

  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [ballMatKey, setBallMatKey] = useState("rubber");
  const [groundMatKey, setGroundMatKey] = useState("concrete");

  const physicsRef = useRef({ active: false, xM: 0, yM: 0, vxM: 0, vyM: 0 });
  const [render, setRender] = useState({ active: false, xPx: 0, yPx: 0 });
  const [readout, setReadout] = useState({ speed: 0, inContact: false, bounces: 0, status: "Ready" });

  const ballRadiusPx = BALL_RADIUS_M * PIXELS_PER_METER;
  const groundYPx = dims.height - GROUND_HEIGHT_PX;
  const groundYM = groundYPx / PIXELS_PER_METER;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setDims({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTimeRef.current = null;
  }, []);

  const wasInContactRef = useRef(false);
  const bounceCountRef = useRef(0);

  const step = useCallback(
    (timestamp) => {
      const p = physicsRef.current;
      if (!p.active) return;

      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp;
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      let dt = (timestamp - lastTimeRef.current) / 1000;
      dt = Math.min(dt, 1 / 30); // clamp so a backgrounded tab doesn't cause a huge jump
      lastTimeRef.current = timestamp;

      const ballMaterial = BALL_MATERIALS[ballMatKey];
      const groundMaterial = GROUND_MATERIALS[groundMatKey];

      const { state, contact } = stepBall(
        { xM: p.xM, yM: p.yM, vxM: p.vxM, vyM: p.vyM },
        {
          dt,
          gravity: G,
          groundYM,
          ballRadiusM: BALL_RADIUS_M,
          mass: ballMaterial.massKg,
          ballMaterial,
          groundMaterial,
        }
      );

      p.xM = state.xM;
      p.yM = state.yM;
      p.vxM = state.vxM;
      p.vyM = state.vyM;

      // count a "bounce" each time the ball transitions into contact
      if (contact.inContact && !wasInContactRef.current) {
        bounceCountRef.current += 1;
      }
      wasInContactRef.current = contact.inContact;

      const xPx = state.xM * PIXELS_PER_METER;
      const yPx = state.yM * PIXELS_PER_METER;
      const speed = Math.hypot(state.vxM, state.vyM);

      setRender({ active: true, xPx, yPx });
      setReadout({
        speed,
        inContact: contact.inContact,
        bounces: bounceCountRef.current,
        status: contact.inContact ? "In contact" : "Falling / airborne",
      });

      // stop condition: ball has settled (low speed) while resting on the ground
      const settled = contact.inContact && speed < 0.03;
      const offscreen = xPx < -ballRadiusPx * 2 || xPx > dims.width + ballRadiusPx * 2;

      if (settled || offscreen) {
        p.active = false;
        setReadout((r) => ({ ...r, status: settled ? "Settled" : "Left the stage" }));
        stopLoop();
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    },
    [ballMatKey, groundMatKey, groundYM, dims.width, ballRadiusPx, stopLoop]
  );

  const launchBall = useCallback(
    (startXPx, startYPx, vxMps, vyMps) => {
      stopLoop();
      bounceCountRef.current = 0;
      wasInContactRef.current = false;
      physicsRef.current = {
        active: true,
        xM: startXPx / PIXELS_PER_METER,
        yM: startYPx / PIXELS_PER_METER,
        vxM: vxMps,
        vyM: vyMps,
      };
      setRender({ active: true, xPx: startXPx, yPx: startYPx });
      setReadout({ speed: Math.hypot(vxMps, vyMps), inContact: false, bounces: 0, status: "Falling / airborne" });
      rafRef.current = requestAnimationFrame(step);
    },
    [step, stopLoop]
  );

  const getLocalPos = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseDown = (e) => {
    const { x, y } = getLocalPos(e);
    dragRef.current = { startX: x, startY: y, startT: performance.now() };
  };

  const handleMouseUp = (e) => {
    if (!dragRef.current) return;
    const { x, y } = getLocalPos(e);
    const { startX, startY, startT } = dragRef.current;
    dragRef.current = null;

    const dtDrag = Math.max((performance.now() - startT) / 1000, 1 / 60);
    const dragXPx = x - startX;
    const dragYPx = y - startY;

    // A quick click (near-zero drag) behaves like the original sim: a plain drop.
    // A drag imparts velocity opposite the drag direction (pull back, release
    // forward — slingshot-style), capped so throws stay readable on screen.
    const dragDistPx = Math.hypot(dragXPx, dragYPx);
    let vx = 0;
    let vy = 0;
    if (dragDistPx > 8) {
      const rawVx = (-dragXPx / dtDrag) / PIXELS_PER_METER;
      const rawVy = (-dragYPx / dtDrag) / PIXELS_PER_METER;
      const maxSpeed = 8; // m/s, keeps throws from launching off-scale
      const rawSpeed = Math.hypot(rawVx, rawVy);
      const scale = rawSpeed > maxSpeed ? maxSpeed / rawSpeed : 1;
      vx = rawVx * scale;
      vy = rawVy * scale;
    }

    launchBall(startX, startY, vx, vy);
  };

  useEffect(() => stopLoop, [stopLoop]);

  const ballTopPx = render.yPx - ballRadiusPx;
  const ballLeftPx = render.xPx - ballRadiusPx;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Gravity + Contact Sim</h1>
        <p style={styles.subtitle}>
          click to drop &nbsp;•&nbsp; click-drag to throw &nbsp;•&nbsp; g = {G} m/s²
        </p>
      </div>

      <div style={styles.controls}>
        <label style={styles.controlLabel}>
          Ball
          <select
            style={styles.select}
            value={ballMatKey}
            onChange={(e) => setBallMatKey(e.target.value)}
          >
            {Object.entries(BALL_MATERIALS).map(([key, m]) => (
              <option key={key} value={key}>{m.name}</option>
            ))}
          </select>
        </label>
        <label style={styles.controlLabel}>
          Ground
          <select
            style={styles.select}
            value={groundMatKey}
            onChange={(e) => setGroundMatKey(e.target.value)}
          >
            {Object.entries(GROUND_MATERIALS).map(([key, m]) => (
              <option key={key} value={key}>{m.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        style={styles.stage}
      >
        {render.active || readout.status !== "Ready" ? (
          <div
            style={{
              ...styles.ball,
              width: ballRadiusPx * 2,
              height: ballRadiusPx * 2,
              left: ballLeftPx,
              top: ballTopPx,
              boxShadow: readout.inContact
                ? "0 0 18px rgba(56,189,248,0.9)"
                : "0 0 12px rgba(56,189,248,0.5)",
            }}
          />
        ) : null}

        <div style={{ ...styles.ground, height: GROUND_HEIGHT_PX }} />

        {readout.status === "Ready" && (
          <div style={styles.hint}>Click to drop • click and drag to throw</div>
        )}
      </div>

      <div style={styles.readoutRow}>
        <span>{readout.status}</span>
        <span>speed: {readout.speed.toFixed(2)} m/s</span>
        <span>bounces: {readout.bounces}</span>
      </div>
    </div>
  );
}

const styles = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    width: "100%",
    background: "#0f1115",
    color: "#e8e8e8",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    boxSizing: "border-box",
    padding: 16,
    gap: 10,
  },
  header: { textAlign: "center" },
  title: { margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: 0.2 },
  subtitle: { margin: "4px 0 0", fontSize: 13, color: "#8a8f98" },
  controls: {
    display: "flex",
    gap: 16,
    justifyContent: "center",
    fontSize: 13,
    color: "#c7ccd6",
  },
  controlLabel: { display: "flex", alignItems: "center", gap: 6 },
  select: {
    background: "#1a1d24",
    color: "#e8e8e8",
    border: "1px solid #3a3f4b",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 13,
  },
  stage: {
    position: "relative",
    flex: 1,
    background: "linear-gradient(to bottom, #1a1d24 0%, #12141a 100%)",
    borderRadius: 12,
    overflow: "hidden",
    cursor: "crosshair",
    border: "1px solid #262a33",
    userSelect: "none",
  },
  ball: {
    position: "absolute",
    borderRadius: "50%",
    background: "radial-gradient(circle at 35% 30%, #7dd3fc, #0284c7 70%)",
  },
  ground: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    background: "linear-gradient(to bottom, #3f3226, #2a2119)",
    borderTop: "2px solid #55432f",
  },
  hint: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    color: "#5a5f6a",
    fontSize: 14,
  },
  readoutRow: {
    display: "flex",
    justifyContent: "center",
    gap: 24,
    fontSize: 13,
    color: "#8a8f98",
    fontVariantNumeric: "tabular-nums",
  },
};
