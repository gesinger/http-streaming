const mpegurlRE = /^(audio|video|application)\/(x-|vnd\.apple\.)?mpegurl/i;
const dashRE = /^application\/dash\+xml/i;

export const simpleTypeFromSourceType = (type) => {
  if (mpegurlRE.test(type)) {
    return 'hls';
  }

  if (dashRE.test(type)) {
    return 'dash';
  }

  // Denotes the special case of a pre-parsed manifest object passed in instead of the
  // traditional source URL.
  //
  // See https://en.wikipedia.org/wiki/Media_type for details on specifying media types.
  //
  // In this case, vnd is for vendor, VHS is for this project, and the +json suffix
  // identifies the structure of the media type.
  if (type === 'application/vnd.vhs+json') {
    return 'vhs-json';
  }

  return null;
};

