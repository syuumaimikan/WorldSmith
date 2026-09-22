# WorldSmith — Art Direction

Derived from analysis of the 8 supplied reference images. This document is the
authority for every visual decision in the project. Where this document and the
general guidance in the design brief disagree, **this document wins** (except
where readability or performance would be destroyed).

---

## 1. Reference image analysis

### Image 1 — Isometric low-poly world diorama (mountains / river / villages)

- **Framing**: high isometric diorama on a flat pastel-blue backdrop. The world
  is a *finite slab* with visible earth-brown cross-section sides.
- **Palette**: saturated grass green (#6FA83C–#8FBF4A), cyan-leaning river blue
  (#3FB4E8), warm dirt paths (#C8A06A), cool grey rock (#8A8D93), snow
  (#F2F4F6), terracotta roofs (#B5462F).
- **Geometry**: extremely faceted. Mountains are hard angular ridges with flat
  triangular snow caps — no smooth normals anywhere. Trees are cone/sphere
  clusters on straight trunks.
- **Lighting**: single sun from upper-left, ~45 degrees. Shadows are short,
  soft-edged and low-contrast — they darken rather than blacken.
- **Density**: paths form an actual *network*. Settlements cluster at river
  crossings and path junctions. Trees clump into groves, never a uniform carpet.
- **Takeaway**: flat shading everywhere; roads as a visible connective network;
  settlements at meaningful terrain features; strong horizon haze so the world
  reads as a diorama.

### Images 2 and 3 — Low-poly animal sets

- Animals are 20–120 triangle silhouettes. Legs are simple tapered boxes, bodies
  are single extruded prisms, heads are cubes with tiny detail wedges.
- Flat solid colours per body part, no textures at all. Markings (zebra, tiger,
  giraffe) are done by **separate coloured faces**, not textures.
- Every model sits on a soft elliptical contact shadow.
- **Takeaway**: wildlife is built from primitives with per-part colour; contact
  shadow blobs are mandatory for grounding. Silhouette beats detail.

### Images 4 and 5 — Chibi hooded character concepts (red / blue)

- **Proportions**: head plus hood is ~45% of total height. Tiny body, no visible
  neck. Big oval eyes — pure white voids on black, no pupils, no mouth.
- The hood has a pronounced backward-curving horn tip — the key silhouette.
- A cape/cloak flares behind and reads as the character's biggest shape.
- Palette is 3 colours only: cloak accent (crimson #E23B4A / navy #1E3A5F),
  near-black body (#1A1A20), eye white (#F5F5F0).
- **Takeaway**: WorldSmith's player and NPCs are hooded, glowing-eyed,
  cape-wearing chibi figures. Profession is communicated by cloak colour.

### Image 6 — Low-poly 3D realisation of the hooded character

- Confirms the concepts translate to blocky geometry: capsule hood, cone cape,
  cylinder limbs, glowing lime eyes (#D8F24A) on a black face plate.
- Hands are simple dark paddles. Legs taper into ragged points.
- **Takeaway**: this is literally the target player model. Glowing eyes are an
  emissive flat colour, bright enough to read at night.

### Image 7 — Low-poly alpine valley

- **Atmosphere**: this is the *distance* reference. Strong aerial perspective —
  far mountains desaturate toward the sky colour and lose almost all contrast.
- Sky is a clean vertical gradient, deep cyan at zenith to pale at horizon. A few
  hard-edged flat white clouds, no soft volumetrics.
- Shadows are long, soft, and clearly blue-tinted (bounce light), never grey.
- Conifers are dark saturated green cones packed densely on slopes; deciduous
  trees are lighter, rounder, and scattered on the valley floor.
- **Takeaway**: fog colour must match sky horizon colour exactly. Exponential fog
  plus desaturation gives "beautiful from a hilltop" for free.

### Image 8 — Low-poly vegetation pack (seasonal)

- Trees come in **families with variation**: same trunk archetype, many canopy
  shapes, scales and rotations.
- Four clear seasonal tints: summer green, autumn orange/gold, winter snow-capped
  white-on-green, dead bare branches.
- Rocks are single convex lumps with 8–14 faces, some with snow/moss caps — a
  *second material on the top faces only*.
- Grass and flowers are tiny crossed or clustered blades in bright accent colours.
- **Takeaway**: one parametric tree generator with per-biome and per-season
  presets plus per-instance variation. Rocks get a cap colour driven by biome.

---

## 2. Consolidated WorldSmith style rules

| Aspect | Rule |
|---|---|
| Shading | **Flat shading only** (`flatShading: true`). No smooth normals on terrain, rocks, trees or characters. |
| Textures | None. Colour comes from vertex colours and per-material flat colours. |
| Materials | `MeshLambertMaterial` for nearly everything (cheap, matches the soft diffuse look). Emissive flats for eyes, lamps and lit windows. |
| Sun | Single `DirectionalLight`, warm white #FFF4DC, intensity ~1.25, from upper-left, elevation animated by time of day. |
| Ambient | `HemisphereLight` — sky #BBD7F0 / ground #5A6B3A, intensity ~0.75. Produces the blue-tinted shadows from Image 7. |
| Shadows | PCF soft, 2048 map, tight frustum that follows the player. Only near objects cast. |
| Fog | `FogExp2`, colour identical to the sky horizon colour, density retuned per weather and time of day. |
| Sky | Vertical gradient shader dome plus flat billboard clouds. Colours lerp through dawn/day/dusk/night. |
| Tone mapping | ACES Filmic, exposure ~1.0, sRGB output. |
| Camera | Third-person, FOV 55, default distance 9m, height offset 2.1m. Build mode lifts to a 60-degree pitched overhead. |
| Scale | Player ~1.6m tall. Small house 6x6m. Trees 4–9m. Keeps the diorama feel of Image 1. |
| Silhouette | Every asset must be identifiable as a black silhouette. Detail below ~0.15m is not modelled. |
| Contact shadows | Every character, animal and small prop gets a cheap dark ellipse decal, per Images 2 and 3. |

---

## 3. Master palette

Defined once in `src/render/Palette.ts`. No colour literal may appear anywhere
else in the codebase.

```
TERRAIN
  grass         #74A83E   grassDry    #A8B056   grassLush  #5E9A34
  dirt          #9C7A4E   path        #C0A070   sand       #E0CE94
  rock          #8A8D93   rockDark    #6E7178   snow       #F0F3F6
  tundra        #9AA88C   savanna     #C2B05A   wetland    #5F8A5A
WATER
  shallow       #58C0E8   deep        #2C7FB8   foam       #E8F6FF
VEGETATION
  leafSummer    #4E8C32   leafSpring  #6FB347   leafAutumn #D2822E
  leafDead      #7A6A4A   conifer     #2F5F3A   trunk      #6B4A2F
BUILD
  wood          #B07B45   woodDark    #7A5230   plaster    #E2D5BB
  roofTile      #B5462F   roofThatch  #C4A05A   stone      #9AA0A6
  scaffold      #C79A5B   windowLit   #FFE9A8   windowDark #6E8CA0
CHARACTER
  body          #1A1A20   eye         #D8F24A
  cloak.builder #E23B4A   cloak.logger #3F8F4F  cloak.farmer #D8A83C
  cloak.miner   #7A7F8A   cloak.hauler #C97A2E  cloak.crafter #8F5BA8
  cloak.trader  #2F7FA8   cloak.player #E23B4A (gold trim)
SKY day        zenith #2E8FD6  horizon #BBD7F0
SKY dawn       zenith #4E76B8  horizon #F2C29A
SKY dusk       zenith #3A5A96  horizon #E89A6A
SKY night      zenith #0C1430  horizon #22304F
```

The authoritative values live in code; this table records the intent.

---

## 4. Non-negotiables taken from the references

1. **Nothing is smooth-shaded.** If it looks smooth, it is a bug.
2. **The horizon must haze out.** Distant terrain desaturates into the sky.
3. **Roads are visible and connect things.** A settlement without a path network
   does not match Image 1.
4. **Groves, not carpets.** Vegetation clusters with clear open ground between.
5. **Characters are hooded chibi figures with glowing eyes.** Not capsules.
6. **Colour identifies function.** Cloak colour equals profession, at a glance.
