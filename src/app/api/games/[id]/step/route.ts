import { stepHandler } from '../../../../../server/http/handlers';
import { getGameService } from '../../../../../server/http/service';

export const maxDuration = 60;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return stepHandler(getGameService(), id, request);
}
