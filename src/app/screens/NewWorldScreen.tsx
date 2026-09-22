import { useState } from 'react';
import { NewWorldOptions } from '../../game/WorldLoader';
import { ClimatePreset, Difficulty, WorldSizePreset, WORLD_SIZE_TILES, TILE_SIZE } from '../../world/types';

interface Props {
  onCancel: () => void;
  onCreate: (options: NewWorldOptions) => void;
}

const SIZES: { id: WorldSizePreset; label: string; note: string }[] = [
  { id: 'small', label: 'Small', note: `${(WORLD_SIZE_TILES.small * TILE_SIZE) / 1000} km across` },
  { id: 'medium', label: 'Medium', note: `${(WORLD_SIZE_TILES.medium * TILE_SIZE) / 1000} km across` },
  { id: 'large', label: 'Large', note: `${(WORLD_SIZE_TILES.large * TILE_SIZE) / 1000} km across` },
];

const CLIMATES: { id: ClimatePreset; label: string; note: string }[] = [
  { id: 'temperate', label: 'Temperate', note: 'Mixed forest, four clear seasons' },
  { id: 'cold', label: 'Cold', note: 'Taiga and tundra, hard winters' },
  { id: 'warm', label: 'Warm', note: 'Long growing season, storms' },
  { id: 'arid', label: 'Arid', note: 'Dry plains, scarce timber' },
];

const DIFFICULTIES: { id: Difficulty; label: string; note: string }[] = [
  { id: 'relaxed', label: 'Relaxed', note: 'Generous supplies, forgiving winters' },
  { id: 'normal', label: 'Normal', note: 'The intended balance' },
  { id: 'harsh', label: 'Harsh', note: 'Little margin for error' },
];

const NAME_SUGGESTIONS = [
  'Newholt', 'Ashford', 'Greyvale', 'Brackwater', 'Elderfell', 'Stonereach',
  'Wintermere', 'Oakhollow', 'Fairstead', 'Thornby',
];

export function NewWorldScreen({ onCancel, onCreate }: Props): JSX.Element {
  const [name, setName] = useState(() => NAME_SUGGESTIONS[Math.floor(Math.random() * NAME_SUGGESTIONS.length)]);
  const [seedText, setSeedText] = useState(() => Math.floor(Math.random() * 1e9).toString(36));
  const [size, setSize] = useState<WorldSizePreset>('medium');
  const [climate, setClimate] = useState<ClimatePreset>('temperate');
  const [resourceDensity, setResourceDensity] = useState(1);
  const [settlers, setSettlers] = useState(6);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');

  const submit = (): void => {
    onCreate({ name, seedText, size, climate, resourceDensity, startingSettlers: settlers, difficulty });
  };

  return (
    <div className="menu-screen">
      <div className="title-block">
        <h1 className="title" style={{ fontSize: 40 }}>
          New World
        </h1>
      </div>

      <div className="panel form-card">
        <h2>Found a settlement</h2>
        <div className="hint">
          Your settlers arrive with what they can carry. Everything else has to be cut, quarried,
          hauled and built.
        </div>

        <div className="two-col">
          <div className="field">
            <label htmlFor="world-name">Settlement name</label>
            <input
              id="world-name"
              type="text"
              value={name}
              maxLength={28}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="world-seed">Seed</label>
            <input
              id="world-seed"
              type="text"
              value={seedText}
              maxLength={32}
              onChange={(e) => setSeedText(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label>World size</label>
          <div className="choice-row">
            {SIZES.map((s) => (
              <button
                key={s.id}
                className={`choice ${size === s.id ? 'active' : ''}`}
                onClick={() => setSize(s.id)}
              >
                {s.label}
                <small>{s.note}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Climate</label>
          <div className="choice-row">
            {CLIMATES.map((c) => (
              <button
                key={c.id}
                className={`choice ${climate === c.id ? 'active' : ''}`}
                onClick={() => setClimate(c.id)}
              >
                {c.label}
                <small>{c.note}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="two-col">
          <div className="field">
            <label htmlFor="density">Resource density — {resourceDensity.toFixed(2)}x</label>
            <input
              id="density"
              type="range"
              min={0.6}
              max={1.6}
              step={0.05}
              value={resourceDensity}
              onChange={(e) => setResourceDensity(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="settlers">Starting settlers — {settlers}</label>
            <input
              id="settlers"
              type="range"
              min={3}
              max={16}
              step={1}
              value={settlers}
              onChange={(e) => setSettlers(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field">
          <label>Difficulty</label>
          <div className="choice-row">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                className={`choice ${difficulty === d.id ? 'active' : ''}`}
                onClick={() => setDifficulty(d.id)}
              >
                {d.label}
                <small>{d.note}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button className="btn ghost" onClick={onCancel}>
            Back
          </button>
          <button className="btn primary" style={{ minWidth: 180 }} onClick={submit}>
            Create World
          </button>
        </div>
      </div>
    </div>
  );
}
