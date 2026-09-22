import { useEffect, useState } from 'react';
import { GenerationProgress } from '../../game/WorldLoader';

interface Props {
  progress: GenerationProgress;
}

const FLAVOUR = [
  'A river finds the lowest ground, and everything else follows the river.',
  'Forests grow where the rain reaches; deserts sit in the shadow of mountains.',
  'Settlements gather where flat ground, fresh water and timber meet.',
  'Every plank in this world will have to be sawn from a log somebody felled.',
  'A house is not placed. It is staked out, footed, framed, walled and roofed.',
  'Roads halve the time a hauler spends walking. They are worth more than they look.',
  'Nothing arrives on site by itself. Someone carries it there.',
  'Cut a forest faster than it grows and it will not be there next winter.',
];

export function LoadingScreen({ progress }: Props): JSX.Element {
  const [flavourIndex, setFlavourIndex] = useState(() => Math.floor(Math.random() * FLAVOUR.length));

  useEffect(() => {
    const id = window.setInterval(() => {
      setFlavourIndex((i) => (i + 1) % FLAVOUR.length);
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
      <div className="loading-stage">{progress.stage}</div>
      <div className="loading-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="loading-detail">{pct}%</div>
      <div className="loading-flavour">{FLAVOUR[flavourIndex]}</div>
    </div>
  );
}
