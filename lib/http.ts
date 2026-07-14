import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function parseJson<T>(request: Request, schema: ZodType<T>) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  return schema.parse(body);
}

export async function handleApi<T>(handler: () => Promise<T>, status = 200) {
  try {
    return NextResponse.json(await handler(), { status });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          type: "https://health-quiz.dev/problems/validation",
          title: "Validation failed",
          status: 422,
          code: "VALIDATION_ERROR",
          errors: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422, headers: { "content-type": "application/problem+json" } },
      );
    }

    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          type: `https://health-quiz.dev/problems/${error.code.toLowerCase()}`,
          title: error.message,
          status: error.status,
          code: error.code,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
        { status: error.status, headers: { "content-type": "application/problem+json" } },
      );
    }

    console.error(error);
    return NextResponse.json(
      {
        type: "https://health-quiz.dev/problems/internal-error",
        title: "Unexpected server error",
        status: 500,
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: { "content-type": "application/problem+json" } },
    );
  }
}
