MrX SceneDeck 2.1.2 for Stash
=============================

MrX SceneDeck is a Stash plugin that displays the current scene as an
always-on-top, resizable and clickable contact sheet. It works independently
from Mosaic Poster and may remain installed alongside it.

PROGRESSIVE IMAGE QUALITY
The floater first displays a grid built from Stash's existing sprite and WebVTT
data, so it never waits on video processing or shows a blank window. Version
2.1 then asks its own backend to create a sharper JPEG from the real video with
ffmpeg. The completed image is fully loaded before it replaces the sprite.

The first high-resolution build for a scene and grid size takes time because
frames must be decoded from the video. The result is cached in the plugin's
generated folder; later visits to that scene and grid size reuse it immediately.
Each grid size has its own cache entry.

FEATURES
- Selectable 4x4, 5x5, 6x6, 7x7 and 8x8 floating grids.
- Immediate sprite display followed by an independent high-resolution upgrade.
- Captures up to four frames in parallel to reduce first-generation time.
- Retains up to 250 generated sheets by default and prunes the oldest files.
- Clicking a frame seeks the main Stash video and keeps keyboard control in
  the floating window.
- Left/Right Arrow seeks backward or forward five seconds without pausing.
- Hold Ctrl and use any arrow key to move the highlighted grid selection;
  release Ctrl to seek there and start playback.
- Opens automatically on the first normal player click by default.
- Ctrl+Shift+M provides an invisible manual opening shortcut.
- No fixed page button, leaving Stash's Multiview control unobscured.
- Prevents duplicate floating windows and generation requests.
- Closing the floater suppresses automatic reopening until a full page reload.
  Ctrl+Shift+M can still reopen it intentionally.
- Preserves and refreshes the same floating window across scene navigation.
- Supports Stash installations served from a URL prefix such as /stash/.
- Remembers the selected grid size in the browser.
- Does not modify Stash metadata or Mosaic Poster.

REQUIREMENTS
- Stash v0.31.0 or newer.
- Stash sprites generated for immediate low-resolution display.
- Python 3 available as `python` to Stash.
- ffmpeg available through Stash's configured path, bundled installation or
  system PATH. No separate ffmpeg configuration is normally required.
- Current Chrome or Edge desktop with Document Picture-in-Picture support.
- Stash opened through http://localhost:9980 or HTTPS.

INSTALLATION WITH STASH PLUGIN MANAGER (RECOMMENDED)
1. In Stash, open Settings -> Plugins -> Available Plugins.
2. Select Add Source.
3. Enter "MrX SceneDeck" as the source name and use this Source URL:
   https://raw.githubusercontent.com/MrX-Builds/MrX-SceneDeck/main/index.yml
4. Save the source, find MrX SceneDeck in Available Plugins and select Install.
5. Select Reload plugins, then refresh the Stash browser page.
6. Open a scene and make a normal left-click in the video player. The sprite
   grid appears first; the status changes to High-res when upgrading completes.

UPDATING WITH STASH PLUGIN MANAGER
When a newer version is published, open Settings -> Plugins -> Installed
Plugins and use the available Update action for MrX SceneDeck. Reload plugins
and refresh the browser page afterward.

MANUAL INSTALLATION
1. Download and extract the regular release ZIP.
2. Remove any old MosaicFloat6x6 plugin folder, then copy the enclosed
   MrXSceneDeck folder into the Stash plugins directory.
   The final manifest path must be:
   .../plugins/MrXSceneDeck/MrXSceneDeck.yml
3. In Stash, open Settings -> Plugins and select Reload plugins.
4. Refresh the Stash browser page.
5. Open a scene and make a normal left-click in the video player.

UPGRADING FROM MOSAICFLOAT6X6 2.0 OR 2.1
Delete the old MosaicFloat6x6 folder and install the complete MrXSceneDeck
folder. Do not leave both folders installed because Stash would load both
plugins. The selected grid size is migrated automatically when available.
Reload plugins and refresh the browser page afterward.

USE
- Select 4x4 through 8x8 using the buttons at the top of the floater.
- Click a frame to seek the main video.
- Press Left/Right Arrow in the floater to seek by five seconds.
- Hold Ctrl and move with Left/Right/Up/Down Arrow. Release Ctrl to seek to the
  highlighted frame and start playback.
- Press Ctrl+Shift+M on the scene page to open the floater manually.
- Resize or move the floating window with the normal browser controls.

SETTINGS
- Disable automatic opening: player clicks no longer open the floater;
  Ctrl+Shift+M remains available.
- Disable high-resolution upgrade: displays only the instant sprite grid and
  performs no ffmpeg generation or cache writes.
- High-resolution cache limit: maximum generated JPEGs to retain. Unset or 0
  uses the default limit of 250. Oldest files are removed first.

The two disable settings are unchecked by default, so automatic opening and
high-resolution upgrading work after a normal installation. Refresh the Stash
page after changing settings.

HIGH-RESOLUTION CACHE
Generated files are stored inside:
.../plugins/MrXSceneDeck/generated/

They are disposable. Deleting them only causes the selected sheets to be
generated again when needed. Removing the entire plugin folder also removes
its cache.

TESTING CHECKLIST
1. Reload Stash, open a scene and click the player. Verify exactly one floating
   window opens and the sprite grid appears first.
2. Verify the status says 'Generating high-res', then changes to 'High-res'
   when the sharper image replaces the sprite.
3. Close and reopen or revisit the same scene/grid. Verify the cached high-res
   sheet appears without another generation delay.
4. Test every grid size from 4x4 through 8x8. The first use of each size creates
   a separate high-resolution cache entry.
5. Click frames after the high-resolution swap and verify seeking matches the
   displayed cells.
6. Test Left/Right Arrow seeking and Ctrl plus all four arrow keys.
7. Navigate to another scene without reloading and verify the floater updates.
8. Close the floater and verify player clicks do not reopen it automatically
   until reload; verify Ctrl+Shift+M still reopens it intentionally.
9. Enable 'Disable high-resolution upgrade', refresh, and verify the status
   remains 'Sprite' with no generation attempt.
10. Verify no launcher covers Stash's Multiview control.

TROUBLESHOOTING
- 'High-res unavailable': confirm Python 3 and ffmpeg are available to Stash,
  then inspect the Stash plugin log for the backend error.
- 'Waiting for Stash sprite data': run Generate -> Sprites for the scene.
- Floater does not appear: press Ctrl+Shift+M while viewing a scene.
- Keep the source Stash tab open; Chrome closes Document PiP with its source.

REMOVE
Plugin Manager installation: uninstall MrX SceneDeck from Settings -> Plugins.
Manual installation: delete the MrXSceneDeck folder. Then reload plugins and
refresh the browser page.

CREDIT
Thanks to the Mosaic Poster developer for the first-player-click suggestion and
browser lifecycle sketch. Mosaic Poster's documented progressive high-resolution
behavior also helped clarify the desired user experience. MrX SceneDeck
uses its own renderer, backend, cache and parallel extraction implementation;
it neither calls nor modifies Mosaic Poster.
