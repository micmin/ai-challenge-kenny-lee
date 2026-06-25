import { getStateHandler } from '../../../../server/http/handlers';
import { getGameService } from '../../../../server/http/service';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return getStateHandler(getGameService(), id, request);
}
