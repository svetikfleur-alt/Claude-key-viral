import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type ProbeMetadata = {
  width: number;
  height: number;
  duration_seconds: number;
  fps: number;
  frame_count: number;
  has_audio: boolean;
  video_codec?: string;
  audio_codec?: string;
};

type ReferenceFrame = {
  timecode_seconds: number;
  file_path: string;
};

type ReferenceAnalysisResult = {
  output_dir: string;
  metadata_path: string;
  style_brief_path: string;
  shot_plan_path: string;
  notes_path: string;
  frames: ReferenceFrame[];
  metadata: ProbeMetadata;
};

type ShotPlanScene = {
  label: string;
  start_seconds: number;
  end_seconds: number;
  objective: string;
  visual_notes: string[];
};

function sanitizeStem(name: string): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!stem) throw new Error('Invalid reference filename. Cause: filename became empty after sanitization. Suggested fix: use a normal media filename.');
  return stem;
}

function assertVideoPath(videoPath: string): void {
  const resolved = path.resolve(videoPath);
  const ext = path.extname(resolved).toLowerCase();
  if (!['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) {
    throw new Error(`Unsupported reference video type. Cause: '${ext}' is not supported. Suggested fix: use .mp4, .mov, .webm, or .mkv.`);
  }
}

async function resolveBinary(binaryName: 'ffmpeg.exe' | 'ffprobe.exe', projectRoot: string): Promise<string> {
  const candidates = [
    path.join(projectRoot, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', binaryName),
    path.join('C:\\Program Files (x86)\\HitPaw\\HitPaw Edimakor', binaryName),
    path.join('C:\\Users\\Lena\\MediaGet2', binaryName),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Reference video analysis could not find ${binaryName}. Suggested fix: install ffmpeg or keep the Remotion compositor package installed.`);
}

async function runPowerShell(command: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  return await new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', command], { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function probeVideo(videoPath: string, projectRoot: string): Promise<ProbeMetadata> {
  const ffprobe = await resolveBinary('ffprobe.exe', projectRoot);
  const command = `& '${ffprobe}' -v error -print_format json -show_streams -show_format '${videoPath.replace(/'/g, "''")}'`;
  const stdout = await runPowerShell(command);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<Record<string, string>>;
    format?: Record<string, string>;
  };
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');
  if (!videoStream) {
    throw new Error('Reference video analysis failed. Cause: no video stream was found. Suggested fix: use a standard playable video file.');
  }

  const fpsParts = String(videoStream.r_frame_rate ?? '0/1').split('/');
  const fps = Number(fpsParts[0]) / Number(fpsParts[1] || 1);
  const durationSeconds = Number(videoStream.duration ?? parsed.format?.duration ?? 0);
  const frameCount = Number(videoStream.nb_frames ?? Math.round(durationSeconds * fps));

  return {
    width: Number(videoStream.width ?? 0),
    height: Number(videoStream.height ?? 0),
    duration_seconds: Number(durationSeconds.toFixed(3)),
    fps: Number(fps.toFixed(3)),
    frame_count: frameCount,
    has_audio: Boolean(audioStream),
    video_codec: String(videoStream.codec_name ?? ''),
    audio_codec: audioStream ? String(audioStream.codec_name ?? '') : undefined,
  };
}

function buildFrameTimes(durationSeconds: number): number[] {
  if (durationSeconds <= 0.5) return [0];
  return [0, durationSeconds * 0.25, durationSeconds * 0.5, durationSeconds * 0.75, Math.max(0, durationSeconds - 0.4)]
    .map((value) => Number(value.toFixed(3)));
}

async function extractFrame(ffmpegPath: string, videoPath: string, outPath: string, timeSeconds: number): Promise<void> {
  const command = `& '${ffmpegPath}' -y -ss ${timeSeconds} -i '${videoPath.replace(/'/g, "''")}' -frames:v 1 -update 1 '${outPath.replace(/'/g, "''")}'`;
  await runPowerShell(command);
}

function buildShotPlan(metadata: ProbeMetadata, notes?: string): ShotPlanScene[] {
  const duration = metadata.duration_seconds || 8;
  const chunk = duration / 4;
  return [
    {
      label: 'Establishing reveal',
      start_seconds: 0,
      end_seconds: Number(chunk.toFixed(2)),
      objective: 'Introduce the environment with instant atmosphere and motion.',
      visual_notes: [
        'Wide cinematic framing.',
        'Natural light ripples or reflective highlights.',
        notes ?? 'Keep the opening grounded in a strong location cue.',
      ],
    },
    {
      label: 'Primary action beat',
      start_seconds: Number(chunk.toFixed(2)),
      end_seconds: Number((chunk * 2).toFixed(2)),
      objective: 'Show the subject performing the signature movement.',
      visual_notes: [
        'Track the main subject through space.',
        'Keep foreground or environmental depth visible.',
        'Avoid flat center-framed dead space.',
      ],
    },
    {
      label: 'Close intensity beat',
      start_seconds: Number((chunk * 2).toFixed(2)),
      end_seconds: Number((chunk * 3).toFixed(2)),
      objective: 'Move closer and let motion or texture sell realism.',
      visual_notes: [
        'Use faster parallax or environmental pass-by.',
        'Let water, particles, or texture create realism if applicable.',
        'Keep subject silhouette clear.',
      ],
    },
    {
      label: 'Exit / payoff',
      start_seconds: Number((chunk * 3).toFixed(2)),
      end_seconds: duration,
      objective: 'Land the shot with a memorable final composition.',
      visual_notes: [
        'Preserve a clean read of the subject.',
        'End on the strongest environment + action balance.',
        'Leave room for title or end-card if needed.',
      ],
    },
  ];
}

function buildStyleBrief(metadata: ProbeMetadata, videoPath: string, notes?: string): string {
  const fileName = path.basename(videoPath);
  return `# Reference style brief

Source file: \`${fileName}\`

## Technical read

- Resolution: ${metadata.width}x${metadata.height}
- Duration: ${metadata.duration_seconds}s
- Frame rate: ${metadata.fps} fps
- Frame count: ${metadata.frame_count}
- Audio present: ${metadata.has_audio ? 'yes' : 'no'}
- Video codec: ${metadata.video_codec || 'unknown'}

## What this reference is doing well

- strong environment read from the first second
- one clear primary subject and action
- wide, premium-feeling composition with visible depth
- natural motion energy instead of static presentation slides
- realistic texture, lighting, and environmental interaction

## Implication for this project

This kind of result is not something a pure SVG/HTML card renderer should fake.

The project should support this in two stages:

1. analyze and structure the reference
2. hand the resulting shot/treatment packet to a richer backend when needed

## Direction extracted for generation

- target premium cinematic motion, not toy animation
- emphasize environmental depth and motion continuity
- keep a single readable subject focus per beat
- use realistic light, texture, and camera language
- avoid excessive UI overlays during the main visual action

## User notes

${notes ?? 'No additional user notes supplied.'}
`;
}

function buildGenerationNotes(metadata: ProbeMetadata): string {
  return `# Generation notes

To match this reference more closely, the pipeline needs:

- wider environmental compositions
- fewer card-like overlays during action moments
- stronger scene-to-scene camera change
- realistic texture-rich backend support when aiming for photoreal footage

Suggested matching targets:

- ${metadata.width}x${metadata.height}
- ${metadata.fps} fps
- short cinematic beat structure
- clear subject + environment relationship

Practical use in this repo:

- keep code-first rendering for treatments, shot plans, intro sequences, and end-cards
- use the reference packet when wiring a local or BYOK cinematic backend later
`;
}

export async function analyzeReferenceVideo(options: {
  projectRoot: string;
  videoPath: string;
  notes?: string;
}): Promise<ReferenceAnalysisResult> {
  assertVideoPath(options.videoPath);
  const resolvedVideo = path.resolve(options.videoPath);
  await fs.access(resolvedVideo);

  const ffmpeg = await resolveBinary('ffmpeg.exe', options.projectRoot);
  const metadata = await probeVideo(resolvedVideo, options.projectRoot);
  const times = buildFrameTimes(metadata.duration_seconds);
  const baseName = sanitizeStem(path.basename(resolvedVideo, path.extname(resolvedVideo)));
  const outputDir = path.join(options.projectRoot, 'outputs', 'reference-studies', `${baseName}-${randomUUID().slice(0, 8)}`);
  const framesDir = path.join(outputDir, '01_frames');
  await fs.mkdir(framesDir, { recursive: true });

  const frames: ReferenceFrame[] = [];
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    const outPath = path.join(framesDir, `frame_${String(index).padStart(2, '0')}.png`);
    await extractFrame(ffmpeg, resolvedVideo, outPath, time);
    frames.push({ timecode_seconds: time, file_path: outPath });
  }

  const metadataPath = path.join(outputDir, '00_metadata.json');
  const styleBriefPath = path.join(outputDir, '02_style-brief.md');
  const shotPlanPath = path.join(outputDir, '03_shot-plan.json');
  const notesPath = path.join(outputDir, '04_generation-notes.md');

  await fs.writeFile(metadataPath, `${JSON.stringify({
    source_video: resolvedVideo,
    metadata,
    frames,
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(styleBriefPath, `${buildStyleBrief(metadata, resolvedVideo, options.notes)}\n`, 'utf8');
  await fs.writeFile(shotPlanPath, `${JSON.stringify({
    source_video: resolvedVideo,
    duration_seconds: metadata.duration_seconds,
    scenes: buildShotPlan(metadata, options.notes),
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(notesPath, `${buildGenerationNotes(metadata)}\n`, 'utf8');

  return {
    output_dir: outputDir,
    metadata_path: metadataPath,
    style_brief_path: styleBriefPath,
    shot_plan_path: shotPlanPath,
    notes_path: notesPath,
    frames,
    metadata,
  };
}

export function buildReferenceTreatmentPreview(metadata: ProbeMetadata): string[] {
  return [
    `${metadata.width}x${metadata.height} cinematic framing`,
    `${metadata.fps} fps motion target`,
    'environment-first composition',
    'single dominant action subject',
    'realistic texture and lighting priority',
  ];
}
