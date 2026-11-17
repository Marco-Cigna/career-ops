import { readJsonObject } from "@/lib/json-body";
import { generateJobQuestions, loadJobQuestions, QuestionsError, saveJobQuestions } from "@/lib/job-questions-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
type Context = { params: Promise<{ n: string }> };

function failure(error: unknown) {
  const status = error instanceof QuestionsError ? error.status : error instanceof SyntaxError ? 422 : 400;
  return Response.json({ error: error instanceof Error ? error.message : "The questions could not be processed." }, { status });
}

export async function GET(_req: Request, { params }: Context) {
  try { return Response.json((await loadJobQuestions((await params).n)).snapshot); }
  catch (error) { return failure(error); }
}

export async function PUT(req: Request, { params }: Context) {
  try {
    const body = await readJsonObject(req);
    if (!body) throw new QuestionsError("Questions and a saved version are required.");
    return Response.json(await saveJobQuestions((await params).n, body.version, body.questions));
  } catch (error) { return failure(error); }
}

export async function POST(req: Request, { params }: Context) {
  try {
    const body = await readJsonObject(req);
    if (!body) throw new QuestionsError("Questions and an AI tool are required.");
    return Response.json(await generateJobQuestions((await params).n, body.version, body.questions, body.ids, body.cliId, req.signal));
  } catch (error) { return failure(error); }
}
