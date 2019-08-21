import videojs from 'video.js';
import window from 'global/window';
import config from './config';
import { simpleTypeFromSourceType } from './videojs-http-streaming';
import {
  parseCodecs,
  audioProfileFromDefault,
  mapLegacyAvcCodecs
} from './util/codecs.js';
import {
  resolveSegmentUris,
  parseManifest as parseHlsManifest
} from './playlist-loader';
import { parseMasterXml } from './dash-playlist-loader';
import { resolveUrl } from './resolve-url';

/**
 * Requests all of the urls provided, then calls back.
 *
 * @param {string[]} urls
 *        An array of urls
 * @param {function(Object, Object)} callback
 *        Callback function with error and object containing url to response text entries
 */
export const requestAll = (urls, callback) => {
  let requestsRemaining = urls.length;
  const responses = {};

  urls.forEach((url) => {
    const request = videojs.xhr(url, (err, response) => {
      if (requestsRemaining <= 0) {
        // this case should only be triggered if a previous requested erred
        return;
      }

      if (err) {
        callback({
          message: err.message,
          request
        });
        // clear remaining requests to break future callbacks
        requestsRemaining = 0;
        return;
      }

      if (!response || (
        response.statusCode !== 200 &&
        response.statusCode !== 206 &&
        response.statusCode !== 0)) {
        callback({
          message: 'Request failed',
          request
        });
        // clear remaining requests to break future callbacks
        requestsRemaining = 0;
        return;
      }

      requestsRemaining--;

      responses[url] = request.responseText;

      if (requestsRemaining === 0) {
        callback(null, responses);
      }
    });
  });
};

/**
 * Parses a manifest string into a VHS supported manifest object.
 *
 * @param {Object} config
 * @param {string} config.url
 *        URL to the manifest
 * @param {string} config.manifestString
 *        The manifest itself
 * @param {string} config..mimeType
 *        Mime type of the manifest
 *
 * @return {Object}
 *          A VHS manifest object
 */
export const parseManifest = ({ url, manifestString, mimeType }) => {
  const type = simpleTypeFromSourceType(mimeType);

  if (type === 'dash') {
    return parseMasterXml({
      masterXml: manifestString,
      srcUrl: url,
      clientOffset: 0
    });
  }

  const manifest = parseHlsManifest({
    manifestString,
    src: url
  });

  if (manifest.playlists) {
    manifest.playlists.forEach((playlist) => {
      playlist.resolvedUri = resolveUrl(url, playlist.uri);

      // For HLS playlists, media playlist segment lists are not yet available. However,
      // they shouldn't be requested yet, as that will lead to a lot of request time to
      // download all of the manifests, and only one from each master is ultimately
      // needed.
    });
  } else {
    manifest.attributes = {};
    manifest.resolvedUri = url;
    manifest.segments.forEach((segment) => {
      resolveSegmentUris(segment, manifest.resolvedUri);
    });
  }

  return manifest;
};

/**
 * Selects the closest matching video playlist to the provided vertical resolution from
 * an array of manifest objects.
 *
 * If the playlists do not include resolution information, the function will match based
 * on VHS' INITIAL_BANDWIDTH config property.
 *
 * If only some playlists include resolution information, the function will only consider
 * those with resolution information.
 *
 * @param {Object[][]} manifestsPlaylists
 *        An array of arrays of playlist objects
 * @param {number} targetVerticalResolution
 *        The vertical resolution to search for among playlists within each manifest
 *
 * @return {Object[]}
 *          An array of playlist objects, one from each of the provided manifests
 */
export const chooseVideoPlaylists = (manifestsPlaylists, targetVerticalResolution) => {
  return manifestsPlaylists.map((manifestPlaylists) => {
    if (manifestPlaylists.length === 1) {
      return manifestPlaylists[0];
    }

    return manifestPlaylists.reduce((acc, playlist) => {
      if (!acc) {
        return playlist;
      }

      if (playlist.attributes.RESOLUTION) {
        // If the selected playlist doesn't have resolution information, and this one
        // does, choose the playlist with resolution info.
        if (!acc.attributes.RESOLUTION) {
          return playlist;
        }

        if (Math.abs(playlist.attributes.RESOLUTION - targetVerticalResolution) <
            Math.abs(acc.attributes.RESOLUTION - targetVerticalResolution)) {
          return playlist;
        }
        return acc;
      }

      // If the selected playlist does have resolution information, and this one doesn't,
      // stick with the playlist with resolution info.
      if (acc.attributes.RESOLUTION) {
        return acc;
      }

      // BANDWIDTH attribute is required
      return Math.abs(playlist.attributes.BANDWIDTH - config.INITIAL_BANDWIDTH) <
        Math.abs(acc.attributes.BANDWIDTH - config.INITIAL_BANDWIDTH) ? playlist : acc;
    }, null);
  });
};

/**
 * Selects valid audio playlists for the provided video playlists, if a relevant audio
 * playlist exists.
 *
 * Note that the manifest objects and video playlists must be the same lengths and in the
 * same order.
 *
 * Only one audio playlist will be selected for each video playlist, and only if the audio
 * playlist has the DEFAULT attribute set to YES. This means that alternate audio is not
 * supported.
 *
 * @param {Object[]} manifestObjects
 *        An array of manifest objects (in the format used by VHS)
 * @param {Object[]} videoPlaylists
 *        An array of video playlists
 *
 * @return {Object[]}
 *          An array of audio playlist objects, one for each of the provided video
 *          playlists
 */
export const chooseAudioPlaylists = (manifestObjects, videoPlaylists) => {
  if (manifestObjects.length !== videoPlaylists.length) {
    throw new Error('Invalid number of video playlists for provided manifests');
  }

  const numExpectedPlaylists = manifestObjects.length;
  const audioPlaylists = [];

  for (let i = 0; i < numExpectedPlaylists; i++) {
    const manifestObject = manifestObjects[i];
    const videoPlaylist = videoPlaylists[i];

    if (!videoPlaylist.attributes.AUDIO ||
        !manifestObject.mediaGroups.AUDIO[videoPlaylist.attributes.AUDIO]) {
      // unable to find a matching audio object
      continue;
    }

    const manifestAudioPlaylists =
      manifestObject.mediaGroups.AUDIO[videoPlaylist.attributes.AUDIO];
    const audioPlaylistNames = Object.keys(manifestAudioPlaylists);

    for (let j = 0; j < audioPlaylistNames.length; j++) {
      const audioPlaylist = manifestAudioPlaylists[audioPlaylistNames[j]];

      if (audioPlaylist.default &&
          // some audio playlists are merely identifiers for muxed audio, don't include
          // those (note that resolvedUri should handle the HLS case, presence of
          // playlists the DASH case)
          (audioPlaylist.resolvedUri || audioPlaylist.playlists)) {
        audioPlaylists.push(audioPlaylist.playlists ?
          audioPlaylist.playlists[0] : audioPlaylist);
        break;
      }
    }
  }

  // This should cover multiple cases. For instance, if a manifest was video only or if
  // a manifest only had muxed default audio.
  if (audioPlaylists.length > 0 && audioPlaylists.length !== numExpectedPlaylists) {
    throw new Error('Did not find matching audio playlists for all video playlists');
  }

  return audioPlaylists;
};

/**
 * Joins the segments of each playlist together into one, with a discontinuity on the
 * start of each new section. Playlist will include basic properties necessary for VHS to
 * play back the playlist.
 *
 * @param {Object} config
 * @param {Object[]} config.playlists
 *        An array of playlist objects (in the format used by VHS)
 * @param {string} config.uriSuffix
 *        A suffix to use for the mocked URI of the combined playlist. This is needed when
 *        using demuxed audio, as if the generated URI matches a video playlist's
 *        generated URI, the rendition will be considered audio only by VHS.
 *
 * @return {Object}
 *          A single playlist containing the combined elements (and joined segments) of
 *          all of the provided playlists
 */
export const combinePlaylists = ({ playlists, uriSuffix = '' }) => {
  const combinedPlaylist = playlists.reduce((acc, playlist) => {
    const firstNewSegmentIndex = acc.segments.length;
    // need to clone because we're modifying the segment objects
    const clonedSegments = JSON.parse(JSON.stringify(playlist.segments));
    const concatenatedSegments = acc.segments.concat(clonedSegments);

    // don't add a discontinuity to the first segment
    if (acc.segments.length > 0) {
      concatenatedSegments[firstNewSegmentIndex].discontinuity = true;
    }

    acc.segments = concatenatedSegments;

    return acc;
  }, {
    segments: []
  });

  // As defined by the HLS spec, the BANDWIDTH attribute for a playlist is the peak
  // bandwidth in the stream, therefore, for a combined playlist, the max of the BANDWIDTH
  // values is used.
  //
  // Spec reference:
  // https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-4.3.4.2
  const maxBandwidth = playlists.reduce((acc, playlist) => {
    if (playlist.attributes &&
        playlist.attributes.BANDWIDTH &&
        (!acc || playlist.attributes.BANDWIDTH > acc)) {
      return playlist.attributes.BANDWIDTH;
    }
    return acc;
  }, null);
  // Because the codecs may be different (but compatible), use the first defined set, if
  // available.
  const codecs = playlists.reduce((acc, playlist) => {
    if (acc) {
      return acc;
    }
    return playlist.attributes ? playlist.attributes.CODECS : null;
  }, null);

  // Attributes used are a subset of
  // https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-4.3.4.2
  // depending on what is available in the playlists. For instance, BANDWIDTH and CODEC
  // attributes may only be available if the original sources were master playlists.
  //
  // Although there are other approaches that may be taken in determining the best set of
  // combined attributes (for instance, using the first playlist's attributes, or merging
  // all attributes in all playlists), using a known subset is safest, as it should
  // prevent any undefined behavior using attributes that may only be relevant for a
  // specific playlist.
  combinedPlaylist.attributes = {};
  if (maxBandwidth) {
    combinedPlaylist.attributes.BANDWIDTH = maxBandwidth;
  }
  if (codecs) {
    combinedPlaylist.attributes.CODECS = codecs;
  }
  combinedPlaylist.uri = `combined-playlist${uriSuffix}`;
  combinedPlaylist.resolvedUri = combinedPlaylist.uri;
  combinedPlaylist.playlistType = 'VOD';
  combinedPlaylist.targetDuration = playlists.reduce((acc, playlist) => {
    return acc > playlist.targetDuration ? acc : playlist.targetDuration;
  }, 0);
  combinedPlaylist.endList = true;
  combinedPlaylist.mediaSequence = 0;
  combinedPlaylist.discontinuitySequence = 0;
  combinedPlaylist.discontinuityStarts = [];

  let timeline = 0;

  for (let i = 0; i < combinedPlaylist.segments.length; i++) {
    const segment = combinedPlaylist.segments[i];

    if (segment.discontinuity) {
      combinedPlaylist.discontinuityStarts.push(i);
      timeline++;
    }
    segment.timeline = timeline;
  }

  return combinedPlaylist;
};

/**
 * Constructs a basic (only the essential information) master manifest given an array of
 * playlists.
 *
 * @param {Object} config
 * @param {Object} config.videoPlaylist
 *        A video playlist object (in the format used by VHS)
 * @param {Object} config.audioPlaylist
 *        An audio playlist object (in the format used by VHS)
 *
 * @return {Object}
 *          A master manifest object containing the playlists
 */
export const constructMasterManifest = ({ videoPlaylist, audioPlaylist }) => {
  // create copies of the playlists
  videoPlaylist = JSON.parse(JSON.stringify(videoPlaylist));
  if (audioPlaylist) {
    audioPlaylist = JSON.parse(JSON.stringify(audioPlaylist));
  }

  const videoPlaylists = [videoPlaylist];
  const audioPlaylists = audioPlaylist ? [audioPlaylist] : null;

  // VHS playlist arrays have properties with the playlist URI in addition to the standard
  // indices. This must be maintained for compatibility.
  videoPlaylists[videoPlaylist.uri] = videoPlaylist;

  if (audioPlaylists) {
    audioPlaylists[audioPlaylist.uri] = audioPlaylist;
  }

  const master = {
    mediaGroups: {
      'AUDIO': {},
      'VIDEO': {},
      'CLOSED-CAPTIONS': {},
      'SUBTITLES': {}
    },
    // placeholder URI, same as used in VHS when no master
    uri: window.location.href,
    playlists: videoPlaylists
  };

  if (audioPlaylist) {
    master.mediaGroups.AUDIO.audio = {
      default: {
        autoselect: true,
        default: true,
        // language is not included to avoid having to verify default languages between
        // concatenated playlists
        language: '',
        uri: 'combined-audio-playlists',
        playlists: audioPlaylists
      }
    };
    master.playlists[0].attributes.AUDIO = 'audio';
  }

  return master;
};

/**
 * Determines the video and audio codecs for each playlist and returns an object
 * associating each playlist's resolvedUri to its respective codecs.
 *
 * @param {Object} manifest
 *        A master or media manifest object (in the format used by VHS)
 *
 * @return {Object}
 *         Object associating playlists to their parsed codecs
 */
export const codecsForPlaylists = (manifest) => {
  // handle master and media playlists
  const playlists = manifest.playlists ? manifest.playlists : [manifest];

  return playlists.reduce((acc, playlist) => {
    // Technically, there should always be the CODECS attribute (and an attributes
    // object). But if they don't exist (e.g., in a media playlist that hasn't had the
    // attributes object added, since m3u8-parser doesn't add the attributes object to
    // media playlists), let calling functions decide what to do with playlists with
    // missing codec info.
    if (!playlist.attributes || !playlist.attributes.CODECS) {
      return acc;
    }

    const codecs = parseCodecs(playlist.attributes.CODECS);

    if (codecs.codecCount !== 2 && playlist.attributes.AUDIO) {
      const audioProfile = audioProfileFromDefault(manifest, playlist.attributes.AUDIO);

      if (audioProfile) {
        codecs.audioProfile = audioProfile;
        codecs.codecCount++;
      }
    }

    acc[playlist.resolvedUri] = codecs;

    return acc;
  }, {});
};

/**
 * Removes unsupported playlists from each provided VHS-formatted manifest object. The
 * checks to determine support include:
 *
 * - Presence of both audio and video in the playlists (audio only and video only are not
 *   currently supported), either as muxed or demuxed (via a default alt audio playlist)
 * - Video codecs supported by the browser's MSE (media source extensions) implementation
 *
 * Note that these checks do not guarantee a successful concatenation operation. Limited
 * availability of information (e.g., no codec info for media manifests), and a lack of
 * checks for compatibility between manifests, may result in an unsuccessful concatenation
 * operation. These are rarer cases though, and should be handled by the user.
 *
 * @param {Object[]} manifestObjects
 *        An array of (master or media) manifest objects (in the format used by VHS)
 *
 * @return {Object[][]}
 *          An array of arrays containing supported playlists from each manifest object
 */
export const removeUnsupportedPlaylists = (manifestObjects) => {
  const codecsForPlaylist = {};

  // Creating the codecsForPlaylist object separate from the main loop serves two
  // purposes. Primarily, it provides for simpler loops. But it also saves on processing
  // in the event that the same playlist is seen in multiple manifests (a valid case).
  manifestObjects.forEach((manifestObject) => {
    const playlistToCodecsMap = codecsForPlaylists(manifestObject);

    Object.keys(playlistToCodecsMap).forEach((playlistKey) => {
      codecsForPlaylist[playlistKey] = playlistToCodecsMap[playlistKey];
    });
  });

  // remove audio and video only playlists, as well as playlists with video codecs not
  // supported by the browser
  return manifestObjects.map((manifestObject) => {
    // handle master and media playlists
    const playlists =
      manifestObject.playlists ? manifestObject.playlists : [manifestObject];

    return playlists.filter((playlist) => {
      const codecs = codecsForPlaylist[playlist.resolvedUri];

      // Allow playlists with no specified codecs to pass through. Although the playlists
      // should have codec info, this prevents missing codec info from auto-failing.
      if (!codecs) {
        videojs.log.warn(
          `Missing codec info for playlist with URI: ${playlist.resolvedUri}`);
        return true;
      }

      if (codecs.codecCount !== 2) {
        return false;
      }

      if (window.MediaSource &&
          window.MediaSource.isTypeSupported &&
          !window.MediaSource.isTypeSupported(
            // ignore audio for the MSE support check to mirror VHS' check
            `video/mp4; codecs="${mapLegacyAvcCodecs(playlist.attributes.CODECS)}"`)) {
        return false;
      }

      return true;
    });
  });
};

/**
 * Requests and parses any unresolved playlists and calls back with the result.
 *
 * @param {Object} config
 * @param {Object[]} config.playlists
 *        An array of playlist objects
 * @param {string[]} config.mimeTypes
 *        An array of mime types (should be one-for-one with the playlists array)
 * @param {function(Object, Object)} config.callback
 *        Callback function with error and playlist URI to resolved playlist objects map
 */
export const resolvePlaylists = ({ playlists, mimeTypes, callback }) => {
  const playlistUris = playlists
    // if the segments are already resolved, don't need to request (DASH case)
    .filter((playlist) => !playlist.segments)
    .map((playlist) => playlist.resolvedUri);
  const preResolvedPlaylists = playlists.filter((playlist) => playlist.segments);
  const origPlaylistsToParsed = {};

  preResolvedPlaylists.forEach((playlist) => {
    origPlaylistsToParsed[playlist.resolvedUri] = playlist;
  });

  if (!playlistUris.length) {
    // all playlists pre-resolved
    callback(null, origPlaylistsToParsed);
    return;
  }

  const uriToPlaylistsMap = {};
  const uriToMimeTypeMap = {};

  for (let i = 0; i < playlists.length; i++) {
    const playlist = playlists[i];

    // it's possible for the caller to concat two of the same video together
    if (!uriToPlaylistsMap[playlist.resolvedUri]) {
      uriToPlaylistsMap[playlist.resolvedUri] = [];
    }
    uriToPlaylistsMap[playlist.resolvedUri].push(playlist);
    uriToMimeTypeMap[playlist.resolvedUri] = mimeTypes[i].mimeType;
  }

  requestAll(playlistUris, (err, responses) => {
    if (err) {
      callback(err);
      return;
    }

    for (let i = 0; i < playlistUris.length; i++) {
      const uri = playlistUris[i];
      const origPlaylists = uriToPlaylistsMap[uri];
      const playlistString = responses[uri];
      const mimeType = uriToMimeTypeMap[uri];
      const playlist = parseManifest({
        url: uri,
        manifestString: playlistString,
        mimeType
      });

      origPlaylists.forEach((origPlaylist) => {
        origPlaylistsToParsed[origPlaylist.resolvedUri] = playlist;
      });
    }

    callback(null, origPlaylistsToParsed);
  });
};

/**
 * Returns a single rendition VHS formatted master playlist object given a list of
 * manifest strings, their URLs, their mime types, and a target vertical resolution.
 *
 * As of now, only DASH and HLS are supported.
 *
 * This function will select the closest rendition (absolute value difference) to the
 * target vertical resolution. If resolution information is not available as part of the
 * manifest, then it will fall back to the INITIAL_BANDWIDTH config value from VHS.
 *
 * @param {Object} config
 * @param {Object[]} config.manifests
 * @param {string} config.manifests[].url
 *        URL to a manifest
 * @param {string} config.manifests[].manifestString
 *        The manifest itself
 * @param {string} config.manifests[].mimeType
 *        Mime type of the manifest
 * @param {number} config.targetVerticalResolution
 *        The vertical resolution to search for among playlists within each manifest
 * @param {function(Object, Object)} config.callback
 *        Callback function with error and concatenated manifest parameters
 *
 * @return {Object} The concatenated manifest object (in the format used by VHS)
 *
 * @throws Will throw if there are incompatibility errors between the playlists
 */
const concatenateManifests = ({ manifests, targetVerticalResolution, callback }) => {
  const manifestObjects = manifests.map((manifest) => parseManifest({
    url: manifest.url,
    manifestString: manifest.response,
    mimeType: manifest.mimeType
  }));

  const supportedPlaylists = removeUnsupportedPlaylists(manifestObjects);

  supportedPlaylists.forEach((playlists) => {
    if (playlists.length === 0) {
      throw new Error('Did not find a supported playlist for each manifest');
    }
  });

  // Video renditions are assumed to be codec compatible, but may have different
  // resolutions. Choose the video rendition closest to the target resolution from each
  // manifest.
  const videoPlaylists = chooseVideoPlaylists(
    supportedPlaylists,
    targetVerticalResolution
  );

  // A rendition with demuxed audio can't be concatenated with a rendition with muxed
  // audio. VHS assumes (based on how most media streaming formats work) that a rendition
  // will not change how it's playing back audio (whether from muxed as part of the
  // rendition's video segments, or demuxed as segments in an alternate audio playlist),
  // except due to user interaction (e.g., clicking an alternate audio playlist in the
  // UI). Therefore, a rendition must maintain a consistent playback scheme (as either
  // demuxed or muxed) throughout the its entire stream.
  const audioPlaylists = chooseAudioPlaylists(manifestObjects, videoPlaylists);
  const allPlaylists = videoPlaylists.concat(audioPlaylists);
  // To correctly set the mime types for all playlists, we have to use the mime types
  // provided by the manifests for the associated playlists. Since  videoPlaylists and
  // audioPlaylists are associated 1:1, and the manifests to videoPlaylists are 1:1, the
  // manifest mime types may be reused for both.
  const mimeTypes = manifests.map((manifest) => manifest.mimeType);

  for (let i = 0; i < audioPlaylists.length; i++) {
    mimeTypes.push(mimeTypes[i]);
  }

  resolvePlaylists({
    playlists: allPlaylists,
    mimeTypes,
    callback: (err, resolvedPlaylistsMap) => {
      if (err) {
        callback(err);
        return;
      }

      allPlaylists.forEach((playlist) => {
        playlist.segments = resolvedPlaylistsMap[playlist.resolvedUri].segments;
      });

      const combinedVideoPlaylist = combinePlaylists({ playlists: videoPlaylists });
      const combinedAudioPlaylist = audioPlaylists.length ? combinePlaylists({
        playlists: audioPlaylists,
        uriSuffix: '-audio'
      }) : null;

      callback(null, constructMasterManifest({
        videoPlaylist: combinedVideoPlaylist,
        audioPlaylist: combinedAudioPlaylist
      }));
    }
  });
};

/**
 * Calls back with a single rendition VHS formatted master playlist object given a list of
 * URLs and their mime types as well as a target vertical resolution.
 *
 * As of now, only DASH and HLS are supported.
 *
 * This function will select the closest rendition (absolute value difference) to the
 * target vertical resolution. If resolution information is not available as part of the
 * manifest, then it will fall back to the INITIAL_BANDWIDTH config value from VHS.
 *
 * @param {Object} config
 * @param {Object[]} config.manifests
 * @param {string} config.manifests[].url
 *        URL to a manifest
 * @param {string} config.manifests[].mimeType
 *        Mime type of the manifest
 * @param {number} config.targetVerticalResolution
 *        The vertical resolution to search for among playlists within each manifest
 * @param {function(Object, Object)} config.callback
 *        Callback function with error and concatenated manifest parameters
 */
export const concatenateVideos = ({ manifests, targetVerticalResolution, callback }) => {
  if (!manifests || !manifests.length) {
    callback({ message: 'No sources provided' });
    return;
  }

  for (let i = 0; i < manifests.length; i++) {
    // The requirement for every manifest needing a URL may be reconsidered in the future
    // to accept pre-parsed manifest objects.
    if (!manifests[i].url) {
      callback({ message: 'All manifests must include a URL' });
      return;
    }

    if (!manifests[i].mimeType) {
      callback({ message: 'All manifests must include a mime type' });
      return;
    }
  }

  const urls = manifests.map((manifestObject) => manifestObject.url);

  requestAll(urls, (err, responses) => {
    if (err) {
      callback(err);
      return;
    }

    const orderedManifests = manifests.map((manifestObject) => {
      return {
        url: manifestObject.url,
        response: responses[manifestObject.url],
        mimeType: manifestObject.mimeType
      };
    });

    try {
      concatenateManifests({
        manifests: orderedManifests,
        targetVerticalResolution,
        callback
      });
    } catch (e) {
      callback(e);
    }
  });
};
