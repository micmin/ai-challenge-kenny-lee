import { createGameHandler } from '../../../server/http/handlers';
import { getGameService } from '../../../server/http/service';

export async function POST(request: Request): Promise<Response> {
  return createGameHandler(getGameService(), request);
}
