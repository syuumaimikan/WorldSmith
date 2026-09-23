import { useState } from 'react';
import { NewWorldOptions } from '../../game/WorldLoader';
import {
  ClimatePreset,
  Difficulty,
  WorldSizePreset,
  WorldEra,
  GameMode,
  WORLD_SIZE_TILES,
  TILE_SIZE,
} from '../../world/types';
import { WORLD_ERAS } from '../../world/eras';
import { GAME_MODES } from '../../world/modes';
import { useT } from '../../i18n';

interface Props {
  onCancel: () => void;
  onCreate: (options: NewWorldOptions) => void;
}

const SIZES: WorldSizePreset[] = ['small', 'medium', 'large'];
const CLIMATES: ClimatePreset[] = ['temperate', 'cold', 'warm', 'arid'];
const DIFFICULTIES: Difficulty[] = ['relaxed', 'normal', 'harsh'];
const ERAS: WorldEra[] = WORLD_ERAS;
const MODES: GameMode[] = GAME_MODES;

const PLAYER_NAMES = [
  'Wayfarer', 'Aldis', 'Bran', 'Cerrin', 'Dara', 'Eirik', 'Fen', 'Gwen',
  'Halli', 'Ida', 'Joran', 'Kestrel', 'Lira', 'Maeve', 'Nial', 'Orin',
];

const NAME_SUGGESTIONS = [
  'Newholt', 'Ashford', 'Greyvale', 'Brackwater', 'Elderfell', 'Stonereach',
  'Wintermere', 'Oakhollow', 'Fairstead', 'Thornby',
];

export function NewWorldScreen({ onCancel, onCreate }: Props): JSX.Element {
  const t = useT();
  const [name, setName] = useState(
    () => NAME_SUGGESTIONS[Math.floor(Math.random() * NAME_SUGGESTIONS.length)],
  );
  const [seedText, setSeedText] = useState(() => Math.floor(Math.random() * 1e9).toString(36));
  const [size, setSize] = useState<WorldSizePreset>('medium');
  const [climate, setClimate] = useState<ClimatePreset>('temperate');
  const [resourceDensity, setResourceDensity] = useState(1);
  const [settlers, setSettlers] = useState(6);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [era, setEra] = useState<WorldEra>('prehistory');
  const [mode, setMode] = useState<GameMode>('survival');
  const [playerName, setPlayerName] = useState(
    () => PLAYER_NAMES[Math.floor(Math.random() * PLAYER_NAMES.length)],
  );

  const submit = (): void => {
    onCreate({
      name,
      seedText,
      size,
      climate,
      resourceDensity,
      startingSettlers: settlers,
      difficulty,
      era,
      mode,
      playerName,
    });
  };

  return (
    <div className="menu-screen">
      <div className="title-block">
        <h1 className="title" style={{ fontSize: 40 }}>
          {t('new.heading')}
        </h1>
      </div>

      <div className="panel form-card">
        <h2>{t('new.found')}</h2>
        <div className="hint">{t('new.hint')}</div>

        <div className="field">
          <label htmlFor="player-name">{t('new.playerName')}</label>
          <input
            id="player-name"
            type="text"
            value={playerName}
            maxLength={32}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <div className="hint">{t('new.playerName.note')}</div>
        </div>

        <div className="two-col">
          <div className="field">
            <label htmlFor="world-name">{t('new.name')}</label>
            <input
              id="world-name"
              type="text"
              value={name}
              maxLength={28}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="world-seed">{t('new.seed')}</label>
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
          <label>{t('new.size')}</label>
          <div className="choice-row">
            {SIZES.map((s) => (
              <button
                key={s}
                className={`choice ${size === s ? 'active' : ''}`}
                onClick={() => setSize(s)}
              >
                {t(`new.size.${s}`)}
                <small>{t('new.size.note', { km: (WORLD_SIZE_TILES[s] * TILE_SIZE) / 1000 })}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('new.climate')}</label>
          <div className="choice-row">
            {CLIMATES.map((c) => (
              <button
                key={c}
                className={`choice ${climate === c ? 'active' : ''}`}
                onClick={() => setClimate(c)}
              >
                {t(`new.climate.${c}`)}
                <small>{t(`new.climate.${c}.note`)}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('new.era')}</label>
          <div className="choice-row wrap">
            {ERAS.map((e) => (
              <button
                key={e}
                className={`choice ${era === e ? 'active' : ''}`}
                onClick={() => setEra(e)}
              >
                {t(`new.era.${e}`)}
                <small>{t(`new.era.${e}.note`)}</small>
              </button>
            ))}
          </div>
          <div className="hint">{t('new.era.hint')}</div>
        </div>

        <div className="field">
          <label>{t('new.mode')}</label>
          <div className="choice-row wrap">
            {MODES.map((m) => (
              <button
                key={m}
                className={`choice ${mode === m ? 'active' : ''}`}
                onClick={() => setMode(m)}
              >
                {t(`new.mode.${m}`)}
                <small>{t(`new.mode.${m}.note`)}</small>
              </button>
            ))}
          </div>
          <div className="hint">{t('new.mode.hint')}</div>
        </div>

        <div className="two-col">
          <div className="field">
            <label htmlFor="density">
              {t('new.density', { value: resourceDensity.toFixed(2) })}
            </label>
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
            <label htmlFor="settlers">{t('new.settlers', { value: settlers })}</label>
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
          <label>{t('new.difficulty')}</label>
          <div className="choice-row">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                className={`choice ${difficulty === d ? 'active' : ''}`}
                onClick={() => setDifficulty(d)}
              >
                {t(`new.difficulty.${d}`)}
                <small>{t(`new.difficulty.${d}.note`)}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button className="btn ghost" onClick={onCancel}>
            {t('new.back')}
          </button>
          <button className="btn primary" style={{ minWidth: 180 }} onClick={submit}>
            {t('new.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
