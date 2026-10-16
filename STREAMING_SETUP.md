# Authorized HLS playback setup

The API can play a direct HTTPS HLS manifest (.m3u8) when the catalog record's source_url is that direct manifest URL. It does not extract media URLs from third-party watch pages or bypass player protections.

## Configure the proxy

Set HLS_ALLOWED_HOSTS in the hosting provider's environment settings to a comma-separated list of exact media CDN hostnames that you own or are authorized to use. Do not include schemes or paths.

Example format (replace with your actual authorized CDN hostname):

```env
HLS_ALLOWED_HOSTS=media.example.com,cdn.example.com
```

The proxy rejects hosts not in this allowlist and rejects non-HTTPS URLs. The manifest and its child playlists/segments must use hosts included in the list. Redirects are not followed.

## Quality and Hindi audio

- Quality choices appear only when the HLS master playlist publishes multiple variants.
- Hindi appears as an audio option only when the manifest exposes a Hindi alternate audio track (typically language metadata such as hin or a Hindi-labelled track).
- If the source catalog contains only a DesiDubAnime watch-page URL, the API returns a watch link; it cannot provide direct HLS playback, quality switching, or audio-track selection from that URL alone.
- Test the deployed endpoint with an authorized direct manifest before enabling it for users. Browser playback can still fail if the upstream media provider requires additional authorized headers/cookies or blocks access.
