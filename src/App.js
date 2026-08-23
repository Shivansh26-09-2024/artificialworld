import React, { useRef, useState, useEffect, useCallback } from "react";

// ---- Physics constants ----
const G = 9.8; // m/s^2, real gravity
const PIXELS_PER_METER = 100; // world scale
const BALL_RADIUS_M = 0.15; // 15 cm ball
const GROUND_HEIGHT_PX = 60;

export default function GravitySim() {
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);

  const [dims, setDims] = useState({ width: 800, height: 600 });

  // Ball state lives in refs for the physics loop (avoids stale closures / re-render churn),
  // mirrored into React state only for rendering.
  const physicsRef = useRef({
    active: false,
    y: 0, // px, distance fallen from release point (0 = at release station)
    v: 0, // m/s, downward velocity
    releaseY: 0, // px, y-coordinate of release point (top of ball at release)
    x: 0, // px, x-coordinate (fixed once released)
  });

  const [render, setRender] = useState({ active: false, x: 0, y: 0 });
  const [stationX, setStationX] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [impactSpeed, setImpactSpeed] = useState(null);

  const ballRadiusPx = BALL_RADIUS_M * PIXELS_PER_METER;
  const groundY = dims.height - GROUND_HEIGHT_PX;

  // Track container size
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

  const step = useCallback(
    (timestamp) => {
      const p = physicsRef.current;
      if (!p.active) return;

      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp;
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      let dt = (timestamp - lastTimeRef.current) / 1000; // seconds
      // clamp dt to avoid huge jumps if tab was backgrounded
      dt = Math.min(dt, 1 / 30);
      lastTimeRef.current = timestamp;

      // v = v0 + g*dt ; y = y0 + v*dt  (semi-implicit Euler — stable for this)
      p.v = p.v + G * dt;
      p.y = p.y + p.v * dt * PIXELS_PER_METER;

      const ballCenterY = p.releaseY + p.y + ballRadiusPx;
      const maxCenterY = groundY - ballRadiusPx;

      if (ballCenterY >= maxCenterY) {
        // Landed: clamp to ground, stop dead (no bounce)
        p.y = maxCenterY - p.releaseY - ballRadiusPx;
        setImpactSpeed(p.v);
        p.active = false;
        setRender({ active: false, x: p.x, y: maxCenterY - ballRadiusPx });
        setElapsed((t) => t); // freeze
        stopLoop();
        return;
      }

      setRender({ active: true, x: p.x, y: ballCenterY - ballRadiusPx });
      rafRef.current = requestAnimationFrame(step);
    },
    [ballRadiusPx, groundY, stopLoop]
  );

  const releaseBall = useCallback(
    (clickX) => {
      stopLoop();
      const releaseTopY = 40; // px from top, just below the release station bar
      physicsRef.current = {
        active: true,
        y: 0,
        v: 0,
        releaseY: releaseTopY,
        x: clickX,
      };
      setStationX(clickX);
      setImpactSpeed(null);
      setElapsed(0);
      setRender({ active: true, x: clickX, y: releaseTopY });
      rafRef.current = requestAnimationFrame(step);
    },
    [step, stopLoop]
  );

  const handleClick = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    releaseBall(x);
  };

  useEffect(() => stopLoop, [stopLoop]);

  const ballTop = render.y;
  const ballLeft = render.x - ballRadiusPx;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Gravity Simulation</h1>
        <p style={styles.subtitle}>
          g = {G} m/s² &nbsp;•&nbsp; click anywhere to release the ball
        </p>
      </div>

      <div
        ref={containerRef}
        onClick={handleClick}
        style={styles.stage}
      >
        {/* Release station rail */}
        <div style={styles.rail} />

        {/* Release marker at chosen x */}
        {stationX !== null && (
          <div
            style={{
              ...styles.releaseMarker,
              left: stationX - 10,
            }}
          />
        )}

        {/* Ball */}
        {stationX !== null && (
          <div
            style={{
              ...styles.ball,
              width: ballRadiusPx * 2,
              height: ballRadiusPx * 2,
              left: ballLeft,
              top: ballTop,
            }}
          />
        )}

        {/* Ground */}
        <div style={{ ...styles.ground, height: GROUND_HEIGHT_PX }} />

        {!stationX && (
          <div style={styles.hint}>Click anywhere to drop the ball</div>
        )}
      </div>

      <div style={styles.readout}>
        {impactSpeed !== null
          ? `Impact speed: ${impactSpeed.toFixed(2)} m/s`
          : render.active
          ? "Falling…"
          : "Ready"}
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
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    boxSizing: "border-box",
    padding: 16,
    gap: 12,
  },
  header: {
    textAlign: "center",
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: 0.2,
  },
  subtitle: {
    margin: "4px 0 0",
    fontSize: 13,
    color: "#8a8f98",
  },
  stage: {
    position: "relative",
    flex: 1,
    background: "linear-gradient(to bottom, #1a1d24 0%, #12141a 100%)",
    borderRadius: 12,
    overflow: "hidden",
    cursor: "crosshair",
    border: "1px solid #262a33",
  },
  rail: {
    position: "absolute",
    top: 36,
    left: 0,
    right: 0,
    height: 4,
    background: "#3a3f4b",
  },
  releaseMarker: {
    position: "absolute",
    top: 26,
    width: 20,
    height: 20,
    borderRadius: "50%",
    border: "2px solid #f5a623",
    boxSizing: "border-box",
  },
  ball: {
    position: "absolute",
    borderRadius: "50%",
    background: "radial-gradient(circle at 35% 30%, #7dd3fc, #0284c7 70%)",
    boxShadow: "0 0 12px rgba(56,189,248,0.5)",
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
  readout: {
    textAlign: "center",
    fontSize: 13,
    color: "#8a8f98",
    fontVariantNumeric: "tabular-nums",
  },
};
