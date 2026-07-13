'use client';
import { useState } from 'react';
import { createSolo, stepAi, submitCaption, pickWinner, type GameView } from './api';
import { deriveScreen, imageForTask, roundOf } from './screen';
import { StartScreen, AiPlayingScreen, YourTurnScreen, RevealScreen, ResultsScreen } from './screens';

type Phase = 'start' | 'stepping' | 'yourTurn' | 'reveal' | 'done';

export default function PlayPage() {
  const [phase, setPhase] = useState<Phase>('start');
  const [gameId, setGameId] = useState('');
  const [hostId, setHostId] = useState('');
  const [view, setView] = useState<GameView | null>(null);
  const [feed, setFeed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runStepLoop(gId: string, hId: string) {
    setPhase('stepping');
    setFeed([]);
    for (let guard = 0; guard < 500; guard += 1) {
      const result = await stepAi(gId, hId);
      if (result.filled) {
        setView(result.view);
        setFeed((f) => [...f, `🤖 ${result.authorName ?? 'AI'} — Claude captioned, 🎨 Imagen drew`]);
        continue;
      }
      setView(result.view);
      const next = deriveScreen(result.view.game);
      setPhase(next === 'reveal' ? 'reveal' : next === 'done' ? 'done' : 'yourTurn');
      return;
    }
    setError('too many AI steps — stopping');
  }

  async function handleStart(seed: string, aiCount: number) {
    setBusy(true); setError(null);
    try {
      const { gameId: gId, hostId: hId } = await createSolo(seed, aiCount);
      setGameId(gId); setHostId(hId);
      await runStepLoop(gId, hId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function handleSubmit(text: string) {
    if (!view) return;
    setBusy(true); setError(null);
    try {
      await submitCaption(gameId, hostId, view.pendingTasks[0].id, text);
      await runStepLoop(gameId, hostId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function handlePick(chainId: string) {
    setBusy(true); setError(null);
    try {
      const game = await pickWinner(gameId, chainId);
      setView((v) => (v ? { ...v, game } : v));
      setPhase('done');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function playAgain() {
    setPhase('start'); setView(null); setFeed([]); setError(null);
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 680, margin: '0 auto' }}>
      <h1>DriftDraw</h1>
      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}
      {phase === 'start' && <StartScreen busy={busy} onStart={handleStart} />}
      {phase === 'stepping' && <AiPlayingScreen feed={feed} />}
      {phase === 'yourTurn' && view && (
        <YourTurnScreen
          image={imageForTask(view.game, view.pendingTasks[0])}
          round={roundOf(view.pendingTasks[0])}
          total={view.game.players.length}
          busy={busy}
          onSubmit={handleSubmit}
        />
      )}
      {phase === 'reveal' && view && <RevealScreen game={view.game} busy={busy} onPick={handlePick} />}
      {phase === 'done' && view && <ResultsScreen game={view.game} onPlayAgain={playAgain} />}
    </main>
  );
}
