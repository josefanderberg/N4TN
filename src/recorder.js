const VIDEO_TYPES = [
  ['video/mp4;codecs=avc1.640033', 'mp4'],
  ['video/mp4;codecs=avc1.640028', 'mp4'],
  ['video/mp4;codecs=avc1', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm;codecs=vp8', 'webm'],
  ['video/webm', 'webm'],
];

const AUDIO_CODEC = { mp4: 'mp4a.40.2', webm: 'opus' };

// Väljer bästa format som webbläsaren kan spela in (MP4 i första hand).
export function pickMimeType(withAudio) {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [type, ext] of VIDEO_TYPES) {
    if (withAudio) {
      const [base, codecs] = type.split(';codecs=');
      const withCodec = codecs
        ? `${base};codecs=${codecs},${AUDIO_CODEC[ext]}`
        : type;
      if (MediaRecorder.isTypeSupported(withCodec)) return { mimeType: withCodec, ext };
    } else if (MediaRecorder.isTypeSupported(type)) {
      return { mimeType: type, ext };
    }
  }
  return null;
}

export class CanvasRecorder {
  constructor(canvas, { fps, videoBitsPerSecond, audioTracks = [], mimeType }) {
    this.stream = canvas.captureStream(fps);
    for (const track of audioTracks) this.stream.addTrack(track);
    this.recorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond,
      audioBitsPerSecond: 192000,
    });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
  }

  start() {
    this.recorder.start(500);
  }

  stop() {
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        // Ljudspåret ägs av ljudgrafen och återanvänds, så bara bildspåret stoppas.
        for (const track of this.stream.getVideoTracks()) track.stop();
        resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'video/webm' }));
      };
      if (this.recorder.state !== 'inactive') this.recorder.stop();
    });
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
