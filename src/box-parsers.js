import videojs from 'video.js';
import { parseType } from 'mux.js/lib/mp4/probe';
import { parse as parseSampleFlags } from 'mux.js/lib/tools/mp4-inspector';
import {
  discardEmulationPreventionBytes,
  readSequenceParameterSet
} from 'mux.js/lib/codecs/h264';
import mp4Generator from 'mux.js/lib/mp4/mp4-generator.js';

const nalParse = (avcStream) => {
  const avcView =
    new DataView(avcStream.buffer, avcStream.byteOffset, avcStream.byteLength);
  const result = [];

  for (let i = 0; i + 4 < avcStream.length; i += length) {
    const length = avcView.getUint32(i);

    i += 4;

    // bail if this doesn't appear to be an H264 stream
    if (length <= 0) {
      result.push('<span style=\'color:red;\'>MALFORMED DATA</span>');
      continue;
    }

    switch (avcStream[i] & 0x1F) {
    case 0x01:
      result.push('slice_layer_without_partitioning_rbsp');
      break;
    case 0x05:
      result.push('slice_layer_without_partitioning_rbsp_idr');
      break;
    case 0x06:
      result.push('sei_rbsp');
      break;
    case 0x07:
      result.push('seq_parameter_set_rbsp');
      break;
    case 0x08:
      result.push('pic_parameter_set_rbsp');
      break;
    case 0x09:
      result.push('access_unit_delimiter_rbsp');
      break;
    default:
      result.push('UNKNOWN NAL - ' + avcStream[i] & 0x1F);
      break;
    }
  }
  return result;
};

const ftyp = (data) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const result = {
    majorBrand: parseType(data.subarray(0, 4)),
    minorVersion: view.getUint32(4),
    compatibleBrands: []
  };
  let i = 8;

  while (i < data.byteLength) {
    result.compatibleBrands.push(parseType(data.subarray(i, i + 4)));
    i += 4;
  }

  return result;
};

const styp = (data) => ftyp(data);

const sidx = (data) => {
 const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
 const result = {
   version: data[0],
   flags: new Uint8Array(data.subarray(1, 4)),
   references: [],
   referenceId: view.getUint32(4),
   timescale: view.getUint32(8),
   earliestPresentationTime: view.getUint32(12),
   firstOffset: view.getUint32(16)
 };
 let referenceCount = view.getUint16(22);

 for (let i = 24; referenceCount; i += 12, referenceCount--) {
   result.references.push({
     referenceType: (data[i] & 0x80) >>> 7,
     referencedSize: view.getUint32(i) & 0x7FFFFFFF,
     subsegmentDuration: view.getUint32(i + 4),
     startsWithSap: !!(data[i + 8] & 0x80),
     sapType: (data[i + 8] & 0x70) >>> 4,
     sapDeltaTime: view.getUint32(i + 8) & 0x0FFFFFFF
   });
 }

  return result;
};

// TODO make parameters for everything more generic
const moof = (data, isEndOfSegment) => {
  return {
    boxes: inspectMp4({ data, isEndOfSegment })
  };
};

const mdat = (data) => {
  return {
    byteLength: data.byteLength,
    nals: nalParse(data)
  };
};

const mfhd = (data) => {
  return {
    version: data[0],
    flags: new Uint8Array(data.subarray(1, 4)),
    sequenceNumber: (data[4] << 24) |
      (data[5] << 16) |
      (data[6] << 8) |
      (data[7])
  };
};

const traf = (data, isEndOfSegment) => {
  return {
    boxes: inspectMp4({ data, isEndOfSegment })
  };
};

const trun = (data) => {
  const result = {
    version: data[0],
    flags: new Uint8Array(data.subarray(1, 4)),
    samples: []
  };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dataOffsetPresent = result.flags[2] & 0x01;
  const firstSampleFlagsPresent = result.flags[2] & 0x04;
  const sampleDurationPresent = result.flags[1] & 0x01;
  const sampleSizePresent = result.flags[1] & 0x02;
  const sampleFlagsPresent = result.flags[1] & 0x04;
  const sampleCompositionTimeOffsetPresent = result.flags[1] & 0x08;
  let sampleCount = view.getUint32(4);
  let offset = 8;
  let sample;

  if (dataOffsetPresent) {
    result.dataOffset = view.getUint32(offset);
    offset += 4;
  }

  if (firstSampleFlagsPresent && sampleCount) {
    sample = {
      flags: parseSampleFlags(data.subarray(offset, offset + 4))
    };
    offset += 4;
    if (sampleDurationPresent) {
      sample.duration = view.getUint32(offset);
      offset += 4;
    }
    if (sampleSizePresent) {
      sample.size = view.getUint32(offset);
      offset += 4;
    }
    if (sampleCompositionTimeOffsetPresent) {
      sample.compositionTimeOffset = view.getUint32(offset);
      offset += 4;
    }
    result.samples.push(sample);
    sampleCount--;
  }

  while (sampleCount--) {
    sample = {};
    if (sampleDurationPresent) {
      sample.duration = view.getUint32(offset);
      offset += 4;
    }
    if (sampleSizePresent) {
      sample.size = view.getUint32(offset);
      offset += 4;
    }
    if (sampleFlagsPresent) {
      sample.flags = parseSampleFlags(data.subarray(offset, offset + 4));
      offset += 4;
    }
    if (sampleCompositionTimeOffsetPresent) {
      sample.compositionTimeOffset = view.getUint32(offset);
      offset += 4;
    }
    result.samples.push(sample);
  }
  return result;
};

const tfhd = (data) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const result = {
    version: data[0],
    flags: new Uint8Array(data.subarray(1, 4)),
    trackId: view.getUint32(4)
  };
  const baseDataOffsetPresent = result.flags[2] & 0x01;
  const sampleDescriptionIndexPresent = result.flags[2] & 0x02;
  const defaultSampleDurationPresent = result.flags[2] & 0x08;
  const defaultSampleSizePresent = result.flags[2] & 0x10;
  const defaultSampleFlagsPresent = result.flags[2] & 0x20;
  let i = 8;

  if (baseDataOffsetPresent) {
    i += 4; // truncate top 4 bytes
    result.baseDataOffset = view.getUint32(12);
    i += 4;
  }
  if (sampleDescriptionIndexPresent) {
    result.sampleDescriptionIndex = view.getUint32(i);
    i += 4;
  }
  if (defaultSampleDurationPresent) {
    result.defaultSampleDuration = view.getUint32(i);
    i += 4;
  }
  if (defaultSampleSizePresent) {
    result.defaultSampleSize = view.getUint32(i);
    i += 4;
  }
  if (defaultSampleFlagsPresent) {
    result.defaultSampleFlags = view.getUint32(i);
  }
  return result;
};

const tfdt = (data) => {
  var result = {
    version: data[0],
    flags: new Uint8Array(data.subarray(1, 4)),
    baseMediaDecodeTime: data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]
  };
  if (result.version === 1) {
    result.baseMediaDecodeTime *= Math.pow(2, 32);
    result.baseMediaDecodeTime += data[8] << 24 | data[9] << 16 | data[10] << 8 | data[11];
  }
  return result;
};

const sdtp = (data) => {
  const result = {
    version: data[0],
    flags: new Uint8Array(data.subarray(1, 4)),
    samples: []
  };

  for (let i = 4; i < data.byteLength; i++) {
    result.samples.push({
      dependsOn: (data[i] & 0x30) >> 4,
      isDependedOn: (data[i] & 0x0c) >> 2,
      hasRedundancy: data[i] & 0x03
    });
  }
  return result;
};

const makeNalPacket = (nalUnitBytes) => {
 const packet = {
   // trackId: trackId,
   // pts: currentPts,
   // dts: currentDts,
   data: nalUnitBytes
 };

  switch (nalUnitBytes[0] & 0x1f) {
  case 0x05:
    packet.nalUnitType = 'slice_layer_without_partitioning_rbsp_idr';
    break;
  case 0x06:
    packet.nalUnitType = 'sei_rbsp';
    packet.escapedRBSP = discardEmulationPreventionBytes(nalUnitBytes.subarray(1));
    break;
  case 0x07:
    packet.nalUnitType = 'seq_parameter_set_rbsp';
    packet.escapedRBSP = discardEmulationPreventionBytes(nalUnitBytes.subarray(1));
    packet.config = readSequenceParameterSet(packet.escapedRBSP);
    break;
  case 0x08:
    packet.nalUnitType = 'pic_parameter_set_rbsp';
    break;
  case 0x09:
    packet.nalUnitType = 'access_unit_delimiter_rbsp';
    break;

  default:
    break;
  }

  return packet;
};

const parseNalUnitPackets = (mdatData) => {
  const nalUnits = [];
  const view = new DataView(mdatData.buffer, mdatData.byteOffset, mdatData.byteLength);
  let offset = 0;

  while (offset < mdatData.length) {
    // TODO should be configurable to different lengths
    const nalUnitLength = view.getUint32(offset)

    offset += 4;

    const nalUnit = mdatData.subarray(offset, offset + nalUnitLength);

    nalUnits.push(makeNalPacket(nalUnit));

		offset += nalUnitLength;
  }

  return nalUnits;
};

/**
 * TODO remove isVideoOnly
 * Return a javascript array of box objects parsed from part of an ISO base media file
 * @param config {Object}
 * @param config.data {Uint8Array} array of bytes of data that may or may not reach the
 *                                 end of segment
 * @param config.isEndOfSegment {Boolean} if the data reaches the end of the segment
 * @param config.boxes {Array} array of bytes of data
 * @return {array} a javascript array of potentially nested box objects
 */
const inspectMp4 = ({ data, isEndOfSegment, topLevelBoxes, isVideoOnly }) => {
  const result = {
    numUsedBytes: 0
  };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const newBoxes = [];
  let offset = 0;

  topLevelBoxes = topLevelBoxes || {};

  while (offset < data.byteLength) {
    // 4 bytes for box length, 4 bytes for type (8 bytes total minimum box size)
    if (data.byteLength - offset < 8) {
      break;
    }

    const boxLength = view.getUint32(offset);
    const boxType = parseType(data.subarray(offset + 4, offset + 8));
    // from Part 12: ISO base media file format
    // "if size is 1 then the actual size is in the field largesize;
    // if size is 0, then this box is the last one in the file, and its contents extend
    // to the end of the file (normally only used for a Media Data Box)"
    if (boxLength === 0 && !isEndOfSegment) {
      break;
    }
    if (boxLength === 1 && !isEndOfSegment) {
      // TODO largesize case, do we need to handle this?
      videojs.log.warn('Encountered a largesize in an mp4 box and we haven\'t reached ' +
        'end of segment');
      break;
    }

    const boxEnd = boxLength > 1 ? offset + boxLength : data.byteLength;

    if (boxEnd > data.byteLength) {
      break;
    }

    const boxBytes = data.subarray(offset, boxEnd);

    // parse type-specific data
    const box = boxParsers[boxType] ?
      boxParsers[boxType](boxBytes.subarray(8), isEndOfSegment) : {};
    box.size = boxLength;
    box.type = boxType;
    box.rawBytes = boxBytes;

    result.numUsedBytes += boxLength;
    offset = boxEnd;

    // cache these for reuse
    if (box.type === 'styp') {
      topLevelBoxes.styp = box;
      continue;
    }
    if (box.type === 'sidx') {
      topLevelBoxes.sidx = box;
      continue;
    }

    newBoxes.push(box);
  }

  result.boxes = topLevelBoxes;

  const hasMdat = newBoxes.reduce((acc, box) => {
    return acc || box.type === 'mdat';
  }, false);

  if (!hasMdat) {
    // save them for next time
    result.boxes.unused = newBoxes;
    return result;
  }

  const moof = newBoxes.reduce((acc, box) => {
    if (box.type === 'moof') {
      acc = box;
    }
    return acc;
  }, null);
  const mdat = newBoxes.reduce((acc, box) => {
    if (box.type === 'mdat') {
      acc = box;
    }
    return acc;
  }, null);

  if (!isVideoOnly) {
    result.bytes = makeMp4Fragment(topLevelBoxes, moof, mdat);
    return result;
  }

  const mdatBytes = mdat.rawBytes.subarray(8);
  const nalUnits = parseNalUnitPackets(mdatBytes);
  const frames = groupNalsIntoFrames(nalUnits);

  // TODO handle cache (unused bytes?)

  if (!frames.length) {
    debugger;
  }

  const newMdatBytes = mp4Generator.mdat(concatenateNalData(frames));

  result.bytes = makeMp4Fragment(topLevelBoxes, moof, {
    rawBytes: newMdatBytes
  });

  return result;
};

const makeMp4Fragment = ({ styp, sidx }, moof, mdat) => {
  const length =
    (styp ? styp.rawBytes.length : 0) +
    (sidx ? sidx.rawBytes.length : 0) +
    moof.rawBytes.length +
    mdat.rawBytes.length;
  const bytes = new Uint8Array(length);
  let offset = 0;

  ([styp, sidx, moof, mdat]).forEach((box) => {
    if (box) {
      bytes.set(box.rawBytes, offset);
      offset += box.rawBytes.length;
    }
  });

  return bytes;
};

// Convert an array of nal units into an array of frames with each frame being
// composed of the nal units that make up that frame
// Also keep track of cummulative data about the frame from the nal units such
// as the frame duration, starting pts, etc.
const groupNalsIntoFrames = (nalUnits) => {
  var
    i,
    currentNal,
    currentFrame = [],
    frames = [];

  frames.byteLength = 0;
  frames.nalCount = 0;

  currentFrame.byteLength = 0;

  for (i = 0; i < nalUnits.length; i++) {
    currentNal = nalUnits[i];

    // Specifically flag key frames for ease of use later
    if (currentNal.nalUnitType === 'slice_layer_without_partitioning_rbsp_idr') {
      frames.byteLength += currentFrame.byteLength;
      frames.nalCount += currentFrame.length;
      frames.push(currentFrame);
      currentFrame = [];
      currentFrame.byteLength = 0;
      currentFrame.keyFrame = true;
    }
    currentFrame.byteLength += currentNal.data.byteLength;
    currentFrame.push(currentNal);
  }

  // Push the final frame
  frames.byteLength += currentFrame.byteLength;
  frames.nalCount += currentFrame.length;
  frames.push(currentFrame);
  return frames;
};

// generate the track's raw mdat data from an array of frames
const concatenateNalData = (frames) => {
  var
    i, j,
    currentFrame,
    currentNal,
    dataOffset = 0,
    nalsByteLength = frames.byteLength,
    numberOfNals = frames.nalCount,
    totalByteLength = nalsByteLength + 4 * numberOfNals,
    data = new Uint8Array(totalByteLength),
    view = new DataView(data.buffer);

  // For each Frame..
  for (i = 0; i < frames.length; i++) {
    currentFrame = frames[i];

    // For each NAL..
    for (j = 0; j < currentFrame.length; j++) {
      currentNal = currentFrame[j];

      view.setUint32(dataOffset, currentNal.data.byteLength);
      dataOffset += 4;
      data.set(currentNal.data, dataOffset);
      dataOffset += currentNal.data.byteLength;
    }
  }
  return data;
};

const boxParsers = {
  ftyp,
  styp,
  sidx,
  moof,
  mdat,
  mfhd,
  traf,
  trun,
  tfhd,
  tfdt,
  sdtp,
  nalParse,
  inspectMp4
};

export default boxParsers;
