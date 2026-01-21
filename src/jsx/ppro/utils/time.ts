// Time Helpers

export const addTime = (a: Time, b: Time) => {
  const ticks = parseInt(a.ticks) + parseInt(b.ticks);
  let time = new Time();
  time.ticks = ticks.toString();
  return time;
};

export const subtractTime = (a: Time, b: Time) => {
  const ticks = parseInt(a.ticks) - parseInt(b.ticks);
  let time = new Time();
  time.ticks = ticks.toString();
  return time;
};

export const multiplyTime = (a: Time, factor: number) => {
  const ticks = parseInt(a.ticks) * factor;
  let time = new Time();
  time.ticks = ticks.toString();
  return time;
};

export const divideTime = (a: Time, factor: number) => {
  const ticks = parseInt(a.ticks) / factor;
  let time = new Time();
  time.ticks = ticks.toString();
  return time;
};

export const ticksToTime = (ticks: string) => {
  let time = new Time();
  time.ticks = ticks;
  return time;
};

const fpsTicksTable: { [key: number]: number } = {
  23.976: 10594584000,
  24: 10584000000,
  25: 10160640000,
  29.97: 8475667200,
  30: 8467200000,
  50: 5080320000,
  59.94: 4237833600,
  60: 4233600000,
};

// export const getItemFrameRate = (item: ProjectItem) => {
//   if (item.isSequence()) {
//     for (let i = 0; i < app.project.sequences.numSequences; i++) {
//       const seq = app.project.sequences[i];
//       if (seq.projectItem.nodeId === item.nodeId) {
//         return 1 / seq.getSettings().videoFrameRate.seconds;
//       }
//     }
//   } else {
//     const key = "Column.Intrinsic.MediaTimebase";
//     const mediaTimeBase = getPrMetadata(item, [key]);
//     return parseFloat(mediaTimeBase[key]);
//   }
// };

// export const getItemDuration = (item: ProjectItem) => {
//   const key = "Column.Intrinsic.MediaDuration";
//   const res = getPrMetadata(item, [key]);
//   return parseFloat(res[key]);
// };

export const getFPSTime = (fps: number) => {
  let time = new Time();
  let ticks = fpsTicksTable[fps];
  if (!ticks) return false;
  time.ticks = ticks.toString();
  return time;
};

export const ticksToFrames = (ticks: string, timebase: string) => {
  const timebaseNum = parseInt(timebase);
  return parseInt(ticks) / timebaseNum;
};

export const timecodeToSeconds = (timecode: string, frameRate: number) => {
  const segments = timecode.split(":");
  const hours = parseInt(segments[0]);
  const minutes = parseInt(segments[1]);
  const seconds = parseInt(segments[2]);
  const frames = parseInt(segments[3]);
  return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
};

export const timecodeToTicks = (timecode: string, frameRate: number) => {
  const segments = timecode.split(":");
  const hours = parseInt(segments[0]);
  const minutes = parseInt(segments[1]);
  const seconds = parseInt(segments[2]);
  const frames = parseInt(segments[3]);
  const totalSeconds =
    hours * 3600 + minutes * 60 + seconds + frames / frameRate;
  const time = new Time();
  time.seconds = totalSeconds;

  return time.ticks;
};

export const secondsToTime = (seconds: number) => {
  let time = new Time();
  time.seconds = seconds;
  return time;
};

export const getTimecode = (
  t: Time,
  frameRateTime: Time,
  videoDisplayFormat: number
) => {
  const timecode = t.getFormatted(frameRateTime, videoDisplayFormat) as string;
  return timecode;
};

export const getTimecodeFromSequence = (t: Time, sequence: Sequence) => {
  return getTimecode(
    t,
    sequence.getSettings().videoFrameRate,
    sequence.getSettings().videoDisplayFormat
  );
};
