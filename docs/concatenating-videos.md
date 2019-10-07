# Concatenating Videos

## Table of Contents

- [Purpose](#purpose)
- [Method](#method)
- [Limitations](#limitations)
- [Examples](#examples)
  - [Two of the same DASH source](#two-of-the-same-dash-source)
  - [Two of the same HLS source](#two-of-the-same-hls-source)
  - [Two of the same demuxed HLS source](#two-of-the-same-demuxed-hls-source)
  - [Demuxed HLS and DASH](#demuxed-hls-and-dash)

## Purpose

There are a few known use cases where a user may want to pass in a pre-parsed manifest object instead of a source URL:

* The manifest has already been downloaded, and providing a pre-parsed source object saves the round trip time of a request.
* The user wants to manipulate the source in some way before passing it along to VHS.
* The user wants to test a specific behavior without creating a mock manifest and spinning up a local server.

There are probably many other use-cases as well, but these are a few of the more standout ones.

## Method

A few approaches can be taken to concatenate videos together, including combining manifests into a new manifest string, and passing that in as a data URI. However, the method chosen for the concatenate-videos module is to use the VHS source parsers (m3u8-parser and mpd-parser at the moment), and to combine those objects into a single object which is then passed as JSON via a data URI to VHS: https://github.com/videojs/http-streaming/pull/649

To use the concatenate-videos module, all that needs to be done is to call the function `concatenateVideos` and wait for the asynchronous operation to finish. The operation is asynchronous to allow for downloading of the manifests.

## Limitations

* Renditions being selected from must have both audio and video (though demuxed is supported in addition to muxed).
* Only HLS and DASH are supported (at the moment).
* Only one rendition is used per source.
* Alternate audio is not supported (except demuxed with default audio playlists).
* WebVTT subtitle playlists are not supported.

## Examples

### Two of the same DASH source

```js
videojs.Hls.concatenateVideos({
  manifests: [{
    url: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
    mimeType: 'application/dash+xml'
  }, {
    url: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
    mimeType: 'application/dash+xml'
  }],
  targetVerticalResolution: 720,
  callback: (err, source) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(source);
    player.src({
      src: `data:application/vnd.vhs+json,${JSON.stringify(source)}`,
      type: 'application/vnd.vhs+json'
    });
  }
});
```

### Two of the same HLS source

```js
videojs.Hls.concatenateVideos({
  manifests: [{
    url: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    mimeType: 'application/x-mpegURL'
  }, {
    url: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    mimeType: 'application/x-mpegURL'
  }],
  targetVerticalResolution: 720,
  callback: (err, source) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(source);
    player.src({
      src: `data:application/vnd.vhs+json,${JSON.stringify(source)}`,
      type: 'application/vnd.vhs+json'
    });
  }
});
```

### Two of the same demuxed HLS source

```js
videojs.Hls.concatenateVideos({
  manifests: [{
    url: 'http://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
    mimeType: 'application/x-mpegURL'
  }, {
    url: 'http://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
    mimeType: 'application/x-mpegURL'
  }],
  targetVerticalResolution: 720,
  callback: (err, source) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(source);
    player.src({
      src: `data:application/vnd.vhs+json,${JSON.stringify(source)}`,
      type: 'application/vnd.vhs+json'
    });
  }
});
```

### Demuxed HLS and DASH

```js
videojs.Hls.concatenateVideos({
  manifests: [{
    url: 'http://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
    mimeType: 'application/x-mpegURL'
  }, {
    url: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
    mimeType: 'application/dash+xml'
  }],
  targetVerticalResolution: 720,
  callback: (err, source) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(source);
    player.src({
      src: `data:application/vnd.vhs+json,${JSON.stringify(source)}`,
      type: 'application/vnd.vhs+json'
    });
  }
});
```
