import React from 'react';
import {
  AbsoluteFill,
  Composition,
  Easing,
  Sequence,
  interpolateColors,
  interpolate,
  random,
  registerRoot,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  Html5Audio,
} from 'remotion';
import type { RemotionVideoInput } from '../types.js';

type RemotionVideoProps = Record<string, unknown> & RemotionVideoInput;

const themeMap: Record<NonNullable<RemotionVideoInput['theme']>, { background: string; panel: string; accent: string; text: string; subtext: string }> = {
  sunset: { background: 'linear-gradient(135deg, #2d1b4e 0%, #7a3348 48%, #e88c4d 100%)', panel: 'rgba(13, 11, 24, 0.34)', accent: '#ffd166', text: '#fff8ef', subtext: '#ffe5c2' },
  ocean: { background: 'linear-gradient(135deg, #081f3f 0%, #145da0 45%, #27c2dd 100%)', panel: 'rgba(4, 20, 39, 0.34)', accent: '#92f2ff', text: '#effbff', subtext: '#c8f3ff' },
  forest: { background: 'linear-gradient(135deg, #0d2617 0%, #1d5c35 45%, #8dcf6f 100%)', panel: 'rgba(7, 26, 15, 0.34)', accent: '#f3f7a4', text: '#f6fff2', subtext: '#d7f5ca' },
  slate: { background: 'linear-gradient(135deg, #0f172a 0%, #334155 52%, #94a3b8 100%)', panel: 'rgba(15, 23, 42, 0.35)', accent: '#f59e0b', text: '#f8fafc', subtext: '#dbe4ee' },
};

type ResolvedScene = {
  headline: string;
  body: string;
  accent: string;
  media_data_url?: string;
  duration_seconds?: number;
};

const taskColors = ['#60a5fa', '#fb7185', '#f59e0b', '#4ade80', '#a78bfa', '#22d3ee'];

function normalizeScenes(inputProps: RemotionVideoInput): ResolvedScene[] {
  const sourceScenes = inputProps.scenes?.length ? inputProps.scenes : [
    { headline: inputProps.title, body: inputProps.subtitle ?? 'Code-driven local media generation', accent: 'SVG, React, Remotion' },
    { headline: 'Composable visuals', body: 'Render motion graphics with repeatable props and versioned code.', accent: 'Local-first' },
    { headline: 'Ready to automate', body: 'Use this video path from MCP clients, scripts, and workflow tooling.', accent: 'MP4 output' },
  ];

  return sourceScenes.map((scene, index) => ({
    headline: scene.headline,
    body: scene.body ?? '',
    accent: scene.accent ?? `Scene ${index + 1}`,
    media_data_url: scene.media_data_url,
    duration_seconds: scene.duration_seconds,
  }));
}

type TimedScene = ResolvedScene & {
  fromFrame: number;
  durationFrames: number;
};

function resolveTimedScenes(
  scenes: ResolvedScene[],
  durationInFrames: number,
  fps: number,
): TimedScene[] {
  const explicitDurations = scenes.map((scene) => Math.max(1, Math.round((scene.duration_seconds ?? 0) * fps)));
  const hasExplicit = explicitDurations.some((duration) => duration > 1);
  if (!hasExplicit) {
    const sceneDuration = Math.max(1, Math.floor(durationInFrames / scenes.length));
    return scenes.map((scene, index) => ({
      ...scene,
      fromFrame: index * sceneDuration,
      durationFrames: index === scenes.length - 1 ? durationInFrames - index * sceneDuration : sceneDuration,
    }));
  }

  const totalExplicit = explicitDurations.reduce((sum, duration) => sum + duration, 0);
  const scale = totalExplicit > 0 ? durationInFrames / totalExplicit : 1;
  let cursor = 0;
  return scenes.map((scene, index) => {
    const scaledDuration = index === scenes.length - 1
      ? Math.max(1, durationInFrames - cursor)
      : Math.max(1, Math.round(explicitDurations[index] * scale));
    const timed: TimedScene = {
      ...scene,
      fromFrame: cursor,
      durationFrames: scaledDuration,
    };
    cursor += scaledDuration;
    return timed;
  });
}

function findActiveTimedScene(timedScenes: TimedScene[], frame: number): TimedScene {
  return timedScenes.find((scene) => frame >= scene.fromFrame && frame < scene.fromFrame + scene.durationFrames)
    ?? timedScenes[timedScenes.length - 1];
}

const RobotShell: React.FC<{
  width: number;
  height: number;
  frame: number;
  accent: string;
  sceneIndex: number;
}> = ({ width, height, frame, accent, sceneIndex }) => {
  const drift = Math.sin(frame / 22) * height * 0.008;
  const lean = Math.sin(frame / 46 + sceneIndex) * 5;
  const armLift = Math.sin(frame / 18 + sceneIndex * 0.5) * 12;
  const glow = interpolate(Math.sin(frame / 14), [-1, 1], [0.75, 1]);
  const centerX = width * 0.68;
  const centerY = height * 0.57 + drift;

  return React.createElement('div', {
    style: {
      position: 'absolute',
      left: centerX - width * 0.13,
      top: centerY - height * 0.31,
      width: width * 0.26,
      height: height * 0.62,
      transform: `rotate(${lean}deg)`,
      filter: `drop-shadow(0 35px 55px rgba(0,0,0,0.38)) drop-shadow(0 0 28px ${accent}33)`,
    },
  },
  React.createElement('div', {
    style: {
      position: 'absolute',
      left: '50%',
      top: '6%',
      width: '30%',
      height: '15%',
      transform: 'translateX(-50%)',
      borderRadius: '28px',
      background: 'linear-gradient(180deg, #1f2937 0%, #0f172a 100%)',
      border: '2px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
    },
  },
  React.createElement('div', {
    style: {
      position: 'absolute',
      inset: '18% 12%',
      borderRadius: '18px',
      background: 'linear-gradient(180deg, rgba(125,211,252,0.95) 0%, rgba(59,130,246,0.72) 100%)',
      boxShadow: `0 0 22px ${accent}55 inset`,
    },
  }),
  React.createElement('div', {
    style: {
      position: 'absolute',
      left: '50%',
      top: '46%',
      width: '38%',
      height: '12%',
      transform: 'translateX(-50%)',
      borderRadius: 999,
      background: 'rgba(255,255,255,0.9)',
      opacity: glow,
    },
  })),
  React.createElement('div', {
    style: {
      position: 'absolute',
      left: '50%',
      top: '21%',
      width: '42%',
      height: '37%',
      transform: 'translateX(-50%)',
      borderRadius: '42px',
      background: 'linear-gradient(180deg, #ef4444 0%, #991b1b 100%)',
      clipPath: 'polygon(18% 0%, 82% 0%, 100% 38%, 88% 82%, 66% 100%, 34% 100%, 12% 82%, 0% 38%)',
    },
  }),
  React.createElement('div', {
    style: {
      position: 'absolute',
      left: '50%',
      top: '35%',
      width: '54%',
      height: '24%',
      transform: 'translateX(-50%)',
      borderRadius: '50% 50% 42% 42%',
      background: 'radial-gradient(circle at 50% 40%, #e2e8f0 0%, #94a3b8 58%, #1e293b 100%)',
      border: '1px solid rgba(255,255,255,0.1)',
    },
  }),
  React.createElement('div', {
    style: {
      position: 'absolute',
      left: '50%',
      top: '43%',
      width: '16%',
      height: '10%',
      transform: 'translateX(-50%)',
      borderRadius: '18px',
      background: '#1e293b',
    },
  }),
  React.createElement('div', {
    style: {
      position: 'absolute',
      left: '50%',
      top: '49%',
      width: '28%',
      height: '17%',
      transform: 'translateX(-50%)',
      borderRadius: '50%',
      background: `radial-gradient(circle at 50% 45%, ${accent} 0%, #2563eb 58%, #0f172a 100%)`,
      boxShadow: `0 0 24px ${accent}44`,
    },
  }),
  React.createElement('div', {
    style: {
      position: 'absolute',
      left: '16%',
      top: '37%',
      width: '28%',
      height: '10%',
      transform: `rotate(${-(34 + armLift)}deg)`,
      transformOrigin: '100% 50%',
      borderRadius: 999,
      background: 'linear-gradient(90deg, #0f172a 0%, #334155 22%, #ef4444 64%, #7f1d1d 100%)',
    },
  }),
  React.createElement('div', {
    style: {
      position: 'absolute',
      right: '16%',
      top: '37%',
      width: '28%',
      height: '10%',
      transform: `rotate(${42 + armLift * 0.7}deg)`,
      transformOrigin: '0% 50%',
      borderRadius: 999,
      background: 'linear-gradient(90deg, #7f1d1d 0%, #ef4444 36%, #334155 78%, #0f172a 100%)',
    },
  }),
  React.createElement('div', {
    style: {
      position: 'absolute',
      right: '3%',
      top: '45%',
      width: '18%',
      height: '10%',
      transform: `rotate(${12 + armLift * 0.35}deg)`,
      borderRadius: 16,
      background: 'linear-gradient(180deg, #f8fafc 0%, #cbd5e1 100%)',
      border: `4px solid ${accent}`,
      boxShadow: `0 0 16px ${accent}33`,
    },
  }),
  React.createElement('div', {
    style: {
      position: 'absolute',
      left: '32%',
      bottom: '0%',
      width: '14%',
      height: '30%',
      borderRadius: '26px',
      background: 'linear-gradient(180deg, #7f1d1d 0%, #ef4444 55%, #111827 100%)',
    },
  }),
  React.createElement('div', {
    style: {
      position: 'absolute',
      right: '32%',
      bottom: '0%',
      width: '14%',
      height: '30%',
      borderRadius: '26px',
      background: 'linear-gradient(180deg, #1d4ed8 0%, #60a5fa 55%, #111827 100%)',
    },
  }));
};

const CinematicRobotVideo: React.FC<Record<string, unknown>> = (rawProps) => {
  const inputProps = rawProps as RemotionVideoProps;
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const palette = themeMap[inputProps.theme ?? 'ocean'];
  const scenes = normalizeScenes(inputProps);
  const timedScenes = resolveTimedScenes(scenes, durationInFrames, fps);
  const scene = findActiveTimedScene(timedScenes, frame);
  const activeIndex = timedScenes.findIndex((item) => item.fromFrame === scene.fromFrame);
  const sceneFrame = frame - scene.fromFrame;
  const sceneProgress = interpolate(sceneFrame, [0, scene.durationFrames * 0.22, scene.durationFrames * 0.82, scene.durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const accent = taskColors[activeIndex % taskColors.length];
  const bgShift = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const roomGlow = interpolateColors(bgShift, [0, 0.5, 1], ['#1e293b', '#0f4c81', '#081f3f']);

  return React.createElement(
    AbsoluteFill,
    {
      style: {
        background: `radial-gradient(circle at 20% 18%, rgba(255,255,255,0.08), transparent 20%), linear-gradient(135deg, ${roomGlow} 0%, #0b1220 35%, #162033 68%, #081019 100%)`,
        color: palette.text,
        fontFamily: 'Segoe UI, Arial, sans-serif',
        overflow: 'hidden',
      },
    },
    React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, rgba(120,180,255,0.04) 0%, rgba(255,255,255,0) 38%, rgba(255,165,0,0.05) 100%)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: '-6%',
        top: height * 0.08,
        width: width * 0.56,
        height: height * 0.64,
        borderRadius: '48px',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)',
        border: '1px solid rgba(255,255,255,0.05)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: height * 0.24,
        background: 'linear-gradient(180deg, rgba(35, 42, 56, 0.2) 0%, rgba(155, 126, 88, 0.72) 18%, rgba(119, 85, 58, 0.88) 100%)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: width * 0.08,
        top: height * 0.12,
        width: width * 0.17,
        height: height * 0.23,
        borderRadius: '30px',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: width * 0.135,
        top: height * 0.42,
        width: width * 0.09,
        height: height * 0.19,
        borderRadius: '18px',
        background: 'linear-gradient(180deg, #ece8df 0%, #d6cbb8 100%)',
        boxShadow: '0 12px 28px rgba(0,0,0,0.14)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: width * 0.145,
        top: height * 0.455,
        width: width * 0.025,
        height: width * 0.025,
        borderRadius: '50%',
        background: '#f8fafc',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: width * 0.18,
        top: height * 0.455,
        width: width * 0.025,
        height: width * 0.025,
        borderRadius: '50%',
        background: '#f8fafc',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: width * 0.09,
        top: height * 0.1,
        width: width * 0.36,
        opacity: sceneProgress,
      },
    },
    React.createElement('div', {
      style: {
        fontSize: Math.round(width * 0.054),
        lineHeight: 1.02,
        fontWeight: 760,
        letterSpacing: -1.5,
        textShadow: '0 8px 24px rgba(0,0,0,0.25)',
      },
    }, inputProps.title),
    React.createElement('div', {
      style: {
        marginTop: 18,
        maxWidth: width * 0.34,
        fontSize: Math.round(width * 0.02),
        lineHeight: 1.45,
        color: 'rgba(226,232,240,0.9)',
      },
    }, scene.body || inputProps.subtitle || 'A futuristic domestic helper moving through a realistic home routine.'),
    React.createElement('div', {
      style: {
        marginTop: 26,
        display: 'inline-block',
        padding: '10px 18px',
        borderRadius: 999,
        background: `${accent}22`,
        color: accent,
        border: `1px solid ${accent}55`,
        fontWeight: 600,
        fontSize: 20,
      },
    }, scene.headline)),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: width * 0.08,
        bottom: height * 0.09,
        width: width * 0.36,
        padding: '18px 22px',
        borderRadius: 24,
        background: 'rgba(12,18,31,0.48)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 18px 40px rgba(0,0,0,0.22)',
      },
    },
    React.createElement('div', { style: { fontSize: 14, color: 'rgba(148,163,184,0.95)', letterSpacing: 2.2, textTransform: 'uppercase' } }, 'Task Focus'),
    React.createElement('div', { style: { marginTop: 8, fontSize: 30, fontWeight: 700 } }, scene.accent),
    React.createElement('div', { style: { marginTop: 8, color: 'rgba(226,232,240,0.88)', fontSize: 18, lineHeight: 1.4 } }, scene.body)),
    scenes.map((item, index) => {
      const y = 144 + index * 68;
      const isActive = index === activeIndex;
      const alpha = isActive ? 1 : 0.48;
      return React.createElement('div', {
        key: `${item.accent}-${index}`,
        style: {
          position: 'absolute',
          right: width * 0.055,
          top: y,
          width: width * 0.15,
          padding: '14px 16px',
          borderRadius: 18,
          background: isActive ? `${taskColors[index % taskColors.length]}22` : 'rgba(255,255,255,0.04)',
          border: `1px solid ${isActive ? `${taskColors[index % taskColors.length]}66` : 'rgba(255,255,255,0.06)'}`,
          color: `rgba(248,250,252,${alpha})`,
          transform: `translateX(${isActive ? interpolate(Math.sin(sceneFrame / 12), [-1, 1], [-2, 6]) : 0}px)`,
        },
      },
      React.createElement('div', { style: { fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: `rgba(203,213,225,${alpha})` } }, `0${index + 1}`),
      React.createElement('div', { style: { marginTop: 6, fontSize: 18, fontWeight: 650, lineHeight: 1.25 } }, item.accent));
    }),
    React.createElement(RobotShell, {
      width,
      height,
      frame,
      accent,
      sceneIndex: activeIndex,
    }),
    Array.from({ length: 18 }, (_, i) => {
      const size = 8 + (i % 4) * 5;
      const seed = random(`spark-${i}`);
      const x = interpolate((frame * 0.35 + seed * 300) % width, [0, width], [0, width]);
      const y = (height * (0.14 + (i % 7) * 0.09) + Math.sin(frame / 24 + i) * 10) % (height * 0.78);
      return React.createElement('div', {
        key: `spark-${i}`,
        style: {
          position: 'absolute',
          left: x,
          top: y,
          width: size,
          height: size,
          borderRadius: '50%',
          background: `${taskColors[i % taskColors.length]}99`,
          filter: 'blur(1px)',
          opacity: 0.65,
        },
      });
    }));
};

const CodegenVideo: React.FC<Record<string, unknown>> = (rawProps) => {
  const inputProps = rawProps as RemotionVideoProps;
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const palette = themeMap[inputProps.theme ?? 'slate'];
  const scenes = normalizeScenes(inputProps);
  const timedScenes = resolveTimedScenes(scenes, durationInFrames, fps);

  return React.createElement(
    AbsoluteFill,
    {
      style: {
        background: palette.background,
        color: palette.text,
        fontFamily: 'Segoe UI, Arial, sans-serif',
        overflow: 'hidden',
      },
    },
    React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.16), transparent 24%), radial-gradient(circle at 80% 30%, rgba(255,255,255,0.1), transparent 22%), radial-gradient(circle at 60% 85%, rgba(255,255,255,0.08), transparent 20%)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        top: height * 0.1,
        left: width * 0.08,
        right: width * 0.08,
        bottom: height * 0.12,
        borderRadius: 36,
        background: palette.panel,
        border: `1px solid ${palette.accent}55`,
        boxShadow: '0 25px 80px rgba(0,0,0,0.22)',
        padding: 48,
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        top: 54,
        left: 72,
        right: 72,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      },
    },
    React.createElement('div', { style: { fontSize: 28, letterSpacing: 1.2, opacity: 0.92 } }, inputProps.title),
    React.createElement('div', { style: { fontSize: 18, color: palette.subtext, opacity: 0.9 } }, `${Math.round(durationInFrames / fps)}s local render`)),
    timedScenes.map((scene, index) => {
      const from = scene.fromFrame;
      const progress = spring({
        fps,
        frame: Math.max(0, frame - from),
        config: { damping: 14, stiffness: 120 },
        durationInFrames: Math.min(scene.durationFrames, fps * 2),
      });
      const translateY = interpolate(progress, [0, 1], [48, 0]);
      const opacity = interpolate(progress, [0, 1], [0, 1]);

        return React.createElement(
          Sequence,
        { key: `${scene.headline}-${index}`, from, durationInFrames: scene.durationFrames },
        React.createElement('div', {
          style: {
            position: 'absolute',
            top: height * 0.22,
            left: width * 0.1,
            right: width * 0.1,
            transform: `translateY(${translateY}px)`,
            opacity,
          },
        },
        React.createElement('div', {
          style: {
            display: 'inline-block',
            marginBottom: 22,
            padding: '10px 18px',
            borderRadius: 999,
            background: `${palette.accent}22`,
            color: palette.accent,
            fontSize: 24,
            fontWeight: 600,
          },
        }, scene.accent),
        React.createElement('div', { style: { fontSize: Math.round(width * 0.052), fontWeight: 700, lineHeight: 1.08, maxWidth: width * 0.72 } }, scene.headline),
        React.createElement('div', {
          style: {
            marginTop: 26,
            color: palette.subtext,
            fontSize: Math.round(width * 0.024),
            lineHeight: 1.4,
            maxWidth: width * 0.62,
            whiteSpace: 'pre-wrap',
          },
        }, scene.body)));
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: width * 0.08,
        bottom: height * 0.14,
        width: width * 0.24,
        height: width * 0.24,
        borderRadius: 999,
        border: `2px solid ${palette.accent}66`,
        opacity: 0.8,
        transform: `scale(${interpolate(Math.sin(frame / 18), [-1, 1], [0.92, 1.04])})`,
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: width * 0.14,
        bottom: height * 0.2,
        width: width * 0.12,
        height: width * 0.12,
        borderRadius: 26,
        background: `${palette.accent}33`,
        transform: `rotate(${frame * 0.8}deg)`,
      },
    }));
};

const PipelineIntroVideo: React.FC<Record<string, unknown>> = (rawProps) => {
  const inputProps = rawProps as RemotionVideoProps;
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const scenes = normalizeScenes(inputProps);
  const timedScenes = resolveTimedScenes(scenes, durationInFrames, fps);
  const scene = findActiveTimedScene(timedScenes, frame);
  const activeIndex = timedScenes.findIndex((item) => item.fromFrame === scene.fromFrame);
  const sceneFrame = frame - scene.fromFrame;
  const intro = spring({
    fps,
    frame,
    config: { damping: 14, stiffness: 110 },
  });
  const sceneReveal = spring({
    fps,
    frame: Math.max(0, sceneFrame),
    config: { damping: 16, stiffness: 120 },
  });
  const connectors = ['Claude / Agent', 'Local MCP Runner', 'Code renderers', 'Outputs / Logs'];
  const nodeColors = ['#7dd3fc', '#93c5fd', '#86efac', '#facc15'];

  return React.createElement(
    AbsoluteFill,
    {
      style: {
        background: 'linear-gradient(145deg, #08101f 0%, #0d172b 45%, #122236 100%)',
        color: '#f8fafc',
        fontFamily: 'Segoe UI, Arial, sans-serif',
        overflow: 'hidden',
      },
    },
    React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle at 15% 18%, rgba(125,211,252,0.22), transparent 18%), radial-gradient(circle at 85% 82%, rgba(134,239,172,0.16), transparent 22%)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: 54,
        top: 48,
        padding: '10px 16px',
        borderRadius: 14,
        border: '1px solid rgba(125,211,252,0.2)',
        background: 'rgba(8,16,30,0.72)',
        color: '#7dd3fc',
        fontSize: 17,
        fontWeight: 700,
        letterSpacing: 0.2,
        opacity: intro,
      },
    }, 'Structure before randomness'),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: 68,
        top: 132,
        width: width * 0.48,
        transform: `translateY(${interpolate(1 - intro, [0, 1], [0, 24])}px)`,
        opacity: intro,
      },
    },
    React.createElement('div', {
      style: {
        fontSize: Math.round(width * 0.06),
        lineHeight: 0.96,
        fontWeight: 760,
        letterSpacing: -2.6,
      },
    }, inputProps.title),
    React.createElement('div', {
      style: {
        marginTop: 20,
        maxWidth: width * 0.44,
        color: '#c4d1e4',
        fontSize: Math.round(width * 0.021),
        lineHeight: 1.4,
      },
    }, inputProps.subtitle)),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: 68,
        right: 68,
        bottom: 108,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        opacity: intro,
      },
    }, connectors.map((label, index) => {
      const active = index === activeIndex || (activeIndex > 2 && index === 3);
      return React.createElement('div', {
        key: label,
        style: {
          width: 255,
          minHeight: 126,
          padding: '22px 22px 20px 22px',
          borderRadius: 18,
          background: active ? 'rgba(14, 27, 47, 0.96)' : 'rgba(8, 16, 30, 0.72)',
          border: `1px solid ${active ? `${nodeColors[index]}44` : 'rgba(125,211,252,0.12)'}`,
          boxShadow: active ? `0 14px 32px ${nodeColors[index]}18` : '0 12px 24px rgba(0,0,0,0.16)',
          transform: `translateY(${active ? interpolate(Math.sin(frame / 10 + index), [-1, 1], [-2, 4]) : 0}px) scale(${active ? 1.02 : 1})`,
        },
      },
      React.createElement('div', {
        style: {
          width: 38,
          height: 6,
          borderRadius: 4,
          background: nodeColors[index],
        },
      }),
      React.createElement('div', {
        style: {
          marginTop: 16,
          fontSize: 24,
          fontWeight: 700,
          lineHeight: 1.12,
        },
      }, label),
      React.createElement('div', {
        style: {
          marginTop: 10,
          color: '#b7c6db',
          fontSize: 16,
          lineHeight: 1.35,
        },
      }, index === 0 ? 'Brief and constraints' : index === 1 ? 'Render + validate' : index === 2 ? 'Cards, diagrams, video' : 'Runs, reports, gallery'));
    })),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: width * 0.55,
        top: 140,
        width: width * 0.36,
        padding: '28px 30px',
        borderRadius: 22,
        background: 'rgba(8, 16, 30, 0.82)',
        border: `1px solid ${nodeColors[activeIndex % nodeColors.length]}30`,
        boxShadow: '0 16px 34px rgba(0,0,0,0.18)',
        opacity: sceneReveal,
        transform: `translateY(${interpolate(1 - sceneReveal, [0, 1], [0, 22])}px)`,
      },
    },
    React.createElement('div', {
      style: {
        fontSize: 15,
        color: nodeColors[activeIndex % nodeColors.length],
        letterSpacing: 2.1,
        textTransform: 'uppercase',
      },
    }, scene.accent),
    React.createElement('div', {
      style: {
        marginTop: 14,
        fontSize: 34,
        lineHeight: 1.08,
        fontWeight: 720,
      },
    }, scene.headline),
    React.createElement('div', {
      style: {
        marginTop: 14,
        color: '#d5deec',
        fontSize: 20,
        lineHeight: 1.45,
      },
    }, scene.body)),
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: 76,
        top: 82,
        display: 'flex',
        gap: 12,
      },
    },
    ['Local-first', 'No required API key', 'Inspectable outputs'].map((label) => React.createElement('div', {
      key: label,
      style: {
        padding: '10px 16px',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#d5deec',
        fontSize: 16,
      },
    }, label))),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: 68,
        bottom: 58,
        color: '#91a4c0',
        fontSize: 19,
        opacity: interpolate(frame, [0, fps], [0, 1], { extrapolateRight: 'clamp' }),
      },
    }, 'Code-first media pipeline • reproducible local runs'));
};

const PipelineIntroProVideo: React.FC<Record<string, unknown>> = (rawProps) => {
  const inputProps = rawProps as RemotionVideoProps;
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  const t = frame / fps;
  const intro = spring({ fps, frame, config: { damping: 14, stiffness: 120 } });
  const fadeIn = interpolate(frame, [0, Math.round(fps * 0.7)], [0, 1], { extrapolateRight: 'clamp' });
  const breathe = 0.5 + 0.5 * Math.sin(frame / 50);

  const safe = {
    x: Math.round(width * 0.06),
    y: Math.round(height * 0.06),
  };

  const titleSize = Math.round(width * 0.056);
  const subSize = Math.round(width * 0.022);

  // Animated “flow” progress through pipeline blocks.
  const phases = [
    { at: 0.0, label: 'Brief', color: '#fb923c', note: 'Constraints and intent' },
    { at: 0.18, label: 'Plan', color: '#a78bfa', note: 'Templates + renderer choice' },
    { at: 0.36, label: 'Render', color: '#60a5fa', note: 'HTML/CSS • SVG • Video' },
    { at: 0.54, label: 'Hybrid', color: '#34d399', note: 'ComfyUI bg + code overlay' },
    { at: 0.72, label: 'Validate', color: '#facc15', note: 'Manifests + checks' },
    { at: 0.86, label: 'Ship', color: '#22d3ee', note: 'Outputs + gallery' },
  ];
  let phaseIndex = 0;
  for (let i = 0; i < phases.length; i += 1) {
    const p = phases[i];
    if (t >= p.at * (durationInFrames / fps)) phaseIndex = i;
  }
  const active = phases[phaseIndex];

  const bg = React.createElement('div', {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'radial-gradient(circle at 18% 18%, rgba(125,211,252,0.20), transparent 30%), radial-gradient(circle at 86% 72%, rgba(167,139,250,0.16), transparent 34%), linear-gradient(145deg, #060c18 0%, #0b152a 45%, #0f1f35 100%)',
      transform: `scale(${1 + breathe * 0.005})`,
    },
  });

  // Subtle grain overlay (CSS-only; deterministic).
  const grain = React.createElement('div', {
    style: {
      position: 'absolute',
      inset: 0,
      backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2760%27 height=%2760%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%2760%27 height=%2760%27 filter=%27url(%23n)%27 opacity=%270.18%27/%3E%3C/svg%3E")',
      mixBlendMode: 'overlay',
      opacity: 0.55,
    },
  });

  const header = React.createElement('div', {
    style: {
      position: 'absolute',
      left: safe.x,
      top: safe.y,
      width: Math.round(width * 0.62),
      opacity: fadeIn,
      transform: `translateY(${interpolate(1 - intro, [0, 1], [0, 18])}px)`,
    },
  },
  React.createElement('div', {
    style: {
      display: 'inline-flex',
      gap: 10,
      padding: '10px 14px',
      borderRadius: 14,
      border: '1px solid rgba(125,211,252,0.22)',
      background: 'rgba(8,16,30,0.72)',
      color: '#7dd3fc',
      fontSize: 16,
      fontWeight: 800,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
  }, 'Structure before randomness'),
  React.createElement('div', {
    style: {
      marginTop: 18,
      fontSize: titleSize,
      lineHeight: 0.98,
      fontWeight: 860,
      letterSpacing: -2.4,
    },
  }, inputProps.title),
  React.createElement('div', {
    style: {
      marginTop: 14,
      maxWidth: Math.round(width * 0.56),
      color: 'rgba(214,226,241,0.92)',
      fontSize: subSize,
      lineHeight: 1.45,
    },
  }, inputProps.subtitle ?? 'Local-first structured media workflows: code-first templates + optional local ComfyUI.'));

  const chips = React.createElement('div', {
    style: {
      position: 'absolute',
      right: safe.x,
      top: safe.y,
      display: 'flex',
      gap: 10,
      opacity: fadeIn,
    },
  }, ['Local-first', 'Deterministic', 'Inspectable outputs'].map((label) => React.createElement('div', {
    key: label,
    style: {
      padding: '10px 14px',
      borderRadius: 14,
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.08)',
      color: '#d5deec',
      fontSize: 15,
      letterSpacing: 0.2,
    },
  }, label)));

  // Pipeline blocks + animated connectors.
  const blockW = Math.round(width * 0.14);
  const blockH = Math.round(height * 0.14);
  const rowY = Math.round(height * 0.52);
  const startX = safe.x;
  const gap = Math.round(width * 0.03);

  const blocks = phases.map((p, i) => {
    const x = startX + i * (blockW + gap);
    const isActive = i <= phaseIndex;
    const wobble = Math.sin((frame / 10) + i) * (isActive ? 2 : 0);
    return React.createElement('div', {
      key: p.label,
      style: {
        position: 'absolute',
        left: x,
        top: rowY,
        width: blockW,
        height: blockH,
        borderRadius: 20,
        padding: '18px 18px 16px 18px',
        background: isActive ? 'rgba(14, 27, 47, 0.96)' : 'rgba(8, 16, 30, 0.72)',
        border: `1px solid ${isActive ? `${p.color}44` : 'rgba(125,211,252,0.12)'}`,
        boxShadow: isActive ? `0 14px 36px ${p.color}18` : '0 12px 24px rgba(0,0,0,0.16)',
        transform: `translateY(${wobble}px) scale(${isActive ? 1.02 : 1})`,
        opacity: fadeIn,
      },
    },
    React.createElement('div', { style: { width: 38, height: 6, borderRadius: 4, background: p.color } }),
    React.createElement('div', { style: { marginTop: 14, fontSize: 22, fontWeight: 820 } }, p.label),
    React.createElement('div', { style: { marginTop: 10, color: 'rgba(183,198,219,0.95)', fontSize: 14, lineHeight: 1.35 } }, p.note));
  });

  const connectorProgress = interpolate(t, [0, durationInFrames / fps], [0, 1], { extrapolateRight: 'clamp' });
  const connectorSvg = React.createElement('svg', {
    width,
    height,
    style: { position: 'absolute', inset: 0, opacity: fadeIn },
  },
  React.createElement('defs', {}, React.createElement('linearGradient', { id: 'flow', x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
    React.createElement('stop', { offset: '0%', stopColor: '#7dd3fc', stopOpacity: 0.25 }),
    React.createElement('stop', { offset: '55%', stopColor: active.color, stopOpacity: 0.62 }),
    React.createElement('stop', { offset: '100%', stopColor: '#34d399', stopOpacity: 0.25 }),
  )),
  phases.slice(0, phases.length - 1).map((_, i) => {
    const x1 = startX + i * (blockW + gap) + blockW;
    const x2 = startX + (i + 1) * (blockW + gap);
    const y = rowY + Math.round(blockH * 0.5);
    const activeLine = i < phaseIndex;
    const dashOffset = -frame * 2.2;
    const seg = `M${x1} ${y} C${x1 + 40} ${y} ${x2 - 40} ${y} ${x2} ${y}`;
    return React.createElement('path', {
      key: `c${i}`,
      d: seg,
      fill: 'none',
      stroke: activeLine ? 'url(#flow)' : 'rgba(148,163,184,0.22)',
      strokeWidth: 4,
      strokeLinecap: 'round',
      strokeDasharray: activeLine ? '10 10' : undefined,
      strokeDashoffset: activeLine ? dashOffset : undefined,
      opacity: activeLine ? 0.95 : 0.65,
    });
  }));

  // Timeline footer
  const footer = React.createElement('div', {
    style: {
      position: 'absolute',
      left: safe.x,
      right: safe.x,
      bottom: safe.y,
      height: 86,
      borderRadius: 22,
      padding: '18px 20px',
      background: 'rgba(6,12,22,0.52)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 20px 44px rgba(0,0,0,0.28)',
      backdropFilter: 'blur(10px)',
      opacity: fadeIn,
    },
  },
  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18 } },
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      React.createElement('div', { style: { color: active.color, fontWeight: 850, letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 14 } }, `Active: ${active.label}`),
      React.createElement('div', { style: { color: 'rgba(214,226,241,0.92)', fontSize: 16 } }, 'Same pipeline works for banners, diagrams, dashboards, nature overlays, and video.')),
    React.createElement('div', { style: { textAlign: 'right', color: 'rgba(145,164,192,0.95)', fontSize: 15 } },
      `t=${t.toFixed(1)}s  •  ${Math.round(connectorProgress * 100)}%`)));

  return React.createElement(
    AbsoluteFill,
    { style: { background: '#050b13', color: '#f8fafc', fontFamily: 'Segoe UI, Arial, sans-serif', overflow: 'hidden' } },
    bg,
    grain,
    inputProps.music_src ? React.createElement(Html5Audio, {
      src: staticFile(inputProps.music_src),
      volume: (f: number) => {
        const base = typeof inputProps.music_volume === 'number' ? inputProps.music_volume : 0.18;
        // Duck music when voiceover is present (simple, deterministic).
        const hasVoice = Boolean(inputProps.voiceover_src);
        const duck = hasVoice ? 0.35 : 1;
        // Slight musical swell after the first second.
        const swell = interpolate(f, [0, fps * 1.2], [0.85, 1], { extrapolateRight: 'clamp' });
        return base * duck * swell;
      },
    }) : null,
    inputProps.voiceover_src ? React.createElement(Html5Audio, {
      src: staticFile(inputProps.voiceover_src),
      volume: typeof inputProps.voiceover_volume === 'number' ? inputProps.voiceover_volume : 1.0,
    }) : null,
    header,
    chips,
    connectorSvg,
    ...blocks,
    footer,
  );
};

const CinematicTreatmentVideo: React.FC<Record<string, unknown>> = (rawProps) => {
  const inputProps = rawProps as RemotionVideoProps;
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const scenes = normalizeScenes(inputProps);
  const timedScenes = resolveTimedScenes(scenes, durationInFrames, fps);
  const scene = findActiveTimedScene(timedScenes, frame);
  const activeIndex = timedScenes.findIndex((item) => item.fromFrame === scene.fromFrame);
  const sceneFrame = frame - scene.fromFrame;
  const reveal = spring({
    fps,
    frame: Math.max(0, sceneFrame),
    config: { damping: 18, stiffness: 130 },
  });
  const overlayOpacity = interpolate(reveal, [0, 1], [0.25, 1], { extrapolateRight: 'clamp' });
  const imageScale = interpolate(Math.sin(sceneFrame / 22), [-1, 1], [1.035, 1.08]);
  const previewLabel = inputProps.visual_style === 'scene_sequence' ? 'SVG scene sequence' : 'Cinematic treatment preview';

  const backgroundNode = scene.media_data_url
    ? React.createElement('img', {
        src: scene.media_data_url,
        style: {
          position: 'absolute',
          inset: -28,
          width: width + 56,
          height: height + 56,
          objectFit: 'cover',
          transform: `scale(${imageScale}) translateY(${interpolate(Math.sin(sceneFrame / 28), [-1, 1], [8, -8])}px)`,
          filter: 'saturate(1.04) contrast(1.08) brightness(0.92)',
        },
      })
    : React.createElement('div', {
        style: {
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(145deg, #08101f 0%, #0e2038 44%, #163552 100%)',
        },
      });

  const progressNodes = timedScenes.map((item, index) => {
    const active = index === activeIndex;
    return React.createElement('div', {
      key: `${item.headline}-${index}`,
      style: {
        width: 54,
        height: 6,
        borderRadius: 4,
        background: active ? '#7dd3fc' : 'rgba(255,255,255,0.22)',
        boxShadow: active ? '0 0 20px rgba(125,211,252,0.34)' : 'none',
      },
    });
  });

  const leftColumn = React.createElement('div', {
    style: {
      maxWidth: width * 0.62,
    },
  },
  React.createElement('div', {
    style: {
      color: '#7dd3fc',
      fontSize: 16,
      letterSpacing: 2,
      textTransform: 'uppercase',
    },
  }, scene.accent || `Beat ${String(activeIndex + 1).padStart(2, '0')}`),
  React.createElement('div', {
    style: {
      marginTop: 10,
      fontSize: Math.round(width * 0.034),
      lineHeight: 1.03,
      fontWeight: 740,
      letterSpacing: -1.2,
    },
  }, scene.headline),
  React.createElement('div', {
    style: {
      marginTop: 12,
      color: 'rgba(231,240,251,0.92)',
      fontSize: Math.round(width * 0.018),
      lineHeight: 1.45,
    },
  }, scene.body));

  const rightColumn = React.createElement('div', {
    style: {
      minWidth: 210,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 8,
    },
  },
  React.createElement('div', {
    style: {
      color: '#d9e7f5',
      fontSize: 15,
      letterSpacing: 1.8,
      textTransform: 'uppercase',
    },
  }, inputProps.title),
  React.createElement('div', {
    style: {
      color: 'rgba(214,226,241,0.88)',
      fontSize: 15,
      textAlign: 'right',
      maxWidth: 220,
      lineHeight: 1.35,
    },
  }, inputProps.subtitle || 'Reference-led motion direction'));

  const lowerThird = React.createElement('div', {
    style: {
      position: 'absolute',
      left: 56,
      right: 56,
      bottom: 52,
      padding: '26px 28px 24px 28px',
      borderRadius: 22,
      background: `rgba(4, 10, 18, ${0.5 * overlayOpacity})`,
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 20px 44px rgba(0,0,0,0.28)',
      backdropFilter: 'blur(10px)',
    },
  },
  React.createElement('div', {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 18,
      alignItems: 'flex-start',
    },
  }, leftColumn, rightColumn));

  return React.createElement(
    AbsoluteFill,
    {
      style: {
        background: '#050b13',
        color: '#f8fafc',
        fontFamily: 'Segoe UI, Arial, sans-serif',
        overflow: 'hidden',
      },
    },
    backgroundNode,
    React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, rgba(1,5,10,0.18) 0%, rgba(1,5,10,0.12) 30%, rgba(1,5,10,0.42) 72%, rgba(1,5,10,0.82) 100%)',
      },
    }),
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: 44,
        top: 42,
        padding: '10px 14px',
        borderRadius: 12,
        background: 'rgba(6,12,22,0.42)',
        border: '1px solid rgba(255,255,255,0.09)',
        color: '#cbe4ff',
        fontSize: 15,
        letterSpacing: 1.7,
        textTransform: 'uppercase',
      },
    }, previewLabel),
    React.createElement('div', {
      style: {
        position: 'absolute',
        right: 46,
        top: 44,
        display: 'flex',
        gap: 10,
      },
    }, progressNodes),
    lowerThird,
  );
};

const RemotionRoot: React.FC = () => {
  const defaultProps: RemotionVideoInput = {
    title: 'Local media generation',
    subtitle: 'Render video from code with Remotion',
    theme: 'slate',
    visual_style: 'presentation',
    scenes: [],
    fps: 30,
    duration_seconds: 6,
    width: 1280,
    height: 720,
  };

  return React.createElement(Composition, {
    id: 'CodegenVideo',
    component: (props: Record<string, unknown>) => {
      const typedProps = props as RemotionVideoProps;
      return typedProps.visual_style === 'cinematic_robot'
        ? React.createElement(CinematicRobotVideo, props)
        : typedProps.visual_style === 'scene_sequence'
          ? React.createElement(CinematicTreatmentVideo, props)
        : typedProps.visual_style === 'cinematic_treatment'
          ? React.createElement(CinematicTreatmentVideo, props)
          : typedProps.visual_style === 'pipeline_intro'
            ? React.createElement(PipelineIntroVideo, props)
          : typedProps.visual_style === 'pipeline_intro_pro'
            ? React.createElement(PipelineIntroProVideo, props)
          : React.createElement(CodegenVideo, props);
    },
    defaultProps: defaultProps as unknown as Record<string, unknown>,
    calculateMetadata: ({ props }) => {
      const typedProps = props as RemotionVideoProps;
      const fps = typedProps.fps ?? defaultProps.fps ?? 30;
      const durationSeconds = typedProps.duration_seconds ?? defaultProps.duration_seconds ?? 6;
      return {
        width: typedProps.width ?? defaultProps.width ?? 1280,
        height: typedProps.height ?? defaultProps.height ?? 720,
        fps,
        durationInFrames: Math.max(1, Math.round(durationSeconds * fps)),
      };
    },
  });
};

registerRoot(RemotionRoot);
