const fs = require("fs");

const file = "public/episode.html";
let html = fs.readFileSync(file, "utf8");

if (html.includes('id="audioLanguage"')) {
  console.log("Audio selector already exists.");
  process.exit(0);
}

/* 1. Audio selector ko player ke turant baad insert karo */
const playerEnd = `</video>
</div>`;

const playerPos = html.indexOf(playerEnd);

if (playerPos === -1) {
  throw new Error("Video player closing block not found.");
}

const insertPos = playerPos + playerEnd.length;

const audioUI = `

<div id="audioControls" style="
margin-top: 14px;
padding: 14px 16px;
border-radius: 12px;
background: #171a24;
border: 1px solid #292d3a;
display: flex;
align-items: center;
gap: 12px;
flex-wrap: wrap;
">
<label for="audioLanguage" style="
font-size: 14px;
font-weight: 600;
color: #d7dbe5;
">Audio Language</label>

<select id="audioLanguage" style="
padding: 10px 12px;
border: 1px solid #3a4050;
border-radius: 9px;
background: #242936;
color: white;
font-size: 14px;
outline: none;
cursor: pointer;
">
<option value="">Loading languages...</option>
</select>

<span id="audioStatus" style="
font-size: 13px;
color: #9da5b5;
">Detecting available audio...</span>
</div>`;

html =
  html.slice(0, insertPos) +
  audioUI +
  html.slice(insertPos);


/* 2. JS references add karo */
const videoLine =
  `const video = document.getElementById("videoPlayer");`;

if (!html.includes(videoLine)) {
  throw new Error("videoPlayer JS line not found.");
}

html = html.replace(
  videoLine,
  `${videoLine}

const audioLanguage =
  document.getElementById("audioLanguage");

const audioStatus =
  document.getElementById("audioStatus");`
);


/* 3. Existing MANIFEST_PARSED handler replace karo */
const manifestStart =
  html.indexOf("hls.on(Hls.Events.MANIFEST_PARSED");

if (manifestStart === -1) {
  throw new Error("MANIFEST_PARSED handler not found.");
}

const manifestEnd =
  html.indexOf("});", manifestStart);

if (manifestEnd === -1) {
  throw new Error("MANIFEST_PARSED handler ending not found.");
}

const manifestBlockEnd = manifestEnd + 3;

const newManifestHandler = `hls.on(Hls.Events.MANIFEST_PARSED, function() {
  console.log("HLS manifest loaded successfully.");

  const tracks = hls.audioTracks || [];

  console.log("Available HLS audio tracks:", tracks);

  audioLanguage.innerHTML = "";

  if (!tracks.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No alternate audio";

    audioLanguage.appendChild(option);
    audioLanguage.disabled = true;

    audioStatus.textContent =
      "No alternate audio tracks found.";
  } else {
    tracks.forEach((track, index) => {
      const option = document.createElement("option");

      option.value = String(index);

      option.textContent =
        track.name ||
        track.lang ||
        track.language ||
        ("Audio " + (index + 1));

      audioLanguage.appendChild(option);
    });

    audioLanguage.disabled = false;

    let defaultIndex = tracks.findIndex(track =>
      String(track.lang || track.language || "")
        .toLowerCase() === "hin"
    );

    if (defaultIndex < 0) {
      defaultIndex = tracks.findIndex(track =>
        String(track.name || "")
          .toLowerCase()
          .includes("hindi")
      );
    }

    if (defaultIndex < 0) {
      defaultIndex = 0;
    }

    hls.audioTrack = defaultIndex;

    audioLanguage.value =
      String(defaultIndex);

    const selectedTrack =
      tracks[defaultIndex];

    audioStatus.textContent =
      "Current: " +
      (
        selectedTrack.name ||
        selectedTrack.lang ||
        selectedTrack.language ||
        "Audio"
      );

    console.log(
      "Default audio selected:",
      selectedTrack
    );
  }

  status.textContent = "Video ready.";

  video.play().catch(() => {
    status.textContent =
      "Video ready. Press Play.";
  });
});

audioLanguage.addEventListener("change", function() {
  const hls = window.currentHls;

  if (!hls || !hls.audioTracks) {
    return;
  }

  const selectedIndex =
    Number(this.value);

  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    !hls.audioTracks[selectedIndex]
  ) {
    return;
  }

  const currentTime =
    video.currentTime;

  const wasPlaying =
    !video.paused;

  const selectedTrack =
    hls.audioTracks[selectedIndex];

  audioStatus.textContent =
    "Switching to " +
    (
      selectedTrack.name ||
      selectedTrack.lang ||
      selectedTrack.language ||
      "Audio"
    ) +
    "...";

  console.log(
    "Switching audio track:",
    selectedTrack
  );

  hls.audioTrack =
    selectedIndex;

  setTimeout(() => {
    try {
      if (
        Number.isFinite(currentTime) &&
        Math.abs(
          video.currentTime - currentTime
        ) > 1
      ) {
        video.currentTime =
          currentTime;
      }

      if (wasPlaying) {
        video.play().catch(() => {});
      }
    } catch (error) {
      console.warn(
        "Audio position restore failed:",
        error
      );
    }
  }, 300);
});

hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, function(event, data) {
  const index = data.id;

  if (!hls.audioTracks[index]) {
    return;
  }

  const track =
    hls.audioTracks[index];

  audioLanguage.value =
    String(index);

  audioStatus.textContent =
    "Current: " +
    (
      track.name ||
      track.lang ||
      track.language ||
      "Audio"
    );

  console.log(
    "Audio track switched:",
    track
  );
});`;

html =
  html.slice(0, manifestStart) +
  newManifestHandler +
  html.slice(manifestBlockEnd);


/* 4. Save */
fs.writeFileSync(file, html);

console.log(
  "SUCCESS: Audio language selector added."
);
