// Sequence Helpers

export const getSequenceFromProjectItem = (item: ProjectItem) => {
  for (let i = 0; i < app.project.sequences.numSequences; i++) {
    const seq = app.project.sequences[i];
    if (seq.projectItem.nodeId === item.nodeId) {
      return seq;
    }
  }
};

export const getSequenceLengthInFrames = (seq: Sequence) => {
  const settings = seq.getSettings();
  const end = seq.end;
  const fps = settings.videoFrameRate.ticks;
  const frames = parseInt(end) / parseInt(fps);
  return frames;
};

export const forEachVideoTrack = (
  sequence: Sequence,
  callback: (track: Track, index: number) => void,
  reverse?: boolean
) => {
  const num = sequence.videoTracks.numTracks;
  if (reverse) {
    for (let i = num - 1; i > -1; i--) {
      callback(sequence.videoTracks[i], i);
    }
  } else {
    for (let i = 0; i < num; i++) {
      callback(sequence.videoTracks[i], i);
    }
  }
};

/**
 * Finds which video track index a TrackItem belongs to
 */
export const getTrackIndexForClip = (
  sequence: Sequence,
  clip: TrackItem
): number | null => {
  for (let i = 0; i < sequence.videoTracks.numTracks; i++) {
    const track = sequence.videoTracks[i];
    for (let j = 0; j < track.clips.numItems; j++) {
      const currentClipId = track.clips[j].nodeId;
      if (currentClipId === clip.nodeId) {
        return i;
      }
    }
  }
  return null;
};

export const forEachAudioTrack = (
  sequence: Sequence,
  callback: (track: Track, index: number) => void,
  reverse?: boolean
) => {
  const num = sequence.audioTracks.numTracks;
  if (reverse) {
    for (let i = num - 1; i > -1; i--) {
      callback(sequence.audioTracks[i], i);
    }
  } else {
    for (let i = 0; i < num; i++) {
      callback(sequence.audioTracks[i], i);
    }
  }
};

export const forEachClip = (
  track: Track,
  callback: (clip: TrackItem, index: number) => void,
  reverse?: boolean
) => {
  const num = track.clips.numItems;
  if (reverse) {
    for (let i = num - 1; i > -1; i--) {
      callback(track.clips[i], i);
    }
  } else {
    for (let i = 0; i < num; i++) {
      callback(track.clips[i], i);
    }
  }
};
