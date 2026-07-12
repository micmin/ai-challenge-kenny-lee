import { createSoloGameHandler } from '../../../../server/http/handlers';
import { getGameService } from '../../../../server/http/service';

export async function POST(request: Request): Promise<Response> {
  return createSoloGameHandler(getGameService(), request);
}
