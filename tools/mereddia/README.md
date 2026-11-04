# Journey Across Mereddia: asset converter

The game's art, maps and levels come from the RPG in a Box project behind Journey Across Mereddia. Its `.scn`
files are Godot 3.1 binary resources (zstd-compressed, `RSRC` magic stripped), which `godot3.mjs` reads.

```
node tools/mereddia/convert.mjs "<project folder>" public/mereddia/3d \
  --maps "start_area,Caves,The Temple,sword_area" --grid src/games/mereddia/maps --top 3 \
  --models "characters/Mallakoth_red_2,characters/green_slime"
```

- `--maps` converts each map to `public/mereddia/3d/maps/<name>.json` (every placed tile, object and character) and
  collects every model it uses into `models/`.
- `--grid` also writes `src/games/mereddia/maps/<name>.grid.ts`: the cropped walkable grid and the placed things the
  rules care about. `world.ts` binds those to game entities. Only the floor layer (z 0..`--top`) counts.
- `--models kind/name` converts extra models by hand (the hero, the slimes that the waves spawn).
- Models are voxel meshes, one per animation frame. Their palette textures are packed into one `<name>.png` atlas per
  model (UVs rewritten to match) and drawn with nearest filtering, as the project draws them. Godot winds front faces clockwise and three.js counter-clockwise, so the converter
  swaps two corners of every triangle; without that the models render inside-out (inverted lighting, near sides culled). The project's animation
  tables (frame ranges and speeds) come across as `meta.animations`.

Re-run it whenever the project changes. The generated grids are checked in; the 3D assets are plain files under
`public/mereddia/3d/`.

## Audio and effects

```
FFMPEG=path/to/ffmpeg node tools/mereddia/audio.mjs "<project folder>" public/mereddia/audio
node tools/mereddia/effects.mjs "<project folder>" public/mereddia/3d/effects
```

- `audio.mjs` compresses the music (96 kbps stereo) and sound effects (64 kbps mono) to MP3: about 3.7 MB for all 60.
  Names keep their spelling with spaces as underscores. `src/games/mereddia/cues.ts` says which sound plays for what
  happens, and `audio.ts` is the engine (crossfading music, looping ambience, one-shots).
- `effects.mjs` turns each particle effect into JSON; `three/effects.ts` draws them with the project's own parameters.

## The treehouse

The project has no map for the Secret Master's treehouse, so `node tools/mereddia/treehouse.mjs` builds one from its
own pieces (log walls, corner posts, thin wooden floor, ladder, bookcases, bed, chabudai, irori hearth, chest, banner,
sconces, pines and maples). It writes `public/mereddia/3d/maps/treehouse.json` and `src/games/mereddia/maps/treehouse.grid.ts`.
Edit the layout in the script and run it again.

## Cutscenes

`src/games/mereddia/cutscenes.ts` lists each scene as staging steps (camera moves and shake, actors walking or
gesturing, effects, sounds, fades, letterbox bars, titles). The rules never wait on them: the engine sets `state.cut`
(for example the intro, the golem waking, the boulder, the sword, the oath), the 3D view plays it with the game paused,
then dispatches `seen`. Story nodes can ask for one with `scene:`. The Skip button jumps to the end.

## Mallakoth's animations

Mallakoth_red_2 has no catch or fire (burning the letter) animations; the older Mallakoth_red does. They are
copied across with `--borrow`:

```
node tools/mereddia/convert.mjs "<project folder>" public/mereddia/3d --models characters/Mallakoth_red_2   --borrow "characters/Mallakoth_red=catch+fire>characters/Mallakoth_red_2"
```

Every frame of Mallakoth_red_2 faces the opposite way from how the game turns him, so they are all turned round. The
converter also records where his right hand is in each frame (`hand`), so the axe can follow it.
