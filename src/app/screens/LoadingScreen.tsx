import { useEffect, useState } from 'react';
import { GenerationProgress } from '../../game/WorldLoader';
import { useT } from '../../i18n';

interface Props {
  progress: GenerationProgress;
}

const FLAVOUR_KEYS = [
  'flavour.1', 'flavour.2', 'flavour.3', 'flavour.4',
  'flavour.5', 'flavour.6', 'flavour.7', 'flavour.8',
];

export function LoadingScreen({ progress }: Props): JSX.Element {
  const t = useT();
  const [flavourIndex, setFlavourIndex] = useState(() =>
    Math.floor(Math.random() * FLAVOUR_KEYS.length),
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setFlavourIndex((i) => (i + 1) % FLAVOUR_KEYS.length);
    }, 4800);
    return () => window.clearInterval(id);
  }, []);

  const pct = Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100);

  return (
    <div className="loading-screen">
      <div className="title-block">
        <h1 className="title" style={{ fontSize: 40 }}>
          World<em>Smith</em>
        </h1>
      </div>
      <div className="loading-stage">{t(progress.stage, progress.params)}</div>
      <div className="loading-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="loading-detail">{pct}%</div>
      <div className="loading-flavour">{t(FLAVOUR_KEYS[flavourIndex])}</div>
    </div>
  );
}
