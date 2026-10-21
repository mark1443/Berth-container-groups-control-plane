import type { ErrorCode } from "@workspace/api-zod";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export type { ErrorCode };

/**
 * The one error shape every route produces (architecture §8):
 * `{ error: { code, message, details? } }`. Services throw these; the
 * middleware below translates them. Anything else becomes 500 INTERNAL
 * with no details leaked.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, "BAD_REQUEST", message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Sign in to use Berth") {
    super(401, "UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "This account is not an operator of this Berth instance") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      404,
      "NOT_FOUND",
      id ? `${resource} ${id} was not found` : `${resource} was not found`,
      id ? { resource, id } : { resource },
    );
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(409, code, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    code: ErrorCode = "VALIDATION_ERROR",
  ) {
    super(422, code, message, details);
  }

  static fromZod(err: ZodError, where = "body"): ValidationError {
    const issues = err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    const first = issues[0];
    const summary = first
      ? `${first.path ? `${first.path}: ` : ""}${first.message}`
      : "Invalid input";
    return new ValidationError(`Invalid ${where}: ${summary}`, { where, issues });
  }
}

/** 502: the runtime behind a provider could not be reached or said no. */
export class ProviderError extends AppError {
  constructor(
    code: Extract<ErrorCode, "PROVIDER_UNREACHABLE" | "PROVIDER_REJECTED">,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(502, code, sanitize(message), details);
  }
}

/** Strip anything that looks like a secret or a bearer token out of a message. */
export function sanitize(message: string): string {
  return message
    .replace(/(password|passwd|secret|token|key)(["']?\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted key material]")
    .slice(0, 500);
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError("Route", `${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.status >= 500) req.log?.error({ err }, err.message);
    res.status(err.status).json(err.toBody());
    return;
  }
  if (err instanceof ZodError) {
    const v = ValidationError.fromZod(err);
    res.status(v.status).json(v.toBody());
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    const b = new BadRequestError("Malformed JSON body");
    res.status(b.status).json(b.toBody());
    return;
  }
  req.log?.error({ err }, "Unhandled error");
  res.status(500).json({
    error: { code: "INTERNAL", message: "Something went wrong on our side" },
  });
};
