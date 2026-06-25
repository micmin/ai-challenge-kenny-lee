export type GameStatus = 'lobby' | 'active' | 'reveal' | 'voting' | 'done';
export type StepType = 'caption' | 'image';
export type StepStatus = 'pending' | 'filled';

export interface Player {
  id: string;
  name: string;
  joinOrder: number;
}

export interface Step {
  id: string;
  chainId: string;
  position: number;
  type: StepType;
  authorPlayerId: string | null;
  content: string;
  isAutoFilled: boolean;
  status: StepStatus;
  deadline: number | null;
}

export interface Chain {
  id: string;
  gameId: string;
  seedPlayerId: string;
  steps: Step[];
}

export interface Game {
  id: string;
  hostId: string;
  status: GameStatus;
  turnDeadlineMs: number;
  players: Player[];
  chains: Chain[];
  createdAt: number;
}
