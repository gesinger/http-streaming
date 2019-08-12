import videojs from 'video.js';
import QUnit from 'qunit';
import sinon from 'sinon';
import window from 'global/window';
import {
  requestAll,
  parseManifest,
  concatenateVideos,
  chooseVideoPlaylists,
  chooseAudioPlaylists
} from '../src/concatenate-videos';
import { useFakeEnvironment } from './test-helpers';
import config from '../src/config';

const STANDARD_HEADERS = { 'Content-Type': 'text/plain' };

const hlsMasterPlaylist = ({
  numPlaylists = 1,
  playlistPrefix = 'playlist',
  includeDemuxedAudio = false
}) => {
  const playlists = [];

  for (let i = 0; i < numPlaylists; i++) {
    const playlistPath = `${playlistPrefix}${i}.m3u8`;
    const audioAttribute = includeDemuxedAudio ? ',AUDIO="audio"' : '';

    playlists.push(`
      #EXT-X-STREAM-INF:BANDWIDTH=${i}${audioAttribute}
      ${playlistPath}
    `);
  }

  const audioGroup = includeDemuxedAudio ?
    '#EXT-X-MEDIA:TYPE=AUDIO' +
      ',GROUP-ID="audio",LANGUAGE="en",NAME="English"' +
      ',AUTOSELECT=YES,DEFAULT=YES' +
      `,URI="${playlistPrefix}-audio.m3u8"` :
    '';

  return `
    #EXTM3U
    #EXT-X-VERSION:3
    ${audioGroup}

    ${playlists.join('\n')}
  `;
};

const hlsMediaPlaylist = ({
  numSegments = 1,
  segmentPrefix = '',
  segmentDuration = 10,
  targetDuration = 10
}) => {
  const segments = [];

  for (let i = 0; i < numSegments; i++) {
    const segmentPath = `${segmentPrefix}${i}.ts`;

    segments.push(`
      #EXTINF:${segmentDuration}
      ${segmentPath}
    `);
  }

  return `
    #EXTM3U
    #EXT-X-VERSION:3
    #EXT-X-PLAYLIST-TYPE:VOD
    #EXT-X-MEDIA-SEQUENCE:0
    #EXT-X-TARGETDURATION:${targetDuration}
    ${segments.join('\n')}
    #EXT-X-ENDLIST
  `;
};

const dashPlaylist = ({
  numSegments = 1,
  segmentDuration = 10
}) => {
  return `<?xml version="1.0"?>
    <MPD
      xmlns="urn:mpeg:dash:schema:mpd:2011"
      profiles="urn:mpeg:dash:profile:full:2011"
      minBufferTime="1.5"
      mediaPresentationDuration="PT${numSegments * segmentDuration}S">
      <Period>
        <BaseURL>main/</BaseURL>
        <AdaptationSet mimeType="video/mp4">
          <BaseURL>video/</BaseURL>
          <Representation
            id="1080p"
            bandwidth="6800000"
            width="1920"
            height="1080"
            codecs="avc1.420015">
            <BaseURL>1080/</BaseURL>
            <SegmentTemplate
              media="$RepresentationID$-segment-$Number$.mp4"
              initialization="$RepresentationID$-init.mp4"
              duration="${segmentDuration}"
              timescale="1"
              startNumber="0" />
          </Representation>
          <Representation
            id="720p"
            bandwidth="2400000"
            width="1280"
            height="720"
            codecs="avc1.420015">
            <BaseURL>720/</BaseURL>
            <SegmentTemplate
              media="$RepresentationID$-segment-$Number$.mp4"
              initialization="$RepresentationID$-init.mp4"
              duration="${segmentDuration}"
              timescale="1"
              startNumber="0" />
          </Representation>
        </AdaptationSet>
        <AdaptationSet mimeType="audio/mp4">
          <BaseURL>audio/</BaseURL>
          <Representation id="audio" bandwidth="128000" codecs="mp4a.40.2">
            <BaseURL>720/</BaseURL>
            <SegmentTemplate
              media="segment-$Number$.mp4"
              initialization="$RepresentationID$-init.mp4"
              duration="${segmentDuration}"
              timescale="1"
              startNumber="0" />
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>`;
};

const concatenateVideosPromise = ({ manifests, targetVerticalResolution }) => {
  return new Promise((accept, reject) => {
    concatenateVideos({
      manifests,
      targetVerticalResolution,
      callback: (err, sourceObject) => {
        if (err) {
          reject(err);
          return;
        }

        accept(sourceObject);
      }
    });
  });
};

QUnit.module('concatenate-videos', {
  beforeEach() {
    this.realXhr = videojs.xhr.XMLHttpRequest;
    this.server = sinon.fakeServer.create();
    videojs.xhr.XMLHttpRequest = this.server.xhr;
    this.server.autoRespond = true;
  },

  afterEach() {
    this.server.restore();
    videojs.xhr.XMLHttpRequest = this.realXhr;
  }
});

QUnit.test('concatenates multiple videos into one', function(assert) {
  const done = assert.async();
  const manifests = [{
    url: '/manifest1.m3u8',
    mimeType: 'application/vnd.apple.mpegurl'
  }, {
    url: '/manifest2.m3u8',
    mimeType: 'application/x-mpegurl'
  }];

  this.server.respondWith(
    'GET',
    manifests[0].url,
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ numSegments: 1 })]
  );
  this.server.respondWith(
    'GET',
    manifests[1].url,
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ segmentPrefix: 'm2s', numSegments: 1 })]
  );

  concatenateVideosPromise({
    manifests,
    targetVideoResolution: 720
  }).then((sourceObject) => {
    assert.deepEqual(
      sourceObject,
      {
        uri: window.location.href,
        mediaGroups: {
          'AUDIO': {},
          'VIDEO': {},
          'CLOSED-CAPTIONS': {},
          'SUBTITLES': {}
        },
        playlists: [{
          attributes: {},
          uri: 'combined-playlist',
          resolvedUri: 'combined-playlist',
          endList: true,
          mediaSequence: 0,
          discontinuitySequence: 0,
          playlistType: 'VOD',
          targetDuration: 10,
          discontinuityStarts: [1],
          segments: [{
            duration: 10,
            timeline: 0,
            uri: '0.ts',
            resolvedUri: `${window.location.origin}/0.ts`
          }, {
            duration: 10,
            discontinuity: true,
            timeline: 1,
            uri: 'm2s0.ts',
            resolvedUri: `${window.location.origin}/m2s0.ts`
          }]
        }]
      },
      'created concatenated video object'
    );
    done();
  });
});

QUnit.test('concatenates HLS and DASH sources together', function(assert) {
  const done = assert.async();
  const manifests = [{
    url: '/manifest1.m3u8',
    mimeType: 'application/vnd.apple.mpegurl'
  }, {
    url: '/dash.mpd',
    mimeType: 'application/dash+xml'
  }];

  this.server.respondWith(
    'GET',
    manifests[0].url,
    [
      200,
      STANDARD_HEADERS,
      hlsMasterPlaylist({
        includeDemuxedAudio: true
      })
    ]
  );
  this.server.respondWith(
    'GET',
    manifests[0].url,
    [200, STANDARD_HEADERS, hlsMasterPlaylist({ includeDemuxedAudio: true })]
  );
  this.server.respondWith(
    'GET',
    '/playlist0.m3u8',
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ numSegments: 1 })]
  );
  this.server.respondWith(
    'GET',
    '/playlist-audio.m3u8',
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ numSegments: 1, segmentPrefix: 'audio' })]
  );
  this.server.respondWith(
    'GET',
    manifests[1].url,
    [200, STANDARD_HEADERS, dashPlaylist({ numSegments: 1 })]
  );

  const expectedAudioPlaylist = {
    attributes: {},
    discontinuitySequence: 0,
    discontinuityStarts: [1],
    endList: true,
    mediaSequence: 0,
    playlistType: 'VOD',
    uri: 'combined-playlist-audio',
    resolvedUri: 'combined-playlist-audio',
    targetDuration: 10,
    segments: [{
      duration: 10,
      resolvedUri: `${window.location.origin}/audio0.ts`,
      timeline: 0,
      uri: 'audio0.ts'
    }, {
      discontinuity: true,
      duration: 10,
      map: {
        uri: 'audio-init.mp4',
        resolvedUri: `${window.location.origin}/main/audio/720/audio-init.mp4`
      },
      number: 0,
      timeline: 1,
      uri: 'segment-0.mp4',
      resolvedUri: `${window.location.origin}/main/audio/720/segment-0.mp4`
    }]
  };
  const expectedAudioPlaylists = [expectedAudioPlaylist];

  expectedAudioPlaylists['combined-playlist-audio'] = expectedAudioPlaylist;

  concatenateVideosPromise({
    manifests,
    targetVideoResolution: 720
  }).then((sourceObject) => {
    assert.deepEqual(
      sourceObject,
      {
        uri: window.location.href,
        mediaGroups: {
          'AUDIO': {
            audio: {
              default: {
                autoselect: true,
                default: true,
                language: '',
                playlists: expectedAudioPlaylists,
                uri: 'combined-audio-playlists'
              }
            }
          },
          'VIDEO': {},
          'CLOSED-CAPTIONS': {},
          'SUBTITLES': {}
        },
        playlists: [{
          attributes: {
            AUDIO: 'audio',
            // TODO?
            BANDWIDTH: 0
          },
          uri: 'combined-playlist',
          resolvedUri: 'combined-playlist',
          endList: true,
          mediaSequence: 0,
          discontinuitySequence: 0,
          playlistType: 'VOD',
          targetDuration: 10,
          discontinuityStarts: [1],
          segments: [{
            duration: 10,
            timeline: 0,
            uri: '0.ts',
            resolvedUri: `${window.location.origin}/0.ts`
          }, {
            duration: 10,
            discontinuity: true,
            timeline: 1,
            number: 0,
            map: {
              uri: '1080p-init.mp4',
              resolvedUri: `${window.location.origin}/main/video/1080/1080p-init.mp4`
            },
            uri: '1080p-segment-0.mp4',
            resolvedUri: `${window.location.origin}/main/video/1080/1080p-segment-0.mp4`
          }]
        }]
      },
      'created concatenated video object'
    );
    done();
  });
});

QUnit.test('calls back with an error when no manifests passed in', function(assert) {
  const done = assert.async();

  concatenateVideosPromise({
    manifests: [],
    targetVideoResolution: 720
  }).catch((error) => {
    assert.equal(
      error.message,
      'No sources provided',
      'called back with correct error message'
    );
    done();
  });
});

QUnit.test('calls back with error when a manifest doesn\'t include a URL', function(assert) {
  const done = assert.async();

  concatenateVideosPromise({
    manifests: [{
      url: '/manifest1.m3u8',
      mimeType: 'application/vnd.apple.mpegurl'
    }, {
      mimeType: 'application/x-mpegurl'
    }],
    targetVideoResolution: 720
  }).catch((error) => {
    assert.equal(
      error.message,
      'All manifests must include a URL',
      'called back with correct error message'
    );
    done();
  });
});

QUnit.test('calls back with an error when a manifest doesn\'t include a mime type', function(assert) {
  const done = assert.async();

  concatenateVideosPromise({
    manifests: [{
      url: '/manifest1.m3u8',
      mimeType: 'application/vnd.apple.mpegurl'
    }, {
      url: '/manifest2.m3u8'
    }],
    targetVideoResolution: 720
  }).catch((error) => {
    assert.equal(
      error.message,
      'All manifests must include a mime type',
      'called back with correct error message'
    );
    done();
  });
});

QUnit.test('calls back with an error on request failure', function(assert) {
  const done = assert.async();
  const manifests = [{
    url: '/manifest1.m3u8',
    mimeType: 'application/vnd.apple.mpegurl'
  }, {
    url: '/manifest2.m3u8',
    mimeType: 'application/x-mpegurl'
  }];

  this.server.respondWith(
    'GET',
    manifests[0].url,
    [200, STANDARD_HEADERS, hlsMediaPlaylist({ numSegments: 1 })]
  );
  this.server.respondWith('GET', manifests[1].url, [500, STANDARD_HEADERS, '']);

  concatenateVideosPromise({
    manifests,
    targetVideoResolution: 720
  }).catch((error) => {
    assert.equal(
      error.message,
      'Request failed',
      'called back with correct error message'
    );
    assert.equal(error.request.status, 500, 'called back with correct error status');
    done();
  });
});

// TODO
// Includes codec info
// Calls back with an error when incompatible playlists
// Falls back to config.INITIAL_BANDWIDTH when no resolution information

QUnit.module('requestAll', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
  },

  afterEach() {
    this.env.restore();
  }
});

QUnit.test('waits for all requests to finish before calling back', function(assert) {
  // fake environment adds an assertion
  assert.expect(7);
  const url1 = 'url1';
  const url2 = 'url2';
  const url3 = 'url3';
  const response1 = 'response1';
  const response2 = 'response2';
  const response3 = 'response3';

  requestAll([url1, url2, url3], (err, responses) => {
    assert.notOk(err);
    assert.equal(responses[url1], response1, 'correct response');
    assert.equal(responses[url2], response2, 'correct response');
    assert.equal(responses[url3], response3, 'correct response');
  });

  assert.equal(this.requests.length, 3, 'three requests');
  this.requests.shift().respond(200, null, response1);
  this.requests.shift().respond(200, null, response2);
  this.requests.shift().respond(200, null, response3);
});

QUnit.test('calls back immediately on error', function(assert) {
  // fake environment adds an assertion
  assert.expect(5);

  let request;

  requestAll(['url1', 'url2'], (err, responses) => {
    assert.deepEqual(
      err,
      { message: 'Request failed', request },
      'calls back with error'
    );
    assert.notOk(responses, 'no responses object provided');
  });

  assert.equal(this.requests.length, 2, 'two requests');
  request = this.requests.shift();
  request.respond(500, null, 'error');
});

QUnit.test('does not call back on success after an error', function(assert) {
  // fake environment adds an assertion
  assert.expect(6);

  let callbackCount = 0;
  let request;

  requestAll(['url1', 'url2'], (err, responses) => {
    callbackCount++;
    assert.deepEqual(
      err,
      { message: 'Request failed', request },
      'calls back with error'
    );
    assert.notOk(responses, 'no responses object provided');
  });

  assert.equal(this.requests.length, 2, 'two requests');
  request = this.requests.shift();
  request.respond(500, null, 'error');
  this.requests.shift().respond(200, null, 'success');
  assert.equal(callbackCount, 1, 'only one callback');
});

QUnit.test('does not call back on error after an error', function(assert) {
  // fake environment adds an assertion
  assert.expect(6);

  let callbackCount = 0;
  let request;

  requestAll(['url1', 'url2'], (err, responses) => {
    callbackCount++;
    assert.deepEqual(
      err,
      { message: 'Request failed', request },
      'calls back with error'
    );
    assert.notOk(responses, 'no responses object provided');
  });

  assert.equal(this.requests.length, 2, 'two requests');
  request = this.requests.shift();
  request.respond(500, null, 'error');
  this.requests.shift().respond(500, null, 'error');
  assert.equal(callbackCount, 1, 'only one callback');
});

QUnit.module('parseManifest');

QUnit.test('adds resolvedUri to media playlists of an HLS master', function(assert) {
  const manifestObject = parseManifest({
    url: 'http://test.com',
    manifestString: hlsMasterPlaylist({
      numPlaylists: 2
    }),
    mimeType: 'application/x-mpegURL'
  });

  assert.equal(manifestObject.playlists.length, 2, 'two playlists');
  assert.equal(
    manifestObject.playlists[0].resolvedUri,
    'http://test.com/playlist0.m3u8',
    'added resolvedUri to first media playlist'
  );
  assert.equal(
    manifestObject.playlists[1].resolvedUri,
    'http://test.com/playlist1.m3u8',
    'added resolvedUri to second media playlist'
  );
});

QUnit.test('adds resolvedUri to an HLS media manifest', function(assert) {
  const manifestObject = parseManifest({
    url: 'http://test.com',
    manifestString: hlsMediaPlaylist({}),
    mimeType: 'application/x-mpegURL'
  });

  assert.equal(
    manifestObject.resolvedUri,
    'http://test.com',
    'added resolvedUri property to manifest object'
  );
});

QUnit.test('adds resolvedUri to playlists of a DASH manifest', function(assert) {
  const manifestObject = parseManifest({
    url: 'http://test.com',
    manifestString: dashPlaylist({}),
    mimeType: 'application/dash+xml'
  });

  assert.equal(manifestObject.playlists.length, 2, 'two playlists');
  assert.equal(
    manifestObject.playlists[0].resolvedUri,
    'http://test.com/placeholder-uri-0',
    'added resolvedUri to playlist'
  );
  assert.equal(
    manifestObject.playlists[1].resolvedUri,
    'http://test.com/placeholder-uri-1',
    'added resolvedUri to playlist'
  );
});

QUnit.test('HLS master manifest media segment lists are not resolved', function(assert) {
  const manifestObject = parseManifest({
    url: 'http://test.com',
    manifestString: hlsMasterPlaylist({
      numPlaylists: 2
    }),
    mimeType: 'application/x-mpegURL'
  });

  assert.equal(manifestObject.playlists.length, 2, 'two playlists');
  assert.notOk(manifestObject.playlists[0].segments, 'did not resolve segment list');
  assert.notOk(manifestObject.playlists[1].segments, 'did not resolve segment list');
});

QUnit.test('HLS media manifest segment list is resolved', function(assert) {
  const manifestObject = parseManifest({
    url: 'http://test.com',
    manifestString: hlsMediaPlaylist({}),
    mimeType: 'application/x-mpegURL'
  });

  assert.notOk(manifestObject.playlists, 'no playlists');
  assert.equal(
    manifestObject.segments.length,
    1,
    'resolved segment list'
  );
});

QUnit.test('DASH manifest segment lists are resolved', function(assert) {
  const manifestObject = parseManifest({
    url: 'http://test.com',
    manifestString: dashPlaylist({}),
    mimeType: 'application/dash+xml'
  });

  assert.equal(manifestObject.playlists.length, 2, 'two playlists');
  assert.equal(
    manifestObject.playlists[0].segments.length,
    1,
    'resolved segment list'
  );
  assert.equal(
    manifestObject.playlists[1].segments.length,
    1,
    'resolved segment list'
  );
});

QUnit.module('chooseVideoPlaylists');

QUnit.test('chooses video playlists by target vertical resolution', function(assert) {
  const playlist1 = { attributes: { RESOLUTION: 1 } };
  const playlist2 = { attributes: { RESOLUTION: 719 } };
  const playlist3 = { attributes: { RESOLUTION: 722 } };
  const manifestObject1 = { playlists: [playlist1, playlist2, playlist3] };
  const manifestObject2 = { playlists: [playlist1, playlist2, playlist3] };
  const manifestObject3 = { playlists: [playlist1, playlist2, playlist3] };

  assert.deepEqual(
    chooseVideoPlaylists([manifestObject1, manifestObject2, manifestObject3], 720),
    [playlist2, playlist2, playlist2],
    'chose closest video playlists'
  );
});

QUnit.test('when no resolution, chooses video playlists by bandwidth', function(assert) {
  const playlist1 = { attributes: { BANDWIDTH: config.INITIAL_BANDWIDTH - 3 } };
  const playlist2 = { attributes: { BANDWIDTH: config.INITIAL_BANDWIDTH - 2 } };
  const playlist3 = { attributes: { BANDWIDTH: config.INITIAL_BANDWIDTH + 1 } };
  const manifestObject1 = { playlists: [playlist1, playlist2, playlist3] };
  const manifestObject2 = { playlists: [playlist1, playlist2, playlist3] };
  const manifestObject3 = { playlists: [playlist1, playlist2, playlist3] };

  assert.deepEqual(
    chooseVideoPlaylists([manifestObject1, manifestObject2, manifestObject3], 720),
    [playlist3, playlist3, playlist3],
    'chose closest video playlists'
  );
});

QUnit.test(
'when only partial resolution info, selects video playlist with info',
function(assert) {
  const playlist1 = { attributes: { BANDWIDTH: config.INITIAL_BANDWIDTH - 3 } };
  const playlist2 = {
    attributes: {
      RESOLUTION: 1,
      BANDWIDTH: config.INITIAL_BANDWIDTH - 2
    }
  };
  const playlist3 = { attributes: { BANDWIDTH: config.INITIAL_BANDWIDTH + 1 } };
  const manifestObject1 = { playlists: [playlist3, playlist2, playlist1] };
  const manifestObject2 = { playlists: [playlist2, playlist3, playlist1] };
  const manifestObject3 = { playlists: [playlist1, playlist3, playlist2] };

  assert.deepEqual(
    chooseVideoPlaylists([manifestObject1, manifestObject2, manifestObject3], 720),
    [playlist2, playlist2, playlist2],
    'chose video playlists with resolution info'
  );
});

QUnit.module('chooseAudioPlaylists');

QUnit.test('chooses default audio playlists for video playlists', function(assert) {
  const audioPlaylist2Resolved = { test: 'case' };
  const audioPlaylist1 = { default: true, resolvedUri: 'resolved-uri-1' };
  const audioPlaylist2 = { default: true, playlists: [audioPlaylist2Resolved] };
  const audioPlaylist3 = { default: true, resolvedUri: 'resolved-uri-3' };
  const manifestObject1 = {
    mediaGroups: {
      AUDIO: {
        audio1: {
          en: audioPlaylist1,
          es: { default: false, resolvedUri: 'resolved-uri' }
        }
      }
    }
  };
  const manifestObject2 = {
    mediaGroups: {
      AUDIO: {
        audio1: {
          en: { default: false, playlists: [] },
          es: audioPlaylist2
        }
      }
    }
  };
  const manifestObject3 = {
    mediaGroups: {
      AUDIO: {
        audio1: {
          en: { default: false, resolvedUri: 'resolved-uri' },
          es: audioPlaylist3
        }
      }
    }
  };
  const videoPlaylist1 = { attributes: { AUDIO: 'audio1' } };
  const videoPlaylist2 = { attributes: { AUDIO: 'audio1' } };
  const videoPlaylist3 = { attributes: { AUDIO: 'audio1' } };

  assert.deepEqual(
    chooseAudioPlaylists(
      [manifestObject1, manifestObject2, manifestObject3],
      [videoPlaylist1, videoPlaylist2, videoPlaylist3]
    ),
    [audioPlaylist1, audioPlaylist2Resolved, audioPlaylist3],
    'chose default audio playlists'
  );
});

QUnit.test('throws error when missing audio playlist', function(assert) {
  const audioPlaylist1 = { default: true, resolvedUri: 'resolved-uri-1' };
  // missing both resolvedUri and playlists, but only for this audio playlist
  const audioPlaylist2 = { default: true };
  const audioPlaylist3 = { default: true, resolvedUri: 'resolved-uri-3' };
  const manifestObject1 = {
    mediaGroups: {
      AUDIO: {
        audio1: {
          en: audioPlaylist1,
          es: { default: false, resolvedUri: 'resolved-uri' }
        }
      }
    }
  };
  const manifestObject2 = {
    mediaGroups: {
      AUDIO: {
        audio1: {
          en: { default: false, playlists: [] },
          es: audioPlaylist2
        }
      }
    }
  };
  const manifestObject3 = {
    mediaGroups: {
      AUDIO: {
        audio1: {
          en: { default: false, resolvedUri: 'resolved-uri' },
          es: audioPlaylist3
        }
      }
    }
  };
  const videoPlaylist1 = { attributes: { AUDIO: 'audio1' } };
  const videoPlaylist2 = { attributes: { AUDIO: 'audio1' } };
  const videoPlaylist3 = { attributes: { AUDIO: 'audio1' } };

  assert.throws(
    () => {
      chooseAudioPlaylists(
        [manifestObject1, manifestObject2, manifestObject3],
        [videoPlaylist1, videoPlaylist2, videoPlaylist3]
      )
    },
    new Error('Did not find matching audio playlists for all video playlists'),
    'throws error when missing resolvedUri and playlist in matching audio playlist'
  );
});

QUnit.test('throws error when missing default audio playlist', function(assert) {
  const audioPlaylist2Resolved = { test: 'case' };
  const audioPlaylist1 = { default: true, resolvedUri: 'resolved-uri-1' };
  // not default
  const audioPlaylist2 = { default: false, playlists: [audioPlaylist2Resolved] };
  const audioPlaylist3 = { default: true, resolvedUri: 'resolved-uri-3' };
  const manifestObject1 = {
    mediaGroups: {
      AUDIO: {
        audio1: {
          en: audioPlaylist1,
          es: { default: false, resolvedUri: 'resolved-uri' }
        }
      }
    }
  };
  const manifestObject2 = {
    mediaGroups: {
      AUDIO: {
        audio1: {
          en: { default: false, playlists: [] },
          es: audioPlaylist2
        }
      }
    }
  };
  const manifestObject3 = {
    mediaGroups: {
      AUDIO: {
        audio1: {
          en: { default: false, resolvedUri: 'resolved-uri' },
          es: audioPlaylist3
        }
      }
    }
  };
  const videoPlaylist1 = { attributes: { AUDIO: 'audio1' } };
  const videoPlaylist2 = { attributes: { AUDIO: 'audio1' } };
  const videoPlaylist3 = { attributes: { AUDIO: 'audio1' } };

  assert.throws(
    () => {
      chooseAudioPlaylists(
        [manifestObject1, manifestObject2, manifestObject3],
        [videoPlaylist1, videoPlaylist2, videoPlaylist3]
      )
    },
    new Error('Did not find matching audio playlists for all video playlists'),
    'throws error when missing a default audio playlist'
  );
});
