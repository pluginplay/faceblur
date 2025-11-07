// QE DOM Methods

export const qeGetClipAt = (track: Track, index: number) => {
  let curClipIndex = -1;
  for (let i = 0; i < track.numItems; i++) {
    const item = track.getItemAt(i);
    //@ts-ignore
    const type = item.type as "Empty" | "Clip";
    if (type === "Clip") {
      curClipIndex++;
      if (curClipIndex === index) {
        return item;
      }
    }
  }
};

// QE DOM doesn't understand some format, so this function so we convert to compatible ones
export const qeSafeTimeDisplayFormat = (timeDisplayFormat: number) => {
  const conversionTable: {
    [key: number]: number;
  } = {
    998: 110, // 23.89 > 23.976
  };
  const match = conversionTable[timeDisplayFormat];
  return match ? match : timeDisplayFormat;
};

/**
 * Gets a QE clip by name
 */
export function getQEClipWithName(
  trackItem: TrackItem,
  trackIndex: number,
  type: "video" | "audio"
): QETrackItem | null {
  try {
    app.enableQE();
    const qeSequence = qe?.project.getActiveSequence();
    if (!qeSequence) {
      throw new Error("Could not find qeSequence");
    }

    const startTime = trackItem.start.seconds;
    const endTime = trackItem.end.seconds;
    const timeBuffer = 0.01;
    const track =
      type === "video"
        ? qeSequence.getVideoTrackAt(trackIndex)
        : qeSequence.getAudioTrackAt(trackIndex);

    for (let j = 0; j < track.numItems; j++) {
      const clip = track.getItemAt(j);
      if (clip.type.toString() === "Empty") continue;

      // Check both start and end time to find the best match
      if (clip.name.toString() === trackItem.name) {
        if (
          startTime === undefined ||
          startTime === null ||
          endTime === undefined ||
          endTime === null
        )
          continue;
        const clipStart: number = clip.start.secs;
        const clipEnd: number = clip.end.secs;

        const startMatches = Math.abs(clipStart - startTime) < timeBuffer;
        const endMatches = Math.abs(clipEnd - endTime) < timeBuffer;

        // Require both start and end time to match within the buffer
        if (startMatches && endMatches) {
          return clip;
        }
      }
    }

    return null;
  } catch (e: any) {
    throw new Error("Could not get QEClip with name: " + e.message);
  }
}
