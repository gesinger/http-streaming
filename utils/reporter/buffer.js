/**
 * Converts a TimeRanges object into an array representation
 * @param {TimeRanges} timeRanges
 * @returns {Array}
 */
const timeRangesToArray = (timeRanges) => {
  const timeRangesList = [];

  for (let i = 0; i < timeRanges.length; i++) {
    timeRangesList.push({
      start: timeRanges.start(i),
      end: timeRanges.end(i)
    });
  }

  return timeRangesList;
};

const timeRangesString = (timeRangesArray) => {
  let string = timeRangesArray.reduce((acc, timeRange) => {
    acc += `${timeRange.start} => ${timeRange.end}, `;
    return acc;
  }, '');

  return string.substring(0, string.length - 2);
};

export const getBufferedStrings = (player) => {
  const sourceBuffer =
    player.vhs.masterPlaylistController_.mainSegmentLoader_.sourceUpdater_.sourceBuffer_;
  const audioBuffered =
    sourceBuffer.audioBuffer_ ? sourceBuffer.audioBuffer_.buffered : null;
  const videoBuffered =
    sourceBuffer.videoBuffer_ ? sourceBuffer.videoBuffer_.buffered : null;

  return {
    audio: audioBuffered ? timeRangesString(timeRangesToArray(audioBuffered)) : null,
    video: videoBuffered ? timeRangesString(timeRangesToArray(videoBuffered)) : null
  };
};
