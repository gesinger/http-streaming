import traces from './traces.json';
import { getBufferedStrings } from './buffer';

// don't import video.js again as it's already included on the page as a global
const videojs = window.videojs;

const setupAfterRequest = (player, state, traces) => {
  player.vhs.xhr.afterRequest = (error, request, response) => {
    if (error) {
      return;
    }

    const bytes = response.body.byteLength || response.body.length;
    const bits = bytes * 8;

    let mockDownloadedBits = 0;
    let lastTraceIndex = 0;
    let millis = 0;

    while (mockDownloadedBits < bits) {
      let currentTrace = traces[lastTraceIndex];

      for (let i = 1; i < traces.length; i++) {
        const trace = traces[i];

        if (trace.time > state.time) {
          break;
        }
        currentTrace = trace;
        lastTraceIndex = i;
      }

      const currentMilliBandwidth = currentTrace.bandwidth / 1000;

      mockDownloadedBits += currentMilliBandwidth;
      millis++;
      state.time++;
    }

    request.bandwidth = mockDownloadedBits / (millis / 1000);
  };
};

const runSimulation = () => {
  player.on('loadedmetadata', () => {
    const state = { time: 0 };

    setupAfterRequest(player, state, traces);

    window.traces = traces;
    window.state = state;
  });

  player.on('progress', () => {
    console.log(getBufferedStrings(player));
  });
};

const runButton = document.querySelector('#run');

runButton.addEventListener('click', () => {
  const player = window.videojs('player');

  window.player = player;

  player.src({
    src: 'http://localhost:8000/index.m3u8',
    type: 'application/x-mpegURL'
  });

  runSimulation(player);
});
