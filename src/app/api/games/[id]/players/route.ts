import { joinGameHandler } from '../../../../../server/http/handlers';
import { getGameService } from '../../../../../server/http/service';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return joinGameHandler(getGameService(), id, request);
}
