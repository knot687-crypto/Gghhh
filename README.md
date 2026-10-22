# AAA Motion — movement & katana combat for Roblox

A complete third- and first-person animation pack for Roblox with the gameplay and VFX to drive it:
76 animations, a particle/ribbon/camera VFX system, a movement controller (dash, slide, wall run,
vault, mantle, double jump …) and a server-authoritative katana combat system (combo, charged heavy,
lunge, aerial slam, block, parry, guard break), plus a demo arena with sparring dummies and an AI
rival.

Showcase videos (rendered from the same animation data the game runs): `aaa_movement.mp4`,
`aaa_combat.mp4`, `aaa_firstperson.mp4` — delivered alongside this repository (they are not
committed because of their size; re-render them with `npm run render`, see below).

## Quick start

1. Open **`export/AAAMotion.rbxl`** in Roblox Studio and press **Play**.
   (Or sync the source live: `rojo serve` with `default.project.json`.)
2. Optional but recommended: upload `assets/textures/*.png` (Asset Manager → Bulk Import) and paste
   the asset ids into `ReplicatedStorage/AAAMotion/Config.Textures`. Without them the effects fall
   back to Roblox's built-in particle textures.

| Input | Action |
| --- | --- |
| WASD / left stick | Move |
| Shift / L3 | Sprint |
| Space / A | Jump · double jump · wall jump · mantle onto ledges |
| Ctrl or C / B | Crouch · **slide** when sprinting (jump out of a slide keeps momentum) |
| Q / R1 | Dash (4-way when armed or in first person; also in the air) |
| Run into walls / rails | Wall run (airborne, along a wall) · auto-vault low obstacles |
| LMB / X | Slash combo (4 hits) · draws the sword if sheathed · in the air: plunging slam |
| RMB hold / Y | Charged heavy cleave (release to strike) |
| F hold / L1 | Block — raise it just as a hit lands to **parry** |
| R / R2 | Lunge thrust |
| E / D-pad left | Draw (iai cut) / sheath |
| V / D-pad up | Toggle first / third person |
| Alt | Free the mouse cursor · H toggles the controls card |

Mobile gets on-screen buttons for every action.

## What's in the pack

**Third person (52 clips)** — Idle, Walk, Run, Sprint, CrouchIdle, CrouchWalk, JumpStart, Rise,
Fall, DoubleJump, LandLight, LandHeavy, LandRoll, DashForward/Back/Left/Right, AirDash, SlideEnter,
Slide, WallRunLeft/Right, WallJumpLeft/Right, Vault, Mantle, CombatIdle, ArmedWalk, ArmedRun,
Light1–4, HeavyCharge, HeavyRelease, AerialSlam, AerialSlamLand, Lunge, Block, BlockHit, Parry,
Parried, GuardBreak, Draw, Sheath, HitFront/Back/Left/Right, Knockback, KnockdownLand, GetUp.

**First person (24 viewmodel clips)** — every movement and combat action has an FP_ twin with the
same length and marker times, plus a virtual `Camera` joint that animates camera kick, dip and roll.

How they were made: poses are solved with inverse kinematics (planted feet with zero sliding at the
design speed, two-handed grips locked to the hilt, hands planted on vault rails and ledges), slashes
follow parametric arcs with the cutting edge leading, and each attack's blade path is baked so the
slash ribbon matches the swing at any frame rate. Clips carry gameplay markers (`HitStart`,
`HitEnd`, `ComboWindow`, `SwingStart`, `Land`, `HandPlant`, `WeaponAttach` …).

**VFX** — hit sparks, slash shards, glow and embers; cross flashes; shockwave rings; dust rings,
debris and rock eruptions with ground cracks; dash wind bursts and afterimages; slide sparks;
footstep dust; parry stars; blade edge glow; swept slash ribbons; camera trauma shake, FOV kicks,
anime impact frames, screen flashes, parry slow motion and speed lines. All recipes live in
`Generated/VFXRecipes` (shared with the preview renderer that made the videos).

## Using the animations without the runtime

`export/AAAMotionAnimations.rbxm` contains all 76 clips as **KeyframeSequences** (folders
`ThirdPerson` and `FirstPerson`). Insert it into Studio, then publish the ones you want with the
Animation Editor (load the sequence onto an R15 rig → *Publish to Roblox*) and play them with a
normal `Animator`. Notes:

* Markers are exported as KeyframeMarkers: `track:GetMarkerReachedSignal("HitStart")`.
* The sword pose is named **`Handle`**: give your katana's root part that name and attach it with a
  `Motor6D` from `RightHand` with `C0 = CFrame.new(0, -0.15, 0) * CFrame.Angles(math.rad(-90), 0, 0)`.
* Root motion (vault, mantle, lunge, attack steps) can't be stored in a KeyframeSequence — move the
  HumanoidRootPart yourself, or use the AAA Motion runtime which applies it with motion warping.
* Additive flinches are baked onto the combat stance, since KeyframeSequences are absolute.

## How the runtime works

* **Procedural playback.** Clips are compact Hermite curves (`Generated/Clips`). Every client
  animates every AAA character (`CharacterDriver`) by evaluating a layered blend
  (locomotion → actions → upper-body overlays → additive) and writing `Motor6D.Transform` in
  `RunService.PreSimulation`. Locomotion blends walk/run/sprint by speed with phase sync (no foot
  sliding), leans into turns and acceleration, and freezes for hit-stop.
* **Replication.** Locomotion comes from replicated physics; one-shot actions are relayed by the
  server (`Play`/`Stop`); persistent state (`AAA_Armed`, `AAA_Crouch`, `AAA_Blocking`) is attributes,
  so late joiners see the right stance.
* **Movement** (`LocalController`) uses `LinearVelocity`/`AlignOrientation`: eased dash profile,
  friction slide, reduced-gravity wall run with wall tracking, coyote time, and clip root motion with
  motion warping for vault/mantle (the clip is retargeted to the real obstacle height/distance).
* **Combat** is server-authoritative. The attacker's client detects hits from the baked blade path
  (`Combat/HitQuery`: hitbox + closest blade pass → exact contact time), shows the impact at once,
  and claims the hit; the server validates timing and reach, resolves block / parry window / guard
  meter / guard break, applies damage and knockback and broadcasts the verdict to everyone.
* **First person** (`Viewmodel`) mirrors every action onto its FP_ clip and drives the camera from
  the clip's camera joint plus bob, sway and strafe roll.
* Tune speeds, attack data and defense numbers in `tools/anim/tuning.mjs` (exported to
  `Generated/Tuning`); keys, camera and graphics options in `Config.luau`.

```
src/ReplicatedStorage/AAAMotion/      shared: Animation/, Combat/, VFX/, Generated/, Config, Net, Util
src/StarterPlayer/.../AAAMotionClient  client: drivers, controller, camera, viewmodel, input, HUD
src/ServerScriptService/AAAMotionServer  server: combat authority, arena, dummies + AI rival
export/                                AAAMotion.rbxl (playable place), AAAMotionAnimations.rbxm
assets/textures/                       particle/decal textures to upload
tools/                                 authoring pipeline, preview renderer, exporters, tests
```

## Tooling (Node 18+)

```bash
cd tools && npm install
npm run build                      # evaluate all clip sources -> build/clips.json (+ baked swings)
node anim/export-luau.mjs          # -> src/ReplicatedStorage/AAAMotion/Generated
node anim/export-rbxmx.mjs         # -> export/AAAMotionAnimations.rbxm (needs rojo on PATH)
node preview/sheet.mjs --clip Light1,Light2 --n 8      # contact sheets for reviewing poses
npm run render -- --seq combat --out ../media/aaa_combat.mp4   # showcase video (resumable)
node preview/export-textures.mjs   # -> assets/textures/*.png
test/luaurun/build.sh && node test/parity.mjs           # Luau runtime vs JS reference
```

Rendering uses headless Chromium + three.js + ffmpeg; `render.mjs` writes finished segments to
`build/render/` and resumes where it stopped if interrupted.

## Verification

* `luau-lsp analyze` with the Roblox type definitions and a Rojo sourcemap: no diagnostics across
  the runtime (non-strict mode).
* Parity test: the Luau animation runtime, run in a real Luau VM, reproduces the JS animator that
  rendered the videos — 3,840 joint samples over a 12 s scripted sequence (locomotion blends,
  jumps, dash, combo with hit-stop, overlays, charge/release, block, flinch, vault) agree within
  0.0002° and 0.00005 studs, with an identical marker/event stream. Hit geometry checks pass.
* KeyframeSequence export round trip (parse the exported sequences, interpolate like Roblox,
  compare with the source curves): within 0.005 studs everywhere and within 1.7° even at the
  fastest one-frame strike.
* `rojo build` produces the place and model files.
* Not yet play-tested inside Roblox Studio itself (no Studio in the build environment) — the
  movement physics, network relay and effect visuals have only been checked statically. Expect to
  tune feel numbers (`tuning.mjs`, `Config.luau`) once you play it.
