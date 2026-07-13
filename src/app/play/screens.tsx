'use client';
import { useState } from 'react';
import type { Game } from '../../engine/index';

const box: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 12, padding: 16, marginTop: 16 };
const img: React.CSSProperties = { maxWidth: '100%', borderRadius: 8, display: 'block' };

export function StartScreen({ busy, onStart }: { busy: boolean; onStart: (seed: string, aiCount: number) => void }) {
  const [seed, setSeed] = useState('');
  const [aiCount, setAiCount] = useState(3);
  return (
    <section style={box}>
      <p>You play one seat; the AI plays the rest and draws every picture.</p>
      <label>AI opponents:{' '}
        <select value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))} disabled={busy}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <p style={{ marginTop: 12 }}>Your opening idea:</p>
      <input style={{ width: '100%', padding: 8 }} value={seed} disabled={busy}
        placeholder="a cat doing taxes" onChange={(e) => setSeed(e.target.value)} />
      <button style={{ marginTop: 12, padding: '8px 16px' }} disabled={busy || seed.trim() === ''}
        onClick={() => onStart(seed.trim(), aiCount)}>
        {busy ? 'Starting…' : 'Start game'}
      </button>
    </section>
  );
}

export function AiPlayingScreen({ feed }: { feed: string[] }) {
  return (
    <section style={box}>
      <p>🤖 The AI is playing…</p>
      <ul>{feed.map((line, i) => <li key={i}>{line}</li>)}</ul>
    </section>
  );
}

export function YourTurnScreen({
  image, round, total, busy, onSubmit,
}: { image: string | null; round: number; total: number; busy: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <section style={box}>
      <p>Round {round} of {total} — what is this?</p>
      {image ? <img src={image} alt="the image handed to you" style={img} /> : <p>(no image)</p>}
      <input style={{ width: '100%', padding: 8, marginTop: 12 }} value={text} disabled={busy}
        placeholder="write a caption" onChange={(e) => setText(e.target.value)} />
      <button style={{ marginTop: 12, padding: '8px 16px' }} disabled={busy || text.trim() === ''}
        onClick={() => { onSubmit(text.trim()); setText(''); }}>
        {busy ? 'Submitting…' : 'Submit'}
      </button>
    </section>
  );
}

export function RevealScreen({ game, busy, onPick }: { game: Game; busy: boolean; onPick: (chainId: string) => void }) {
  return (
    <section style={box}>
      <h2>The big reveal</h2>
      {game.chains.map((chain) => (
        <div key={chain.id} style={{ ...box, background: '#fafafa' }}>
          {chain.steps.map((step) => (
            <div key={step.id} style={{ marginBottom: 8 }}>
              {step.type === 'image'
                ? <img src={step.content} alt="drawn step" style={img} />
                : <p>"{step.content}"{step.isAutoFilled ? ' 🤖' : ''}</p>}
            </div>
          ))}
          <button disabled={busy} onClick={() => onPick(chain.id)}>Pick this one as funniest</button>
        </div>
      ))}
    </section>
  );
}

export function ResultsScreen({ game, onPlayAgain }: { game: Game; onPlayAgain: () => void }) {
  const winner = game.chains.find((c) => c.id === game.winnerChainId);
  const finalImage = winner?.steps.filter((s) => s.type === 'image').at(-1);
  return (
    <section style={box}>
      <h2>Your pick</h2>
      {finalImage ? <img src={finalImage.content} alt="the chain you picked" style={img} /> : <p>No pick recorded.</p>}
      <button style={{ marginTop: 12, padding: '8px 16px' }} onClick={onPlayAgain}>Play again</button>
    </section>
  );
}
