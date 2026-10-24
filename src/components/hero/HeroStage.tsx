"use client";
// The home-page hero (T-126). The drawn pot (HeroArt, an SVG) is the first paint and the fallback.
// After the page has loaded, and only when WebGL works, the 3D pot (PotScene) is loaded lazily
// and fades in over it. The SVG keeps its place in the layout, so nothing moves when the canvas
// arrives. If WebGL is missing, the script fails to load, or the GPU context is lost, the SVG stays.
// This file also owns the Pause/Play button (WCAG 2.2.2: the animation runs longer than 5 seconds).
import dynamic from "next/dynamic";
import {
  Component,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { HeroArt } from "@/components/Ornaments";

const PotScene = dynamic(() => import("./PotScene"), { ssr: false });

type Status = "svg" | "loading" | "ready" | "fallback";

/** True when this browser can make a WebGL context. Releases the test context straight away. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ||
      c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const subscribeNone = () => () => {};
function readFixedT(): number | null {
  if (process.env.NODE_ENV === "production") return null;
  const t = new URLSearchParams(window.location.search).get("t");
  const n = t === null ? NaN : parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** Catches a failed chunk load or a render error inside the 3D scene, so the page keeps the SVG. */
class SceneBoundary extends Component<
  { onFail: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PauseIcon({ playing }: { playing: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="size-4"
      fill="currentColor"
    >
      {playing ? (
        <>
          <rect x="3" y="2" width="3.5" height="12" rx="1" />
          <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
        </>
      ) : (
        <path d="M4 2.2v11.6a.8.8 0 0 0 1.2.7l9-5.8a.8.8 0 0 0 0-1.4l-9-5.8A.8.8 0 0 0 4 2.2z" />
      )}
    </svg>
  );
}

export function HeroStage({ children }: { children: ReactNode }) {
  const [heroEl, setHeroEl] = useState<HTMLDivElement | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("svg");
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
  const [paused, setPaused] = useState(false);
  const [resting, setResting] = useState(false);
  const [replay, setReplay] = useState(0);
  // Test mode only (never in a production build): ?t=<seconds> freezes the scene for screenshots.
  const fixedT = useSyncExternalStore(subscribeNone, readFixedT, () => null);

  useEffect(() => {
    // After the first paint and the page load, so the headline never waits for three.js.
    let cancelled = false;
    let idle = 0;
    let cancelIdle = () => {};
    const go = () => {
      if (cancelled) return;
      setStatus((s) =>
        s !== "svg" ? s : webglAvailable() ? "loading" : "fallback",
      );
    };
    const start = () => {
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(go, { timeout: 1500 });
        cancelIdle = () => window.cancelIdleCallback(idle);
      } else {
        idle = window.setTimeout(go, 300);
        cancelIdle = () => window.clearTimeout(idle);
      }
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
      cancelIdle();
    };
  }, []);

  const wantScene = status === "loading" || status === "ready";
  const frozen = fixedT !== null;
  const showButton = status === "ready" && !reduced && !frozen;
  const state =
    status === "fallback"
      ? "fallback"
      : status !== "ready"
        ? status
        : reduced
          ? "still"
          : frozen
            ? "frozen"
            : resting
              ? "rest"
              : paused
                ? "paused"
                : "playing";

  const onButton = () => {
    if (resting) {
      setPaused(false);
      setReplay((n) => n + 1);
    } else setPaused((p) => !p);
  };
  // After the animation has rested, the button offers to run it again; while paused it plays.
  const playing = !paused && !resting;

  return (
    <div
      ref={setHeroEl}
      className="hero hero-stage flex flex-1 items-center"
      data-pot-state={state}
    >
      {wantScene && (
        <div className="pot-layer" aria-hidden="true">
          <SceneBoundary onFail={() => setStatus("fallback")}>
            {heroEl && anchorEl && (
              <PotScene
                key={String(reduced)}
                hero={heroEl}
                anchor={anchorEl}
                paused={paused}
                reduced={reduced}
                fixedT={fixedT}
                replayToken={replay}
                onReady={() => setStatus("ready")}
                onFail={() => setStatus("fallback")}
                onRest={setResting}
              />
            )}
          </SceneBoundary>
          <div className="pot-shade" />
        </div>
      )}
      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-6 px-4 lg:grid-cols-[1.2fr_0.8fr]">
        {children}
        <div ref={setAnchorEl} className="hero-art-cell">
          <HeroArt className="hero-art mx-auto w-full max-w-xs sm:max-w-md" />
        </div>
      </div>
      {showButton && (
        <button
          type="button"
          className="pot-toggle"
          onClick={onButton}
          data-testid="pot-toggle"
        >
          <PauseIcon playing={playing} />
          {playing ? "Pause animation" : "Play animation"}
        </button>
      )}
    </div>
  );
}
