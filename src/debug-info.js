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

const timeRangesString = (timeRanges) => {
  const timeRangesArray = timeRangesToArray(timeRanges);

  let string = timeRangesArray.reduce((acc, timeRange) => {
    acc += `${timeRange.start} => ${timeRange.end}, `;
    return acc;
  }, '');

  return string.substring(0, string.length - 2);
};

const timeRangesGapsString = (timeRanges) => {
  let lastEnd = timeRanges.end(0);
  let string = '';

  for (let i = 1; i < timeRanges.length; i++) {
    if (i > 1) {
      string += ', ';
    }

    string += `${lastEnd} => ${timeRanges.start(i)}`;

    lastEnd = timeRanges.end(i);
  }

  return string;
}

const toStringOfDepth = (array, depth) => {
  // two space indent
  return array.map((string) => '  '.repeat(depth) + string).join('\n');
};

const segmentInfoString = (segmentInfo, depth) => {
  if (!segmentInfo) {
    return 'null';
  }

  const {
    uri,
    mediaIndex,
    partIndex,
    isSyncRequest,
    startOfSegment,
    timestampOffset,
    timeline,
    duration,
    audioAppendStart,
    discontinuity
  } = segmentInfo;

  return toStringOfDepth([
    `uri: ${uri}`,
    `discontinuity: ${Boolean(discontinuity)}`,
    `mediaIndex: ${mediaIndex}`,
    `partIndex: ${partIndex}`,
    `isSyncRequest: ${isSyncRequest}`,
    `startOfSegment: ${startOfSegment}`,
    `timestampOffset: ${timestampOffset}`,
    `timeline: ${timeline}`,
    `duration: ${duration}`,
    `audioAppendStart: ${audioAppendStart}`
  ], 2);
};

const playlistString = (playlist) => {
  if (!playlist) {
    return 'null';
  }

  const {
    endList,
    excludeUntil,
    id,
    segments,
    targetDuration,
    timeline,
    mediaSequence
  } = playlist;

  return toStringOfDepth([
    `id: ${id}`,
    `endList: ${endList}`,
    `excludeUntil: ${excludeUntil}`,
    `numSegments: ${segments ? segments.length : 'n/a'}`,
    `mediaSequence: ${mediaSequence}`,
    `targetDuration: ${targetDuration}`,
    `timeline: ${timeline}`
  ], 2);
};

const segmentLoaderInfoString = (loader) => {
  const playlist = loader.playlist_;

  return toStringOfDepth([
    `state: ${loader.state_}`,
    `syncPoint: ${JSON.stringify(loader.syncPoint_)}`,
    `pendingSegment: ${segmentInfoString(loader.pendingSegment_)}`,
    `playlist: ${playlistString(playlist)}`,
    `audioDisabled: ${loader.audioDisabled_}`,
    `callQueue length: ${loader.callQueue_.length}`,
    `loadQueue length: ${loader.loadQueue_.length}`,
    `currentTimeline: ${loader.currentTimeline_}`,
    `ended: ${loader.ended_}`,
    `error: ${loader.error_}`,
    `fetchAtBuffer: ${loader.fetchAtBuffer_}`,
    `isPendingTimestampOffset: ${loader.isPendingTimestampOffset_}`,
    `mediaIndex: ${loader.mediaIndex}`,
    `partIndex: ${loader.partIndex}`
  ], 1);
};

export const log = (player) => {
  const mpc = player.tech(true).vhs.masterPlaylistController_;
  const mainSegmentLoader = mpc.mainSegmentLoader_;
  const audioSegmentLoader = mpc.audioSegmentLoader_;
  const sourceUpdater = mainSegmentLoader.sourceUpdater_;
  const videoBuffered = sourceUpdater.videoBuffer.buffered;
  const audioBuffered = sourceUpdater.audioBuffer.buffered;

  console.log(toStringOfDepth([
    `currentTime: ${player.currentTime()}`,
    `seekable: ${timeRangesString(player.seekable())}`,
    `video buffered: ${timeRangesString(videoBuffered)}`,
    `audio buffered: ${timeRangesString(audioBuffered)}`,
    `seeking: ${player.seeking()}`,
    '\n',
    `main segment loader: ${segmentLoaderInfoString(mainSegmentLoader)}`,
    '\n',
    `audio segment loader: ${segmentLoaderInfoString(audioSegmentLoader)}`,
    `video timestamp offset: ${sourceUpdater.videoBuffer.timestampOffset}`,
    `audio timestamp offset: ${sourceUpdater.audioBuffer.timestampOffset}`,
  ], 0));

  const mainSyncPoint = mainSegmentLoader.syncPoint_;
  const audioSyncPoint = audioSegmentLoader.syncPoint_;

  if (mainSyncPoint && mainSyncPoint.segmentIndex < -1) {
    console.warn(`main loader's sync point is a negative: ${JSON.stringify(mainSyncPoint)}`);
  }
  if (audioSyncPoint && audioSyncPoint.segmentIndex < -1) {
    console.warn(`audio loader's sync point is a negative: ${JSON.stringify(audioSyncPoint)}`);
  }

  if (audioBuffered.length > 1) {
    console.warn(`${audioBuffered.length - 1} gap(s) in the audio buffer: ${timeRangesGapsString(audioBuffered)}`);
  }
  if (videoBuffered.length > 1) {
    console.warn(`${videoBuffered.length - 1} gap(s) in the video buffer: ${timeRangesGapsString(videoBuffered)}`);
  }

  const mainPlaylistLoader = mpc.masterPlaylistLoader_;
  const mediaTypes = mpc.mediaTypes_;
  const audioPlaylistLoader = mediaTypes.AUDIO.activePlaylistLoader;

  const masterPlaylist = mainPlaylistLoader.master;
  const mediaPlaylist = mainPlaylistLoader.media_;
  const audioPlaylist = audioPlaylistLoader && audioPlaylistLoader.media_;

  console.log('master playlist', masterPlaylist);
  console.log('media playlist', mediaPlaylist);

  if (audioPlaylist) {
    console.log('audio playlist', audioPlaylist);
  }

  if (mediaPlaylist.excludeUntil) {
    console.warn('media playlist was excluded');
  }
  if (audioPlaylist && audioPlaylist.excludeUntil) {
    console.warn('audio playlist was excluded');
  }

  // TODO go through all playlists and look for potential issues
  // * mismatched discontinuity sequences
  // * no discontinuity sequence
  // * segment durations greater than target duration
};

export default {
  log
};
