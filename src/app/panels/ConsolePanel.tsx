/**
 * The command line.
 *
 * Deliberately plain: a scrollback, a prompt, a history you can arrow
 * through and tab completion on the verb. It sits at the bottom of the
 * screen rather than in a window because it is a thing you type into while
 * looking at the world, not a panel you open instead of looking at it.
 */

import { useEffect, useRef, useState } from 'react';
import { Game } from '../../game/Game';
import { completions, runCommand } from '../../game/Commands';
import { useT } from '../../i18n';

interface Props {
  game: Game;
  onClose: () => void;
}

interface Line {
  text: string;
  bad: boolean;
}

export function ConsolePanel({ game, onClose }: Props): JSX.Element {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [{ text: t('cmd.opened'), bad: false }]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const submit = (): void => {
    const line = text.trim();
    if (!line) return;
    setText('');
    setHistory((h) => [line, ...h].slice(0, 60));
    setHistoryAt(-1);
    const result = runCommand({ game, world: game.world, t }, line);
    setLines((prev) =>
      [
        ...prev,
        { text: '> ' + line, bad: false },
        ...result.lines.map((l) => ({ text: l, bad: !result.ok })),
      ].slice(-200),
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // Everything typed here is text, not movement: the world must not walk
    // away underneath a command being typed.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const head = text.replace(/^\//, '').split(' ')[0];
      const matches = completions(head);
      if (matches.length === 1) setText('/' + matches[0] + ' ');
      else if (matches.length > 1) {
        setLines((prev) => [...prev, { text: matches.join('  '), bad: false }]);
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = e.key === 'ArrowUp'
        ? Math.min(history.length - 1, historyAt + 1)
        : Math.max(-1, historyAt - 1);
      setHistoryAt(next);
      setText(next < 0 ? '' : history[next]);
    }
  };

  return (
    <div className="console">
      <div className="console-scroll selectable" ref={scrollRef}>
        {lines.map((l, i) => (
          <div key={i} className={l.bad ? 'console-line bad' : 'console-line'}>
            {l.text}
          </div>
        ))}
      </div>
      <div className="console-prompt">
        <span className="console-caret">/</span>
        <input
          ref={inputRef}
          type="text"
          value={text}
          spellCheck={false}
          autoComplete="off"
          placeholder={t('cmd.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
