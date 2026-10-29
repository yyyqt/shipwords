// Clip the presentation timeline without discarding H.264 reference frames.
// We only accept our own non-fragmented, mdat-before-moov muxer output. Changing the
// trailing moov cannot invalidate sample offsets. Edit lists keep AAC priming intact.
type Box = { start: number; end: number; header: number; type: string };

function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: Box[] = [];
  for (let at = start; at < end; ) {
    if (at + 8 > end) throw new Error('Truncated MP4 box');
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    // Our bounded (<16 MiB) muxer never emits extended-size or open-ended boxes.
    if (size < 8 || at + size > end) throw new Error('Invalid MP4 box size');
    result.push({ start: at, end: at + size, header: at + 8, type });
    at += size;
  }
  return result;
}

function join(parts: readonly Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function box(type: string, parts: readonly Uint8Array[]) {
  const body = join(parts);
  const result = new Uint8Array(8 + body.length);
  new DataView(result.buffer).setUint32(0, result.length);
  result.set(
    [...type].map((char) => char.charCodeAt(0)),
    4,
  );
  result.set(body, 8);
  return result;
}

function editList(duration: number) {
  const body = new Uint8Array(20); // FullBox + entry count + one v0 entry.
  const view = new DataView(body.buffer);
  view.setUint32(4, 1);
  view.setUint32(8, duration);
  view.setInt32(12, 0);
  view.setInt16(16, 1); // media_rate = 1.0: no change in speed.
  return box('edts', [box('elst', [body])]);
}

function setDuration(bytes: Uint8Array, at: number, version: number, duration: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (version === 0) view.setUint32(at, duration);
  else if (version === 1) view.setBigUint64(at, BigInt(duration));
  else throw new Error('Unsupported MP4 header version');
}

/** MP4 edit lists trim playback at the original audio's end, including B-frame dependencies. */
export function clipMp4Presentation(input: Uint8Array, seconds: number): Uint8Array {
  if (!(Number.isFinite(seconds) && seconds > 0 && seconds < 60)) throw new Error('Invalid clip duration');
  const top = boxes(input);
  const moov = top.find((entry) => entry.type === 'moov');
  const mdat = top.find((entry) => entry.type === 'mdat');
  if (!moov || !mdat || moov.end !== input.length || mdat.end > moov.start)
    throw new Error('Expected trailing MP4 metadata');
  const children = boxes(input, moov.header, moov.end);
  const movie = children.find((entry) => entry.type === 'mvhd');
  if (!movie) throw new Error('Missing movie header');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const movieVersion = view.getUint8(movie.header);
  if (movieVersion !== 0 && movieVersion !== 1) throw new Error('Unsupported movie header');
  const timeOffset = movie.header + (movieVersion === 0 ? 12 : 20);
  const timescale = view.getUint32(timeOffset);
  const duration = Math.round(seconds * timescale);
  if (!timescale || !Number.isSafeInteger(duration) || duration > 0xffffffff)
    throw new Error('Invalid MP4 timescale');
  let tracks = 0;
  const updated = children.map((entry) => {
    if (entry.type === 'mvhd') {
      const bytes = input.slice(entry.start, entry.end);
      setDuration(bytes, timeOffset - entry.start + 4, movieVersion, duration);
      return bytes;
    }
    if (entry.type !== 'trak') return input.subarray(entry.start, entry.end);
    tracks++;
    let hasEdit = false;
    let hasHeader = false;
    const parts = boxes(input, entry.header, entry.end).map((part) => {
      if (part.type === 'tkhd') {
        hasHeader = true;
        const bytes = input.slice(part.start, part.end);
        const version = bytes[8]!;
        setDuration(bytes, version === 0 ? 28 : 36, version, duration);
        return bytes;
      }
      if (part.type !== 'edts') return input.subarray(part.start, part.end);
      hasEdit = true;
      const edits = boxes(input, part.header, part.end);
      const elst = edits[0];
      if (edits.length !== 1 || !elst || elst.type !== 'elst') throw new Error('Unexpected MP4 edits');
      const version = view.getUint8(elst.header);
      const entries = view.getUint32(elst.header + 4);
      if (entries !== 1 || (version !== 0 && version !== 1)) throw new Error('Unexpected MP4 edit list');
      const bytes = input.slice(part.start, part.end);
      const durationOffset = elst.header + 8 - part.start;
      // Leave media_time unchanged: negative AAC priming has already been skipped by the muxer.
      setDuration(bytes, durationOffset, version, duration);
      return bytes;
    });
    if (!hasHeader) throw new Error('Missing track header');
    if (!hasEdit) parts.splice(1, 0, editList(duration));
    return box('trak', parts);
  });
  if (tracks !== 2) throw new Error('Expected exactly one video and one audio track');
  return join([input.subarray(0, moov.start), box('moov', updated)]);
}
